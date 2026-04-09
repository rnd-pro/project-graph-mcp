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
  } catch (e) { }

  return files;
}

function calculateComplexity(body) {
  let complexity = 1; // Base complexity

  walk.simple(body, {
    // Branching
    IfStatement() { complexity++; },
    ConditionalExpression() { complexity++; }, // ternary

    // Loops
    ForStatement() { complexity++; },
    ForOfStatement() { complexity++; },
    ForInStatement() { complexity++; },
    WhileStatement() { complexity++; },
    DoWhileStatement() { complexity++; },

    // Switch cases
    SwitchCase(node) {
      if (node.test) complexity++; // Skip default case
    },

    // Logical operators
    LogicalExpression(node) {
      if (node.operator === '&&' || node.operator === '||') {
        complexity++;
      }
    },

    // Nullish coalescing
    BinaryExpression(node) {
      if (node.operator === '??') {
        complexity++;
      }
    },

    // Error handling
    CatchClause() { complexity++; },
  });

  return complexity;
}

function getRating(complexity) {
  if (complexity <= 5) return 'low';
  if (complexity <= 10) return 'moderate';
  if (complexity <= 20) return 'high';
  return 'critical';
}

export function analyzeComplexityFile(code, relPath) {
  const items = [];

  let ast;
  try {
    ast = parse(code, { ecmaVersion: 'latest', sourceType: 'module', locations: true });
  } catch (e) {
    return items;
  }

  walk.simple(ast, {
    FunctionDeclaration(node) {
      if (!node.id) return;
      const complexity = calculateComplexity(node.body);
      items.push({
        name: node.id.name,
        type: 'function',
        file: relPath,
        line: node.loc.start.line,
        complexity,
        rating: getRating(complexity),
      });
    },

    ArrowFunctionExpression(node) {
      if (node.body.type !== 'BlockStatement') return;
      const complexity = calculateComplexity(node.body);
      if (complexity > 5) {
        items.push({
          name: '(arrow)',
          type: 'function',
          file: relPath,
          line: node.loc.start.line,
          complexity,
          rating: getRating(complexity),
        });
      }
    },

    MethodDefinition(node) {
      if (node.kind !== 'method') return;
      const name = node.key.name || node.key.value;
      const complexity = calculateComplexity(node.value.body);
      items.push({
        name,
        type: 'method',
        file: relPath,
        line: node.loc.start.line,
        complexity,
        rating: getRating(complexity),
      });
    },
  });

  return items;
}

function analyzeFile(filePath, rootDir) {
  let code;
  try {
    code = readFileSync(filePath, 'utf-8');
  } catch (e) {
    return []; // File deleted between findJSFiles and read
  }
  const relPath = relative(rootDir, filePath);
  return analyzeComplexityFile(code, relPath);
}

export async function getComplexity(dir, options = {}) {
  const minComplexity = options.minComplexity || 1;
  const onlyProblematic = options.onlyProblematic || false;
  const resolvedDir = resolve(dir);

  const files = findJSFiles(dir);
  let allItems = [];

  for (const file of files) {
    allItems.push(...analyzeFile(file, resolvedDir));
  }

  // Filter
  allItems = allItems.filter(item => {
    if (item.complexity < minComplexity) return false;
    if (onlyProblematic && (item.rating === 'low' || item.rating === 'moderate')) return false;
    return true;
  });

  // Sort by complexity descending
  allItems.sort((a, b) => b.complexity - a.complexity);

  // Calculate stats
  const stats = {
    low: allItems.filter(i => i.rating === 'low').length,
    moderate: allItems.filter(i => i.rating === 'moderate').length,
    high: allItems.filter(i => i.rating === 'high').length,
    critical: allItems.filter(i => i.rating === 'critical').length,
    average: allItems.length > 0
      ? Math.round(allItems.reduce((s, i) => s + i.complexity, 0) / allItems.length * 10) / 10
      : 0,
  };

  return {
    total: allItems.length,
    stats,
    items: allItems.slice(0, 30),
  };
}
