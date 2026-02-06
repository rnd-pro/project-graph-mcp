/**
 * Undocumented code detector
 * Finds classes/functions missing JSDoc annotations
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import { parse } from '../vendor/acorn.mjs';
import * as walk from '../vendor/walk.mjs';
import { shouldExcludeDir, shouldExcludeFile, parseGitignore } from './filters.js';

/**
 * @typedef {Object} UndocumentedItem
 * @property {string} file
 * @property {string} name - ClassName.methodName or functionName
 * @property {number} line
 * @property {string[]} missing - What's missing: @test, @expect, @param, @returns, description
 */

/**
 * Get list of undocumented code items
 * @param {string} dir - Directory to scan
 * @param {Object} [options]
 * @param {'tests'|'params'|'all'} [options.level='tests'] - Strictness level
 * @returns {Promise<UndocumentedItem[]>}
 */
export async function getUndocumented(dir, options = {}) {
  const level = options.level || 'tests';
  const results = [];

  parseGitignore(dir);
  const files = findJSFiles(dir);

  for (const file of files) {
    const content = readFileSync(file, 'utf-8');
    const relPath = relative(process.cwd(), file);
    const items = analyzeFile(content, relPath, level);
    results.push(...items);
  }

  return results;
}

/**
 * Analyze single file for undocumented items
 * @param {string} code 
 * @param {string} filename 
 * @param {'tests'|'params'|'all'} level 
 * @returns {UndocumentedItem[]}
 */
function analyzeFile(code, filename, level) {
  const results = [];

  let ast;
  try {
    ast = parse(code, {
      ecmaVersion: 'latest',
      sourceType: 'module',
      locations: true,
      onComment: [],
    });
  } catch (e) {
    return results;
  }

  // Collect all comments with their end positions
  const comments = extractComments(code);

  walk.simple(ast, {
    ClassDeclaration(node) {
      // Check each method
      for (const element of node.body.body) {
        if (element.type === 'MethodDefinition') {
          const methodName = element.key.name || element.key.value;

          // Skip: constructor, private, getters/setters
          if (shouldSkip(methodName, element.kind)) continue;

          const jsdoc = findJSDocBefore(comments, element.loc.start.line, code);
          const missing = checkMissing(jsdoc, level);

          if (missing.length > 0) {
            results.push({
              file: filename,
              name: `${node.id.name}.${methodName}`,
              line: element.loc.start.line,
              missing,
            });
          }
        }
      }
    },

    FunctionDeclaration(node) {
      if (!node.id) return;
      const funcName = node.id.name;

      // Skip private functions
      if (funcName.startsWith('_')) return;

      const jsdoc = findJSDocBefore(comments, node.loc.start.line, code);
      const missing = checkMissing(jsdoc, level);

      if (missing.length > 0) {
        results.push({
          file: filename,
          name: funcName,
          line: node.loc.start.line,
          missing,
        });
      }
    },
  });

  return results;
}

/**
 * Check if method should be skipped
 * @param {string} name 
 * @param {string} kind - 'method', 'get', 'set', 'constructor'
 * @returns {boolean}
 */
function shouldSkip(name, kind) {
  if (kind === 'constructor') return true;
  if (kind === 'get' || kind === 'set') return true;
  if (name.startsWith('_')) return true;
  return false;
}

/**
 * Extract comments from code
 * @param {string} code 
 * @returns {Array<{text: string, endLine: number}>}
 */
function extractComments(code) {
  const comments = [];
  const regex = /\/\*\*[\s\S]*?\*\//g;
  let match;

  while ((match = regex.exec(code)) !== null) {
    const beforeMatch = code.slice(0, match.index + match[0].length);
    const endLine = beforeMatch.split('\n').length;
    comments.push({
      text: match[0],
      endLine,
    });
  }

  return comments;
}

/**
 * Find JSDoc comment before a line
 * @param {Array<{text: string, endLine: number}>} comments 
 * @param {number} targetLine 
 * @param {string} code 
 * @returns {string|null}
 */
function findJSDocBefore(comments, targetLine, code) {
  // Find comment that ends 1-3 lines before target
  for (const comment of comments) {
    const gap = targetLine - comment.endLine;
    if (gap >= 0 && gap <= 2) {
      return comment.text;
    }
  }
  return null;
}

/**
 * Check what's missing from JSDoc based on level
 * @param {string|null} jsdoc 
 * @param {'tests'|'params'|'all'} level 
 * @returns {string[]}
 */
function checkMissing(jsdoc, level) {
  const missing = [];

  if (!jsdoc) {
    // No JSDoc at all
    if (level === 'all') {
      missing.push('description');
    }
    if (level === 'params' || level === 'all') {
      missing.push('@param', '@returns');
    }
    if (level === 'tests' || level === 'params' || level === 'all') {
      missing.push('@test', '@expect');
    }
    return missing;
  }

  // Has JSDoc, check what's missing
  if (level === 'tests' || level === 'params' || level === 'all') {
    if (!jsdoc.includes('@test')) missing.push('@test');
    if (!jsdoc.includes('@expect')) missing.push('@expect');
  }

  if (level === 'params' || level === 'all') {
    if (!jsdoc.includes('@param')) missing.push('@param');
    if (!jsdoc.includes('@returns') && !jsdoc.includes('@return')) missing.push('@returns');
  }

  return missing;
}

/**
 * Find all JS files recursively
 * @param {string} dir 
 * @param {string} [rootDir]
 * @returns {string[]}
 */
function findJSFiles(dir, rootDir = dir) {
  const files = [];

  try {
    for (const entry of readdirSync(dir)) {
      const fullPath = join(dir, entry);
      const stat = statSync(fullPath);
      const relativePath = relative(rootDir, dir);

      if (stat.isDirectory()) {
        if (!shouldExcludeDir(entry, relativePath)) {
          files.push(...findJSFiles(fullPath, rootDir));
        }
      } else if (entry.endsWith('.js')) {
        if (!shouldExcludeFile(entry, relativePath)) {
          files.push(fullPath);
        }
      }
    }
  } catch (e) {
    // Ignore
  }

  return files;
}
