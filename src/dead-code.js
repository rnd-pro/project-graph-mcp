/**
 * Dead Code Detector
 * Finds unused functions, classes, exports, variables, and imports
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, relative, resolve, dirname } from 'path';
import { parse } from '../vendor/acorn.mjs';
import * as walk from '../vendor/walk.mjs';
import { shouldExcludeDir, shouldExcludeFile, parseGitignore } from './filters.js';

/**
 * @typedef {Object} DeadCodeItem
 * @property {string} name
 * @property {string} type - 'function' | 'class' | 'export' | 'variable' | 'import'
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
 * Find project root by walking up from dir to find package.json
 * @param {string} dir
 * @returns {string}
 */
function findProjectRoot(dir) {
  let current = resolve(dir);
  while (current !== dirname(current)) {
    if (existsSync(join(current, 'package.json'))) return current;
    current = dirname(current);
  }
  return resolve(dir);
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
 * Analyze file for unused local variables and imports
 * @param {string} code
 * @returns {{unusedVars: Array<{name: string, line: number}>, unusedImports: Array<{name: string, local: string, source: string, line: number}>}}
 */
function analyzeFileLocals(code) {
  const unusedVars = [];
  const unusedImports = [];

  let ast;
  try {
    ast = parse(code, { ecmaVersion: 'latest', sourceType: 'module', locations: true });
  } catch (e) {
    return { unusedVars, unusedImports };
  }

  // Collect all identifier references (non-declaration sites)
  const refs = new Set();
  // Collect variable declarations: { name, line, isExported }
  const varDecls = [];
  // Collect import specifiers: { name, local, source, line }
  const importDecls = [];
  // Track names at declaration sites to exclude
  const declSites = new Set();

  // First pass: collect declarations
  walk.simple(ast, {
    VariableDeclaration(node) {
      const isExported = node.parent?.type === 'ExportNamedDeclaration';
      for (const decl of node.declarations) {
        if (decl.id.type === 'Identifier') {
          varDecls.push({ name: decl.id.name, line: decl.loc.start.line, isExported });
          declSites.add(decl.id);
        }
      }
    },
    ImportDeclaration(node) {
      for (const spec of node.specifiers) {
        const local = spec.local.name;
        const imported = spec.type === 'ImportSpecifier'
          ? spec.imported.name
          : spec.type === 'ImportDefaultSpecifier'
            ? 'default' : '*';
        importDecls.push({
          name: imported,
          local,
          source: node.source.value,
          line: node.loc.start.line,
        });
        declSites.add(spec.local);
      }
    },
  });

  // Walk AST to find variable declaration sites more precisely
  // (the walk.simple above doesn't set parents, so we need ancestor walk)
  // Instead, use top-level statement analysis
  const topLevelExportedNames = new Set();
  for (const node of ast.body) {
    if (node.type === 'ExportNamedDeclaration' && node.declaration) {
      if (node.declaration.declarations) {
        for (const decl of node.declaration.declarations) {
          if (decl.id.type === 'Identifier') topLevelExportedNames.add(decl.id.name);
        }
      }
      if (node.declaration.id) topLevelExportedNames.add(node.declaration.id.name);
    }
    if (node.type === 'ExportNamedDeclaration' && node.specifiers) {
      for (const spec of node.specifiers) {
        topLevelExportedNames.add(spec.local.name);
      }
    }
  }

  // Collect all identifier references across the AST
  walk.simple(ast, {
    Identifier(node) {
      refs.add(node.name);
    },
  });

  // Find unused variables (declared but never referenced beyond declaration)
  // We count total references: if name appears only in declaration, it's unused
  for (const v of varDecls) {
    // Skip exported variables (handled by orphan exports)
    if (topLevelExportedNames.has(v.name)) continue;
    // Skip destructuring names and common patterns
    if (v.name.startsWith('_')) continue;
    // Check if name is referenced anywhere in the code beyond its declaration
    // Simple heuristic: count occurrences in the source
    const regex = new RegExp(`\\b${v.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g');
    const matches = code.match(regex);
    // If only 1 occurrence, it's the declaration itself
    if (matches && matches.length <= 1) {
      unusedVars.push({ name: v.name, line: v.line });
    }
  }

  // Find unused imports
  for (const imp of importDecls) {
    // Skip namespace imports
    if (imp.name === '*') continue;
    // Check if local name is referenced beyond the import declaration
    const regex = new RegExp(`\\b${imp.local.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g');
    const matches = code.match(regex);
    // If only 1 occurrence, it's the import declaration itself
    if (matches && matches.length <= 1) {
      unusedImports.push(imp);
    }
  }

  return { unusedVars, unusedImports };
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

  // Collect all calls and exports across target directory
  const allCalls = new Set();
  const allExports = new Set();
  const fileData = [];

  // Track imports project-wide: key = "importedName@resolvedSourcePath", value = consumer files
  /** @type {Map<string, Set<string>>} */
  const importConsumers = new Map();

  // Scan entire project for import consumers (not just target dir)
  const projectRoot = findProjectRoot(dir);
  const projectFiles = findJSFiles(projectRoot);

  for (const file of projectFiles) {
    let code;
    try { code = readFileSync(file, 'utf-8'); } catch { continue; }
    const relPath = relative(resolvedDir, file);
    const { imports } = analyzeFile(code);

    for (const imp of imports) {
      if (!imp.source.startsWith('.')) continue;
      const fileDir = dirname(file);
      let resolvedSource = resolve(fileDir, imp.source);
      if (!resolvedSource.endsWith('.js')) resolvedSource += '.js';
      const relSource = relative(resolvedDir, resolvedSource);
      const key = `${imp.name}@${relSource}`;
      if (!importConsumers.has(key)) importConsumers.set(key, new Set());
      importConsumers.get(key).add(relPath);
    }
  }

  // Analyze target directory files for definitions, calls, exports
  for (const file of files) {
    const code = readFileSync(file, 'utf-8');
    const relPath = relative(resolvedDir, file);
    const { definitions, calls, exports, namedExports } = analyzeFile(code);

    for (const call of calls) allCalls.add(call);
    for (const exp of exports) allExports.add(exp);

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

  // Find unused variables and imports per file
  for (const { file, code } of fileData) {
    if (file.includes('.test.') || file.includes('/tests/')) continue;
    if (file.endsWith('.css.js') || file.endsWith('.tpl.js')) continue;

    const { unusedVars, unusedImports } = analyzeFileLocals(code);

    for (const v of unusedVars) {
      items.push({
        name: v.name,
        type: 'variable',
        file,
        line: v.line,
        reason: 'Declared but never used',
      });
    }

    for (const imp of unusedImports) {
      items.push({
        name: imp.local,
        type: 'import',
        file,
        line: imp.line,
        reason: `Imported from '${imp.source}' but never used`,
      });
    }
  }

  const byType = {
    function: items.filter(i => i.type === 'function').length,
    class: items.filter(i => i.type === 'class').length,
    export: items.filter(i => i.type === 'export').length,
    variable: items.filter(i => i.type === 'variable').length,
    import: items.filter(i => i.type === 'import').length,
  };

  return {
    total: items.length,
    byType,
    items: items.slice(0, 50),
  };
}
