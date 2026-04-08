/**
 * JSDoc Consistency Checker (AST-based)
 * Validates JSDoc annotations against actual function signatures
 * 
 * Checks:
 * - Param count mismatch (JSDoc vs AST)
 * - Param name mismatch
 * - Missing @returns on functions with return statements
 * - Type hint inconsistency (default value vs JSDoc type)
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative, resolve } from 'path';
import { parse } from '../vendor/acorn.mjs';
import * as walk from '../vendor/walk.mjs';
import { shouldExcludeDir, shouldExcludeFile, parseGitignore } from './filters.js';

/**
 * @typedef {Object} JSDocIssue
 * @property {string} file
 * @property {number} line
 * @property {string} name - Function or method name
 * @property {'error'|'warning'} severity
 * @property {string} message
 */

/**
 * Find all JS files in directory
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
  } catch (e) { /* dir not found */ }
  return files;
}

/**
 * Extract JSDoc comments with positions
 * @param {string} code
 * @returns {Array<{text: string, endLine: number, params: Array<{name: string, type: string}>, hasReturns: boolean}>}
 */
function extractJSDocComments(code) {
  const comments = [];
  const regex = /\/\*\*[\s\S]*?\*\//g;
  let match;

  while ((match = regex.exec(code)) !== null) {
    const text = match[0];
    const endLine = code.slice(0, match.index + text.length).split('\n').length;

    // Parse @param tags — handle nested braces in types like {Array<{text: string}>}
    const params = [];
    const paramStartRegex = /@param\s+\{/g;
    let paramStart;
    while ((paramStart = paramStartRegex.exec(text)) !== null) {
      // Find matching closing brace (balanced)
      let depth = 1;
      let i = paramStart.index + paramStart[0].length;
      while (i < text.length && depth > 0) {
        if (text[i] === '{') depth++;
        else if (text[i] === '}') depth--;
        i++;
      }
      if (depth !== 0) continue;
      const type = text.slice(paramStart.index + paramStart[0].length, i - 1);
      // Extract param name after the closing brace
      const afterType = text.slice(i);
      const nameMatch = afterType.match(/^\s+(\[?\w+(?:\.\w+)*\]?)/);
      if (!nameMatch) continue;
      let name = nameMatch[1];
      // Strip [] from optional params: [opts] → opts
      if (name.startsWith('[')) name = name.slice(1);
      if (name.endsWith(']')) name = name.slice(0, -1);
      // Strip dotted paths: options.includeTests → skip (nested property)
      if (name.includes('.')) continue;
      params.push({ name, type });
    }

    const hasReturns = /@returns?\s/.test(text);

    comments.push({ text, endLine, params, hasReturns });
  }

  return comments;
}

/**
 * Find JSDoc comment before a target line
 * @param {Array} comments
 * @param {number} targetLine
 * @returns {Object|null}
 */
function findJSDocBefore(comments, targetLine) {
  for (const comment of comments) {
    const gap = targetLine - comment.endLine;
    if (gap >= 0 && gap <= 2) return comment;
  }
  return null;
}

/**
 * Extract parameter name from AST node
 * @param {Object} param
 * @returns {string}
 */
function extractParamName(param) {
  if (param.type === 'Identifier') return param.name;
  if (param.type === 'AssignmentPattern' && param.left.type === 'Identifier') return param.left.name;
  if (param.type === 'RestElement' && param.argument.type === 'Identifier') return param.argument.name;
  if (param.type === 'ObjectPattern') return 'options';
  if (param.type === 'ArrayPattern') return 'args';
  return 'param';
}

/**
 * Infer expected type from AST default value
 * @param {Object} param
 * @returns {string|null}
 */
function inferTypeFromDefault(param) {
  if (param.type !== 'AssignmentPattern') return null;
  const def = param.right;
  if (def.type === 'Literal') {
    if (typeof def.value === 'string') return 'string';
    if (typeof def.value === 'number') return 'number';
    if (typeof def.value === 'boolean') return 'boolean';
  }
  if (def.type === 'ArrayExpression') return 'Array';
  if (def.type === 'ObjectExpression') return 'Object';
  return null;
}

/**
 * Check if function body has return statements with values
 * @param {Object} node - Function AST node
 * @returns {boolean}
 */
function hasReturnValue(node) {
  let found = false;
  try {
    walk.simple(node.body, {
      ReturnStatement(ret) {
        if (ret.argument) found = true;
      },
      // Don't recurse into nested functions
      FunctionDeclaration() { },
      FunctionExpression() { },
      ArrowFunctionExpression() { },
    });
  } catch (e) { /* walk error */ }
  return found;
}

/**
 * Validate a function's JSDoc against its AST
 * @param {Object} jsdoc - Parsed JSDoc
 * @param {Object[]} astParams - AST param nodes
 * @param {Object} funcNode - AST function node
 * @param {string} name - Function name
 * @param {string} file - File path
 * @param {number} line - Line number
 * @returns {JSDocIssue[]}
 */
function validateFunction(jsdoc, astParams, funcNode, name, file, line) {
  const issues = [];

  if (!jsdoc) return issues; // No JSDoc = handled by undocumented checker

  const docParams = jsdoc.params;

  // 1. Param count mismatch
  if (docParams.length !== astParams.length) {
    issues.push({
      file, line, name,
      severity: 'error',
      message: `Param count mismatch: JSDoc has ${docParams.length}, function has ${astParams.length}`,
    });
  }

  // 2. Param name mismatch
  const minLen = Math.min(docParams.length, astParams.length);
  for (let i = 0; i < minLen; i++) {
    const docName = docParams[i].name;
    const astName = extractParamName(astParams[i]);

    if (docName !== astName && astName !== 'options' && astName !== 'args' && astName !== 'param') {
      issues.push({
        file, line, name,
        severity: 'error',
        message: `Param name mismatch at position ${i}: JSDoc says "${docName}", code has "${astName}"`,
      });
    }
  }

  // 3. Missing @returns on non-void functions
  if (!jsdoc.hasReturns && hasReturnValue(funcNode)) {
    issues.push({
      file, line, name,
      severity: 'warning',
      message: 'Function returns a value but JSDoc has no @returns',
    });
  }

  // 4. Type hint inconsistency
  for (let i = 0; i < minLen; i++) {
    const docType = docParams[i].type;
    const inferredType = inferTypeFromDefault(astParams[i]);

    if (inferredType && docType && docType !== '*') {
      let compatible = docType.includes(inferredType);
      // Union types like 'a'|'b' are valid strings
      if (!compatible && inferredType === 'string' && docType.includes("'") && docType.includes('|')) {
        compatible = true;
      }
      // Type[] shorthand is a valid Array
      if (!compatible && inferredType === 'Array' && docType.includes('[]')) {
        compatible = true;
      }
      if (!compatible) {
        issues.push({
          file, line, name,
          severity: 'warning',
          message: `Type mismatch for "${docParams[i].name}": JSDoc says {${docType}}, default value suggests {${inferredType}}`,
        });
      }
    }
  }

  return issues;
}

/**
 * Check JSDoc consistency for a single file (per-file export for cache integration)
 * @param {string} code
 * @param {string} filePath
 * @returns {JSDocIssue[]}
 */
export function checkJSDocFile(code, filePath) {
  const issues = [];

  let ast;
  try {
    ast = parse(code, { ecmaVersion: 'latest', sourceType: 'module', locations: true });
  } catch (e) {
    return issues;
  }

  const comments = extractJSDocComments(code);

  walk.simple(ast, {
    FunctionDeclaration(node) {
      if (!node.id) return;
      const jsdoc = findJSDocBefore(comments, node.loc.start.line);
      if (jsdoc) {
        issues.push(...validateFunction(jsdoc, node.params, node, node.id.name, filePath, node.loc.start.line));
      }
    },

    // Exported arrow/const functions
    VariableDeclaration(node) {
      for (const decl of node.declarations) {
        if (!decl.init) continue;
        const func = decl.init.type === 'ArrowFunctionExpression' || decl.init.type === 'FunctionExpression'
          ? decl.init : null;
        if (!func || !decl.id?.name) continue;

        const jsdoc = findJSDocBefore(comments, node.loc.start.line);
        if (jsdoc) {
          issues.push(...validateFunction(jsdoc, func.params, func, decl.id.name, filePath, node.loc.start.line));
        }
      }
    },

    ClassDeclaration(node) {
      const className = node.id?.name || 'Anonymous';
      for (const element of node.body.body) {
        if (element.type !== 'MethodDefinition') continue;
        const methodName = element.key.name || element.key.value;
        if (!methodName || methodName === 'constructor') continue;
        if (element.kind !== 'method') continue;

        const funcNode = element.value;
        const jsdoc = findJSDocBefore(comments, element.loc.start.line);
        if (jsdoc) {
          issues.push(...validateFunction(jsdoc, funcNode.params, funcNode, `${className}.${methodName}`, filePath, element.loc.start.line));
        }
      }
    },
  });

  return issues;
}

/**
 * Check JSDoc consistency across a directory
 * @param {string} dir
 * @returns {{ issues: JSDocIssue[], summary: { total: number, errors: number, warnings: number, byFile: Object } }}
 */
export function checkJSDocConsistency(dir) {
  const resolvedDir = resolve(dir);
  const files = findJSFiles(dir);
  const allIssues = [];

  for (const file of files) {
    let content;
    try {
      content = readFileSync(file, 'utf-8');
    } catch (e) {
      continue; // File deleted between findJSFiles and read
    }
    const relPath = relative(resolvedDir, file);
    const issues = checkJSDocFile(content, relPath);
    allIssues.push(...issues);
  }

  const errors = allIssues.filter(i => i.severity === 'error').length;
  const warnings = allIssues.filter(i => i.severity === 'warning').length;

  const byFile = {};
  for (const issue of allIssues) {
    byFile[issue.file] = (byFile[issue.file] || 0) + 1;
  }

  return {
    issues: allIssues,
    summary: {
      total: allIssues.length,
      errors,
      warnings,
      byFile,
    },
  };
}
