/**
 * MCP Tools for Project Graph
 */

import { parseProject, parseFile } from './parser.js';
import { buildGraph, createSkeleton } from './graph-builder.js';
import { readFileSync } from 'fs';
import { execSync } from 'child_process';

/** @type {import('./graph-builder.js').Graph|null} */
let cachedGraph = null;

/** @type {string|null} */
let cachedPath = null;

/**
 * Get or build graph with caching
 * @param {string} path 
 * @returns {Promise<import('./graph-builder.js').Graph>}
 */
async function getGraph(path) {
  if (cachedGraph && cachedPath === path) {
    return cachedGraph;
  }

  const parsed = await parseProject(path);
  cachedGraph = buildGraph(parsed);
  cachedPath = path;

  return cachedGraph;
}

/**
 * Get compact project skeleton
 * @param {string} path 
 * @returns {Promise<Object>}
 */
export async function getSkeleton(path) {
  const graph = await getGraph(path);
  return createSkeleton(graph);
}

/**
 * Get enriched focus zone based on recent activity
 * @param {Object} options
 * @param {string[]} [options.recentFiles]
 * @param {boolean} [options.useGitDiff]
 * @returns {Promise<Object>}
 */
export async function getFocusZone(options = {}) {
  const path = options.path || 'src/components';
  const graph = await getGraph(path);

  let focusFiles = options.recentFiles || [];

  // Auto-detect from git diff
  if (options.useGitDiff) {
    try {
      const diff = execSync('git diff --name-only HEAD~5', { encoding: 'utf-8' });
      focusFiles = diff.split('\n').filter(f => f.endsWith('.js'));
    } catch (e) {
      // Git not available or not a repo
    }
  }

  const expanded = {};

  for (const file of focusFiles) {
    // Find classes in this file
    const content = readFileSync(file, 'utf-8');
    const parsed = await parseFile(content, file);

    for (const cls of parsed.classes) {
      const shortName = graph.legend[cls.name];
      if (shortName && graph.nodes[shortName]) {
        expanded[shortName] = {
          ...graph.nodes[shortName],
          methods: cls.methods,
          properties: cls.properties,
          file: cls.file,
          line: cls.line,
        };
      }
    }
  }

  return {
    focusFiles,
    expanded,
    expandable: Object.keys(graph.nodes).filter(k => !expanded[k]),
  };
}

/**
 * Expand a symbol to full details
 * @param {string} symbol - Minified symbol like 'SN' or 'SN.tP'
 * @returns {Promise<Object>}
 */
export async function expand(symbol) {
  const path = cachedPath || 'src/components';
  const graph = await getGraph(path);

  const [nodeKey, methodKey] = symbol.split('.');
  const fullName = graph.reverseLegend[nodeKey];

  if (!fullName) {
    return { error: `Unknown symbol: ${symbol}. Run get_skeleton on your project first, then use symbols from the L (Legend) field.` };
  }

  // Find the source file
  const parsed = await parseProject(path);
  const cls = parsed.classes.find(c => c.name === fullName);

  if (!cls) {
    return { error: `Class not found: ${fullName}` };
  }

  // If method specified, extract method code
  if (methodKey) {
    const methodName = graph.reverseLegend[methodKey] || methodKey;
    const content = readFileSync(cls.file, 'utf-8');
    const methodCode = extractMethod(content, methodName);

    return {
      symbol,
      fullName: `${fullName}.${methodName}`,
      file: cls.file,
      line: cls.line, // TODO: get actual method line
      code: methodCode,
    };
  }

  // Return full class info
  return {
    symbol,
    fullName,
    file: cls.file,
    line: cls.line,
    extends: cls.extends,
    methods: cls.methods,
    properties: cls.properties,
    calls: cls.calls,
  };
}

/**
 * Get dependency tree for a symbol
 * @param {string} symbol 
 * @returns {Promise<Object>}
 */
export async function deps(symbol) {
  const path = cachedPath || 'src/components';
  const graph = await getGraph(path);

  const node = graph.nodes[symbol];
  if (!node) {
    return { error: `Unknown symbol: ${symbol}. Run get_skeleton on your project first, then use symbols from the L (Legend) field.` };
  }

  // Find incoming edges (usedBy)
  const usedBy = graph.edges
    .filter(e => e[2].startsWith(symbol))
    .map(e => e[0]);

  // Find outgoing edges (calls)
  const calls = graph.edges
    .filter(e => e[0] === symbol)
    .map(e => e[2]);

  return {
    symbol,
    imports: node.i || [],
    usedBy: [...new Set(usedBy)],
    calls: [...new Set(calls)],
  };
}

/**
 * Find all usages of a symbol
 * @param {string} symbol 
 * @returns {Promise<Array>}
 */
export async function usages(symbol) {
  const path = cachedPath || 'src/components';
  const graph = await getGraph(path);
  const parsed = await parseProject(path);

  const fullName = graph.reverseLegend[symbol] || symbol;
  const results = [];

  for (const cls of parsed.classes) {
    if (cls.calls?.includes(fullName) || cls.calls?.some(c => c.includes(fullName))) {
      results.push({
        file: cls.file,
        line: cls.line,
        context: `${cls.name} calls ${fullName}`,
      });
    }
  }

  return results;
}

/**
 * Extract method code from file content
 * @param {string} content 
 * @param {string} methodName 
 * @returns {string}
 */
function extractMethod(content, methodName) {
  const regex = new RegExp(`((?:\\/\\*\\*[\\s\\S]*?\\*\\/\\s*)?)(?:async\\s+)?${methodName}\\s*\\([^)]*\\)\\s*{`, 'g');
  const match = regex.exec(content);

  if (!match) return '';

  const start = match.index;
  let depth = 0;
  let i = match.index + match[0].length - 1;

  while (i < content.length) {
    if (content[i] === '{') depth++;
    else if (content[i] === '}') {
      depth--;
      if (depth === 0) {
        return content.slice(start, i + 1);
      }
    }
    i++;
  }

  return content.slice(start);
}

/**
 * Invalidate cache
 */
export function invalidateCache() {
  cachedGraph = null;
  cachedPath = null;
}
