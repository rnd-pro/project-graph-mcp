#!/usr/bin/env node
import { startStdioServer } from './mcp-server.js';
import { runCLI } from './cli.js';

// Main execution logic
// We check endsWith('server.js') to verify this is the main module being run
if (process.argv[1] && (process.argv[1].endsWith('server.js') || process.argv[1].endsWith('project-graph-mcp'))) {
  const [, , command, ...args] = process.argv;

  if (command) {
    // CLI mode
    runCLI(command, args);
  } else {
    // MCP stdio mode
    // Use stderr for logs so stdout remains clean for JSON-RPC
    console.error('Starting Project Graph MCP (stdio)...');
    startStdioServer();
  }
}
