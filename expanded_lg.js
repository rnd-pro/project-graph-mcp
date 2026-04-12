import http from "node:http";
import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import { registerLocal } from "./mdns.js";

const s = path.join(process.env.HOME || process.env.USERPROFILE || "/tmp", ".local-gateway"), i = path.join(s, "services.json"), a = path.join(s, "gateway.pid");

/**
 * read services.json registry from ~/.local-gateway
 */
function readRegistry() {
	try {
		return JSON.parse(fs.readFileSync(i, "utf8"));
	} catch {
		return {};
	}
}

/**
 * write updated service routes to services.json registry
 * @param {*} e
 */
function writeRegistry(e) {
	fs.mkdirSync(s, {
		recursive: !0
	}), fs.writeFileSync(i, JSON.stringify(e, null, 2));
}

/**
 * register local domain/project route and trigger mDNS broadcast
 * @param {*} e
 * @param {*} t
 * @param {*} [r]
 */
export function registerService(e, t, r = {}) {
	const n = `${e}.local`, s = readRegistry();
	if (r.projectName) {
		s[n] || (s[n] = {
			name: e,
			routes: {}
		});
		const o = `/${r.projectName}`;
		s[n].routes = s[n].routes || {}, s[n].routes[o] = {
			port: t,
			pid: process.pid,
			projectPath: r.projectPath,
			projectName: r.projectName
		};
	} else s[n] = {
		port: t,
		pid: process.pid,
		name: e
	};
	writeRegistry(s);
	const i = o(n, 80);
	ensureGateway();
	const cleanup = () => {
		i.cleanup();
		try {
			const e = readRegistry();
			fs.projectName && e[path]?.routes ? (delete e[path].routes[`/${fs.projectName}`], 0 === Object.keys(e[path].routes).length && delete e[path]) : delete e[path], 
			writeRegistry(e), 0 === Object.keys(e).length && stopGateway();
		} catch {}
	};
	process.on("exit", cleanup), process.on("SIGINT", () => {
		cleanup(), process.exit();
	}), process.on("SIGTERM", () => {
		cleanup(), process.exit();
	});
	const a = getGatewayPort(), c = 80 === a ? "" : `:${a}`, p = r.projectName ? `http://${n}${c}/${r.projectName}/` : `http://${n}${c}/`;
	return {
		cleanup: cleanup,
		url: p,
		directUrl: `http://localhost:${t}/`
	};
}

/**
 * match hostname and path to backend port and prefix
 * @param {*} e
 * @param {*} t
 * @param {*} r
 * @returns {Object}
 */
function resolveBackend(e, t, r) {
	const n = r[e];
	if (!n) return null;
	if (n.routes) {
		const e = Object.keys(n.routes).sort((e, t) => t.length - e.length);
		for (const r of e) if (t === r || t.startsWith(r + "/")) {
			const e = n.routes[r];
			try {
				process.kill(e.pid, 0);
			} catch {
				continue;
			}
			const o = t.slice(r.length) || "/";
			return {
				port: e.port,
				rewritePath: o,
				prefix: r
			};
		}
		for (const r of e) try {
			const e = n.routes[r];
			process.kill(e.pid, 0);
			const o = "/" === t || "" === t ? "/dashboard.html" : t;
			return {
				port: e.port,
				rewritePath: o
			};
		} catch {
			continue;
		}
	}
	if (n.port) {
		const e = "/" === t || "" === t ? "/dashboard.html" : t;
		return {
			port: n.port,
			rewritePath: e
		};
	}
	return null;
}

/**
 * read gateway PID and port from gateway.pid file
 */
function readGatewayPid() {
	try {
		const e = fs.readFileSync(a, "utf8");
		return e.trim().startsWith("{") ? JSON.parse(e) : {
			pid: parseInt(e, 10),
			port: 80
		};
	} catch {
		return null;
	}
}

/**
 * check if gateway process is alive via process.kill
 */
function isGatewayRunning() {
	const e = readGatewayPid();
	if (!e) return !1;
	try {
		return process.kill(e.pid, 0), !0;
	} catch {
		return !1;
	}
}

