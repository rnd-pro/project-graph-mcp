/**
 * Backend Lifecycle — singleton backend per project.
 *
 * Each project gets one shared backend process. Multiple MCP stdio agents
 * connect to it via WebSocket proxy. First agent starts the backend,
 * subsequent agents discover and connect to the running instance.
 *
 * Discovery: ~/.local-gateway/backends/{hash}.json
 * Transport: Native WebSocket (Node 22+, zero dependencies)
 */
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, readdirSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { createConnection } from 'node:net';
import { fileURLToPath } from 'node:url';

const __dirname = join(fileURLToPath(import.meta.url), '..');

const BACKENDS_DIR = join(
  process.env.HOME || process.env.USERPROFILE || '/tmp',
  '.local-gateway',
  'backends',
);

/**
 * Get portfile path for a project.
 * @param {string} projectPath - Absolute path to project
 * @returns {string}
 */
function getPortFilePath(projectPath) {
  const abs = resolve(projectPath);
  const hash = createHash('md5').update(abs).digest('hex').slice(0, 8);
  return join(BACKENDS_DIR, `${hash}.json`);
}

/**
 * Read portfile and verify backend is alive.
 * @param {string} projectPath
 * @returns {{ port: number, pid: number, project: string, name: string } | null}
 */
function readPortFile(projectPath) {
  const filePath = getPortFilePath(projectPath);
  if (!existsSync(filePath)) return null;

  try {
    const data = JSON.parse(readFileSync(filePath, 'utf8'));

    // Verify PID is alive
    try {
      process.kill(data.pid, 0);
    } catch {
      // Process dead — stale portfile
      try { unlinkSync(filePath); } catch {}
      return null;
    }

    return data;
  } catch {
    return null;
  }
}

/**
 * Write portfile for a running backend.
 * @param {string} projectPath
 * @param {number} port
 */
export function writePortFile(projectPath, port) {
  mkdirSync(BACKENDS_DIR, { recursive: true });
  const abs = resolve(projectPath);
  const data = {
    port,
    pid: process.pid,
    project: abs,
    name: basename(abs),
    startedAt: Date.now(),
  };
  writeFileSync(getPortFilePath(projectPath), JSON.stringify(data, null, 2));
}

/**
 * Remove portfile on exit.
 * @param {string} projectPath
 */
export function removePortFile(projectPath) {
  try { unlinkSync(getPortFilePath(projectPath)); } catch {}
}

/**
 * List all active backends.
 * @returns {Array<{ port: number, pid: number, project: string, name: string }>}
 */
export function listBackends() {
  if (!existsSync(BACKENDS_DIR)) return [];
  const files = readdirSync(BACKENDS_DIR).filter(f => f.endsWith('.json'));

  const result = [];

  for (const file of files) {
    try {
      const data = JSON.parse(readFileSync(join(BACKENDS_DIR, file), 'utf8'));
      // Verify alive
      try {
        process.kill(data.pid, 0);
        result.push(data);
      } catch {
        // Dead — cleanup
        try { unlinkSync(join(BACKENDS_DIR, file)); } catch {}
      }
    } catch {}
  }

  return result;
}

/**
 * Ensure a backend is running for the given project.
 * Starts one if needed, returns the port.
 *
 * @param {string} projectPath
 * @returns {Promise<number>} Backend port
 */
export async function ensureBackend(projectPath) {
  const abs = resolve(projectPath);

  // Check if already running
  const existing = readPortFile(abs);
  if (existing) return existing.port;

  // Spawn detached backend
  const backendScript = join(__dirname, 'backend.js');
  const child = spawn(process.execPath, [backendScript, abs], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, PROJECT_GRAPH_BACKEND: '1' },
  });
  child.unref();

  // Wait for portfile to appear (backend writes it after listen)
  const portFilePath = getPortFilePath(abs);
  const maxWait = 10_000; // 10 seconds
  const start = Date.now();

  while (Date.now() - start < maxWait) {
    await new Promise(r => setTimeout(r, 200));
    if (existsSync(portFilePath)) {
      const data = readPortFile(abs);
      if (data) return data.port;
    }
  }

  throw new Error(`Backend failed to start within ${maxWait / 1000}s`);
}

