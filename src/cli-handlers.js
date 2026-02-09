/**
 * CLI Command Handlers Registry
 * Extracted from cli.js to reduce cyclomatic complexity
 */

import { getSkeleton, getFocusZone, expand, deps, usages } from './tools.js';
import { getPendingTests, getTestSummary } from './test-annotations.js';
import { getFilters } from './filters.js';
import { getInstructions } from './instructions.js';
import { getUndocumentedSummary } from './undocumented.js';
import { getDeadCode } from './dead-code.js';
import { generateJSDoc } from './jsdoc-generator.js';
import { getSimilarFunctions } from './similar-functions.js';
import { getComplexity } from './complexity.js';
import { getLargeFiles } from './large-files.js';
import { getOutdatedPatterns } from './outdated-patterns.js';
import { getFullAnalysis } from './full-analysis.js';
import { resolvePath } from './workspace.js';

/**
 * Parse named argument from args array
 * @param {string[]} args 
 * @param {string} name 
 * @returns {string|undefined}
 */
function getArg(args, name) {
  const arg = args.find(a => a.startsWith(`--${name}=`));
  return arg ? arg.split('=')[1] : undefined;
}

/**
 * Get path argument (first non-flag arg), resolved against workspace root
 * @param {string[]} args 
 * @returns {string}
 */
function getPath(args) {
  const raw = args.find(a => !a.startsWith('--')) || '.';
  return resolvePath(raw);
}

/**
 * CLI command handlers registry
 * Each handler returns a result or throws an error
 */
export const CLI_HANDLERS = {
  skeleton: {
    requiresArg: true,
    argError: 'Path required: skeleton <path>',
    handler: async (args) => getSkeleton(resolvePath(args[0])),
  },

  expand: {
    requiresArg: true,
    argError: 'Symbol required: expand <symbol>',
    handler: async (args) => expand(args[0]),
  },

  deps: {
    requiresArg: true,
    argError: 'Symbol required: deps <symbol>',
    handler: async (args) => deps(args[0]),
  },

  usages: {
    requiresArg: true,
    argError: 'Symbol required: usages <symbol>',
    handler: async (args) => usages(args[0]),
  },

  pending: {
    handler: async (args) => getPendingTests(getPath(args)),
  },

  summary: {
    handler: async (args) => getTestSummary(getPath(args)),
  },

  filters: {
    handler: async () => getFilters(),
  },

  instructions: {
    rawOutput: true,
    handler: async () => getInstructions(),
  },

  undocumented: {
    handler: async (args) => {
      const level = getArg(args, 'level') || 'tests';
      return getUndocumentedSummary(getPath(args), level);
    },
  },

  deadcode: {
    handler: async (args) => getDeadCode(getPath(args)),
  },

  jsdoc: {
    requiresArg: true,
    argError: 'Usage: jsdoc <file>',
    handler: async (args) => generateJSDoc(resolvePath(args[0])),
  },

  similar: {
    handler: async (args) => {
      const threshold = parseInt(getArg(args, 'threshold')) || 60;
      return getSimilarFunctions(getPath(args), { threshold });
    },
  },

  complexity: {
    handler: async (args) => {
      const minComplexity = parseInt(getArg(args, 'min')) || 1;
      const onlyProblematic = args.includes('--problematic');
      return getComplexity(getPath(args), { minComplexity, onlyProblematic });
    },
  },

  largefiles: {
    handler: async (args) => {
      const onlyProblematic = args.includes('--problematic');
      return getLargeFiles(getPath(args), { onlyProblematic });
    },
  },

  outdated: {
    handler: async (args) => {
      const codeOnly = args.includes('--code');
      const depsOnly = args.includes('--deps');
      return getOutdatedPatterns(getPath(args), { codeOnly, depsOnly });
    },
  },

  analyze: {
    handler: async (args) => {
      const includeItems = args.includes('--items');
      return getFullAnalysis(getPath(args), { includeItems });
    },
  },
};
