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
  npx project-graph-mcp                  Start MCP stdio server
  npx project-graph-mcp <command> [args] Run CLI command

Commands:
  skeleton <path>        Get compact project overview
  expand <symbol>        Expand minified symbol (e.g., SN, SN.togglePin)
  deps <symbol>          Get dependency tree
  usages <symbol>        Find all usages
  pending <path>         List pending .ctx.md test checklists
  summary <path>         Get test progress summary
  undocumented <path>    Find missing JSDoc (--level=tests|params|all)
  deadcode <path>        Find unused functions/classes
  jsdoc <file>           Generate JSDoc for file
  similar <path>         Find similar functions (--threshold=60)
  complexity <path>      Analyze cyclomatic complexity (--min=1)
  largefiles <path>      Find files needing split (--problematic)
  outdated <path>        Find legacy patterns & redundant deps
  analyze <path>         Run ALL checks with Health Score
  jsdoc-check <path>     Validate JSDoc ↔ function signatures
  types <path>           Run tsc type checking (--max=50)
  compress <file>        Compress JS file for AI (--no-beautify, --no-legend)
  compact <path>         Compact all JS files — strips comments/whitespace (--dry-run)
  beautify <path>        Beautify/expand all JS files — inverse of compact (--dry-run)
  inject-jsdoc <path>    Generate JSDoc from .ctx files and inject into source
  strip-jsdoc <path>     Strip all JSDoc blocks from source files
  docs <path>            Get project docs in doc-dialect format (--file=<name>)
  generate-ctx <path>    Generate .context/ docs (--overwrite --scope=focus)
  filters                Show current filter configuration
  instructions           Show agent guidelines (JSDoc, Arch)
  help                   Show this help

Examples:
  npx project-graph-mcp skeleton src/components
  npx project-graph-mcp expand SN
  npx project-graph-mcp compact src/ --dry-run
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
