#!/usr/bin/env node
// @ctx server.ctx
import path from 'node:path';
import fs from 'node:fs';

let _v = '0.0.0';
try {
  let _d = path.dirname(new URL(import.meta.url).pathname);
  _v = JSON.parse(fs.readFileSync(path.join(_d, '..', '..', 'package.json'), 'utf8')).version;
} catch {}

if (process.argv[1] && (process.argv[1].endsWith('server.js') || process.argv[1].endsWith('project-graph-mcp'))) {
  let [,, command, ...args] = process.argv;

  if (command === 'serve') {
    // UI has been extracted to mcp-agent-portal
    console.log('\n  [redirect] UI has moved to \'mcp-agent-portal\'.');
    console.log('  Install: npm i -g mcp-agent-portal');
    console.log('  Run:     npx mcp-agent-portal\n');
    process.exit(0);
  } else if (command) {
    let { runCLI } = await import('../cli/cli.js');
    runCLI(command, args);
  } else {
    // MCP stdio mode — always direct, no singleton backend
    let { startStdioServer } = await import('../mcp/mcp-server.js');
    let { setRoots, getWorkspaceRoot } = await import('../core/workspace.js');
    let { createInterface } = await import('node:readline');

    let rl = createInterface({ input: process.stdin, terminal: false });
    let buffered = [];
    let started = false;
    let rootsRequestId = null;
    let initializeId = null;

    let startMCP = (root) => {
      if (started) return;
      started = true;
      rl.removeAllListeners('line');
      rl.close();
      console.error(`[project-graph] Starting MCP stdio for: ${root}`);
      startStdioServer(buffered);
    };

    rl.on('line', (line) => {
      try {
        let msg = JSON.parse(line);

        if (msg.method === 'initialize') {
          initializeId = msg.id;
          if (msg.params?.roots?.length > 0) {
            setRoots(msg.params.roots);
          }
          // Respond to initialize immediately
          let response = JSON.stringify({
            jsonrpc: '2.0',
            id: msg.id,
            result: {
              protocolVersion: '2025-06-18',
              capabilities: { tools: {}, resources: {} },
              serverInfo: { name: 'project-graph', version: _v },
            },
          });
          process.stdout.write(response + '\n');
          return;
        }

        if (msg.method === 'initialized' || msg.method === 'notifications/initialized') {
          // Request roots from client
          rootsRequestId = 999999;
          let rootsReq = JSON.stringify({ jsonrpc: '2.0', id: rootsRequestId, method: 'roots/list' });
          process.stdout.write(rootsReq + '\n');
          // Fallback: start after 2s if no roots response
          setTimeout(() => {
            if (!started) {
              let root = getWorkspaceRoot();
              startMCP(root);
            }
          }, 2000);
          return;
        }

        // roots/list response
        if (msg.id !== undefined && msg.id === rootsRequestId) {
          if (msg.result?.roots?.length > 0) {
            setRoots(msg.result.roots);
          }
          let root = getWorkspaceRoot();
          startMCP(root);
          return;
        }

        // Buffer other messages until MCP starts
        if (msg.method && msg.id !== undefined) {
          buffered.push(line);
        } else {
          buffered.push(line);
        }
      } catch {
        buffered.push(line);
      }
    });

    // Absolute fallback
    setTimeout(() => {
      if (!started) {
        let root = getWorkspaceRoot();
        console.error(`[project-graph] No roots received in 5s, using fallback: ${root}`);
        startMCP(root);
      }
    }, 5000);
  }
}