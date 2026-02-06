/**
 * Entry Point for Project Graph MCP
 * 
 * Decides whether to run in CLI mode or MCP Server mode (stdio)
 * Usage:
 *   node src/server.js                  -> stdio server
 *   node src/server.js <cmd> [args]     -> CLI execution
 */

import { startStdioServer } from './mcp-server.js';
import { runCLI } from './cli.js';

// Main execution logic
// We check endsWith('server.js') to verify this is the main module being run
if (process.argv[1] && process.argv[1].endsWith('server.js')) {
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