/**
 * Thin stdio proxy — bridges stdin/stdout to backend WebSocket.
 * Uses raw TCP + manual WS framing (zero dependencies, bypasses Node 22 WS bugs).
 *
 * @param {number} port - Backend port
 */
export function startStdioProxy(port) {
  const wsKey = randomBytes(16).toString('base64');

  const socket = createConnection({ host: '127.0.0.1', port }, () => {
    socket.write(
      'GET /mcp-ws HTTP/1.1\r\n' +
      `Host: 127.0.0.1:${port}\r\n` +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Key: ${wsKey}\r\n` +
      'Sec-WebSocket-Version: 13\r\n' +
      '\r\n'
    );
  });

  let handshakeComplete = false;
  let dataBuf = Buffer.alloc(0);

  const rl = createInterface({ input: process.stdin, terminal: false });

  // Encode a masked WS text frame (client → server MUST be masked)
  function encodeClientFrame(text) {
    const payload = Buffer.from(text, 'utf8');
    const mask = randomBytes(4);
    const masked = Buffer.alloc(payload.length);
    for (let i = 0; i < payload.length; i++) masked[i] = payload[i] ^ mask[i % 4];

    let header;
    if (payload.length < 126) {
      header = Buffer.alloc(2);
      header[0] = 0x81;
      header[1] = 0x80 | payload.length;
    } else if (payload.length < 65536) {
      header = Buffer.alloc(4);
      header[0] = 0x81;
      header[1] = 0x80 | 126;
      header.writeUInt16BE(payload.length, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x81;
      header[1] = 0x80 | 127;
      header.writeBigUInt64BE(BigInt(payload.length), 2);
    }

    return Buffer.concat([header, mask, masked]);
  }

  // Decode an unmasked WS frame (server → client)
  function decodeFrame(buf) {
    if (buf.length < 2) return null;
    const opcode = buf[0] & 0x0F;
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

    if (buf.length < offset + payloadLen) return null;
    const data = buf.slice(offset, offset + payloadLen).toString('utf8');
    return { opcode, data, totalLen: offset + payloadLen };
  }

  socket.on('data', (chunk) => {
    if (!handshakeComplete) {
      // Look for end of HTTP headers
      const combined = Buffer.concat([dataBuf, chunk]);
      const headerEnd = combined.indexOf('\r\n\r\n');
      if (headerEnd === -1) {
        dataBuf = combined;
        return;
      }

      const headers = combined.slice(0, headerEnd).toString();
      if (!headers.includes('101')) {
        console.error('[project-graph] WebSocket handshake failed');
        process.exit(1);
      }

      handshakeComplete = true;
      dataBuf = combined.slice(headerEnd + 4);

      // Start reading stdin → WS
      rl.on('line', (line) => {
        try { socket.write(encodeClientFrame(line)); } catch {}
      });
      rl.on('close', () => {
        socket.end();
        process.exit(0);
      });
    } else {
      dataBuf = Buffer.concat([dataBuf, chunk]);
    }

    // Process WS frames
    while (dataBuf.length >= 2) {
      const frame = decodeFrame(dataBuf);
      if (!frame) break;
      dataBuf = dataBuf.slice(frame.totalLen);

      if (frame.opcode === 0x1) {
        // Text frame → stdout
        process.stdout.write(frame.data + '\n');
      } else if (frame.opcode === 0x8) {
        // Close
        process.exit(0);
      } else if (frame.opcode === 0x9) {
        // Ping → Pong (not masked for simplicity, most servers accept)
        const pong = Buffer.alloc(2);
        pong[0] = 0x8A; // FIN + pong
        pong[1] = 0;
        socket.write(pong);
      }
    }
  });

  socket.on('close', () => process.exit(0));
  socket.on('error', (err) => {
    console.error(`[project-graph] Proxy connection error: ${err.message}`);
    process.exit(1);
  });
}

