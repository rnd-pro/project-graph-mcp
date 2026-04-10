/**
 * Zero-dependency mDNS hostname registration
 *
 * Registers a .local hostname so `http://project-graph.local:PORT/`
 * resolves to 127.0.0.1 without editing /etc/hosts.
 *
 * Strategy:
 *   macOS  → dns-sd -P (talks to built-in mDNSResponder)
 *   Linux  → avahi-publish-address (if avahi-daemon installed)
 *   Any OS → pure Node.js mDNS responder via multicast UDP
 *
 * @module project-graph-mcp/mdns
 */
import { spawn } from 'node:child_process';
import dgram from 'node:dgram';

const MDNS_ADDR = '224.0.0.251';
const MDNS_PORT = 5353;

/**
 * Register .local hostname. Returns cleanup function.
 * @param {string} hostname - e.g. 'project-graph.local'
 * @param {number} port - HTTP port
 * @returns {{ cleanup: () => void, method: string }}
 */
export function registerLocal(hostname, port) {
  if (process.platform === 'darwin') {
    return registerDnsSd(hostname, port);
  }

  if (process.platform === 'linux') {
    const avahi = tryAvahi(hostname);
    if (avahi) return avahi;
  }

  // Fallback: pure Node.js mDNS responder
  return registerMcast(hostname);
}

// ═══ macOS: dns-sd ═══
function registerDnsSd(hostname, port) {
  const child = spawn('dns-sd', [
    '-P', 'Project Graph', '_http._tcp', '', String(port),
    hostname, '127.0.0.1',
  ], { stdio: 'ignore', detached: false });

  child.unref();

  return {
    method: 'Bonjour (dns-sd)',
    cleanup: () => { try { child.kill(); } catch {} },
  };
}

// ═══ Linux: avahi-publish ═══
function tryAvahi(hostname) {
  try {
    const child = spawn('avahi-publish-address', [
      '-R', hostname, '127.0.0.1',
    ], { stdio: 'ignore', detached: false });

    let failed = false;
    child.on('error', () => { failed = true; });
    child.unref();

    // Give it a moment — if avahi isn't installed, error fires sync
    if (failed) return null;

    return {
      method: 'Avahi',
      cleanup: () => { try { child.kill(); } catch {} },
    };
  } catch {
    return null;
  }
}

// ═══ Pure Node.js mDNS responder (any OS) ═══
function registerMcast(hostname) {
  // Encode hostname as DNS wire format
  // "project-graph.local" → [0x0d]project-graph[0x05]local[0x00]
  const labels = hostname.split('.');
  const encodedName = Buffer.concat([
    ...labels.map((label) => {
      const buf = Buffer.alloc(1 + label.length);
      buf[0] = label.length;
      buf.write(label, 1, 'ascii');
      return buf;
    }),
    Buffer.from([0]),
  ]);

  let socket;
  try {
    socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  } catch {
    return { method: 'none', cleanup: () => {} };
  }

  socket.on('message', (msg) => {
    // Parse: need at least DNS header (12 bytes)
    if (msg.length < 12) return;

    const flags = msg.readUInt16BE(2);
    if (flags & 0x8000) return; // QR=1 → response, skip

    const qdcount = msg.readUInt16BE(4);
    if (qdcount === 0) return;

    // Check if question matches our hostname
    const qStart = 12;
    if (qStart + encodedName.length + 4 > msg.length) return;
    if (msg.compare(encodedName, 0, encodedName.length, qStart, qStart + encodedName.length) !== 0) return;

    // Verify QTYPE=A(1), QCLASS=IN(1) (mask unicast bit)
    const typeOff = qStart + encodedName.length;
    const qtype = msg.readUInt16BE(typeOff);
    const qclass = msg.readUInt16BE(typeOff + 2) & 0x7FFF;
    if (qtype !== 1 || qclass !== 1) return;

    // Build A record response
    const res = Buffer.alloc(12 + encodedName.length + 10 + 4);
    let off = 0;

    // Header
    res.writeUInt16BE(0, off); off += 2;       // ID = 0 (mDNS)
    res.writeUInt16BE(0x8400, off); off += 2;  // QR=1, AA=1
    res.writeUInt16BE(0, off); off += 2;       // QDCOUNT
    res.writeUInt16BE(1, off); off += 2;       // ANCOUNT
    res.writeUInt16BE(0, off); off += 2;       // NSCOUNT
    res.writeUInt16BE(0, off); off += 2;       // ARCOUNT

    // Answer section
    encodedName.copy(res, off); off += encodedName.length;
    res.writeUInt16BE(1, off); off += 2;       // TYPE = A
    res.writeUInt16BE(0x8001, off); off += 2;  // CLASS = IN + cache-flush
    res.writeUInt32BE(120, off); off += 4;     // TTL = 120s
    res.writeUInt16BE(4, off); off += 2;       // RDLENGTH = 4
    res[off++] = 127; res[off++] = 0; res[off++] = 0; res[off++] = 1;

    socket.send(res, 0, off, MDNS_PORT, MDNS_ADDR);
  });

  socket.on('error', () => {
    // Port 5353 busy or no multicast — silent fail
    try { socket.close(); } catch {}
  });

  try {
    socket.bind({ port: MDNS_PORT, exclusive: false }, () => {
      try {
        socket.addMembership(MDNS_ADDR);
        socket.setMulticastTTL(255);
      } catch {
        try { socket.close(); } catch {}
      }
    });
  } catch {
    return { method: 'none', cleanup: () => {} };
  }

  return {
    method: 'Node.js mDNS',
    cleanup: () => { try { socket.close(); } catch {} },
  };
}
