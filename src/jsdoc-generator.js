/**
 * JSDoc Generator
 * Auto-generates JSDoc templates from AST analysis
 */

import { readFileSync } from 'fs';
import { relative } from 'path';
import { parse } from '../vendor/acorn.mjs';
import * as walk from '../vendor/walk.mjs';

/**
 * @typedef {Object} JSDocTemplate
 * @property {string} name - Function/method name
 * @property {string} type - 'function' | 'method' | 'class'
 * @property {string} file
 * @property {number} line
 * @property {string} jsdoc - Generated JSDoc template
 */

/**
 * Generate JSDoc for a single file
 * @param {string} filePath - Absolute path to file
 * @param {Object} [options]
 * @param {boolean} [options.includeTests=true] - Include @test/@expect placeholders
 * @returns {JSDocTemplate[]}
 */
export function generateJSDoc(filePath, options = {}) {
  const includeTests = options.includeTests !== false;
  const results = [];

  const code = readFileSync(filePath, 'utf-8');
  const relPath = relative(process.cwd(), filePath);

  let ast;
  try {
    ast = parse(code, { ecmaVersion: 'latest', sourceType: 'module', locations: true });
  } catch (e) {
    return results;
  }

  // Check if line already has JSDoc
  const hasJSDocAt = (line) => {
    const lines = code.split('\n');
    // Look backwards from function line for JSDoc closing */
    for (let i = line - 2; i >= Math.max(0, line - 15); i--) {
      const trimmed = lines[i]?.trim();
      if (!trimmed) continue; // Skip empty lines
      // Found JSDoc end - look for start
      if (trimmed === '*/' || trimmed.endsWith('*/')) {
        // Now look for /** opening above
        for (let j = i - 1; j >= Math.max(0, i - 20); j--) {
          const upper = lines[j]?.trim();
          if (upper?.startsWith('/**')) return true;
          // If we hit something non-JSDoc, stop
          if (upper && !upper.startsWith('*')) break;
        }
        return false;
      }
      // If we hit code, stop
      if (!trimmed.startsWith('*') && !trimmed.startsWith('//')) break;
    }
    return false;
  };

  walk.simple(ast, {
    FunctionDeclaration(node) {
      if (!node.id) return;
      if (hasJSDocAt(node.loc.start.line)) return;

      const jsdoc = buildJSDoc({
        name: node.id.name,
        params: node.params,
        async: node.async,
        includeTests,
      });

      results.push({
        name: node.id.name,
        type: 'function',
        file: relPath,
        line: node.loc.start.line,
        jsdoc,
      });
    },

    ClassDeclaration(node) {
      if (!node.id) return;

      // Check methods
      for (const element of node.body.body) {
        if (element.type === 'MethodDefinition') {
          const methodName = element.key.name || element.key.value;

          // Skip constructor, getters, setters, private
          if (element.kind !== 'method') continue;
          if (methodName.startsWith('_')) continue;
          if (hasJSDocAt(element.loc.start.line)) continue;

          const funcNode = element.value;
          const jsdoc = buildJSDoc({
            name: methodName,
            params: funcNode.params,
            async: funcNode.async,
            includeTests,
          });

          results.push({
            name: `${node.id.name}.${methodName}`,
            type: 'method',
            file: relPath,
            line: element.loc.start.line,
            jsdoc,
          });
        }
      }
    },
  });

  return results;
}

/**
 * Build JSDoc string from function info
 * @param {Object} info
 * @param {string} info.name
 * @param {Array} info.params
 * @param {boolean} info.async
 * @param {boolean} info.includeTests
 * @returns {string}
 */
function buildJSDoc(info) {
  const lines = ['/**'];

  // Description placeholder
  lines.push(` * TODO: Add description for ${info.name}`);

  // Parameters
  for (const param of info.params) {
    const paramName = extractParamName(param);
    const paramType = inferParamType(param);
    lines.push(` * @param {${paramType}} ${paramName}`);
  }

  // Return type
  lines.push(` * @returns {${info.async ? 'Promise<*>' : '*'}}`);

  // Test annotations (Agentic Verification)
  if (info.includeTests) {
    lines.push(` * @test TODO: describe test scenario`);
    lines.push(` * @expect TODO: expected result`);
  }

  lines.push(' */');
  return lines.join('\n');
}

/**
 * Extract parameter name from AST node
 * @param {Object} param 
 * @returns {string}
 */
function extractParamName(param) {
  if (param.type === 'Identifier') {
    return param.name;
  }
  if (param.type === 'AssignmentPattern' && param.left.type === 'Identifier') {
    return `[${param.left.name}]`; // Optional param
  }
  if (param.type === 'RestElement' && param.argument.type === 'Identifier') {
    return `...${param.argument.name}`;
  }
  if (param.type === 'ObjectPattern') {
    return 'options';
  }
  if (param.type === 'ArrayPattern') {
    return 'args';
  }
  return 'param';
}

/**
 * Infer parameter type from AST
 * @param {Object} param 
 * @returns {string}
 */
function inferParamType(param) {
  if (param.type === 'AssignmentPattern') {
    const defaultVal = param.right;
    if (defaultVal.type === 'Literal') {
      if (typeof defaultVal.value === 'string') return 'string';
      if (typeof defaultVal.value === 'number') return 'number';
      if (typeof defaultVal.value === 'boolean') return 'boolean';
    }
    if (defaultVal.type === 'ArrayExpression') return 'Array';
    if (defaultVal.type === 'ObjectExpression') return 'Object';
  }
  if (param.type === 'RestElement') return 'Array';
  if (param.type === 'ObjectPattern') return 'Object';
  if (param.type === 'ArrayPattern') return 'Array';
  return '*';
}

/**
 * Generate JSDoc for specific function by name
 * @param {string} filePath 
 * @param {string} functionName 
 * @param {Object} [options]
 * @returns {JSDocTemplate|null}
 */
export function generateJSDocFor(filePath, functionName, options = {}) {
  const results = generateJSDoc(filePath, options);
  return results.find(r => r.name === functionName || r.name.endsWith(`.${functionName}`)) || null;
}
