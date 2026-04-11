#!/usr/bin/env node
/**
 * WebSocket Monitor Test — data-level diagnostic
 * 
 * Tests the full WebSocket pipeline:
 *   1. Direct connection to backend (bypasses gateway)
 *   2. Connection via gateway (the browser path)
 *   3. Triggers a tool call via HTTP API to generate events
 *   4. Verifies events arrive on both connections
 * 
 * Usage:
 *   node tests/ws-monitor-test.js [--direct-only] [--gateway-only]
 */

import http from 'node:http';
import net from 'node:net';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ═══ Config ═══

const REGISTRY_DIR = path.join(process.env.HOME || '/tmp', '.local-gateway');
const REGISTRY_FILE = path.join(REGISTRY_DIR, 'services.json');
const GATEWAY_PID_FILE = path.join(REGISTRY_DIR, 'gateway.pid');

const args = process.argv.slice(2);
const DIRECT_ONLY = args.includes('--direct-only');
const GATEWAY_ONLY = args.includes('--gateway-only');

// ═══ Colors for CLI output ═══

const C = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
  blue: '\x1b[34m',
};

function log(icon, msg, color = '') {
  const ts = new Date().toISOString().slice(11, 23);
  console.log(`${C.dim}${ts}${C.reset} ${color}${icon}${C.reset} ${msg}`);
}

function logEvent(source, data) {
  const type = data.type || 'unknown';
  const tool = data.tool || '';
  const dur = data.duration_ms ? ` (${data.duration_ms}ms)` : '';
  const success = data.success !== undefined ? (data.success ? C.green + ' ✓' : C.red + ' ✗') + C.reset : '';
  log('◆', `${C.bold}[${source}]${C.reset} ${type} ${C.cyan}${tool}${C.reset}${dur}${success}`);
  
  if (data.args) {
    const argStr = JSON.stringify(data.args);
    log(' ', `  args: ${C.dim}${argStr.length > 120 ? argStr.slice(0, 120) + '...' : argStr}${C.reset}`);
  }
  if (data.result_keys) {
    log(' ', `  result_keys: ${C.dim}${data.result_keys.join(', ')}${C.reset}`);
  }
}

// ═══ Registry helpers ═══

