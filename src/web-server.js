import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
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
  res.writeHead(200, { 'Content-Type': contentType });
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
  const projectName = path.basename(path.resolve(projectPath));
  let nextAgentId = 1;

  // ═══ MCP Agent connections (stdio proxy WebSocket clients) ═══
  const mcpAgents = new Map(); // socket → { id, mcpServer, agentId, connectedAt }
  let shutdownTimer = null;
  const SHUTDOWN_DELAY = 15 * 60 * 1000; // 15 minutes

  function resetShutdownTimer() {
    if (shutdownTimer) {
      clearTimeout(shutdownTimer);
      shutdownTimer = null;
    }
  }

  function startShutdownTimer() {
    if (mcpAgents.size > 0) return;
    shutdownTimer = setTimeout(() => {
      if (mcpAgents.size === 0) {
        console.log('[project-graph] No agents connected for 15 min — shutting down.');
        process.exit(0);
      }
    }, SHUTDOWN_DELAY);
  }

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
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Unknown API endpoint' }));
          return;
      }

      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(JSON.stringify(result));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
  }

  // ═══ WebSocket broadcast (monitor) ═══
  const wsClients = new Set();

  function broadcastWS(data) {
    const payload = JSON.stringify(data);
    const frame = encodeWSFrame(payload);
    for (const client of wsClients) {
      try { client.write(frame); } catch { wsClients.delete(client); }
    }
  }

  bus.on('tool:call', (event) => broadcastWS(event));
  bus.on('tool:result', (event) => broadcastWS(event));

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
      handleAPI(url.pathname, url.searchParams, req, res);
      return;
    }

    serveStatic(url.pathname, res);
  });

  // ═══ WebSocket upgrade — supports /ws/monitor AND /mcp-ws ═══
  server.on('upgrade', (req, socket) => {
    const key = req.headers['sec-websocket-key'];
    if (!key) { socket.destroy(); return; }

    // ── Monitor WebSocket (browser) ──
    if (req.url === '/ws/monitor') {
      const accept = computeWSAccept(key);
      socket.write(
        'HTTP/1.1 101 Switching Protocols\r\n' +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        `Sec-WebSocket-Accept: ${accept}\r\n` +
        '\r\n'
      );
      wsClients.add(socket);

      socket.on('data', (buf) => {
        if (buf.length >= 2) {
          const opcode = buf[0] & 0x0F;
          if (opcode === 0x8) { wsClients.delete(socket); socket.end(); }
          else if (opcode === 0x9) {
            const pong = Buffer.from(buf);
            pong[0] = (pong[0] & 0xF0) | 0xA;
            socket.write(pong);
          }
        }
      });
      socket.on('close', () => wsClients.delete(socket));
      socket.on('error', () => wsClients.delete(socket));
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

      // Broadcast agent connect event
      broadcastWS({ type: 'agent_connect', agentId, agents: mcpAgents.size, ts: Date.now() });

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
            broadcastWS({ type: 'agent_disconnect', agentId, agents: mcpAgents.size, ts: Date.now() });
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
        broadcastWS({ type: 'agent_disconnect', agentId, agents: mcpAgents.size, ts: Date.now() });
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

