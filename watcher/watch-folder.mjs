#!/usr/bin/env node
/**
 * NuRock Utility Invoice folder watcher
 *
 * Watches H:\Claude\Utility Invoices (or whatever WATCH_FOLDER is set to)
 * and, whenever a new PDF lands, POSTs it to the app's intake endpoint.
 * Processed files move into dated subfolders for operational clarity;
 * failures move into a "failed" subfolder and are written to a log.
 *
 * Typical deployment: runs on Sharon's workstation as a Node background
 * process, or installed as a Windows service via `node-windows` (see README).
 *
 *   node watcher/watch-folder.mjs
 *
 * Required config (either .env in this folder OR OS env vars):
 *   APP_URL               https://utilities.nurock.com
 *   INTAKE_WEBHOOK_SECRET <same value as the web app>
 *   WATCH_FOLDER          H:\\Claude\\Utility Invoices
 *
 * Optional:
 *   MOVE_ON_SUCCESS       true|false (default true)
 *   MOVE_ON_FAILURE       true|false (default true)
 *   STABLE_WAIT_MS        2000       (ms to wait for file size stability)
 *   RETRY_LIMIT           3
 *   LOG_FILE              ./watcher.log
 */

import chokidar from "chokidar";
import fs from "node:fs/promises";
import fssync from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

// Inline .env loader — this script runs outside Next so we don't get dotenv for free.
try {
  const envPath = path.resolve(process.cwd(), ".env");
  if (fssync.existsSync(envPath)) {
    const content = fssync.readFileSync(envPath, "utf-8");
    for (const line of content.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m && !process.env[m[1]]) {
        let val = m[2];
        if ((val.startsWith('"') && val.endsWith('"')) ||
            (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
        process.env[m[1]] = val;
      }
    }
  }
} catch {}

const {
  APP_URL,
  INTAKE_WEBHOOK_SECRET,
  WATCH_FOLDER,
  MOVE_ON_SUCCESS = "true",
  MOVE_ON_FAILURE = "true",
  STABLE_WAIT_MS  = "2000",
  RETRY_LIMIT     = "3",
  LOG_FILE        = "./watcher.log",
} = process.env;

function die(msg) { console.error("[watcher] " + msg); process.exit(1); }

if (!APP_URL)               die("APP_URL not set (e.g. https://utilities.nurock.com)");
if (!INTAKE_WEBHOOK_SECRET) die("INTAKE_WEBHOOK_SECRET not set");
if (!WATCH_FOLDER)          die("WATCH_FOLDER not set (e.g. H:\\Claude\\Utility Invoices)");
if (!fssync.existsSync(WATCH_FOLDER)) die(`WATCH_FOLDER does not exist: ${WATCH_FOLDER}`);

const moveOnSuccess = MOVE_ON_SUCCESS === "true";
const moveOnFailure = MOVE_ON_FAILURE === "true";
const stableWaitMs  = parseInt(STABLE_WAIT_MS, 10);
const retryLimit    = parseInt(RETRY_LIMIT, 10);

const ingestUrl = `${APP_URL.replace(/\/$/, "")}/api/ingest/pdf`;

function log(level, msg, meta) {
  const line = `${new Date().toISOString()} [${level}] ${msg}${meta ? " " + JSON.stringify(meta) : ""}`;
  console.log(line);
  try { fssync.appendFileSync(LOG_FILE, line + "\n"); } catch {}
}

async function waitForStableSize(filePath) {
  let last = -1;
  for (let i = 0; i < 30; i++) {
    try {
      const stat = await fs.stat(filePath);
      if (stat.size === last && stat.size > 0) return stat.size;
      last = stat.size;
    } catch {
      return 0;
    }
    await new Promise(r => setTimeout(r, stableWaitMs));
  }
  return last;
}

async function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const s = fssync.createReadStream(filePath);
    s.on("error", reject);
    s.on("data", chunk => hash.update(chunk));
    s.on("end", () => resolve(hash.digest("hex")));
  });
}

