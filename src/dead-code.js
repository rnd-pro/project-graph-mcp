/**
 * Dead Code Detector
 * Finds unused/orphan functions and classes
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import { parse } from '../vendor/acorn.mjs';
import * as walk from '../vendor/walk.mjs';
import { shouldExcludeDir, shouldExcludeFile, parseGitignore } from './filters.js';

/**
 * @typedef {Object} DeadCodeItem
 * @property {string} name
 * @property {string} type - 'function' | 'class'
 * @property {string} file
 * @property {number} line
 * @property {string} reason
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
 * Parse file and extract definitions + calls
 * @param {string} code 
 * @returns {{definitions: Set<string>, calls: Set<string>, exports: Set<string>}}
 */
function analyzeFile(code) {
  const definitions = new Set();
  const calls = new Set();
  const exports = new Set();

  let ast;
  try {
    ast = parse(code, { ecmaVersion: 'latest', sourceType: 'module', locations: true });
  } catch (e) {
    return { definitions, calls, exports };
  }

  walk.simple(ast, {
    FunctionDeclaration(node) {
      if (node.id) {
        definitions.add(node.id.name);
      }
    },

    ClassDeclaration(node) {
      if (node.id) {
        definitions.add(node.id.name);
      }
    },

    CallExpression(node) {
      if (node.callee.type === 'Identifier') {
        calls.add(node.callee.name);
      } else if (node.callee.type === 'MemberExpression' && node.callee.object.type === 'Identifier') {
        calls.add(node.callee.object.name);
      }
      // Track function references passed as arguments: .map(funcName)
      for (const arg of node.arguments) {
        if (arg.type === 'Identifier') {
          calls.add(arg.name);
        }
      }
    },

    NewExpression(node) {
      if (node.callee.type === 'Identifier') {
        calls.add(node.callee.name);
      }
    },

    ExportNamedDeclaration(node) {
      if (node.declaration) {
        if (node.declaration.id) {
          exports.add(node.declaration.id.name);
        } else if (node.declaration.declarations) {
          for (const decl of node.declaration.declarations) {
            if (decl.id.type === 'Identifier') {
              exports.add(decl.id.name);
            }
          }
        }
      }
      if (node.specifiers) {
        for (const spec of node.specifiers) {
          exports.add(spec.exported.name);
        }
      }
    },

    ExportDefaultDeclaration(node) {
      if (node.declaration?.id) {
        exports.add(node.declaration.id.name);
      }
    },
  });

  return { definitions, calls, exports };
}

/**
 * Get dead code items
 * @param {string} dir 
 * @returns {Promise<{total: number, byType: Object, items: DeadCodeItem[]}>}
 */
export async function getDeadCode(dir) {
  const files = findJSFiles(dir);
  const items = [];

  // Collect all calls and exports across project
  const allCalls = new Set();
  const allExports = new Set();
  const fileData = [];

  for (const file of files) {
    const code = readFileSync(file, 'utf-8');
    const relPath = relative(process.cwd(), file);
    const { definitions, calls, exports } = analyzeFile(code);

    // Add to global sets
    for (const call of calls) allCalls.add(call);
    for (const exp of exports) allExports.add(exp);

    // Store for later
    fileData.push({ file: relPath, code, definitions, exports });
  }

  // Find dead code
  for (const { file, code, definitions, exports } of fileData) {
    // Skip test files
    if (file.includes('.test.') || file.includes('/tests/')) continue;

    let ast;
    try {
      ast = parse(code, { ecmaVersion: 'latest', sourceType: 'module', locations: true });
    } catch (e) {
      continue;
    }

    walk.simple(ast, {
      FunctionDeclaration(node) {
        if (!node.id) return;
        const name = node.id.name;

        // Skip if exported
        if (exports.has(name) || allExports.has(name)) return;

        // Skip if called anywhere
        if (allCalls.has(name)) return;

        // Skip private functions
        if (name.startsWith('_')) return;

        items.push({
          name,
          type: 'function',
          file,
          line: node.loc.start.line,
          reason: 'Never called',
        });
      },

      ClassDeclaration(node) {
        if (!node.id) return;
        const name = node.id.name;

        // Skip if exported
        if (exports.has(name) || allExports.has(name)) return;

        // Skip if used (new Class() or extended)
        if (allCalls.has(name)) return;

        items.push({
          name,
          type: 'class',
          file,
          line: node.loc.start.line,
          reason: 'Never instantiated',
        });
      },
    });
  }

  const byType = {
    function: items.filter(i => i.type === 'function').length,
    class: items.filter(i => i.type === 'class').length,
  };

  return {
    total: items.length,
    byType,
    items: items.slice(0, 30),
  };
}
