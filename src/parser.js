/**
 * AST Parser for JavaScript files using Acorn
 * Extracts classes, functions, methods, properties, imports, calls, and SQL queries
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, relative, resolve } from 'path';
import { parse } from '../vendor/acorn.mjs';
import * as walk from '../vendor/walk.mjs';
import { shouldExcludeDir, shouldExcludeFile, parseGitignore } from './filters.js';
import { parseTypeScript } from './lang-typescript.js';
import { parsePython } from './lang-python.js';
import { parseGo } from './lang-go.js';
import { parseSQL, extractSQLFromString, isSQLString } from './lang-sql.js';

/** Supported source file extensions */
const SOURCE_EXTENSIONS = ['.js', '.ts', '.tsx', '.py', '.go', '.sql'];

/**
 * @typedef {Object} ClassInfo
 * @property {string} name
 * @property {string} [extends]
 * @property {string[]} methods
 * @property {string[]} properties
 * @property {string[]} calls
 * @property {string[]} [dbReads] - Tables read by SQL queries
 * @property {string[]} [dbWrites] - Tables written by SQL queries
 * @property {string} file
 * @property {number} line
 */

/**
 * @typedef {Object} FunctionInfo
 * @property {string} name
 * @property {boolean} exported
 * @property {string[]} calls
 * @property {string[]} [dbReads] - Tables read by SQL queries
 * @property {string[]} [dbWrites] - Tables written by SQL queries
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
        dbReads: [],
        dbWrites: [],
        file: filename,
        line: node.loc.start.line,
      };

      // Extract methods and properties from class body
      for (const element of node.body.body) {
        if (element.type === 'MethodDefinition' && element.key.name !== 'constructor') {
          classInfo.methods.push(element.key.name);

          // Extract calls and SQL from method body
          extractCallsAndSQL(element.value.body, classInfo.calls, classInfo.dbReads, classInfo.dbWrites);
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
          params: node.params.map(p => {
            if (p.type === 'Identifier') return p.name;
            if (p.type === 'AssignmentPattern' && p.left.type === 'Identifier') return p.left.name + '=';
            if (p.type === 'RestElement' && p.argument.type === 'Identifier') return '...' + p.argument.name;
            if (p.type === 'ObjectPattern') return 'options';
            return '?';
          }),
          async: node.async || false,
          calls: [],
          dbReads: [],
          dbWrites: [],
          file: filename,
          line: node.loc.start.line,
        };

        extractCallsAndSQL(node.body, funcInfo.calls, funcInfo.dbReads, funcInfo.dbWrites);
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

/** DB client method names that accept SQL as first argument */
const DB_METHODS = new Set(['query', 'execute', 'raw', 'exec', 'queryFile', 'none', 'one', 'many', 'any', 'oneOrNone', 'manyOrNone', 'result']);

/**
 * Extract method calls AND SQL queries from AST node in a single walk.
 * Combines what was previously two separate walk.simple() calls.
 * @param {Object} node 
 * @param {string[]} calls 
 * @param {string[]} [dbReads]
 * @param {string[]} [dbWrites]
 */
