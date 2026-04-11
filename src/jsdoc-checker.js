import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative, resolve } from 'path';
import { parse } from '../vendor/acorn.mjs';
import * as walk from '../vendor/walk.mjs';
import { shouldExcludeDir, shouldExcludeFile, parseGitignore } from './filters.js';

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

function findJSDocBefore(comments, targetLine) {
  for (const comment of comments) {
    const gap = targetLine - comment.endLine;
    if (gap >= 0 && gap <= 2) return comment;
  }
  return null;
}

function extractParamName(param) {
  if (param.type === 'Identifier') return param.name;
  if (param.type === 'AssignmentPattern' && param.left.type === 'Identifier') return param.left.name;
  if (param.type === 'RestElement' && param.argument.type === 'Identifier') return param.argument.name;
  if (param.type === 'ObjectPattern') return 'options';
  if (param.type === 'ArrayPattern') return 'args';
  return 'param';
}

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

function validateFunction(jsdoc, astParams, funcNode, name, file, line) {
  const issues = [];

  if (!jsdoc) return issues; // No JSDoc = handled by undocumented checker

  const docParams = jsdoc.params;

  // 1. Param count mismatch (skip description-only comments: 0 @param is intentional when .ctx holds the params)
  if (docParams.length > 0 && docParams.length !== astParams.length) {
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
      let compatible = docType.toLowerCase().includes(inferredType.toLowerCase());
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
