#!/usr/bin/env node
/**
 * Install the folder watcher as a Windows service so it starts at boot and
 * restarts on crash. Requires `npm install node-windows` to have succeeded
 * (it's listed as an optionalDependency so installs work on non-Windows
 * machines too).
 *
 *   node install-windows-service.mjs
 *
 * To uninstall, run `node remove-windows-service.mjs`.
 */

import path from "node:path";

let Service;
try {
  ({ Service } = await import("node-windows"));
} catch {
  console.error("node-windows is not installed. Run: npm install node-windows");
  process.exit(1);
}

const svc = new Service({
  name: "NuRock Utilities Invoice Watcher",
  description: "Watches the utility invoice drop folder and posts new PDFs to the NuRock Utilities AP app.",
  script: path.resolve("./watch-folder.mjs"),
  nodeOptions: [],
  workingDirectory: path.resolve("."),
});

svc.on("install", () => {
  console.log("Installed. Starting service…");
  svc.start();
});

svc.on("alreadyinstalled", () => {
  console.log("Service already installed.");
});

svc.on("start", () => {
  console.log("Service started.");
});

svc.install();
