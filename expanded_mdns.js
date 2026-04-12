import { spawn } from "node:child_process";
import dgram from "node:dgram";

const r = "224.0.0.251";

/**
 * route mDNS registration to dns-sd(mac)
 * @param {*} t
 * @param {*} e
 */
export function registerLocal(t, e) {
	if ("darwin" === process.platform) return registerDnsSd(t, e);
	if ("linux" === process.platform) {
		const e = tryAvahi(t);
		if (e) return e;
	}
	return registerMcast(t);
}

/**
 * spawn dns-sd process for Bonjour service registration
 * @param {*} e
 * @param {*} r
 * @returns {String}
 */
function registerDnsSd(e, r) {
	const n = spawn("dns-sd", [ "-P", "Project Graph", "_http._tcp", "", String(r), e, "127.0.0.1" ], {
		stdio: "ignore",
		detached: !1
	});
	return n.unref(), {
		method: "Bonjour (dns-sd)",
		cleanup: () => {
			try {
				n.kill();
			} catch {}
		}
	};
}

/**
 * spawn avahi-publish-address process for Linux mDNS registration
 * @param {*} e
 */
function tryAvahi(e) {
	try {
		const r = spawn("avahi-publish-address", [ "-R", e, "127.0.0.1" ], {
			stdio: "ignore",
			detached: !1
		});
		let n = !1;
		return r.on("error", () => {
			n = !0;
		}), r.unref(), n ? null : {
			method: "Avahi",
			cleanup: () => {
				try {
					r.kill();
				} catch {}
			}
		};
	} catch {
		return null;
	}
}

/**
 * create UDP socket and send mDNS answer packets
 * @param {*} t
 */
function registerMcast(t) {
	const n = t.split("."), c = Buffer.concat([ ...n.map(t => {
		const e = Buffer.alloc(1 + t.length);
		return e[0] = t.length, e.write(t, 1, "ascii"), e;
	}), Buffer.from([ 0 ]) ]);
	let o;
	try {
		o = e.createSocket({
			type: "udp4",
			reuseAddr: !0
		});
	} catch {
		return {
			method: "none",
			cleanup: () => {}
		};
	}
	o.on("message", t => {
		if (t.length < 12) return;
		if (32768 & t.readUInt16BE(2)) return;
		if (0 === t.readUInt16BE(4)) return;
		if (12 + c.length + 4 > t.length) return;
		if (0 !== t.compare(c, 0, c.length, 12, 12 + c.length)) return;
		const e = 12 + c.length, n = t.readUInt16BE(e), i = 32767 & t.readUInt16BE(e + 2);
		if (1 !== n || 1 !== i) return;
		const s = Buffer.alloc(12 + c.length + 10 + 4);
		let a = 0;
		s.writeUInt16BE(0, a), a += 2, s.writeUInt16BE(33792, a), a += 2, s.writeUInt16BE(0, a), 
		a += 2, s.writeUInt16BE(1, a), a += 2, s.writeUInt16BE(0, a), a += 2, s.writeUInt16BE(0, a), 
		a += 2, c.copy(s, a), a += c.length, s.writeUInt16BE(1, a), a += 2, s.writeUInt16BE(32769, a), 
		a += 2, s.writeUInt32BE(120, a), a += 4, s.writeUInt16BE(4, a), a += 2, s[a++] = 127, 
		s[a++] = 0, s[a++] = 0, s[a++] = 1, o.send(s, 0, a, 5353, r);
	}), o.on("error", () => {
		try {
			o.close();
		} catch {}
	});
	try {
		o.bind({
			port: 5353,
			exclusive: !1
		}, () => {
			try {
				o.addMembership(r), o.setMulticastTTL(255);
			} catch {
				try {
					o.close();
				} catch {}
			}
		});
	} catch {
		return {
			method: "none",
			cleanup: () => {}
		};
	}
	return {
		method: "Node.js mDNS",
		cleanup: () => {
			try {
				o.close();
			} catch {}
		}
	};
}
