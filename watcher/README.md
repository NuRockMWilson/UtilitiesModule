# NuRock Utilities Invoice Watcher

Watches `H:\Claude\Utility Invoices` (or any configured folder) and posts every new PDF to the NuRock Utilities AP app for automatic extraction, coding, and variance analysis.

## Why this exists

Dakota scans mail bills into the H: drive; vendor portal bills are often downloaded manually into the same folder. This watcher means AP doesn't have to remember to go upload anything — drop a PDF in the folder, and within ~30 seconds it's sitting in the Invoices list ready for Sharon's pass.

## Install

On the NuRock workstation where the H: drive is mounted (typically Sharon's or Dakota's machine):

```
cd watcher
npm install
cp .env.example .env
# edit .env with your values
npm start
```

That runs it in the foreground — useful for the first smoke test. Once you confirm a test PDF lands, the scan gets processed, and the file moves into `processed\YYYY-MM-DD\`, install it as a Windows service so it survives reboots.

## Run as a Windows service

```
npm install node-windows
npm run install-service
```

The watcher now runs at boot, restarts on crash, and logs to `watcher.log` in its working directory. To remove:

```
npm run remove-service
```

Services log to both `watcher.log` and the Windows Event Log under "NuRock Utilities Invoice Watcher".

## Configuration

`.env` settings:

| Variable | Purpose | Default |
|---|---|---|
| `APP_URL` | Base URL of the utilities AP app | (required) |
| `INTAKE_WEBHOOK_SECRET` | Must match the value in the web app's env | (required) |
| `WATCH_FOLDER` | Path to watch | `H:\Claude\Utility Invoices` |
| `MOVE_ON_SUCCESS` | Move processed files to `processed\YYYY-MM-DD\` | `true` |
| `MOVE_ON_FAILURE` | Move failed files to `failed\YYYY-MM-DD\` | `true` |
| `STABLE_WAIT_MS` | Milliseconds to wait for file size stability before posting | `2000` |
| `RETRY_LIMIT` | Max POST attempts before declaring failure | `3` |
| `LOG_FILE` | Append log path | `./watcher.log` |

## How it works

1. Chokidar polls the folder (polling works reliably across SMB / mapped network drives where inotify-style events don't).
2. When a new `.pdf` appears, the watcher waits until its size has been stable for `STABLE_WAIT_MS` (so a scanner writing a big PDF doesn't get posted mid-write).
3. Computes a SHA-256 hash of the file contents.
4. POSTs the file + hash + path to `${APP_URL}/api/ingest/pdf` with the shared secret in the `X-Intake-Secret` header.
5. The app dedupes by hash — if a bill with that exact content already exists, the watcher logs it and moves on without creating a duplicate invoice.
6. On success, moves the source PDF to `processed\YYYY-MM-DD\`. On failure after `RETRY_LIMIT` attempts, moves it to `failed\YYYY-MM-DD\` so it's visible for manual review.

Subfolders created and managed automatically:
```
H:\Claude\Utility Invoices\
├─ processed\2026-04-24\       (successfully posted files)
├─ failed\2026-04-24\          (could not post after retries)
└─ watcher.log                 (append-only log)
```

## Troubleshooting

**"EPERM: operation not permitted, rename"** — the network share is mounted read-only or the service account doesn't have write access. Either mount with write permission or set `MOVE_ON_SUCCESS=false` (processed files stay in place; dedup ensures they're not re-posted).

**Nothing happens when I drop a file** — check `watcher.log`. If there's no "detected" line, the polling interval may be too slow; drop `STABLE_WAIT_MS` and raise chokidar polling frequency in `watch-folder.mjs`. If you see "detected" but no "posted", check `APP_URL` and `INTAKE_WEBHOOK_SECRET` match the web app.

**Service won't start after Windows reboot** — check Windows Event Viewer under "NuRock Utilities Invoice Watcher". Most common cause is the H: drive hasn't mounted yet; set a small startup delay or run under a service account that has persistent drive mappings.
