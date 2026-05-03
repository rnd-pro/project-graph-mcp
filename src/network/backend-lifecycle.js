import { readdirSync, readFileSync, unlinkSync, existsSync } from "node:fs";

import { join } from "node:path";

let BACKENDS_DIR = join(process.env.HOME || process.env.USERPROFILE || "/tmp", ".local-gateway", "backends");

export function listBackends() {
  if (!existsSync(BACKENDS_DIR)) return [];
  let files = readdirSync(BACKENDS_DIR).filter(f => f.endsWith(".json"));
  let active = [];
  for (let f of files) {
    try {
      let data = JSON.parse(readFileSync(join(BACKENDS_DIR, f), "utf8"));
      try {
        process.kill(data.pid, 0);
        active.push(data);
      } catch {
        try {
          unlinkSync(join(BACKENDS_DIR, f));
        } catch {}
      }
    } catch {}
  }
  return active;
}

export function writePortFile() {}

export function removePortFile() {}

export async function ensureBackend() {
  throw new Error("Singleton backend removed — use direct stdio via startStdioServer");
}

export function startStdioProxy() {
  throw new Error("Stdio proxy removed — use direct stdio via startStdioServer");
}
