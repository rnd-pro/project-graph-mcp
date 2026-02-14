/**
 * Dead Code Detector
 * Finds unused/orphan functions, classes, and exports
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative, resolve } from 'path';
import { parse } from '../vendor/acorn.mjs';
import * as walk from '../vendor/walk.mjs';
import { shouldExcludeDir, shouldExcludeFile, parseGitignore } from './filters.js';

/**
 * @typedef {Object} DeadCodeItem
 * @property {string} name
 * @property {string} type - 'function' | 'class' | 'export'
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
      } else if (entry.endsWith('.css.js') || entry.endsWith('.tpl.js')) {
        if (!shouldExcludeFile(entry, relativePath)) {
          files.push(fullPath);
        }
      }
    }
  } catch (e) { }

  return files;
}

/**
 * @typedef {Object} ImportInfo
 * @property {string} name - imported name
 * @property {string} source - import source path
 */

/**
 * @typedef {Object} ExportInfo
 * @property {string} name - exported name
 * @property {number} line - line number
 */

/**
 * Parse file and extract definitions, calls, exports, and imports
 * @param {string} code 
 * @returns {{definitions: Set<string>, calls: Set<string>, exports: Set<string>, imports: ImportInfo[], namedExports: ExportInfo[]}}
 */
function analyzeFile(code) {
  const definitions = new Set();
  const calls = new Set();
  const exports = new Set();
  /** @type {ImportInfo[]} */
  const imports = [];
  /** @type {ExportInfo[]} */
  const namedExports = [];

  let ast;
  try {
    ast = parse(code, { ecmaVersion: 'latest', sourceType: 'module', locations: true });
  } catch (e) {
    return { definitions, calls, exports, imports, namedExports };
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

    ImportDeclaration(node) {
      const source = node.source.value;
      for (const spec of node.specifiers) {
        if (spec.type === 'ImportSpecifier') {
          imports.push({ name: spec.imported.name, source });
        } else if (spec.type === 'ImportDefaultSpecifier') {
          imports.push({ name: 'default', source });
        }
      }
    },

    ExportNamedDeclaration(node) {
      if (node.declaration) {
        if (node.declaration.id) {
          const name = node.declaration.id.name;
          exports.add(name);
          namedExports.push({ name, line: node.loc.start.line });
        } else if (node.declaration.declarations) {
          for (const decl of node.declaration.declarations) {
            if (decl.id.type === 'Identifier') {
              const name = decl.id.name;
              exports.add(name);
              namedExports.push({ name, line: node.loc.start.line });
            }
          }
        }
      }
      if (node.specifiers) {
        for (const spec of node.specifiers) {
          const name = spec.exported.name;
          exports.add(name);
          namedExports.push({ name, line: node.loc.start.line });
        }
      }
    },

    ExportDefaultDeclaration(node) {
      if (node.declaration?.id) {
        exports.add(node.declaration.id.name);
      }
    },
  });

  return { definitions, calls, exports, imports, namedExports };
}

/**
 * Get dead code items
 * @param {string} dir 
 * @returns {Promise<{total: number, byType: Object, items: DeadCodeItem[]}>}
 */
export async function getDeadCode(dir) {
  const resolvedDir = resolve(dir);
  const files = findJSFiles(dir);
  const items = [];

  // Collect all calls and exports across project
  const allCalls = new Set();
  const allExports = new Set();
  const fileData = [];

  // Track imports: key = "importedName@resolvedSourcePath", value = count
  /** @type {Map<string, Set<string>>} */
  const importConsumers = new Map();

  for (const file of files) {
    const code = readFileSync(file, 'utf-8');
    const relPath = relative(resolvedDir, file);
    const { definitions, calls, exports, imports, namedExports } = analyzeFile(code);

    // Add to global sets
    for (const call of calls) allCalls.add(call);
    for (const exp of exports) allExports.add(exp);

    // Resolve import sources relative to the file
    for (const imp of imports) {
      if (!imp.source.startsWith('.')) continue; // skip bare specifiers (npm packages)
      const fileDir = join(resolvedDir, relPath, '..');
      let resolvedSource = resolve(fileDir, imp.source);
      // Normalize: add .js if missing
      if (!resolvedSource.endsWith('.js')) resolvedSource += '.js';
      const relSource = relative(resolvedDir, resolvedSource);
      const key = `${imp.name}@${relSource}`;
      if (!importConsumers.has(key)) importConsumers.set(key, new Set());
      importConsumers.get(key).add(relPath);
    }

    // Store for later (include per-file calls for scoped orphan checks)
    fileData.push({ file: relPath, code, definitions, calls, exports, namedExports });
  }

  // Find dead code (functions/classes)
  for (const { file, code, definitions, exports } of fileData) {
    // Skip test files and presentation files
    if (file.includes('.test.') || file.includes('/tests/')) continue;
    if (file.endsWith('.css.js') || file.endsWith('.tpl.js')) continue;

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

  // Find orphan exports (named exports not imported by any other file)
  for (const { file, calls, namedExports } of fileData) {
    if (file.includes('.test.') || file.includes('/tests/')) continue;

    for (const exp of namedExports) {
      // Skip exports used as call targets within the same file (e.g. ClassName.reg())
      if (calls.has(exp.name)) continue;
      const key = `${exp.name}@${file}`;
      const consumers = importConsumers.get(key);
      if (!consumers || consumers.size === 0) {
        items.push({
          name: exp.name,
          type: 'export',
          file,
          line: exp.line,
          reason: 'Exported but never imported',
        });
      }
    }
  }

  const byType = {
    function: items.filter(i => i.type === 'function').length,
    class: items.filter(i => i.type === 'class').length,
    export: items.filter(i => i.type === 'export').length,
  };

  return {
    total: items.length,
    byType,
    items: items.slice(0, 50),
  };
}
