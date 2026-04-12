#!/usr/bin/env node
import path from "node:path";
import fs from "node:fs";

if (process.argv[1] && (process.argv[1].endsWith("server.js") || process.argv[1].endsWith("project-graph-mcp"))) {
	const [, , o, ...r] = process.argv;
	if ("serve" === o) {
		const t = r[0] || ".", o = r.indexOf("--port"), s = -1 !== o ? parseInt(r[o + 1], 10) : 0;
		if (s) {
			const {startWebServer: e} = await import("./web-server.js");
			path(fs, s);
		} else {
			const {ensureBackend: o} = await import("./backend-lifecycle.js");
			try {
				const r = await o(fs), s = path.resolve(fs);
				console.log("\n  ⬡ project-graph-mcp"), console.log("  ─────────────────────────────"), 
				console.log(`  → http://localhost:${r}/`), console.log(`  → Project: ${s}`), console.log(`  → MCP WebSocket: ws://127.0.0.1:${r}/mcp-ws\n`);
			} catch (e) {
				console.error(`Failed to start backend: ${path.message}`), process.exit(1);
			}
		}
	} else if (o) {
		const {runCLI: e} = await import("../cli/cli.js");
		path(o, r);
	} else if (process.env.PROJECT_GRAPH_BACKEND) {
		const {startStdioServer: e} = await import("../mcp/mcp-server.js");
		console.error("Starting Project Graph MCP (stdio, direct)..."), path();
	} else {
		const {setRoots: e, getWorkspaceRoot: o} = await import("../core/workspace.js"), {ensureBackend: r, startStdioProxy: s} = await import("./backend-lifecycle.js"), {createInterface: i} = await import("node:readline"), n = fs.createWriteStream("/tmp/pg-init-debug.log", {
			flags: "a"
		});
		debugLog.write(`\n=== NEW SESSION ${(new Date).toISOString()} ===\n`);
		const c = i({
			input: process.stdin,
			terminal: !1
		}), a = [];
		let l = !1, p = null, d = null;
		const startProxy = async e => {
			if (!resolved) {
				l = !0, rl.removeAllListeners("line"), rl.close(), debugLog.write(`RESOLVED: ${e}\n`), debugLog.end();
				try {
					const t = await r(e);
					console.error(`[project-graph] Connected to backend on port ${t} (project: ${e})`), 
					s(t, pendingMessages);
				} catch (e) {
					console.error(`[project-graph] Singleton failed (${e.message}), falling back to direct stdio`);
					const {startStdioServer: t} = await import("../mcp/mcp-server.js");
					t(pendingMessages);
				}
			}
		};
		rl.on("line", t => {
			try {
				const r = JSON.parse(t);
				if (debugLog.write(`IN: ${r.method || `response:${r.id}`}\n`), "initialize" === r.method) {
					d = r.id, r.params?.roots?.length > 0 && (e(r.params.roots), debugLog.write("ROOTS from initialize.params\n"));
					const t = JSON.stringify({
						jsonrpc: "2.0",
						id: r.id,
						result: {
							protocolVersion: "2025-06-18",
							capabilities: {
								tools: {},
								resources: {}
							},
							serverInfo: {
								name: "project-graph",
								version: "2.0.0"
							}
						}
					});
					return debugLog.write("OUT: initialize response\n"), void process.stdout.write(t + "\n");
				}
				if ("initialized" === r.method || "notifications/initialized" === r.method) {
					debugLog.write("IN: initialized notification\n"), p = 999999;
					const e = JSON.stringify({
						jsonrpc: "2.0",
						id: rootsRequestId,
						method: "roots/list"
					});
					return debugLog.write(`OUT: roots/list request id=${rootsRequestId}\n`), process.stdout.write(e + "\n"), 
					void setTimeout(() => {
						if (!resolved) {
							const e = o();
							debugLog.write(`ROOTS timeout, using: ${e}\n`), startProxy(e);
						}
					}, 2e3);
				}
				if (void 0 !== r.id && r.id === rootsRequestId && (debugLog.write(`IN: roots/list response: ${JSON.stringify(r.result)}\n`), 
				r.result?.roots?.length > 0)) {
					e(r.result.roots);
					const t = o();
					return debugLog.write(`ROOTS resolved: ${t}\n`), void startProxy(t);
				}
				pendingMessages.push(t);
			} catch {
				pendingMessages.push(t);
			}
		}), setTimeout(() => {
			if (!resolved) {
				const e = o();
				debugLog.write(`TIMEOUT: fallback to ${e}\n`), console.error(`[project-graph] No roots received in 5s, using fallback: ${e}`), 
				startProxy(e);
			}
		}, 5e3);
	}
}
