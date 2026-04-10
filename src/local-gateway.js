/**
 * Local Gateway — shared reverse proxy for .local services
 *
 * Runs on port 80, routes by Host header OR path prefix to backend services.
 *
 * Routing modes:
 *   1. Hostname routing: project-graph.local → port X (default)
 *   2. Path-prefix routing: project-graph.local/my-api/ → port X
 *                          project-graph.local/frontend/ → port Y
 *
 * Registry format (services.json):
 *   { "project-graph.local": { port, pid, name, routes: { "/my-api": { port, pid } } } }
 *
 * @module project-graph-mcp/local-gateway
 */
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { registerLocal } from './mdns.js';

const REGISTRY_DIR = path.join(
  process.env.HOME || process.env.USERPROFILE || '/tmp',
  '.local-gateway',
);
const REGISTRY_FILE = path.join(REGISTRY_DIR, 'services.json');
const GATEWAY_PID_FILE = path.join(REGISTRY_DIR, 'gateway.pid');

// ═══ Registry helpers ═══

function readRegistry() {
  try {
    return JSON.parse(fs.readFileSync(REGISTRY_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function writeRegistry(reg) {
  fs.mkdirSync(REGISTRY_DIR, { recursive: true });
  fs.writeFileSync(REGISTRY_FILE, JSON.stringify(reg, null, 2));
}

// ═══ Public API — called by each MCP server ═══

/**
 * Register a service with the local gateway.
 * Starts the gateway if not running. Registers mDNS hostname.
 *
 * @param {string} name - Service name (e.g. 'project-graph')
 * @param {number} backendPort - Port the service is running on
 * @param {object} [meta] - Optional metadata
 * @param {string} [meta.projectPath] - Absolute project path
 * @param {string} [meta.projectName] - Project basename
 * @returns {{ cleanup: () => void, url: string }}
 */
export function registerService(name, backendPort, meta = {}) {
  const hostname = `${name}.local`;
  const reg = readRegistry();

  if (meta.projectName) {
    // Path-prefix routing: register under hostname → routes → /{projectName}
    if (!reg[hostname]) {
      reg[hostname] = { name, routes: {} };
    }

    const prefix = `/${meta.projectName}`;
    reg[hostname].routes = reg[hostname].routes || {};
    reg[hostname].routes[prefix] = {
      port: backendPort,
      pid: process.pid,
      projectPath: meta.projectPath,
      projectName: meta.projectName,
    };
  } else {
    // Simple hostname routing (fallback)
    reg[hostname] = { port: backendPort, pid: process.pid, name };
  }

  writeRegistry(reg);

  // Register mDNS hostname → 127.0.0.1
  const mdns = registerLocal(hostname, 80);
  ensureGateway();

  const cleanup = () => {
    mdns.cleanup();
    try {
      const r = readRegistry();
      if (meta.projectName && r[hostname]?.routes) {
        delete r[hostname].routes[`/${meta.projectName}`];
        if (Object.keys(r[hostname].routes).length === 0) {
          delete r[hostname];
        }
      } else {
        delete r[hostname];
      }
      writeRegistry(r);
      if (Object.keys(r).length === 0) stopGateway();
    } catch {}
  };

  process.on('exit', cleanup);
  process.on('SIGINT', () => { cleanup(); process.exit(); });
  process.on('SIGTERM', () => { cleanup(); process.exit(); });

  // Gateway URL (may not be started yet, but will be within this tick)
  const gwPort = getGatewayPort();
  const portSuffix = gwPort === 80 ? '' : `:${gwPort}`;
  const url = meta.projectName
    ? `http://${hostname}${portSuffix}/${meta.projectName}/`
    : `http://${hostname}${portSuffix}/`;

  return { cleanup, url, directUrl: `http://localhost:${backendPort}/` };
}

// ═══ Routing logic ═══

/**
 * Resolve a request to a backend service.
 * Checks path-prefix routes first, then falls back to simple hostname routing.
 *
 * @returns {{ port: number, rewritePath: string } | null}
 */
function resolveBackend(host, pathname, reg) {
  const service = reg[host];
  if (!service) return null;

  // Path-prefix routing: find matching route
  if (service.routes) {
    const prefixes = Object.keys(service.routes).sort((a, b) => b.length - a.length);
    for (const prefix of prefixes) {
      if (pathname === prefix || pathname.startsWith(prefix + '/')) {
        const route = service.routes[prefix];
        // Verify PID alive
        try { process.kill(route.pid, 0); } catch { continue; }
        // Strip prefix from path
        const rewritePath = pathname.slice(prefix.length) || '/';
        return { port: route.port, rewritePath, prefix };
      }
    }

    // Root path → serve dashboard
    if (pathname === '/' || pathname === '') {
      return { port: 0, rewritePath: '/__dashboard__', isDashboard: true, routes: service.routes };
    }
  }

  // Simple hostname routing
  if (service.port) {
    return { port: service.port, rewritePath: pathname };
  }

  return null;
}

// ═══ Dashboard HTML ═══

function serveDashboard(res, routes) {
  const projects = Object.entries(routes || {}).map(([prefix, r]) => {
    let alive = false;
    try { process.kill(r.pid, 0); alive = true; } catch {}
    return { prefix, ...r, alive };
  });

  const items = projects.map(p =>
    `<li class="${p.alive ? 'active' : 'inactive'}">
      <a href="${p.prefix}/">${p.projectName || p.prefix}</a>
      <span class="path">${p.projectPath || ''}</span>
      <span class="status">${p.alive ? '● running' : '○ stopped'}</span>
    </li>`
  ).join('');

  const html = `<!DOCTYPE html>
<html><head>
  <meta charset="utf-8"><title>Project Graph — Dashboard</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, -apple-system, sans-serif; background: #0a0a0f; color: #e8e8e8; 
           display: flex; align-items: center; justify-content: center; min-height: 100vh; }
    .card { background: #15151f; border: 1px solid #2a2a3a; border-radius: 16px; padding: 48px;
            max-width: 680px; width: 100%; }
    h1 { font-size: 28px; font-weight: 600; margin-bottom: 8px; }
    .sub { color: #888; margin-bottom: 32px; }
    ul { list-style: none; }
    li { border: 1px solid #2a2a3a; border-radius: 12px; padding: 16px 20px; margin-bottom: 12px;
         transition: border-color 0.2s, background 0.2s; }
    li:hover { border-color: #5a5aff; background: #1a1a2f; }
    li.inactive { opacity: 0.4; }
    a { color: #7878ff; font-size: 18px; font-weight: 500; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .path { display: block; color: #666; font-size: 13px; font-family: monospace; margin-top: 4px; }
    .status { display: block; color: #4ade80; font-size: 12px; margin-top: 4px; }
    li.inactive .status { color: #666; }
    .empty { color: #555; text-align: center; padding: 32px; }
  </style>
</head><body>
  <div class="card">
    <h1>⬡ Project Graph</h1>
    <p class="sub">${projects.length} project${projects.length !== 1 ? 's' : ''} registered</p>
    ${items.length ? `<ul>${items}</ul>` : '<p class="empty">No projects registered. Start an MCP agent to see projects here.</p>'}
  </div>
</body></html>`;

  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(html);
}

// ═══ Gateway process management ═══

function readGatewayPid() {
  try {
    const raw = fs.readFileSync(GATEWAY_PID_FILE, 'utf8');
    // Support both old (plain PID) and new (JSON) format
    if (raw.trim().startsWith('{')) {
      return JSON.parse(raw);
    }
    return { pid: parseInt(raw, 10), port: 80 };
  } catch {
    return null;
  }
}

function isGatewayRunning() {
  const info = readGatewayPid();
  if (!info) return false;
  try {
    process.kill(info.pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the port the gateway is listening on.
 * @returns {number} Gateway port (80 or 8080 typically)
 */
export function getGatewayPort() {
  const info = readGatewayPid();
  return info?.port || 80;
}

function ensureGateway() {
  if (isGatewayRunning()) return;

  try {
    const gateway = http.createServer((req, res) => {
      const host = (req.headers.host || '').split(':')[0];
      const reg = readRegistry();
      const resolved = resolveBackend(host, req.url, reg);

      if (!resolved) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end(`Unknown host: ${host}\nRegistered: ${Object.keys(reg).join(', ')}`);
        return;
      }

      // Dashboard
      if (resolved.isDashboard) {
        serveDashboard(res, resolved.routes);
        return;
      }

      // Proxy request to backend
      const proxyReq = http.request({
        hostname: '127.0.0.1',
        port: resolved.port,
        path: resolved.rewritePath,
        method: req.method,
        headers: { ...req.headers, host: `localhost:${resolved.port}` },
      }, (proxyRes) => {
        const contentType = proxyRes.headers['content-type'] || '';
        const isHTML = contentType.includes('text/html');

        // For HTML via path-prefix: inject <base href> so root-absolute paths work
        if (isHTML && resolved.prefix) {
          const chunks = [];
          proxyRes.on('data', c => chunks.push(c));
          proxyRes.on('end', () => {
            let html = Buffer.concat(chunks).toString('utf8');
            // Insert <base> before first <link> or <script> or after <head>
            const baseTag = `<base href="${resolved.prefix}/">`;
            if (html.includes('<head>')) {
              html = html.replace('<head>', `<head>\n  ${baseTag}`);
            } else {
              html = baseTag + '\n' + html;
            }
            // Fix content-length
            const buf = Buffer.from(html, 'utf8');
            const headers = { ...proxyRes.headers };
            headers['content-length'] = buf.length;
            delete headers['transfer-encoding'];
            res.writeHead(proxyRes.statusCode, headers);
            res.end(buf);
          });
        } else {
          // Non-HTML or no prefix — pipe through directly
          res.writeHead(proxyRes.statusCode, proxyRes.headers);
          proxyRes.pipe(res);
        }
      });

      proxyReq.on('error', () => {
        res.writeHead(502, { 'Content-Type': 'text/plain' });
        res.end(`Backend unavailable on port ${resolved.port}`);
      });

      req.pipe(proxyReq);
    });

    // Handle WebSocket upgrades
    gateway.on('upgrade', (req, socket, head) => {
      const host = (req.headers.host || '').split(':')[0];
      const reg = readRegistry();
      const resolved = resolveBackend(host, req.url, reg);

      if (!resolved || resolved.isDashboard) {
        socket.destroy();
        return;
      }

      const proxySocket = net.createConnection(
        { host: '127.0.0.1', port: resolved.port },
        () => {
          // Rewrite the URL in the upgrade request
          const rewrittenUrl = resolved.rewritePath;
          proxySocket.write(
            `${req.method} ${rewrittenUrl} HTTP/1.1\r\n` +
            Object.entries(req.headers)
              .map(([k, v]) => `${k}: ${v}`)
              .join('\r\n') +
            '\r\n\r\n'
          );
          if (head.length) proxySocket.write(head);
          socket.pipe(proxySocket).pipe(socket);
        }
      );

      proxySocket.on('error', () => socket.destroy());
      socket.on('error', () => proxySocket.destroy());
    });

    // Try port 80 first, fallback to 8080
    function startListening(port) {
      gateway.listen(port, '0.0.0.0', () => {
        const actualPort = gateway.address().port;
        fs.mkdirSync(REGISTRY_DIR, { recursive: true });
        // Store PID and port so clients know the gateway address
        fs.writeFileSync(GATEWAY_PID_FILE, JSON.stringify({ pid: process.pid, port: actualPort }));
      });
    }

    gateway.on('error', (err) => {
      if (err.code === 'EACCES' && gateway.listening === false) {
        // Port 80 requires sudo — try 8080
        startListening(8080);
      } else if (err.code === 'EADDRINUSE' && gateway.listening === false) {
        // Port already taken — skip
      }
    });

    startListening(80);
  } catch {
    // Gateway can't start — services accessible via direct port
  }
}

function stopGateway() {
  try {
    fs.unlinkSync(GATEWAY_PID_FILE);
    fs.unlinkSync(REGISTRY_FILE);
  } catch {}
}
