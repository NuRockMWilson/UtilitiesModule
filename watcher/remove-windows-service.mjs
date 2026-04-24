#!/usr/bin/env node
import path from "node:path";

let Service;
try {
  ({ Service } = await import("node-windows"));
} catch {
  console.error("node-windows is not installed.");
  process.exit(1);
}

const svc = new Service({
  name: "NuRock Utilities Invoice Watcher",
  script: path.resolve("./watch-folder.mjs"),
});

svc.on("uninstall", () => {
  console.log("Service uninstalled.");
});

svc.uninstall();