function readRegistry() {
  try {
    return JSON.parse(fs.readFileSync(REGISTRY_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function readGatewayPid() {
  try {
    return JSON.parse(fs.readFileSync(GATEWAY_PID_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function isProcessAlive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

// ═══ WebSocket client (raw, no dependencies) ═══

function wsConnect(host, port, wsPath, label, hostOverride, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const key = crypto.randomBytes(16).toString('base64');
    const hostHeader = hostOverride || (port === 80 ? host : `${host}:${port}`);
    const extraStr = Object.entries(extraHeaders).map(([k, v]) => `${k}: ${v}\r\n`).join('');
    const socket = net.createConnection({ host, port }, () => {
      socket.write(
        `GET ${wsPath} HTTP/1.1\r\n` +
        `Host: ${hostHeader}\r\n` +
        `Upgrade: websocket\r\n` +
        `Connection: Upgrade\r\n` +
        `Sec-WebSocket-Key: ${key}\r\n` +
        `Sec-WebSocket-Version: 13\r\n` +
        `Origin: http://${hostHeader}\r\n` +
        extraStr +
        `\r\n`
      );
    });

    let upgraded = false;
    let headerBuf = Buffer.alloc(0);
    let dataBuf = Buffer.alloc(0);
    const events = [];

    const ws = {
      socket,
      events,
      label,
      close: () => {
        // Send WS close frame
        const close = Buffer.alloc(6);
        close[0] = 0x88; // FIN + close
        close[1] = 0x80; // Masked, length 0
        crypto.randomBytes(4).copy(close, 2);
        try { socket.write(close); } catch {}
        socket.end();
      },
    };

    socket.on('data', (chunk) => {
      if (!upgraded) {
        headerBuf = Buffer.concat([headerBuf, chunk]);
        const headerEnd = headerBuf.indexOf('\r\n\r\n');
        if (headerEnd === -1) return;

        const headerStr = headerBuf.slice(0, headerEnd).toString();
        const statusLine = headerStr.split('\r\n')[0];
        
        if (!statusLine.includes('101')) {
          log('✗', `[${label}] Upgrade denied: ${statusLine}`, C.red);
          socket.destroy();
          reject(new Error(`Upgrade failed: ${statusLine}`));
          return;
        }

        log('✓', `[${label}] WebSocket upgraded: ${C.green}${statusLine}${C.reset}`);
        upgraded = true;

        // Remaining data after headers is WS data
        dataBuf = headerBuf.slice(headerEnd + 4);
        resolve(ws);
        // Process any remaining data
        if (dataBuf.length > 0) processFrames();
        return;
      }

      dataBuf = Buffer.concat([dataBuf, chunk]);
      processFrames();
    });

    function processFrames() {
      while (dataBuf.length >= 2) {
        const opcode = dataBuf[0] & 0x0F;
        const masked = dataBuf[1] & 0x80;
        let payloadLen = dataBuf[1] & 0x7F;
        let offset = 2;

        if (payloadLen === 126) {
          if (dataBuf.length < 4) return;
          payloadLen = dataBuf.readUInt16BE(2);
          offset = 4;
        } else if (payloadLen === 127) {
          if (dataBuf.length < 10) return;
          payloadLen = Number(dataBuf.readBigUInt64BE(2));
          offset = 10;
        }

        if (masked) offset += 4; // skip mask key
        if (dataBuf.length < offset + payloadLen) return;

        let payload = dataBuf.slice(offset, offset + payloadLen);
        if (masked) {
          const mask = dataBuf.slice(offset - 4, offset);
          for (let i = 0; i < payload.length; i++) {
            payload[i] ^= mask[i % 4];
          }
        }

        dataBuf = dataBuf.slice(offset + payloadLen);

        if (opcode === 0x1) {
          // Text frame
          try {
            const data = JSON.parse(payload.toString());
            events.push(data);
            logEvent(label, data);
          } catch (e) {
            log('?', `[${label}] Non-JSON text: ${payload.toString().slice(0, 100)}`, C.yellow);
          }
        } else if (opcode === 0x8) {
          log('●', `[${label}] Server sent close frame`, C.dim);
        } else if (opcode === 0x9) {
          // Ping — send pong
          const pong = Buffer.alloc(2 + payloadLen + 4);
          pong[0] = 0x8A; // FIN + pong
          pong[1] = 0x80 | payloadLen; // Masked
          const mask = crypto.randomBytes(4);
          mask.copy(pong, 2);
          for (let i = 0; i < payloadLen; i++) {
            pong[6 + i] = payload[i] ^ mask[i % 4];
          }
          try { socket.write(pong); } catch {}
        }
      }
    }

    socket.on('error', (err) => {
      if (!upgraded) {
        log('✗', `[${label}] Connection error: ${err.message}`, C.red);
        reject(err);
      }
    });

    socket.on('close', () => {
      if (!upgraded) reject(new Error('Connection closed before upgrade'));
    });

    setTimeout(() => {
      if (!upgraded) {
        socket.destroy();
        reject(new Error('Upgrade timeout (3s)'));
      }
    }, 3000);
  });
}

// ═══ HTTP API call to trigger events ═══

function triggerToolCall(host, port, apiPath) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host, port, path: apiPath,
      method: 'GET',
      headers: { 'Accept': 'application/json' },
    }, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        resolve({ status: res.statusCode, body: body.slice(0, 200) });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

// ═══ Main test ═══

async function main() {
  console.log(`\n${C.bold}${C.cyan}  ═══ WebSocket Monitor Pipeline Test ═══${C.reset}\n`);

  // Step 1: Read registry state
  const reg = readRegistry();
  const gwInfo = readGatewayPid();
  
  log('◎', `Registry: ${C.dim}${REGISTRY_FILE}${C.reset}`);
  log('◎', `Registry contents: ${C.dim}${JSON.stringify(reg, null, 0).slice(0, 200)}${C.reset}`);
  
  if (gwInfo) {
    const alive = isProcessAlive(gwInfo.pid);
    log(alive ? '✓' : '✗', `Gateway PID ${gwInfo.pid} port ${gwInfo.port}: ${alive ? C.green + 'ALIVE' : C.red + 'DEAD'}${C.reset}`);
  } else {
    log('!', `No gateway PID file found`, C.yellow);
  }

  // Find backend
  const hostEntry = reg['project-graph.local'];
  let backendPort = null;
  let backendPrefix = null;

  if (hostEntry?.routes) {
    for (const [prefix, route] of Object.entries(hostEntry.routes)) {
      const alive = isProcessAlive(route.pid);
      log(alive ? '✓' : '✗', `Backend ${C.cyan}${prefix}${C.reset} PID ${route.pid} port ${route.port}: ${alive ? C.green + 'ALIVE' : C.red + 'DEAD'}${C.reset}`);
      if (alive) {
        backendPort = route.port;
        backendPrefix = prefix;
      }
    }
  } else if (hostEntry?.port) {
    const alive = isProcessAlive(hostEntry.pid);
    log(alive ? '✓' : '✗', `Backend port ${hostEntry.port}: ${alive ? 'ALIVE' : 'DEAD'}`);
    if (alive) backendPort = hostEntry.port;
  }

  if (!backendPort) {
    log('✗', `${C.red}${C.bold}No alive backend found!${C.reset}`, C.red);
    log('!', `Start the MCP server first. The gateway registers automatically.`, C.yellow);
    log(' ', `  Run: ${C.cyan}node src/server.js${C.reset} (or use an MCP client)`);
    process.exit(1);
  }

  console.log('');

  // Step 2: Test direct WebSocket to backend
  const connections = [];

  if (!GATEWAY_ONLY) {
    log('→', `${C.bold}Test 1: Direct WebSocket to backend${C.reset} (127.0.0.1:${backendPort}/ws/monitor)`);
    try {
      const directWS = await wsConnect('127.0.0.1', backendPort, '/ws/monitor', 'DIRECT');
      connections.push(directWS);
    } catch (err) {
      log('✗', `Direct WS failed: ${err.message}`, C.red);
    }
    console.log('');
  }

  // Step 3: Test gateway WebSocket
  if (!DIRECT_ONLY && gwInfo && isProcessAlive(gwInfo.pid)) {
    const gwPort = gwInfo.port;
    const wsPath = backendPrefix ? `${backendPrefix}/ws/monitor` : '/ws/monitor';
    log('→', `${C.bold}Test 2: Gateway WebSocket${C.reset} (project-graph.local:${gwPort}${wsPath})`);
    try {
      const gwWS = await wsConnect('127.0.0.1', gwPort, wsPath, 'GATEWAY', 'project-graph.local');
      connections.push(gwWS);
    } catch (err) {
      log('✗', `Gateway WS failed: ${err.message}`, C.red);
    }
    console.log('');
  } else if (!DIRECT_ONLY) {
    log('!', `Skipping gateway test — gateway not running`, C.yellow);
    console.log('');
  }

  // Step 3b: Test gateway with browser-like headers (includes extensions)
  if (!DIRECT_ONLY && gwInfo && isProcessAlive(gwInfo.pid)) {
    const gwPort = gwInfo.port;
    const wsPath = backendPrefix ? `${backendPrefix}/ws/monitor` : '/ws/monitor';
    log('→', `${C.bold}Test 2b: Gateway WS with browser headers${C.reset} (extensions, user-agent)`);
    try {
      const browserWS = await wsConnect('127.0.0.1', gwPort, wsPath, 'BROWSER', 'project-graph.local', {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Sec-WebSocket-Extensions': 'permessage-deflate; client_max_window_bits',
        'Accept-Encoding': 'gzip, deflate',
        'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.6,en;q=0.5',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
      });
      connections.push(browserWS);
    } catch (err) {
      log('✗', `Browser-like WS failed: ${err.message}`, C.red);
    }
    console.log('');
  }

  if (connections.length === 0) {
    log('✗', `${C.red}No WebSocket connections established. Aborting.${C.reset}`);
    process.exit(1);
  }

  // Step 4: Trigger a tool call via API
  log('→', `${C.bold}Test 3: Triggering tool event${C.reset} via /api/skeleton?path=.`);
  try {
    const result = await triggerToolCall('127.0.0.1', backendPort, '/api/skeleton?path=.');
    log('✓', `API response: ${C.green}${result.status}${C.reset} ${C.dim}${result.body.slice(0, 80)}...${C.reset}`);
  } catch (err) {
    log('✗', `API call failed: ${err.message}`, C.red);
  }

  // Step 5: Wait for events to arrive
  log('◎', `Waiting 3s for WebSocket events...`);
  await new Promise(r => setTimeout(r, 3000));

  // Step 6: Summary
  console.log(`\n${C.bold}${C.cyan}  ═══ Results ═══${C.reset}\n`);
  
  for (const ws of connections) {
    const count = ws.events.length;
    const icon = count > 0 ? '✓' : '✗';
    const color = count > 0 ? C.green : C.red;
    log(icon, `[${ws.label}] Received ${color}${C.bold}${count}${C.reset} events`);
    
    if (count > 0) {
      const types = {};
      for (const e of ws.events) {
        types[e.type] = (types[e.type] || 0) + 1;
      }
      log(' ', `  Types: ${C.dim}${JSON.stringify(types)}${C.reset}`);
    }
  }

  // Cleanup
  for (const ws of connections) {
    ws.close();
  }

  console.log(`\n${C.bold}Pipeline test complete.${C.reset}\n`);
  
  // Exit after cleanup
  setTimeout(() => process.exit(0), 500);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
