/**
 * UI Client — HTTP API + WebSocket for web-server testing
 *
 * Starts the web-server process, captures the port from stdout,
 * provides HTTP GET helpers and WebSocket connection.
 */
import { spawn } from 'child_process';
import http from 'node:http';

/**
 * Start the web-server and wait for it to be ready.
 * @param {string} serverPath — path to server.js
 * @param {string} projectDir — project directory
 * @param {number} port — port number (0 = random)
 * @returns {Promise<{port: number, process: ChildProcess}>}
 */
export async function startUIServer(serverPath, projectDir, port = 0) {
  const child = spawn('node', [serverPath, 'serve', projectDir, '--port', String(port)], {
    stdio: ['pipe', 'pipe', 'pipe'],
    cwd: projectDir,
  });

  let stderr = '';
  child.stderr.on('data', (d) => { stderr += d.toString(); });

  // Wait for the server to print its port
  const resolvedPort = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`UI server failed to start in 10s. stderr: ${stderr}`));
    }, 10000);

    let buf = '';
    child.stdout.on('data', (chunk) => {
      buf += chunk.toString();
      // Server prints: → http://localhost:PORT/
      const match = buf.match(/localhost:(\d+)/);
      if (match) {
        clearTimeout(timeout);
        resolve(parseInt(match[1], 10));
      }
    });

    child.on('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`UI server exited with code ${code}. stderr: ${stderr}`));
    });
  });

  // Give server a moment to be fully ready
  await new Promise(r => setTimeout(r, 200));

  return { port: resolvedPort, process: child };
}

/**
 * HTTP GET a JSON API endpoint.
 * @param {number} port
 * @param {string} path — e.g. '/api/skeleton'
 * @param {number} [timeoutMs=10000] — request timeout in ms
 * @returns {Promise<object>}
 */
export function httpGet(port, path, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://127.0.0.1:${port}${path}`, (res) => {
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, data });
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => { req.destroy(); reject(new Error('HTTP timeout')); });
  });
}

/**
 * Connect to WebSocket /ws/monitor and receive the initial snapshot.
 * Uses the 'ws' library (same dep as the server).
 * @param {number} port
 * @returns {Promise<{ws: WebSocket, snapshot: object}>}
 */
export async function wsConnect(port) {
  const { default: WebSocket } = await import('ws');

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/monitor`);
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error('WebSocket snapshot timeout'));
    }, 10000);

    ws.on('open', () => {});

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.method === 'snapshot') {
          clearTimeout(timeout);
          resolve({ ws, snapshot: msg.params.state });
        }
      } catch {}
    });

    ws.on('error', (e) => { clearTimeout(timeout); reject(e); });
  });
}

/**
 * Call a tool via WebSocket JSON-RPC.
 * @param {WebSocket} ws
 * @param {string} name — tool name
 * @param {object} args — tool arguments
 * @returns {Promise<object>} — tool result
 */
export function wsCallTool(ws, name, args = {}) {
  const id = Date.now() + Math.random();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`WS tool call timeout: ${name}`));
    }, 15000);

    const handler = (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.id === id) {
          clearTimeout(timeout);
          ws.removeListener('message', handler);
          if (msg.error) reject(new Error(msg.error.message));
          else resolve(msg.result);
        }
      } catch {}
    };

    ws.on('message', handler);
    ws.send(JSON.stringify({
      jsonrpc: '2.0',
      id,
      method: 'tool',
      params: { name, args },
    }));
  });
}

/**
 * Collect patch events from WebSocket for a duration.
 * @param {WebSocket} ws
 * @param {number} durationMs
 * @returns {Promise<Array>}
 */
export function collectPatches(ws, durationMs = 1000) {
  return new Promise((resolve) => {
    const patches = [];
    const handler = (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.method === 'patch') patches.push(msg.params);
        if (msg.method === 'event') patches.push(msg.params);
      } catch {}
    };
    ws.on('message', handler);
    setTimeout(() => {
      ws.removeListener('message', handler);
      resolve(patches);
    }, durationMs);
  });
}

/**
 * Stop the UI server process.
 * @param {ChildProcess} proc
 */
export function stopUIServer(proc) {
  if (proc && !proc.killed) {
    proc.kill('SIGTERM');
  }
}

/**
 * HTTP GET — returns status code and content-type header (no body parsing).
 * @param {number} port
 * @param {string} path
 * @returns {Promise<{status: number, contentType: string}>}
 */
export function httpGetStatus(port, path) {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://127.0.0.1:${port}${path}`, (res) => {
      res.resume(); // drain
      resolve({ status: res.statusCode, contentType: res.headers['content-type'] || '' });
    });
    req.on('error', reject);
    req.setTimeout(5000, () => { req.destroy(); reject(new Error('HTTP timeout')); });
  });
}