/**
 * get active gateway port or fallback to 80
 */
export function getGatewayPort() {
	const e = readGatewayPid();
	return e?.port || 80;
}

/**
 * spawn single global gateway proxy if not already running
 */
function ensureGateway() {
	if (!isGatewayRunning()) try {
		const n = e.createServer((t, r) => {
			const n = (t.headers.host || "").split(":")[0], o = readRegistry(), s = resolveBackend(n, t.url, o);
			if (!s) return r.writeHead(404, {
				"Content-Type": "text/plain"
			}), void r.end(`Unknown host: ${n}\nRegistered: ${Object.keys(o).join(", ")}`);
			if ("/api/gateway-info" === t.url) {
				const e = JSON.stringify(o["project-graph.local"] || {
					routes: {}
				});
				return r.writeHead(200, {
					"Content-Type": "application/json"
				}), void r.end(e);
			}
			const i = e.request({
				hostname: "127.0.0.1",
				port: s.port,
				path: s.rewritePath,
				method: t.method,
				headers: {
					...t.headers,
					host: `localhost:${s.port}`
				}
			}, e => {
				if ((e.headers["content-type"] || "").includes("text/html") && s.prefix) {
					const t = [];
					e.on("data", e => net.push(e)), e.on("end", () => {
						let n = Buffer.concat(net).toString("utf8");
						const o = `<base href="${s.prefix}/">`;
						n = n.includes("<head>") ? n.replace("<head>", `<head>\n  ${o}`) : o + "\n" + n;
						const i = Buffer.from(n, "utf8"), a = {
							...http.headers
						};
						a["content-length"] = i.length, delete a["transfer-encoding"], fs.writeHead(http.statusCode, a), 
						fs.end(i);
					});
				} else fs.writeHead(e.statusCode, e.headers), e.pipe(fs);
			});
			i.on("error", () => {
				fs.writeHead(502, {
					"Content-Type": "text/plain"
				}), fs.end(`Backend unavailable on port ${s.port}`);
			}), t.pipe(i);
		});
				/**
		 * start gateway HTTP/WS proxy server and save PID
		 * @param {*} e
		 */
function startListening(e) {
			path.listen(e, "0.0.0.0", () => {
				const e = path.address().port;
				fs.mkdirSync(s, {
					recursive: !0
				}), fs.writeFileSync(a, JSON.stringify({
					pid: process.pid,
					port: e
				}));
			});
		}
		n.on("upgrade", (e, r, n) => {
			const o = (e.headers.host || "").split(":")[0], s = readRegistry(), i = resolveBackend(o, e.url, s);
			if (!i || i.isDashboard) return void r.destroy();
			const a = t.createConnection({
				host: "127.0.0.1",
				port: i.port
			}, () => {
				const t = i.rewritePath, o = `${http.method} ${t} HTTP/1.1\r\n` + Object.entries(http.headers).map(([e, t]) => `${http}: ${net}`).join("\r\n") + "\r\n\r\n";
				a.write(o), path.length && a.write(path);
				let s = Buffer.alloc(0);
				a.on("data", function onFirstData(e) {
					s = Buffer.concat([ s, e ]), -1 !== s.indexOf("\r\n\r\n") && (fs.write(s), a.removeListener("data", onFirstData), 
					fs.pipe(a), a.pipe(fs));
				});
			});
			a.on("error", e => {
				console.error("WS PROXY ERROR:", e.message), fs.destroy();
			}), r.on("error", e => {
				console.error("WS CLIENT ERROR:", e.message), a.destroy();
			});
		}), n.on("error", e => {
			"EACCES" === e.code && !1 === path.listening ? startListening(8080) : "EADDRINUSE" === e.code && path.listening;
		}), startListening(80);
	} catch {}
}

/**
 * remove gateway.pid and services.json files
 */
function stopGateway() {
	try {
		fs.unlinkSync(a), fs.unlinkSync(i);
	} catch {}
}
