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
      // We ARE the backend — start directly (spawned by backend-lifecycle)
      // This path is handled by backend.js, not here
      const { startStdioServer } = await import('./mcp-server.js');
      console.error('Starting Project Graph MCP (stdio, direct)...');
      startStdioServer();
    } else {
      // Normal agent — use singleton backend
      const { getWorkspaceRoot } = await import('./workspace.js');
      const { ensureBackend, startStdioProxy } = await import('./backend-lifecycle.js');

      try {
        const projectPath = getWorkspaceRoot();
        const backendPort = await ensureBackend(projectPath);
        console.error(`[project-graph] Connected to backend on port ${backendPort}`);
        startStdioProxy(backendPort);
      } catch (err) {
        // Fallback: direct stdio (no singleton)
        console.error(`[project-graph] Singleton failed (${err.message}), falling back to direct stdio`);
        const { startStdioServer } = await import('./mcp-server.js');
        startStdioServer();
      }
    }
  }
}
