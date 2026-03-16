/**
 * MCP Tools for Project Graph
 */

import { parseProject, parseFile, findJSFiles } from './parser.js';
import { buildGraph, createSkeleton } from './graph-builder.js';
import { readFileSync, statSync, writeFileSync, existsSync, unlinkSync } from 'fs';
import { execSync } from 'child_process';
import { join } from 'path';

/** @type {import('./graph-builder.js').Graph|null} */
let cachedGraph = null;

/** @type {string|null} */
let cachedPath = null;

/** @type {Map<string, number>} file path -> mtimeMs */
let cachedMtimes = new Map();

/**
 * Save cache to disk
 * @param {string} path 
 * @param {import('./graph-builder.js').Graph} graph 
 */
function saveDiskCache(path, graph) {
  try {
    const cachePath = join(path, '.project-graph-cache.json');
    const cacheData = {
      version: 1,
      path: path,
      mtimes: Object.fromEntries(cachedMtimes),
      graph: graph
    };
    writeFileSync(cachePath, JSON.stringify(cacheData), 'utf-8');
  } catch (e) {
    // Ignore cache save errors
  }
}

/**
 * Load cache from disk
 * @param {string} path 
 * @returns {boolean} true if cache was successfully loaded and is valid
 */
function loadDiskCache(path) {
  try {
    const cachePath = join(path, '.project-graph-cache.json');
    if (!existsSync(cachePath)) return false;

    const content = readFileSync(cachePath, 'utf-8');
    const data = JSON.parse(content);

    if (data.version !== 1 || data.path !== path) return false;

    cachedMtimes.clear();
    for (const [file, mtime] of Object.entries(data.mtimes)) {
      cachedMtimes.set(file, mtime);
    }

    cachedGraph = data.graph;
    cachedPath = path;

    const changed = detectChanges(path);
    if (changed) {
      cachedGraph = null;
      cachedPath = null;
      cachedMtimes.clear();
      return false;
    }

    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Get or build graph with smart mtime-based caching.
 * On first call: full parse + build.
 * On subsequent calls: check file mtimes, rebuild only if changes detected.
 * @param {string} path 
 * @returns {Promise<import('./graph-builder.js').Graph>}
 */
async function getGraph(path) {
  // Different path = full rebuild
  if (cachedGraph && cachedPath === path) {
    // Check for file changes via mtime
    const changed = detectChanges(path);
    if (!changed) {
      return cachedGraph;
    }
    // Files changed - full rebuild (incremental would need graph-builder changes)
  } else if (!cachedGraph) {
    if (loadDiskCache(path)) {
      return cachedGraph;
    }
  }

  const parsed = await parseProject(path);
  cachedGraph = buildGraph(parsed);
  cachedPath = path;

  // Snapshot mtimes for all parsed files
  snapshotMtimes(path);
  saveDiskCache(path, cachedGraph);

  return cachedGraph;
}

/**
 * Detect if any JS files changed since last snapshot.
 * Checks: new files, deleted files, modified files (via mtimeMs).
 * @param {string} path
 * @returns {boolean} true if changes detected
 */
function detectChanges(path) {
  if (cachedMtimes.size === 0) return true;

  try {
    const currentFiles = findJSFiles(path);
    const currentSet = new Set(currentFiles);
    const cachedSet = new Set(cachedMtimes.keys());

    // New or deleted files
    if (currentFiles.length !== cachedMtimes.size) return true;
    for (const f of currentFiles) {
      if (!cachedSet.has(f)) return true;
    }
    for (const f of cachedSet) {
      if (!currentSet.has(f)) return true;
    }

    // Check mtimes
    for (const file of currentFiles) {
      try {
        const mtime = statSync(file).mtimeMs;
        if (mtime !== cachedMtimes.get(file)) return true;
      } catch {
        return true; // File gone or unreadable
      }
    }

    return false;
  } catch {
    return true; // Safety: rebuild on error
  }
}

/**
 * Snapshot current mtimes for all JS files in path.
 * @param {string} path
 */
function snapshotMtimes(path) {
  cachedMtimes.clear();
  try {
    const files = findJSFiles(path);
    for (const file of files) {
      try {
        cachedMtimes.set(file, statSync(file).mtimeMs);
      } catch {
        // Skip unreadable files
      }
    }
  } catch {
    // Ignore errors
  }
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
 * Find call chain from one symbol to another
 * @param {Object} options 
 * @param {string} options.from - Starting symbol (full or minified)
 * @param {string} options.to - Target symbol (full or minified)
 * @param {string} [options.path] - Project path
 * @returns {Promise<string[]|Object>}
 */
export async function getCallChain(options = {}) {
  const { from, to, path } = options;
  if (!from || !to) {
    return { error: 'Both "from" and "to" parameters are required' };
  }

  const projectPath = path || cachedPath || 'src/components';
  const graph = await getGraph(projectPath);

  const fromSym = graph.legend[from] || from;
  const toSym = graph.legend[to] || to;

  // Build adjacency list for fast lookup
  const adj = {};
  for (const [caller, _, target] of graph.edges) {
    if (!adj[caller]) adj[caller] = [];
    adj[caller].push(target);
  }

  // Queue stores { current: string, path: string[] }
  const queue = [{ current: fromSym, path: [fromSym] }];
  const visitedNodes = new Set();
  const expandedBases = new Set();
  visitedNodes.add(fromSym);

  while (queue.length > 0) {
    const { current, path: currentPath } = queue.shift();

    const currentBase = current.split('.')[0];
    const currentMethod = current.split('.')[1];

    if (current === toSym || currentBase === toSym || currentMethod === toSym) {
      const fullPath = currentPath.map(sym => {
        const parts = sym.split('.');
        const base = graph.reverseLegend[parts[0]] || parts[0];
        if (parts.length === 2) {
          const method = graph.reverseLegend[parts[1]] || parts[1];
          return `${base}.${method}`;
        }
        return base;
      });
      return fullPath;
    }

    if (expandedBases.has(currentBase)) {
      continue;
    }
    expandedBases.add(currentBase);

    const neighbors = adj[currentBase] || [];
    for (const neighbor of neighbors) {
      if (!visitedNodes.has(neighbor)) {
        visitedNodes.add(neighbor);
        queue.push({
          current: neighbor,
          path: [...currentPath, neighbor]
        });
      }
    }
  }

  return { error: `No call path found from "${from}" to "${to}"` };
}

/**
 * Invalidate cache
 */
export function invalidateCache() {
  if (cachedPath) {
    try {
      const cachePath = join(cachedPath, '.project-graph-cache.json');
      if (existsSync(cachePath)) {
        unlinkSync(cachePath);
      }
    } catch (e) {}
  }
  cachedGraph = null;
  cachedPath = null;
  cachedMtimes.clear();
}
