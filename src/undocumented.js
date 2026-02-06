/**
 * Undocumented Code Finder
 * Finds methods/functions missing JSDoc annotations
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import { shouldExcludeDir, shouldExcludeFile, parseGitignore } from './filters.js';

/**
 * @typedef {Object} UndocumentedItem
 * @property {string} name
 * @property {string} type - 'method' | 'function' | 'class'
 * @property {string} file
 * @property {number} line
 * @property {string} [reason] - What's missing
 */

/**
 * Find all JS files in directory
 * @param {string} dir 
 * @param {string} rootDir
 * @returns {string[]}
 */
function findJSFiles(dir, rootDir = dir) {
  if (dir === rootDir) {
    parseGitignore(rootDir);
  }

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
  } catch (e) {
    // Directory not found
  }

  return files;
}

/**
 * Check if a JSDoc block has @test annotations
 * @param {string} jsdoc 
 * @returns {boolean}
 */
function hasTestAnnotations(jsdoc) {
  return jsdoc.includes('@test') || jsdoc.includes('@expect');
}

/**
 * Check if a JSDoc block has @param annotations
 * @param {string} jsdoc 
 * @returns {boolean}
 */
function hasParamAnnotations(jsdoc) {
  return jsdoc.includes('@param');
}

/**
 * Check if a JSDoc block has @returns annotation
 * @param {string} jsdoc 
 * @returns {boolean}
 */
function hasReturnsAnnotation(jsdoc) {
  return jsdoc.includes('@returns') || jsdoc.includes('@return');
}

/**
 * Parse file and find undocumented items
 * @param {string} content 
 * @param {string} filePath 
 * @param {'tests'|'params'|'all'} level
 * @returns {UndocumentedItem[]}
 */
function parseUndocumented(content, filePath, level) {
  const results = [];

  // Find standalone functions
  const functionRegex = /^(\s*)(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)\s*{/gm;
  const classRegex = /^(\s*)(?:export\s+)?class\s+(\w+)/gm;

  let match;

  // Find classes
  while ((match = classRegex.exec(content)) !== null) {
    const lineNum = content.slice(0, match.index).split('\n').length;
    const prevLines = content.slice(0, match.index);
    const hasJsdoc = /\/\*\*[\s\S]*?\*\/\s*$/.test(prevLines);

    if (!hasJsdoc && level === 'all') {
      results.push({
        name: match[2],
        type: 'class',
        file: filePath,
        line: lineNum,
        reason: 'No JSDoc',
      });
    }
  }

  // Find standalone functions
  while ((match = functionRegex.exec(content)) !== null) {
    const lineNum = content.slice(0, match.index).split('\n').length;
    const prevLines = content.slice(0, match.index);
    const jsdocMatch = prevLines.match(/\/\*\*([\s\S]*?)\*\/\s*$/);
    const jsdoc = jsdocMatch ? jsdocMatch[1] : '';
    const params = match[3].trim();

    const issues = [];

    if (!jsdocMatch) {
      if (level !== 'tests') {
        issues.push('No JSDoc');
      }
    } else {
      if (level === 'tests' && !hasTestAnnotations(jsdoc)) {
        issues.push('No @test/@expect');
      }
      if ((level === 'params' || level === 'all') && params && !hasParamAnnotations(jsdoc)) {
        issues.push('No @param');
      }
      if (level === 'all' && !hasReturnsAnnotation(jsdoc)) {
        issues.push('No @returns');
      }
    }

    if (issues.length > 0) {
      results.push({
        name: match[2],
        type: 'function',
        file: filePath,
        line: lineNum,
        reason: issues.join(', '),
      });
    }
  }

  // Find class methods (indent > 0, not function keyword)
  const classMethodRegex = /^(  +)(async\s+)?(\w+)\s*\(([^)]*)\)\s*{/gm;
  while ((match = classMethodRegex.exec(content)) !== null) {
    const methodName = match[3];

    // Skip constructor, lifecycle methods, and JS keywords
    const skipNames = [
      'constructor', 'connectedCallback', 'disconnectedCallback', 'attributeChangedCallback', 'renderCallback',
      'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'try', 'catch', 'finally', 'with',
    ];
    if (skipNames.includes(methodName)) {
      continue;
    }

    const lineNum = content.slice(0, match.index).split('\n').length;
    const prevLines = content.slice(0, match.index);
    const jsdocMatch = prevLines.match(/\/\*\*([\s\S]*?)\*\/\s*$/);
    const jsdoc = jsdocMatch ? jsdocMatch[1] : '';
    const params = match[4].trim();

    const issues = [];

    if (!jsdocMatch) {
      if (level !== 'tests') {
        issues.push('No JSDoc');
      }
    } else {
      if (level === 'tests' && !hasTestAnnotations(jsdoc)) {
        issues.push('No @test/@expect');
      }
      if ((level === 'params' || level === 'all') && params && !hasParamAnnotations(jsdoc)) {
        issues.push('No @param');
      }
    }

    if (issues.length > 0) {
      results.push({
        name: methodName,
        type: 'method',
        file: filePath,
        line: lineNum,
        reason: issues.join(', '),
      });
    }
  }

  return results;
}

/**
 * Get undocumented items from directory
 * @param {string} dir 
 * @param {'tests'|'params'|'all'} level
 * @returns {UndocumentedItem[]}
 */
export function getUndocumented(dir, level = 'tests') {
  const files = findJSFiles(dir);
  const results = [];

  for (const file of files) {
    const content = readFileSync(file, 'utf-8');
    const items = parseUndocumented(content, relative(process.cwd(), file), level);
    results.push(...items);
  }

  return results;
}

/**
 * Get summary of undocumented items
 * @param {string} dir 
 * @param {'tests'|'params'|'all'} level
 * @returns {Object}
 */
export function getUndocumentedSummary(dir, level = 'tests') {
  const items = getUndocumented(dir, level);

  const byType = {
    class: items.filter(i => i.type === 'class').length,
    function: items.filter(i => i.type === 'function').length,
    method: items.filter(i => i.type === 'method').length,
  };

  const byReason = {};
  for (const item of items) {
    byReason[item.reason] = (byReason[item.reason] || 0) + 1;
  }

  return {
    total: items.length,
    byType,
    byReason,
    items: items.slice(0, 20),
  };
}
