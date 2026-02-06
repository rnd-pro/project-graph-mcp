/**
 * Outdated Patterns Detector
 * Finds legacy code patterns and redundant npm dependencies
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, relative } from 'path';
import { parse } from '../vendor/acorn.mjs';
import * as walk from '../vendor/walk.mjs';
import { shouldExcludeDir, shouldExcludeFile, parseGitignore } from './filters.js';

/**
 * Redundant npm packages that are now built into Node.js 18+
 */
const REDUNDANT_DEPS = {
  'node-fetch': { replacement: 'fetch()', since: 'Node 18' },
  'cross-fetch': { replacement: 'fetch()', since: 'Node 18' },
  'isomorphic-fetch': { replacement: 'fetch()', since: 'Node 18' },
  'uuid': { replacement: 'crypto.randomUUID()', since: 'Node 19' },
  'deep-clone': { replacement: 'structuredClone()', since: 'Node 17' },
  'lodash.clonedeep': { replacement: 'structuredClone()', since: 'Node 17' },
  'abort-controller': { replacement: 'AbortController (global)', since: 'Node 15' },
  'form-data': { replacement: 'FormData (global)', since: 'Node 18' },
  'web-streams-polyfill': { replacement: 'ReadableStream (global)', since: 'Node 18' },
  'url-parse': { replacement: 'URL (global)', since: 'Node 10' },
  'querystring': { replacement: 'URLSearchParams', since: 'Node 10' },
  'rimraf': { replacement: 'fs.rm({ recursive: true })', since: 'Node 14' },
  'mkdirp': { replacement: 'fs.mkdir({ recursive: true })', since: 'Node 10' },
  'recursive-readdir': { replacement: 'fs.readdir({ recursive: true })', since: 'Node 20' },
  'glob': { replacement: 'fs.glob()', since: 'Node 22' },
};

/**
 * Legacy code patterns to detect
 */
const CODE_PATTERNS = [
  {
    name: 'var-usage',
    description: 'Use const/let instead of var',
    check: (node) => node.type === 'VariableDeclaration' && node.kind === 'var',
    severity: 'warning',
    replacement: 'const/let',
  },
  {
    name: 'require-usage',
    description: 'Use ESM import instead of require()',
    check: (node) => node.type === 'CallExpression' &&
      node.callee.type === 'Identifier' && node.callee.name === 'require',
    severity: 'info',
    replacement: 'import ... from',
  },
  {
    name: 'module-exports',
    description: 'Use ESM export instead of module.exports',
    check: (node) => node.type === 'AssignmentExpression' &&
      node.left.type === 'MemberExpression' &&
      node.left.object.type === 'Identifier' && node.left.object.name === 'module' &&
      node.left.property.type === 'Identifier' && node.left.property.name === 'exports',
    severity: 'info',
    replacement: 'export default/export',
  },
  {
    name: 'buffer-constructor',
    description: 'new Buffer() is deprecated',
    check: (node) => node.type === 'NewExpression' &&
      node.callee.type === 'Identifier' && node.callee.name === 'Buffer',
    severity: 'error',
    replacement: 'Buffer.from() / Buffer.alloc()',
  },
  {
    name: 'arguments-usage',
    description: 'Use rest parameters instead of arguments',
    check: (node) => node.type === 'Identifier' && node.name === 'arguments',
    severity: 'warning',
    replacement: '...args',
  },
  {
    name: 'promisify-usage',
    description: 'Use fs/promises instead of util.promisify',
    check: (node) => node.type === 'CallExpression' &&
      node.callee.type === 'MemberExpression' &&
      node.callee.object.type === 'Identifier' && node.callee.object.name === 'util' &&
      node.callee.property.type === 'Identifier' && node.callee.property.name === 'promisify',
    severity: 'info',
    replacement: 'fs/promises module',
  },
  {
    name: 'sync-in-async',
    description: 'Avoid sync methods in async context (readFileSync, etc.)',
    check: (node, context) => {
      if (node.type !== 'CallExpression') return false;
      const callee = node.callee;
      if (callee.type === 'MemberExpression' && callee.property.type === 'Identifier') {
        const name = callee.property.name;
        return name.endsWith('Sync') && context.inAsync;
      }
      return false;
    },
    severity: 'warning',
    replacement: 'async fs/promises methods',
  },
];

/**
 * @typedef {Object} PatternMatch
 * @property {string} pattern
 * @property {string} description
 * @property {string} file
 * @property {number} line
 * @property {string} severity
 * @property {string} replacement
 */

/**
 * @typedef {Object} RedundantDep
 * @property {string} name
 * @property {string} replacement
 * @property {string} since
 */

