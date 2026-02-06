/**
 * CLI Entry Point for Project Graph MCP
 */

import { getSkeleton, getFocusZone, expand, deps, usages, invalidateCache } from './tools.js';
import { getPendingTests, getTestSummary } from './test-annotations.js';
import { getFilters, addExcludes, resetFilters } from './filters.js';
import { getInstructions } from './instructions.js';
import { getUndocumentedSummary } from './undocumented.js';
import { getDeadCode } from './dead-code.js';
import { generateJSDoc } from './jsdoc-generator.js';
import { getSimilarFunctions } from './similar-functions.js';
import { getComplexity } from './complexity.js';
import { getLargeFiles } from './large-files.js';
import { getOutdatedPatterns } from './outdated-patterns.js';
import { getFullAnalysis } from './full-analysis.js';

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
  try {
    let result;

    switch (command) {
      case 'skeleton':
        if (!args[0]) throw new Error('Path required: skeleton <path>');
        result = await getSkeleton(args[0]);
        break;

      case 'expand':
        if (!args[0]) throw new Error('Symbol required: expand <symbol>');
        result = await expand(args[0]);
        break;

      case 'deps':
        if (!args[0]) throw new Error('Symbol required: deps <symbol>');
        result = await deps(args[0]);
        break;

      case 'usages':
        if (!args[0]) throw new Error('Symbol required: usages <symbol>');
        result = await usages(args[0]);
        break;

      case 'pending':
        result = getPendingTests(args[0] || '.');
        break;

      case 'summary':
        result = getTestSummary(args[0] || '.');
        break;

      case 'filters':
        result = getFilters();
        break;

      case 'instructions':
        console.log(getInstructions());
        return; // Early return as it's just text

      case 'undocumented':
        const level = args.find(a => a.startsWith('--level='))?.split('=')[1] || 'tests';
        const uPath = args.find(a => !a.startsWith('--')) || '.';
        result = getUndocumentedSummary(uPath, level);
        break;

      case 'deadcode':
        const dcPath = args[0] || '.';
        result = await getDeadCode(dcPath);
        break;

      case 'jsdoc':
        const jsPath = args[0];
        if (!jsPath) {
          console.error('Usage: jsdoc <file>');
          process.exit(1);
        }
        result = generateJSDoc(jsPath);
        break;

      case 'similar':
        const simPath = args.find(a => !a.startsWith('--')) || '.';
        const simThreshold = parseInt(args.find(a => a.startsWith('--threshold='))?.split('=')[1]) || 60;
        result = await getSimilarFunctions(simPath, { threshold: simThreshold });
        break;

      case 'complexity':
        const cxPath = args.find(a => !a.startsWith('--')) || '.';
        const cxMin = parseInt(args.find(a => a.startsWith('--min='))?.split('=')[1]) || 1;
        const cxProblematic = args.includes('--problematic');
        result = await getComplexity(cxPath, { minComplexity: cxMin, onlyProblematic: cxProblematic });
        break;

      case 'largefiles':
        const lfPath = args.find(a => !a.startsWith('--')) || '.';
        const lfProblematic = args.includes('--problematic');
        result = await getLargeFiles(lfPath, { onlyProblematic: lfProblematic });
        break;

      case 'outdated':
        const outPath = args.find(a => !a.startsWith('--')) || '.';
        const codeOnly = args.includes('--code');
        const depsOnly = args.includes('--deps');
        result = await getOutdatedPatterns(outPath, { codeOnly, depsOnly });
        break;

      case 'analyze':
        const anPath = args.find(a => !a.startsWith('--')) || '.';
        const includeItems = args.includes('--items');
        result = await getFullAnalysis(anPath, { includeItems });
        break;

      case 'help':
      case '--help':
      case '-h':
        printHelp();
        return;

      default:
        console.error(`Unknown command: ${command}`);
        console.error('Run with "help" for usage information');
        process.exit(1);
    }

    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}
