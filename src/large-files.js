/**
 * Large Files Analyzer
 * Identifies files that may need splitting
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import { parse } from '../vendor/acorn.mjs';
import * as walk from '../vendor/walk.mjs';
import { shouldExcludeDir, shouldExcludeFile, parseGitignore } from './filters.js';

/**
 * @typedef {Object} LargeFileItem
 * @property {string} file
 * @property {number} lines
 * @property {number} functions
 * @property {number} classes
 * @property {number} exports
 * @property {string} rating - 'ok' | 'warning' | 'critical'
 * @property {string[]} reasons
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
 * Analyze a single file
 * @param {string} filePath 
 * @returns {LargeFileItem}
 */
function analyzeFile(filePath) {
  const code = readFileSync(filePath, 'utf-8');
  const relPath = relative(process.cwd(), filePath);
  const lines = code.split('\n').length;

  let functions = 0;
  let classes = 0;
  let exports = 0;

  let ast;
  try {
    ast = parse(code, { ecmaVersion: 'latest', sourceType: 'module', locations: true });
  } catch (e) {
    return { file: relPath, lines, functions: 0, classes: 0, exports: 0, rating: 'ok', reasons: [] };
  }

  walk.simple(ast, {
    FunctionDeclaration() { functions++; },
    ArrowFunctionExpression(node) {
      if (node.body.type === 'BlockStatement') functions++;
    },
    ClassDeclaration() { classes++; },
    ExportNamedDeclaration() { exports++; },
    ExportDefaultDeclaration() { exports++; },
  });

  // Calculate rating
  const reasons = [];
  let score = 0;

  if (lines > 500) {
    score += 2;
    reasons.push(`${lines} lines (>500)`);
  } else if (lines > 300) {
    score += 1;
    reasons.push(`${lines} lines (>300)`);
  }

  if (functions > 15) {
    score += 2;
    reasons.push(`${functions} functions (>15)`);
  } else if (functions > 10) {
    score += 1;
    reasons.push(`${functions} functions (>10)`);
  }

  if (classes > 3) {
    score += 2;
    reasons.push(`${classes} classes (>3)`);
  } else if (classes > 1) {
    score += 1;
    reasons.push(`${classes} classes (>1)`);
  }

  if (exports > 10) {
    score += 2;
    reasons.push(`${exports} exports (>10)`);
  } else if (exports > 5) {
    score += 1;
    reasons.push(`${exports} exports (>5)`);
  }

  let rating = 'ok';
  if (score >= 4) rating = 'critical';
  else if (score >= 2) rating = 'warning';

  return { file: relPath, lines, functions, classes, exports, rating, reasons };
}

/**
 * Get large files analysis
 * @param {string} dir 
 * @param {Object} [options]
 * @param {boolean} [options.onlyProblematic=false] - Only show warning/critical
 * @returns {Promise<{total: number, stats: Object, items: LargeFileItem[]}>}
 */
export async function getLargeFiles(dir, options = {}) {
  const onlyProblematic = options.onlyProblematic || false;
  const files = findJSFiles(dir);
  let items = files.map(f => analyzeFile(f));

  if (onlyProblematic) {
    items = items.filter(i => i.rating !== 'ok');
  }

  // Sort by lines descending
  items.sort((a, b) => b.lines - a.lines);

  const stats = {
    totalFiles: files.length,
    ok: items.filter(i => i.rating === 'ok').length,
    warning: items.filter(i => i.rating === 'warning').length,
    critical: items.filter(i => i.rating === 'critical').length,
    totalLines: items.reduce((s, i) => s + i.lines, 0),
    avgLines: items.length > 0 ? Math.round(items.reduce((s, i) => s + i.lines, 0) / items.length) : 0,
  };

  return {
    total: items.length,
    stats,
    items: items.slice(0, 30),
  };
}
