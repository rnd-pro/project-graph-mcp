#!/usr/bin/env node
/**
 * Backend — singleton process per project.
 *
 * Spawned as a detached child by backend-lifecycle.js.
 * Combines web server + MCP WebSocket endpoint.
 * All agents for this project connect here.
 *
 * Usage (internal — spawned automatically):
 *   node src/backend.js /path/to/project
 */
import { resolve } from 'node:path';
import { startWebServer } from './web-server.js';
import { writePortFile, removePortFile } from './backend-lifecycle.js';

const projectPath = resolve(process.argv[2] || '.');

// Cleanup on exit
function cleanup() {
  removePortFile(projectPath);
}
process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(); });
process.on('SIGTERM', () => { cleanup(); process.exit(); });

// Start server on random port
const server = startWebServer(projectPath, 0);

// Write portfile once listening (server.listen callback is in web-server.js)
// We need to wait for the server to actually listen
const checkReady = setInterval(() => {
  const addr = server.address();
  if (addr) {
    clearInterval(checkReady);
    writePortFile(projectPath, addr.port);
  }
}, 50);
