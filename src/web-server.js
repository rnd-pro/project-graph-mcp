import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { createServer as createMCPServer } from './mcp-server.js';
import bus from './event-bus.js';
import { registerService } from './local-gateway.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.join(__dirname, '..');
const WEB_ROOT = path.join(PKG_ROOT, 'web');

/** Map /vendor/ requests to node_modules for npm-installed deps */
const VENDOR_MAP = {
  'symbiote-node': path.join(PKG_ROOT, 'node_modules', 'symbiote-node'),
  'symbiote': path.join(PKG_ROOT, 'node_modules', '@symbiotejs', 'symbiote'),
};

const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function serveStatic(reqPath, res) {
  const safePath = path.normalize(reqPath).replace(/^(\.\.[/\\])+/, '');

  // Resolve /vendor/<lib>/* from node_modules
  const vendorMatch = safePath.match(/^[/\\]?vendor[/\\]([^/\\]+)[/\\]?(.*)/);
  let filePath;
  let allowedRoot;

  if (vendorMatch && VENDOR_MAP[vendorMatch[1]]) {
    allowedRoot = VENDOR_MAP[vendorMatch[1]];
    filePath = path.join(allowedRoot, vendorMatch[2] || 'index.js');
  } else {
    allowedRoot = WEB_ROOT;
    filePath = path.join(WEB_ROOT, safePath === '/' ? 'index.html' : safePath);
  }

  if (!filePath.startsWith(allowedRoot)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, 'index.html');
  }

  if (!fs.existsSync(filePath)) {
    res.writeHead(404);
    res.end('Not Found');
    return;
  }

  const ext = path.extname(filePath);
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  const content = fs.readFileSync(filePath);
  res.writeHead(200, {
    'Content-Type': contentType,
    'Cache-Control': 'no-cache, no-store, must-revalidate',
  });
  res.end(content);
}

// WebSocket helpers (zero-dependency)
function computeWSAccept(key) {
  return crypto.createHash('sha1')
    .update(key + '258EAFA5-E914-47DA-95CA-5AB5ADF35C70')
    .digest('base64');
}

function encodeWSFrame(data) {
  const payload = Buffer.from(data, 'utf8');
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x81; // FIN + text
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, payload]);
}

function decodeWSFrame(buf) {
  if (buf.length < 2) return null;
  const opcode = buf[0] & 0x0F;
  const masked = !!(buf[1] & 0x80);
  let payloadLen = buf[1] & 0x7F;
  let offset = 2;

  if (payloadLen === 126) {
    if (buf.length < 4) return null;
    payloadLen = buf.readUInt16BE(2);
    offset = 4;
  } else if (payloadLen === 127) {
    if (buf.length < 10) return null;
    payloadLen = Number(buf.readBigUInt64BE(2));
    offset = 10;
  }

  if (masked) {
    if (buf.length < offset + 4 + payloadLen) return null;
    const mask = buf.slice(offset, offset + 4);
    offset += 4;
    const data = buf.slice(offset, offset + payloadLen);
    for (let i = 0; i < data.length; i++) data[i] ^= mask[i % 4];
    return { opcode, data: data.toString('utf8'), totalLen: offset + payloadLen };
  }

  if (buf.length < offset + payloadLen) return null;
  return { opcode, data: buf.slice(offset, offset + payloadLen).toString('utf8'), totalLen: offset + payloadLen };
}