async function postToIntake(filePath, contentHash) {
  const buffer = await fs.readFile(filePath);
  const filename = path.basename(filePath);

  const form = new FormData();
  form.append("file",             new Blob([buffer], { type: "application/pdf" }), filename);
  form.append("filename",         filename);
  form.append("content_sha256",   contentHash);
  form.append("source_reference", filePath);

  const res = await fetch(ingestUrl, {
    method: "POST",
    headers: { "X-Intake-Secret": INTAKE_WEBHOOK_SECRET },
    body: form,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${data.error ?? "unknown"}`);
  }
  return data;
}

async function moveTo(src, subfolder) {
  const date = new Date().toISOString().slice(0, 10);
  const destDir = path.join(WATCH_FOLDER, subfolder, date);
  await fs.mkdir(destDir, { recursive: true });
  const dest = path.join(destDir, path.basename(src));
  try {
    await fs.rename(src, dest);
  } catch (e) {
    if (e.code === "EXDEV") {
      // Cross-device rename on Windows network drives — fall back to copy + delete
      await fs.copyFile(src, dest);
      await fs.unlink(src);
    } else {
      throw e;
    }
  }
  return dest;
}

async function handleFile(filePath) {
  const base = path.basename(filePath);
  if (!base.toLowerCase().endsWith(".pdf")) return;
  if (base.startsWith(".")) return;

  log("info", `detected ${base}`);

  const size = await waitForStableSize(filePath);
  if (size === 0) {
    log("warn", `file vanished or zero-byte: ${base}`);
    return;
  }

  let hash;
  try {
    hash = await sha256File(filePath);
  } catch (e) {
    log("error", `hash failed for ${base}: ${e.message}`);
    if (moveOnFailure) await moveTo(filePath, "failed").catch(() => {});
    return;
  }

  for (let attempt = 1; attempt <= retryLimit; attempt++) {
    try {
      const result = await postToIntake(filePath, hash);
      log("info", `posted ${base}`, { invoice_id: result.invoice_id, duplicate: !!result.duplicate_of });
      if (moveOnSuccess) {
        const dest = await moveTo(filePath, "processed");
        log("info", `moved → ${dest}`);
      }
      return;
    } catch (e) {
      log("warn", `attempt ${attempt}/${retryLimit} failed for ${base}: ${e.message}`);
      if (attempt < retryLimit) {
        await new Promise(r => setTimeout(r, 2000 * attempt));
      }
    }
  }

  log("error", `giving up on ${base} after ${retryLimit} attempts`);
  if (moveOnFailure) {
    try {
      const dest = await moveTo(filePath, "failed");
      log("error", `moved to failed → ${dest}`);
    } catch (e) {
      log("error", `move to failed also failed: ${e.message}`);
    }
  }
}

// Exclude our own subfolders so we don't pick up processed files as new ones
const ignored = [
  /[\/\\]processed[\/\\]?/,
  /[\/\\]failed[\/\\]?/,
  /^\./,
];

log("info", `watching ${WATCH_FOLDER}`, {
  ingestUrl,
  moveOnSuccess,
  moveOnFailure,
});

const watcher = chokidar.watch(WATCH_FOLDER, {
  ignored,
  persistent: true,
  ignoreInitial: false,   // pick up any PDFs already in the folder when we start
  awaitWriteFinish: {
    stabilityThreshold: stableWaitMs,
    pollInterval: 500,
  },
  usePolling: true,       // reliable over SMB/network drives on Windows
  interval: 2000,
  depth: 0,               // only watch the folder itself, not recurse
});

watcher.on("add", (filePath) => {
  handleFile(filePath).catch(err => {
    log("error", `unhandled in handleFile: ${err.message}`);
  });
});

watcher.on("error", err => {
  log("error", `chokidar: ${err.message}`);
});

process.on("SIGINT",  () => { log("info", "shutting down"); watcher.close().finally(() => process.exit(0)); });
process.on("SIGTERM", () => { log("info", "shutting down"); watcher.close().finally(() => process.exit(0)); });
