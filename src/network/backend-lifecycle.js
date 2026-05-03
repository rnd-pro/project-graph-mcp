// @ctx backend-lifecycle.ctx
// Retained for backward compatibility with older IDE configs that may still reference this module.
// The singleton backend pattern was removed when the web UI was extracted to mcp-agent-portal.
// project-graph-mcp now runs as a pure stdio MCP server — no detached backend, no port files.

import { readdirSync, readFileSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';

let BACKENDS_DIR = join(process.env.HOME || process.env.USERPROFILE || '/tmp', '.local-gateway', 'backends');

/**
 * List all active local-gateway backends (from any MCP server).
 * Used by agent-portal for service discovery.
 * @returns {Array<{ name: string, project: string, port: number, pid: number }>}
 */
export function listBackends() {
  if (!existsSync(BACKENDS_DIR)) return [];
  let files = readdirSync(BACKENDS_DIR).filter(f => f.endsWith('.json'));
  let active = [];
  for (let f of files) {
    try {
      let data = JSON.parse(readFileSync(join(BACKENDS_DIR, f), 'utf8'));
      try {
        process.kill(data.pid, 0);
        active.push(data);
      } catch {
        try { unlinkSync(join(BACKENDS_DIR, f)); } catch {}
      }
    } catch {}
  }
  return active;
}

// Legacy exports — no-op stubs for backward compatibility
export function writePortFile() {}
export function removePortFile() {}
export async function ensureBackend() { throw new Error('Singleton backend removed — use direct stdio via startStdioServer'); }
export function startStdioProxy() { throw new Error('Stdio proxy removed — use direct stdio via startStdioServer'); }