/**
 * CLI Entry Point for Project Graph MCP
 */

import { CLI_HANDLERS } from './cli-handlers.js';

/**
 * Print CLI help
 */
export function printHelp() {
  console.log(`
project-graph-mcp - MCP server for AI agents

Usage:
  node src/server.js                  Start MCP stdio server
  node src/server.js <command> [args] Run CLI command

Commands:
  skeleton <path>        Get compact project overview
  expand <symbol>        Expand minified symbol (e.g., SN, SN.togglePin)
  deps <symbol>          Get dependency tree
  usages <symbol>        Find all usages
  pending <path>         List pending @test/@expect tests
  summary <path>         Get test progress summary
  undocumented <path>    Find missing JSDoc (--level=tests|params|all)
  deadcode <path>        Find unused functions/classes
  jsdoc <file>           Generate JSDoc for file
  similar <path>         Find similar functions (--threshold=60)
  complexity <path>      Analyze cyclomatic complexity (--min=1)
  largefiles <path>      Find files needing split (--problematic)
  outdated <path>        Find legacy patterns & redundant deps
  analyze <path>         Run ALL checks with Health Score
  filters                Show current filter configuration
  instructions           Show agent guidelines (JSDoc, Arch)
  help                   Show this help

Examples:
  node src/server.js skeleton src/components
  node src/server.js expand SN
  node src/server.js pending src/
`);
}

/**
 * Run CLI command
 * @param {string} command 
 * @param {string[]} args 
 */
export async function runCLI(command, args) {
  // Handle help commands
  if (!command || command === 'help' || command === '--help' || command === '-h') {
    printHelp();
    return;
  }

  // Look up handler
  const def = CLI_HANDLERS[command];
  if (!def) {
    console.error(`Unknown command: ${command}`);
    console.error('Run with "help" for usage information');
    process.exit(1);
  }

  // Validate required arg
  if (def.requiresArg && !args[0]) {
    console.error(def.argError || `Argument required for: ${command}`);
    process.exit(1);
  }

  try {
    const result = await def.handler(args);

    // Handle raw output (like instructions)
    if (def.rawOutput) {
      console.log(result);
    } else {
      console.log(JSON.stringify(result, null, 2));
    }
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}
