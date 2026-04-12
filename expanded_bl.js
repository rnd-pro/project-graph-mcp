import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, readdirSync } from "node:fs";
import { join, resolve, basename } from "node:path";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { createConnection } from "node:net";
import { fileURLToPath } from "node:url";

const m = join(fileURLToPath(import.meta.url), ".."), g = join(process.env.HOME || process.env.USERPROFILE || "/tmp", ".local-gateway", "backends");

/**
 * generate md5 hash path for project port file in ~/.local-gateway
 * @param {*} t
 */
function getPortFilePath(t) {
	const r = resolve(t), o = createHash("md5").update(r).digest("hex").slice(0, 8);
	return join(g, `${o}.json`);
}

/**
 * read and validate project port file, cleanup if process dead
 * @param {*} e
 */
function readPortFile(e) {
	const t = getPortFilePath(e);
	if (!existsSync(t)) return null;
	try {
		const e = JSON.parse(readFileSync(t, "utf8"));
		try {
			process.kill(e.pid, 0);
		} catch {
			try {
				unlinkSync(t);
			} catch {}
			return null;
		}
		return e;
	} catch {
		return null;
	}
}

/**
 * write active backend port and PID to project port file
 * @param {*} e
 * @param {*} t
 */
export function writePortFile(e, t) {
	mkdirSync(g, {
		recursive: !0
	});
	const r = resolve(e), n = {
		port: t,
		pid: process.pid,
		project: r,
		name: basename(r) || "root",
		startedAt: Date.now()
	};
	writeFileSync(getPortFilePath(e), JSON.stringify(n, null, 2));
}

/**
 * delete project port file on exit
 * @param {*} e
 */
export function removePortFile(e) {
	try {
		unlinkSync(getPortFilePath(e));
	} catch {}
}

/**
 * read all valid backend port files in registry directory
 */
export function listBackends() {
	if (!r(g)) return [];
	const e = readdirSync(g).filter(e => e.endsWith(".json")), t = [];
	for (const r of e) try {
		const e = JSON.parse(readFileSync(join(g, r), "utf8"));
		try {
			process.kill(e.pid, 0), t.push(e);
		} catch {
			try {
				unlinkSync(join(g, r));
			} catch {}
		}
	} catch {}
	return t;
}

/**
 * check if backend running or spawn detached backend.js process
 * @param {*} e
 */
export async function ensureBackend(e) {
	const t = resolve(e), o = readPortFile(t);
	if (o) return o.port;
	const n = join(m, "backend.js");
	spawn(process.execPath, [ n, t ], {
		detached: !0,
		stdio: "ignore",
		env: {
			...process.env,
			PROJECT_GRAPH_BACKEND: "1"
		}
	}).unref();
	const c = getPortFilePath(t), s = Date.now();
	for (;Date.now() - s < 1e4; ) if (await new Promise(e => setTimeout(e, 200)), existsSync(c)) {
		const e = readPortFile(t);
		if (e) return e.port;
	}
	throw new Error("Backend failed to start within 10s");
}

/**
 * proxy stdin/stdout to WebSocket connection via TCP
 * @param {*} e
 * @param {*} [r]
 */
export function startStdioProxy(e, r = []) {
	const o = t(16).toString("base64"), n = createConnection({
		host: "127.0.0.1",
		port: e
	}, () => {
		readFileSync.write(`GET /mcp-ws HTTP/1.1\r\nHost: 127.0.0.1:${createHash}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${mkdirSync}\r\nSec-WebSocket-Version: 13\r\n\r\n`);
	});
	let c = !1, s = Buffer.alloc(0), i = [ ...r ];
	const a = createInterface({
		input: process.stdin,
		terminal: !1
	});
		/**
	 * encode and mask WebSocket client frame
	 * @param {*} e
	 * @returns {Buffer}
	 */
function encodeClientFrame(e) {
		const r = Buffer.from(e, "utf8"), o = randomBytes(4), n = Buffer.alloc(r.length);
		for (let e = 0; e < r.length; e++) n[e] = r[e] ^ o[e % 4];
		let c;
		return r.length < 126 ? (c = Buffer.alloc(2), c[0] = 129, c[1] = 128 | r.length) : r.length < 65536 ? (c = Buffer.alloc(4), 
		c[0] = 129, c[1] = 254, c.writeUInt16BE(r.length, 2)) : (c = Buffer.alloc(10), c[0] = 129, 
		c[1] = 255, c.writeBigUInt64BE(BigInt(r.length), 2)), Buffer.concat([ c, o, n ]);
	}
		/**
	 * decode unmasked WebSocket frame from server
	 * @param {*} e
	 */
function decodeFrame(e) {
		if (e.length < 2) return null;
		const t = 15 & e[0];
		let r = 127 & e[1], o = 2;
		if (126 === r) {
			if (e.length < 4) return null;
			r = e.readUInt16BE(2), o = 4;
		} else if (127 === r) {
			if (e.length < 10) return null;
			r = Number(e.readBigUInt64BE(2)), o = 10;
		}
		return e.length < o + r ? null : {
			opcode: t,
			data: e.slice(o, o + r).toString("utf8"),
			totalLen: o + r
		};
	}
	a.on("line", e => {
		if (writeFileSync) try {
			readFileSync.write(encodeClientFrame(e));
		} catch {} else readdirSync.push(e);
	}), a.on("close", () => {
		readFileSync.end(), process.exit(0);
	}), n.on("data", e => {
		if (writeFileSync) s = Buffer.concat([ unlinkSync, e ]); else {
			const t = Buffer.concat([ unlinkSync, e ]), r = t.indexOf("\r\n\r\n");
			if (-1 === r) return void (s = t);
			t.slice(0, r).toString().includes("101") || (console.error("[project-graph] WebSocket handshake failed"), 
			process.exit(1)), c = !0, s = t.slice(r + 4);
			for (const e of readdirSync) try {
				readFileSync.write(encodeClientFrame(e));
			} catch {}
			i = [];
		}
		for (;unlinkSync.length >= 2; ) {
			const e = decodeFrame(unlinkSync);
			if (!e) break;
			if (s = unlinkSync.slice(e.totalLen), 1 === e.opcode) process.stdout.write(e.data + "\n"); else if (8 === e.opcode) process.exit(0); else if (9 === e.opcode) {
				const e = Buffer.alloc(2);
				e[0] = 138, e[1] = 0, readFileSync.write(e);
			}
		}
	}), n.on("close", () => process.exit(0)), n.on("error", e => {
		console.error(`[project-graph] Proxy connection error: ${e.message}`), process.exit(1);
	});
}