function extractCallsAndSQL(node, calls, dbReads, dbWrites) {
  if (!node) return;

  walk.simple(node, {
    CallExpression(callNode) {
      const callee = callNode.callee;

      // === Call extraction ===
      if (callee.type === 'MemberExpression') {
        const object = callee.object;
        const property = callee.property;

        if (property.type === 'Identifier') {
          if (object.type === 'Identifier') {
            const call = `${object.name}.${property.name}`;
            if (!calls.includes(call)) calls.push(call);
          } else if (object.type === 'MemberExpression' && object.property.type === 'Identifier') {
            const call = `${object.property.name}.${property.name}`;
            if (!calls.includes(call)) calls.push(call);
          } else if (object.type === 'ThisExpression') {
            const call = property.name;
            if (!calls.includes(call)) calls.push(call);
          }
        }
      } else if (callee.type === 'Identifier') {
        const call = callee.name;
        if (!calls.includes(call)) calls.push(call);
      }

      // === SQL extraction from DB client calls ===
      if (dbReads && dbWrites) {
        const methodName = getCallMethodName(callNode);
        if (methodName && DB_METHODS.has(methodName) && callNode.arguments.length > 0) {
          const sqlStr = extractStringValue(callNode.arguments[0]);
          if (sqlStr && isSQLString(sqlStr)) {
            const ext = extractSQLFromString(sqlStr);
            ext.reads.forEach(t => { if (!dbReads.includes(t)) dbReads.push(t); });
            ext.writes.forEach(t => { if (!dbWrites.includes(t)) dbWrites.push(t); });
          }
        }
      }
    },

    // === SQL: Tagged templates ===
    TaggedTemplateExpression(tagNode) {
      if (!dbReads || !dbWrites) return;
      const tagName = getTagName(tagNode.tag);
      if (tagName && /sql/i.test(tagName)) {
        const sqlStr = templateToString(tagNode.quasi);
        if (sqlStr) {
          const ext = extractSQLFromString(sqlStr);
          ext.reads.forEach(t => { if (!dbReads.includes(t)) dbReads.push(t); });
          ext.writes.forEach(t => { if (!dbWrites.includes(t)) dbWrites.push(t); });
        }
      }
    },

    // === SQL: Standalone template literals ===
    TemplateLiteral(tplNode) {
      if (!dbReads || !dbWrites) return;
      const sqlStr = templateToString(tplNode);
      if (sqlStr && isSQLString(sqlStr)) {
        const ext = extractSQLFromString(sqlStr);
        ext.reads.forEach(t => { if (!dbReads.includes(t)) dbReads.push(t); });
        ext.writes.forEach(t => { if (!dbWrites.includes(t)) dbWrites.push(t); });
      }
    },

    // === SQL: String literals ===
    Literal(litNode) {
      if (!dbReads || !dbWrites) return;
      if (typeof litNode.value === 'string' && isSQLString(litNode.value)) {
        const ext = extractSQLFromString(litNode.value);
        ext.reads.forEach(t => { if (!dbReads.includes(t)) dbReads.push(t); });
        ext.writes.forEach(t => { if (!dbWrites.includes(t)) dbWrites.push(t); });
      }
    },
  });
}

/**
 * Get tag name from tagged template expression.
 * Handles: sql`...`, Prisma.sql`...`, db.sql`...`
 * @param {Object} tag - AST node
 * @returns {string|null}
 */
function getTagName(tag) {
  if (tag.type === 'Identifier') return tag.name;
  if (tag.type === 'MemberExpression' && tag.property.type === 'Identifier') {
    return tag.property.name;
  }
  return null;
}

/**
 * Get method name from a CallExpression callee.
 * @param {Object} callNode
 * @returns {string|null}
 */
function getCallMethodName(callNode) {
  const callee = callNode.callee;
  if (callee.type === 'MemberExpression' && callee.property.type === 'Identifier') {
    return callee.property.name;
  }
  return null;
}

/**
 * Extract string value from AST node (Literal or TemplateLiteral).
 * For templates with expressions, substitutes $N placeholders.
 * @param {Object} node
 * @returns {string|null}
 */
function extractStringValue(node) {
  if (!node) return null;
  if (node.type === 'Literal' && typeof node.value === 'string') {
    return node.value;
  }
  if (node.type === 'TemplateLiteral') {
    return templateToString(node);
  }
  return null;
}

/**
 * Convert TemplateLiteral AST node to string.
 * Expressions are replaced with $N placeholders.
 * @param {Object} tplNode
 * @returns {string}
 */
function templateToString(tplNode) {
  if (!tplNode || !tplNode.quasis) return '';
  let result = '';
  for (let i = 0; i < tplNode.quasis.length; i++) {
    result += tplNode.quasis[i].value.cooked || tplNode.quasis[i].value.raw || '';
    if (i < tplNode.expressions?.length) {
      result += '$' + (i + 1);
    }
  }
  return result;
}

/**
 * Discover sub-projects in a monorepo directory structure
 * @param {string} rootDir 
 * @returns {Array<{name: string, path: string, absolutePath: string}>}
 */