/**
 * Find all JS files
 * @param {string} dir 
 * @param {string} rootDir 
 * @returns {string[]}
 */
function findJSFiles(dir, rootDir = dir) {
  if (dir === rootDir) parseGitignore(rootDir);
  const files = [];

  try {
    for (const entry of readdirSync(dir)) {
      const fullPath = join(dir, entry);
      const relativePath = relative(rootDir, fullPath);
      const stat = statSync(fullPath);

      if (stat.isDirectory()) {
        if (!shouldExcludeDir(entry, relativePath)) {
          files.push(...findJSFiles(fullPath, rootDir));
        }
      } else if (entry.endsWith('.js') && !entry.endsWith('.css.js') && !entry.endsWith('.tpl.js')) {
        if (!shouldExcludeFile(entry, relativePath)) {
          files.push(fullPath);
        }
      }
    }
  } catch (e) { }

  return files;
}

/**
 * Analyze file for outdated patterns
 * @param {string} filePath 
 * @returns {PatternMatch[]}
 */
function analyzeFilePatterns(filePath) {
  const code = readFileSync(filePath, 'utf-8');
  const relPath = relative(process.cwd(), filePath);
  const matches = [];

  let ast;
  try {
    ast = parse(code, { ecmaVersion: 'latest', sourceType: 'module', locations: true });
  } catch (e) {
    return matches;
  }

  // Track async context
  const context = { inAsync: false };

  walk.simple(ast, {
    FunctionDeclaration(node) {
      context.inAsync = node.async;
    },
    ArrowFunctionExpression(node) {
      context.inAsync = node.async;
    },
  });

  // Reset and check patterns
  context.inAsync = false;

  walk.ancestor(ast, {
    '*'(node, ancestors) {
      // Update async context
      for (const anc of ancestors) {
        if ((anc.type === 'FunctionDeclaration' || anc.type === 'ArrowFunctionExpression' ||
          anc.type === 'FunctionExpression') && anc.async) {
          context.inAsync = true;
          break;
        }
      }

      for (const pattern of CODE_PATTERNS) {
        if (pattern.check(node, context)) {
          matches.push({
            pattern: pattern.name,
            description: pattern.description,
            file: relPath,
            line: node.loc?.start?.line || 0,
            severity: pattern.severity,
            replacement: pattern.replacement,
          });
        }
      }
    },
  });

  return matches;
}

/**
 * Analyze package.json for redundant dependencies
 * @param {string} dir 
 * @returns {RedundantDep[]}
 */
function analyzePackageJson(dir) {
  const pkgPath = join(dir, 'package.json');
  const redundant = [];

  if (!existsSync(pkgPath)) return redundant;

  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    const allDeps = {
      ...pkg.dependencies,
      ...pkg.devDependencies,
    };

    for (const depName of Object.keys(allDeps)) {
      if (REDUNDANT_DEPS[depName]) {
        redundant.push({
          name: depName,
          ...REDUNDANT_DEPS[depName],
        });
      }
    }
  } catch (e) { }

  return redundant;
}

/**
 * Get outdated patterns analysis
 * @param {string} dir 
 * @param {Object} [options]
 * @param {boolean} [options.codeOnly=false] - Only check code patterns
 * @param {boolean} [options.depsOnly=false] - Only check dependencies
 * @returns {Promise<{codePatterns: PatternMatch[], redundantDeps: RedundantDep[], stats: Object}>}
 */
export async function getOutdatedPatterns(dir, options = {}) {
  const codeOnly = options.codeOnly || false;
  const depsOnly = options.depsOnly || false;

  let codePatterns = [];
  let redundantDeps = [];

  if (!depsOnly) {
    const files = findJSFiles(dir);
    for (const file of files) {
      codePatterns.push(...analyzeFilePatterns(file));
    }
    // Sort by severity
    const severityOrder = { error: 0, warning: 1, info: 2 };
    codePatterns.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);
  }

  if (!codeOnly) {
    redundantDeps = analyzePackageJson(dir);
  }

  const stats = {
    totalPatterns: codePatterns.length,
    byPattern: {},
    bySeverity: {
      error: codePatterns.filter(p => p.severity === 'error').length,
      warning: codePatterns.filter(p => p.severity === 'warning').length,
      info: codePatterns.filter(p => p.severity === 'info').length,
    },
    redundantDeps: redundantDeps.length,
  };

  // Group by pattern name
  for (const p of codePatterns) {
    stats.byPattern[p.pattern] = (stats.byPattern[p.pattern] || 0) + 1;
  }

  return {
    codePatterns: codePatterns.slice(0, 50),
    redundantDeps,
    stats,
  };
}