export function startWebServer(projectPath, port) {
  const mcpServer = createMCPServer(() => {});
  const projectName = path.basename(path.resolve(projectPath)) || 'root';
  let nextAgentId = 1;

  // ═══ Reactive Server State Graph ═══
  const absPath = path.resolve(projectPath);
  const colorHash = crypto.createHash('md5').update(absPath).digest('hex');
  const colorHue = parseInt(colorHash.slice(0, 4), 16) % 360;

  const serverState = {
    project: {
      name: projectName,
      path: absPath,
      color: `hsl(${colorHue}, 65%, 55%)`,
      agents: 0,
      pid: process.pid,
    },
    skeleton: null,   // loaded lazily on first request
    events: [],       // last 500 tool events
  };

  /** Broadcast JSON-RPC 2.0 notification to all monitor WS clients */
  function broadcastRPC(method, params) {
    const msg = JSON.stringify({ jsonrpc: '2.0', method, params });
    for (const client of wsClients) {
      try { client.send(msg); } catch { wsClients.delete(client); }
    }
  }

  /** Update serverState field and broadcast patch to all clients */
  function patchState(statePath, value) {
    // Apply to local state
    const keys = statePath.split('.');
    let target = serverState;
    for (let i = 0; i < keys.length - 1; i++) target = target[keys[i]];
    target[keys[keys.length - 1]] = value;
    // Broadcast patch
    broadcastRPC('patch', { path: statePath, value });
  }

  /** Load skeleton into state (lazy, cached) */
  async function ensureSkeleton() {
    if (!serverState.skeleton) {
      try {
        serverState.skeleton = await mcpServer.executeTool('get_skeleton', { path: projectPath });
      } catch { /* skeleton not available yet */ }
    }
    return serverState.skeleton;
  }

  // ═══ MCP Agent + Monitor connections ═══
  const mcpAgents = new Map(); // socket → { id, mcpServer, agentId, connectedAt }
  const wsClients = new Set(); // monitor WS clients
  let shutdownTimer = null;
  const SHUTDOWN_DELAY = 15 * 60 * 1000; // 15 minutes

  function hasActiveClients() {
    return mcpAgents.size > 0 || wsClients.size > 0;
  }

  function resetShutdownTimer() {
    if (shutdownTimer) {
      clearTimeout(shutdownTimer);
      shutdownTimer = null;
    }
  }

  function startShutdownTimer() {
    if (hasActiveClients()) return;
    resetShutdownTimer();
    shutdownTimer = setTimeout(() => {
      if (!hasActiveClients()) {
        console.log('[project-graph] No clients for 15 min — shutting down.');
        process.exit(0);
      }
    }, SHUTDOWN_DELAY);
  }

  /** Call on any activity (API call, WS message) to keep backend alive */
  function touchActivity() {
    resetShutdownTimer();
    startShutdownTimer();
  }

  // Start idle timer immediately — if nobody connects, auto-exit
  startShutdownTimer();

  // API route handlers — reuse existing consolidated tool handlers
  async function handleAPI(pathname, query, req, res) {
    try {
      let result;
      const p = query.get('path') || projectPath;

      switch (pathname) {
        case '/api/skeleton':
          result = await mcpServer.executeTool('get_skeleton', { path: p });
          break;
        case '/api/file':
          result = await mcpServer.executeTool('compact', {
            action: 'compress_file',
            path: query.get('path'),
            beautify: true,
          });
          break;
        case '/api/raw-file': {
          const rawPath = query.get('path');
          try {
            const { readFileSync } = await import('fs');
            const { resolve, relative } = await import('path');
            const fullPath = resolve(projectPath, rawPath);
            const content = readFileSync(fullPath, 'utf-8');
            result = { content, file: rawPath };
          } catch (e) {
            result = { content: `// Cannot read: ${e.message}`, file: rawPath };
          }
          break;
        }
        case '/api/docs':
          result = await mcpServer.executeTool('docs', {
            action: 'get',
            path: p,
            file: query.get('file'),
          });
          break;
        case '/api/analysis':
          result = await mcpServer.executeTool('analyze', {
            action: 'full_analysis',
            path: p,
          });
          break;
        case '/api/analysis-summary':
          result = await mcpServer.executeTool('analyze', {
            action: 'analysis_summary',
            path: p,
          });
          break;
        case '/api/deps':
          result = await mcpServer.executeTool('navigate', {
            action: 'deps',
            symbol: query.get('symbol'),
          });
          break;
        case '/api/usages':
          result = await mcpServer.executeTool('navigate', {
            action: 'usages',
            symbol: query.get('symbol'),
          });
          break;
        case '/api/expand':
          result = await mcpServer.executeTool('navigate', {
            action: 'expand',
            symbol: query.get('symbol'),
          });
          break;
        case '/api/chain':
          result = await mcpServer.executeTool('navigate', {
            action: 'call_chain',
            from: query.get('from'),
            to: query.get('to'),
          });
          break;

        // ═══ New: project identity & multi-instance ═══
        case '/api/project-info': {
          const abs = path.resolve(projectPath);
          const hash = crypto.createHash('md5').update(abs).digest('hex');
          const hue = parseInt(hash.slice(0, 4), 16) % 360;
          result = {
            name: projectName,
            path: abs,
            color: `hsl(${hue}, 65%, 55%)`,
            agents: mcpAgents.size,
            pid: process.pid,
          };
          break;
        }
        case '/api/instances': {
          try {
            const { listBackends } = await import('./backend-lifecycle.js');
            result = listBackends();
          } catch {
            result = [{ name: projectName, path: path.resolve(projectPath), agents: mcpAgents.size }];
          }
          break;
        }

        default:
          res.writeHead(200, { 
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache, no-store, must-revalidate',
          });
          res.end(JSON.stringify({ error: 'Unknown API endpoint' }));
          return;
      }

      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-cache',
      });
      res.end(JSON.stringify(result));
    } catch (err) {
      res.writeHead(500, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      });
      res.end(JSON.stringify({ error: err.message }));
    }
  }


  // Event bus → broadcast as legacy events AND push to serverState.events
  bus.on('tool:call', (event) => {
    serverState.events.push(event);
    if (serverState.events.length > 500) serverState.events.shift();
    broadcastRPC('event', event);
  });
  bus.on('tool:result', (event) => {
    serverState.events.push(event);
    if (serverState.events.length > 500) serverState.events.shift();
    broadcastRPC('event', event);
  });

  // HTTP server
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${port || 0}`);

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST',
        'Access-Control-Allow-Headers': 'Content-Type',
      });
      res.end();
      return;
    }

    if (url.pathname.startsWith('/api/')) {
      touchActivity();
      handleAPI(url.pathname, url.searchParams, req, res);
      return;
    }

    if (url.pathname === '/ws/monitor') {
      console.log('UNEXPECTED HTTP /ws/monitor', req.headers);
    }
    
    serveStatic(url.pathname, res);
  });


  // ═══ Monitor WebSocket via 'ws' library ═══
  // Supports JSON-RPC 2.0: snapshot on connect, patches, and tool calls
  const monitorWSS = new WebSocketServer({ noServer: true });
  monitorWSS.on('connection', async (ws) => {
    wsClients.add(ws);
    touchActivity();

    // Send initial state snapshot via JSON-RPC 2.0 (without events — those stream live)
    await ensureSkeleton();
    const snapshot = {
      project: serverState.project,
      skeleton: serverState.skeleton,
    };
    try {
      ws.send(JSON.stringify({
        jsonrpc: '2.0',
        method: 'snapshot',
        params: { state: snapshot },
      }));
    } catch { /* client may have disconnected */ }

    // Handle incoming JSON-RPC 2.0 requests (tool calls from UI)
    ws.on('message', async (raw) => {
      touchActivity();
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }

      // Only handle JSON-RPC 2.0 requests (must have 'id' and 'method')
      if (!msg.jsonrpc || !msg.id || !msg.method) return;

      if (msg.method === 'tool') {
        // Execute MCP tool via WS: { method: "tool", params: { name, args } }
        const { name, args } = msg.params || {};
        try {
          const result = await mcpServer.executeTool(name, args || {});
          ws.send(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }));
        } catch (err) {
          ws.send(JSON.stringify({
            jsonrpc: '2.0', id: msg.id,
            error: { code: -32000, message: err.message },
          }));
        }
      } else {
        ws.send(JSON.stringify({
          jsonrpc: '2.0', id: msg.id,
          error: { code: -32601, message: `Unknown method: ${msg.method}` },
        }));
      }
    });

    ws.on('close', () => {
      wsClients.delete(ws);
      startShutdownTimer();
    });
    ws.on('error', () => {
      wsClients.delete(ws);
      startShutdownTimer();
    });
  });

  // ═══ WebSocket upgrade — supports /ws/monitor AND /mcp-ws ═══
  server.on('upgrade', (req, socket, head) => {
    const key = req.headers['sec-websocket-key'];
    if (!key) { socket.destroy(); return; }

    // ── Monitor WebSocket (browser) — delegate to ws library ──
    if (req.url === '/ws/monitor') {
      monitorWSS.handleUpgrade(req, socket, head, (ws) => {
        monitorWSS.emit('connection', ws, req);
      });
      return;
    }

    // ── MCP WebSocket (stdio proxy agents) ──
    if (req.url === '/mcp-ws') {
      const accept = computeWSAccept(key);
      socket.write(
        'HTTP/1.1 101 Switching Protocols\r\n' +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        `Sec-WebSocket-Accept: ${accept}\r\n` +
        '\r\n'
      );

      const agentId = `agent-${nextAgentId++}`;
      const agentMCP = createMCPServer((msg) => {
        // Send server→client message back through WebSocket
        try { socket.write(encodeWSFrame(JSON.stringify(msg))); } catch {}
      });

      mcpAgents.set(socket, { agentId, mcpServer: agentMCP, connectedAt: Date.now() });
      resetShutdownTimer();

      // Update state + broadcast agent connect
      patchState('project.agents', mcpAgents.size);
      broadcastRPC('event', { type: 'agent_connect', agentId, agents: mcpAgents.size, ts: Date.now() });

      let buf = Buffer.alloc(0);
      socket.on('data', (chunk) => {
        buf = Buffer.concat([buf, chunk]);

        // Process all complete frames
        while (buf.length >= 2) {
          const frame = decodeWSFrame(buf);
          if (!frame) break;

          buf = buf.slice(frame.totalLen);

          if (frame.opcode === 0x8) {
            // Close
            mcpAgents.delete(socket);
            patchState('project.agents', mcpAgents.size);
            broadcastRPC('event', { type: 'agent_disconnect', agentId, agents: mcpAgents.size, ts: Date.now() });
            socket.end();
            if (mcpAgents.size === 0) startShutdownTimer();
            return;
          }

          if (frame.opcode === 0x9) {
            // Ping → Pong
            const pong = Buffer.from(chunk);
            pong[0] = (pong[0] & 0xF0) | 0xA;
            socket.write(pong);
            continue;
          }

          if (frame.opcode === 0x1) {
            // Text frame — JSON-RPC message
            (async () => {
              try {
                const message = JSON.parse(frame.data);
                const response = await agentMCP.handleMessage(message);
                if (response !== null) {
                  socket.write(encodeWSFrame(JSON.stringify(response)));
                }
              } catch (e) {
                socket.write(encodeWSFrame(JSON.stringify({
                  jsonrpc: '2.0',
                  error: { code: -32700, message: 'Parse error' },
                })));
              }
            })();
          }
        }
      });

      socket.on('close', () => {
        mcpAgents.delete(socket);
        patchState('project.agents', mcpAgents.size);
        broadcastRPC('event', { type: 'agent_disconnect', agentId, agents: mcpAgents.size, ts: Date.now() });
        if (mcpAgents.size === 0) startShutdownTimer();
      });
      socket.on('error', () => {
        mcpAgents.delete(socket);
        if (mcpAgents.size === 0) startShutdownTimer();
      });
      return;
    }

    socket.destroy();
  });

  // ═══ Listen ═══
  const useGateway = !port;
  const backendPort = port || 0; // 0 = OS picks a free port

  server.listen(backendPort, '127.0.0.1', () => {
    const actualPort = server.address().port;

    if (useGateway) {
      // Register with shared gateway
      const gw = registerService('project-graph', actualPort, {
        projectPath: path.resolve(projectPath),
        projectName,
      });

      // Defer output slightly — gateway may be starting on fallback port
      setTimeout(() => {
        const gwUrl = gw.url;
        console.log(`\n  ⬡ project-graph-mcp`);
        console.log(`  ─────────────────────────────`);
        console.log(`  → ${gwUrl}`);
        console.log(`  → ${gw.directUrl}  (direct)`);
        console.log(`  → Project: ${path.resolve(projectPath)}`);
        console.log(`  → MCP WebSocket: ws://127.0.0.1:${actualPort}/mcp-ws\n`);
      }, 200);
    } else {
      console.log(`\n  ⬡ project-graph-mcp`);
      console.log(`  ─────────────────────────────`);
      console.log(`  → http://localhost:${actualPort}/`);
      console.log(`  → Project: ${path.resolve(projectPath)}`);
      console.log(`  → MCP WebSocket: ws://127.0.0.1:${actualPort}/mcp-ws\n`);
    }
  });

  return server;
}

