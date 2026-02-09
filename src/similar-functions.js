/**
 * Similar Functions Detector
 * Finds functionally similar functions across the codebase
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative, resolve } from 'path';
import { parse } from '../vendor/acorn.mjs';
import * as walk from '../vendor/walk.mjs';
import { shouldExcludeDir, shouldExcludeFile, parseGitignore } from './filters.js';

/**
 * @typedef {Object} FunctionSignature
 * @property {string} name
 * @property {string} file
 * @property {number} line
 * @property {number} paramCount
 * @property {string[]} paramNames
 * @property {boolean} async
 * @property {string} bodyHash - Structural hash of function body
 * @property {string[]} calls - Functions called inside
 */

/**
 * @typedef {Object} SimilarPair
 * @property {FunctionSignature} a
 * @property {FunctionSignature} b
 * @property {number} similarity - 0-100
 * @property {string[]} reasons
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
 * Extract function signatures from a file
 * @param {string} filePath 
 * @returns {FunctionSignature[]}
 */
function extractSignatures(filePath, rootDir) {
  const code = readFileSync(filePath, 'utf-8');
  const relPath = relative(rootDir, filePath);
  const signatures = [];

  let ast;
  try {
    ast = parse(code, { ecmaVersion: 'latest', sourceType: 'module', locations: true });
  } catch (e) {
    return signatures;
  }

  walk.simple(ast, {
    FunctionDeclaration(node) {
      if (!node.id) return;
      signatures.push(buildSignature(node, node.id.name, relPath));
    },

    MethodDefinition(node) {
      if (node.kind !== 'method') return;
      const name = node.key.name || node.key.value;
      if (name.startsWith('_')) return;
      signatures.push(buildSignature(node.value, name, relPath));
    },
  });

  return signatures;
}

/**
 * Build signature from function node
 * @param {Object} node 
 * @param {string} name 
 * @param {string} file 
 * @returns {FunctionSignature}
 */
function buildSignature(node, name, file) {
  const paramNames = node.params.map(p => extractParamName(p));
  const calls = [];

  // Extract function calls
  walk.simple(node.body, {
    CallExpression(callNode) {
      if (callNode.callee.type === 'Identifier') {
        calls.push(callNode.callee.name);
      } else if (callNode.callee.type === 'MemberExpression' && callNode.callee.property.type === 'Identifier') {
        calls.push(callNode.callee.property.name);
      }
    },
  });

  // Create structural hash
  const bodyHash = hashBodyStructure(node.body);

  return {
    name,
    file,
    line: node.loc?.start?.line || 0,
    paramCount: node.params.length,
    paramNames,
    async: node.async || false,
    bodyHash,
    calls: [...new Set(calls)],
  };
}

/**
 * Extract param name
 * @param {Object} param 
 * @returns {string}
 */
function extractParamName(param) {
  if (param.type === 'Identifier') return param.name;
  if (param.type === 'AssignmentPattern' && param.left.type === 'Identifier') return param.left.name;
  if (param.type === 'RestElement' && param.argument.type === 'Identifier') return param.argument.name;
  return 'param';
}

/**
 * Create structural hash of function body
 * @param {Object} body 
 * @returns {string}
 */
function hashBodyStructure(body) {
  const structure = [];

  walk.simple(body, {
    IfStatement() { structure.push('IF'); },
    ForStatement() { structure.push('FOR'); },
    ForOfStatement() { structure.push('FOROF'); },
    ForInStatement() { structure.push('FORIN'); },
    WhileStatement() { structure.push('WHILE'); },
    SwitchStatement() { structure.push('SWITCH'); },
    TryStatement() { structure.push('TRY'); },
    ReturnStatement() { structure.push('RET'); },
    ThrowStatement() { structure.push('THROW'); },
    AwaitExpression() { structure.push('AWAIT'); },
  });

  return structure.join('|');
}

/**
 * Calculate similarity between two functions
 * @param {FunctionSignature} a 
 * @param {FunctionSignature} b 
 * @returns {{similarity: number, reasons: string[]}}
 */
function calculateSimilarity(a, b) {
  const reasons = [];
  let score = 0;
  let maxScore = 0;

  // Same param count (important)
  maxScore += 30;
  if (a.paramCount === b.paramCount) {
    score += 30;
    reasons.push('Same param count');
  }

  // Similar param names
  maxScore += 20;
  const commonParams = a.paramNames.filter(p => b.paramNames.includes(p));
  if (commonParams.length > 0 && a.paramNames.length > 0) {
    const paramSim = commonParams.length / Math.max(a.paramNames.length, b.paramNames.length);
    score += Math.round(paramSim * 20);
    if (paramSim >= 0.5) reasons.push(`Similar params: ${commonParams.join(', ')}`);
  }

  // Same async status
  maxScore += 10;
  if (a.async === b.async) {
    score += 10;
  }

  // Similar body structure
  maxScore += 25;
  if (a.bodyHash === b.bodyHash && a.bodyHash.length > 0) {
    score += 25;
    reasons.push('Identical structure');
  } else if (a.bodyHash.length > 0 && b.bodyHash.length > 0) {
    const aTokens = a.bodyHash.split('|');
    const bTokens = b.bodyHash.split('|');
    const commonTokens = aTokens.filter(t => bTokens.includes(t));
    if (commonTokens.length > 0) {
      const structSim = commonTokens.length / Math.max(aTokens.length, bTokens.length);
      score += Math.round(structSim * 25);
      if (structSim >= 0.5) reasons.push('Similar control flow');
    }
  }

  // Common function calls
  maxScore += 15;
  const commonCalls = a.calls.filter(c => b.calls.includes(c));
  if (commonCalls.length > 0 && a.calls.length > 0 && b.calls.length > 0) {
    const callSim = commonCalls.length / Math.max(a.calls.length, b.calls.length);
    score += Math.round(callSim * 15);
    if (commonCalls.length >= 2) reasons.push(`Common calls: ${commonCalls.slice(0, 3).join(', ')}`);
  }

  const similarity = Math.round((score / maxScore) * 100);
  return { similarity, reasons };
}

/**
 * Get similar functions in directory
 * @param {string} dir 
 * @param {Object} [options]
 * @param {number} [options.threshold=60] - Minimum similarity percentage
 * @returns {Promise<{total: number, pairs: SimilarPair[]}>}
 */
export async function getSimilarFunctions(dir, options = {}) {
  const threshold = options.threshold || 60;
  const resolvedDir = resolve(dir);
  const files = findJSFiles(dir);
  const allSignatures = [];

  // Collect all signatures
  for (const file of files) {
    allSignatures.push(...extractSignatures(file, resolvedDir));
  }

  // Compare all pairs
  const pairs = [];
  for (let i = 0; i < allSignatures.length; i++) {
    for (let j = i + 1; j < allSignatures.length; j++) {
      const a = allSignatures[i];
      const b = allSignatures[j];

      // Skip same file same name (likely intentional overload)
      if (a.file === b.file && a.name === b.name) continue;

      // Skip very small functions
      if (a.bodyHash.length < 3 && b.bodyHash.length < 3) continue;

      const { similarity, reasons } = calculateSimilarity(a, b);

      if (similarity >= threshold && reasons.length > 0) {
        pairs.push({ a, b, similarity, reasons });
      }
    }
  }

  // Sort by similarity descending
  pairs.sort((x, y) => y.similarity - x.similarity);

  return {
    total: pairs.length,
    pairs: pairs.slice(0, 20),
  };
}
