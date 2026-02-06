/**
 * Dead Code Detector
 * Finds unused/orphan functions and classes using dependency graph
 */

import { parseProject } from './parser.js';
import { buildGraph } from './graph-builder.js';

/**
 * @typedef {Object} DeadCodeItem
 * @property {string} name
 * @property {string} type - 'function' | 'class' | 'method'
 * @property {string} file
 * @property {number} line
 * @property {string} reason - Why it's considered dead
 */

/**
 * Get list of dead/unused code
 * @param {string} dir - Directory to scan
 * @returns {Promise<{total: number, byType: Object, items: DeadCodeItem[]}>}
 */
export async function getDeadCode(dir) {
  const parsed = await parseProject(dir);
  const graph = buildGraph(parsed);

  const items = [];

  // Collect all targets (things that are called/used)
  const usedTargets = new Set();
  for (const edge of graph.edges) {
    // edge[2] is the target like "SN" or "SN.method"
    const target = edge[2].split('.')[0];
    usedTargets.add(target);
    // Also mark methods as used
    if (edge[2].includes('.')) {
      usedTargets.add(edge[2]);
    }
  }

  // Check functions
  for (const func of parsed.functions || []) {
    const shortName = graph.legend[func.name];

    // Skip exported functions (they're entry points)
    if (func.exported) continue;

    // Skip test files
    if (func.file?.includes('.test.') || func.file?.includes('/tests/')) continue;

    // If not used anywhere, it's dead
    if (!usedTargets.has(shortName)) {
      items.push({
        name: func.name,
        type: 'function',
        file: func.file,
        line: func.line,
        reason: 'Not called anywhere',
      });
    }
  }

  // Check classes
  for (const cls of parsed.classes || []) {
    const shortName = graph.legend[cls.name];

    // Skip exported classes
    if (cls.exported) continue;

    // Skip if class is used (instantiated or extended)
    if (usedTargets.has(shortName)) continue;

    // Skip test classes
    if (cls.file?.includes('.test.') || cls.file?.includes('/tests/')) continue;

    // Check if any of its methods are called
    let hasUsedMethod = false;
    for (const method of cls.methods || []) {
      const methodKey = `${shortName}.${graph.legend[method] || method}`;
      if (usedTargets.has(methodKey)) {
        hasUsedMethod = true;
        break;
      }
    }

    if (!hasUsedMethod) {
      items.push({
        name: cls.name,
        type: 'class',
        file: cls.file,
        line: cls.line,
        reason: 'Never instantiated or extended',
      });
    }
  }

  // Build summary
  const byType = {
    function: items.filter(i => i.type === 'function').length,
    class: items.filter(i => i.type === 'class').length,
  };

  return {
    total: items.length,
    byType,
    items: items.slice(0, 30),
  };
}