export function discoverSubProjects(rootDir) {
  const resolvedRoot = resolve(rootDir);
  const subProjects = [];
  
  // Known monorepo directory conventions
  const MONO_DIRS = ['packages', 'apps', 'services', 'modules', 'libs', 'plugins'];
  
  for (const monoDir of MONO_DIRS) {
    const monoPath = join(resolvedRoot, monoDir);
    if (!existsSync(monoPath)) continue;
    
    try {
      for (const entry of readdirSync(monoPath)) {
        const entryPath = join(monoPath, entry);
        const pkgPath = join(entryPath, 'package.json');
        if (statSync(entryPath).isDirectory() && existsSync(pkgPath)) {
          try {
            const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
            subProjects.push({
              name: pkg.name || entry,
              path: relative(resolvedRoot, entryPath),
              absolutePath: entryPath,
            });
          } catch { 
            subProjects.push({ name: entry, path: relative(resolvedRoot, entryPath), absolutePath: entryPath });
          }
        }
      }
    } catch { /* dir not readable */ }
  }
  
  return subProjects;
}

/**
 * Parse all JS files in a directory
 * @param {string} dir 
 * @param {Object} [options={}]
 * @param {boolean} [options.recursive=false]
 * @returns {Promise<ParseResult>}
 */
export async function parseProject(dir, options = {}) {
  const result = {
    files: [],
    classes: [],
    functions: [],
    imports: [],
    exports: [],
    tables: [],
  };

  const resolvedDir = resolve(dir);
  const files = findJSFiles(dir);

  for (const file of files) {
    try {
      const content = readFileSync(file, 'utf-8');
      const relPath = relative(resolvedDir, file);
      const parsed = await parseFileByExtension(content, relPath);

      result.files.push(relPath);
      result.classes.push(...parsed.classes);
      result.functions.push(...parsed.functions);
      result.imports.push(...parsed.imports);
      result.exports.push(...parsed.exports);
      if (parsed.tables?.length) {
        result.tables.push(...parsed.tables);
      }
    } catch (e) {
      // Ignore unreadable files
    }
  }

  // Recursive monorepo support
  if (options.recursive) {
    const subs = discoverSubProjects(dir);
    result.subProjects = [];
    for (const sub of subs) {
      try {
        const subResult = await parseProject(sub.absolutePath);
        // Prefix all file paths with sub-project path
        for (const f of subResult.files) {
          result.files.push(join(sub.path, f));
        }
        for (const c of subResult.classes) {
          c.file = join(sub.path, c.file);
          result.classes.push(c);
        }
        for (const fn of subResult.functions) {
          fn.file = join(sub.path, fn.file);
          result.functions.push(fn);
        }
        result.imports.push(...subResult.imports);
        result.exports.push(...subResult.exports);
        if (subResult.tables?.length) result.tables.push(...subResult.tables);
        result.subProjects.push({ name: sub.name, path: sub.path, files: subResult.files.length });
      } catch { /* sub-project parse failure is non-fatal */ }
    }
  }

  // Dedupe imports/exports
  result.imports = [...new Set(result.imports)];
  result.exports = [...new Set(result.exports)];

  return result;
}

/**
 * Route file to appropriate parser based on extension.
 * @param {string} code
 * @param {string} filename
 * @returns {Promise<ParseResult>}
 */
async function parseFileByExtension(code, filename) {
  if (filename.endsWith('.sql')) {
    return parseSQL(code, filename);
  }
  if (filename.endsWith('.py')) {
    return parsePython(code, filename);
  }
  if (filename.endsWith('.go')) {
    return parseGo(code, filename);
  }
  if (filename.endsWith('.ts') || filename.endsWith('.tsx')) {
    return parseTypeScript(code, filename);
  }
  // Default: JS via Acorn
  return parseFile(code, filename);
}

/**
 * Check if file is a supported source file.
 * @param {string} filename
 * @returns {boolean}
 */
function isSourceFile(filename) {
  // Exclude Symbiote.js presentation files
  if (filename.endsWith('.css.js') || filename.endsWith('.tpl.js')) {
    return false;
  }
  return SOURCE_EXTENSIONS.some(ext => filename.endsWith(ext));
}

/**
 * Find all JS files recursively (uses filter configuration)
 * @param {string} dir 
 * @param {string} [rootDir] - Root directory for relative path calculation
 * @returns {string[]}
 */
export function findJSFiles(dir, rootDir = dir) {
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
      } else if (isSourceFile(entry)) {
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
