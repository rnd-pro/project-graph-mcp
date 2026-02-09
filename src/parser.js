/**
 * AST Parser for JavaScript files using Acorn
 * Extracts classes, functions, methods, properties, imports, and calls
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative, resolve } from 'path';
import { parse } from '../vendor/acorn.mjs';
import * as walk from '../vendor/walk.mjs';
import { shouldExcludeDir, shouldExcludeFile, parseGitignore } from './filters.js';

/**
 * @typedef {Object} ClassInfo
 * @property {string} name
 * @property {string} [extends]
 * @property {string[]} methods
 * @property {string[]} properties
 * @property {string[]} calls
 * @property {string} file
 * @property {number} line
 */

/**
 * @typedef {Object} FunctionInfo
 * @property {string} name
 * @property {boolean} exported
 * @property {string[]} calls
 * @property {string} file
 * @property {number} line
 */

/**
 * @typedef {Object} ParseResult
 * @property {string[]} files
 * @property {ClassInfo[]} classes
 * @property {FunctionInfo[]} functions
 * @property {string[]} imports
 * @property {string[]} exports
 */

/**
 * Parse a JavaScript file content using AST
 * @param {string} code 
 * @param {string} filename 
 * @returns {Promise<ParseResult>}
 */
export async function parseFile(code, filename) {
  const result = {
    file: filename,
    classes: [],
    functions: [],
    imports: [],
    exports: [],
  };

  let ast;
  try {
    ast = parse(code, {
      ecmaVersion: 'latest',
      sourceType: 'module',
      locations: true,
    });
  } catch (e) {
    // If parsing fails, return empty result
    console.warn(`Parse error in ${filename}:`, e.message);
    return result;
  }

  // Track exported names
  const exportedNames = new Set();

  // Walk the AST
  walk.simple(ast, {
    // Import declarations
    ImportDeclaration(node) {
      for (const spec of node.specifiers) {
        if (spec.type === 'ImportDefaultSpecifier') {
          result.imports.push(spec.local.name);
        } else if (spec.type === 'ImportSpecifier') {
          result.imports.push(spec.imported.name);
        }
      }
    },

    // Export declarations
    ExportNamedDeclaration(node) {
      if (node.declaration) {
        if (node.declaration.id) {
          exportedNames.add(node.declaration.id.name);
        } else if (node.declaration.declarations) {
          for (const decl of node.declaration.declarations) {
            exportedNames.add(decl.id.name);
          }
        }
      }
      if (node.specifiers) {
        for (const spec of node.specifiers) {
          exportedNames.add(spec.exported.name);
        }
      }
    },

    ExportDefaultDeclaration(node) {
      if (node.declaration && node.declaration.id) {
        exportedNames.add(node.declaration.id.name);
      }
    },

    // Class declarations
    ClassDeclaration(node) {
      const classInfo = {
        name: node.id.name,
        extends: node.superClass ? node.superClass.name : null,
        methods: [],
        properties: [],
        calls: [],
        file: filename,
        line: node.loc.start.line,
      };

      // Extract methods and properties from class body
      for (const element of node.body.body) {
        if (element.type === 'MethodDefinition' && element.key.name !== 'constructor') {
          classInfo.methods.push(element.key.name);

          // Extract calls from method body
          extractCalls(element.value.body, classInfo.calls);
        } else if (element.type === 'PropertyDefinition') {
          const propName = element.key.name;

          // Check for init$ object properties
          if (propName === 'init$' && element.value && element.value.type === 'ObjectExpression') {
            for (const prop of element.value.properties) {
              if (prop.key && prop.key.name) {
                classInfo.properties.push(prop.key.name);
              }
            }
          }
        }
      }

      result.classes.push(classInfo);
    },

    // Standalone function declarations
    FunctionDeclaration(node) {
      if (node.id) {
        const funcInfo = {
          name: node.id.name,
          exported: false, // Will be updated later
          calls: [],
          file: filename,
          line: node.loc.start.line,
        };

        extractCalls(node.body, funcInfo.calls);
        result.functions.push(funcInfo);
      }
    },
  });

  // Mark exported functions
  for (const func of result.functions) {
    func.exported = exportedNames.has(func.name);
  }

  // Collect exports
  result.exports = [...exportedNames];

  return result;
}

/**
 * Extract method calls from AST node
 * @param {Object} node 
 * @param {string[]} calls 
 */
function extractCalls(node, calls) {
  if (!node) return;

  walk.simple(node, {
    CallExpression(callNode) {
      const callee = callNode.callee;

      if (callee.type === 'MemberExpression') {
        // obj.method() or this.method()
        const object = callee.object;
        const property = callee.property;

        if (property.type === 'Identifier') {
          if (object.type === 'Identifier') {
            // Class.method() or obj.method()
            const call = `${object.name}.${property.name}`;
            if (!calls.includes(call)) {
              calls.push(call);
            }
          } else if (object.type === 'MemberExpression' && object.property.type === 'Identifier') {
            // this.obj.method()
            const call = `${object.property.name}.${property.name}`;
            if (!calls.includes(call)) {
              calls.push(call);
            }
          } else if (object.type === 'ThisExpression') {
            // this.method() - internal call
            const call = property.name;
            if (!calls.includes(call)) {
              calls.push(call);
            }
          }
        }
      } else if (callee.type === 'Identifier') {
        // Direct function call: funcName()
        const call = callee.name;
        if (!calls.includes(call)) {
          calls.push(call);
        }
      }
    },
  });
}

/**
 * Parse all JS files in a directory
 * @param {string} dir 
 * @returns {Promise<ParseResult>}
 */
export async function parseProject(dir) {
  const result = {
    files: [],
    classes: [],
    functions: [],
    imports: [],
    exports: [],
  };

  const resolvedDir = resolve(dir);
  const files = findJSFiles(dir);

  for (const file of files) {
    const content = readFileSync(file, 'utf-8');
    const relPath = relative(resolvedDir, file);
    const parsed = await parseFile(content, relPath);

    result.files.push(relPath);
    result.classes.push(...parsed.classes);
    result.functions.push(...parsed.functions);
    result.imports.push(...parsed.imports);
    result.exports.push(...parsed.exports);
  }

  // Dedupe imports/exports
  result.imports = [...new Set(result.imports)];
  result.exports = [...new Set(result.exports)];

  return result;
}

/**
 * Find all JS files recursively (uses filter configuration)
 * @param {string} dir 
 * @param {string} [rootDir] - Root directory for relative path calculation
 * @returns {string[]}
 */
function findJSFiles(dir, rootDir = dir) {
  // Parse gitignore on first call
  if (dir === rootDir) {
    parseGitignore(rootDir);
  }

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
      } else if (entry.endsWith('.js') && !entry.endsWith('.css.js') && !entry.endsWith('.tpl.js')) {
        if (!shouldExcludeFile(entry, relativePath)) {
          files.push(fullPath);
        }
      }
    }
  } catch (e) {
    console.warn(`Cannot read directory ${dir}:`, e.message);
  }

  return files;
}
