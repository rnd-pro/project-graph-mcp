#!/usr/bin/env node
/**
 * Project Graph MCP — Entry Point
 *
 * Modes:
 *   node server.js              → MCP stdio (singleton: proxy to shared backend)
 *   node server.js serve [path] → Ensure backend running + print URL
 *   node server.js <command>    → CLI mode
 */
import path from 'node:path';
import fs from 'node:fs';

// Main execution logic
if (process.argv[1] && (process.argv[1].endsWith('server.js') || process.argv[1].endsWith('project-graph-mcp'))) {
  const [, , command, ...args] = process.argv;

  if (command === 'serve') {
    // Web UI mode — ensure backend running, print URL
    const projectPath = args[0] || '.';
    const portFlag = args.indexOf('--port');
    const port = portFlag !== -1 ? parseInt(args[portFlag + 1], 10) : 0;

    if (port) {
      // Explicit port — direct server (no singleton pattern)
      const { startWebServer } = await import('./web-server.js');
      startWebServer(projectPath, port);
    } else {
      // Singleton — ensure backend + print URL
      const { ensureBackend } = await import('./backend-lifecycle.js');
      try {
        const backendPort = await ensureBackend(projectPath);
        const absPath = path.resolve(projectPath);
        console.log(`\n  ⬡ project-graph-mcp`);
        console.log(`  ─────────────────────────────`);
        console.log(`  → http://localhost:${backendPort}/`);
        console.log(`  → Project: ${absPath}`);
        console.log(`  → MCP WebSocket: ws://127.0.0.1:${backendPort}/mcp-ws\n`);
      } catch (err) {
        console.error(`Failed to start backend: ${err.message}`);
        process.exit(1);
      }
    }

  } else if (command) {
    // CLI mode
    const { runCLI } = await import('./cli.js');
    runCLI(command, args);

  } else {
    // MCP stdio mode — singleton proxy
    if (process.env.PROJECT_GRAPH_BACKEND) {
      const { startStdioServer } = await import('./mcp-server.js');
      console.error('Starting Project Graph MCP (stdio, direct)...');
      startStdioServer();
    } else {
      // ═══════════════════════════════════════════════════════════════════
      // Normal agent — use singleton backend
      //
      // Problem: process.cwd() is '/' when IDE spawns us.
      // We need the workspace root from MCP roots, but roots arrive AFTER
      // the initialize handshake completes (spec requirement).
      //
      // Solution: act as a mini MCP server during handshake:
      //   1. Respond to 'initialize' ourselves
      //   2. Wait for 'initialized' notification
      //   3. Send roots/list request to client
      //   4. Parse response → extract workspace path
      //   5. Start real backend, replay all buffered messages
      // ═══════════════════════════════════════════════════════════════════
      const { setRoots, getWorkspaceRoot } = await import('./workspace.js');
      const { ensureBackend, startStdioProxy } = await import('./backend-lifecycle.js');
      const { createInterface } = await import('node:readline');

      const debugLog = fs.createWriteStream('/tmp/pg-init-debug.log', { flags: 'a' });
      debugLog.write(`\n=== NEW SESSION ${new Date().toISOString()} ===\n`);

      const rl = createInterface({ input: process.stdin, terminal: false });
      const bufferedLines = [];
      let resolved = false;
      let rootsRequestId = null;
      let initializeId = null;

      const startProxy = async (projectPath) => {
        if (resolved) return;
        resolved = true;
        rl.removeAllListeners('line');
        rl.close();
        debugLog.write(`RESOLVED: ${projectPath}\n`);
        debugLog.end();

        try {
          const backendPort = await ensureBackend(projectPath);
          console.error(`[project-graph] Connected to backend on port ${backendPort} (project: ${projectPath})`);
          startStdioProxy(backendPort, bufferedLines);
        } catch (err) {
          console.error(`[project-graph] Singleton failed (${err.message}), falling back to direct stdio`);
          const { startStdioServer } = await import('./mcp-server.js');
          startStdioServer(bufferedLines);
        }
      };

      rl.on('line', (line) => {
        try {
          const msg = JSON.parse(line);
          debugLog.write(`IN: ${msg.method || `response:${msg.id}`}\n`);

          // ─── Step 1: Respond to 'initialize' ourselves ───
          if (msg.method === 'initialize') {
            initializeId = msg.id;

            // Check for inline roots (some clients send them in initialize)
            if (msg.params?.roots?.length > 0) {
              setRoots(msg.params.roots);
              debugLog.write(`ROOTS from initialize.params\n`);
            }

            // Send our own initialize response
            const initResponse = JSON.stringify({
              jsonrpc: '2.0',
              id: msg.id,
              result: {
                protocolVersion: '2025-06-18',
                capabilities: { tools: {}, resources: {} },
                serverInfo: { name: 'project-graph', version: '2.0.0' },
              },
            });
            debugLog.write(`OUT: initialize response\n`);
            process.stdout.write(initResponse + '\n');

            // DON'T buffer initialize — we already responded.
            // Backend will get its own init via the WS handler.
            return;
          }

          // ─── Step 2: Handle 'initialized' notification ───
          if (msg.method === 'initialized' || msg.method === 'notifications/initialized') {
            // DON'T buffer — proxy consumed this during handshake
            debugLog.write(`IN: initialized notification\n`);

            // Try requesting roots from client
            rootsRequestId = 999999;
            const rootsReq = JSON.stringify({
              jsonrpc: '2.0',
              id: rootsRequestId,
              method: 'roots/list',
            });
            debugLog.write(`OUT: roots/list request id=${rootsRequestId}\n`);
            process.stdout.write(rootsReq + '\n');

            // Also set a short timeout — if roots come back empty,
            // resolve with selfRoot (from workspace.js)
            setTimeout(() => {
              if (!resolved) {
                const projectPath = getWorkspaceRoot();
                debugLog.write(`ROOTS timeout, using: ${projectPath}\n`);
                startProxy(projectPath);
              }
            }, 2000);
            return;
          }

          // ─── Step 3: Handle roots/list response ───
          if (msg.id !== undefined && msg.id === rootsRequestId) {
            debugLog.write(`IN: roots/list response: ${JSON.stringify(msg.result)}\n`);
            if (msg.result?.roots?.length > 0) {
              setRoots(msg.result.roots);
              const projectPath = getWorkspaceRoot();
              debugLog.write(`ROOTS resolved: ${projectPath}\n`);
              startProxy(projectPath);
              return;
            }
            // Empty roots — let timeout handle it
          }

          // Buffer everything else
          bufferedLines.push(line);
        } catch {
          bufferedLines.push(line);
        }
      });

      // Timeout: if no roots after 5s, fall back
      setTimeout(() => {
        if (!resolved) {
          const projectPath = getWorkspaceRoot();
          debugLog.write(`TIMEOUT: fallback to ${projectPath}\n`);
          console.error(`[project-graph] No roots received in 5s, using fallback: ${projectPath}`);
          startProxy(projectPath);
        }
      }, 5000);
    }
  }
}
