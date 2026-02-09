/**
 * Graph Builder - Creates minified project graph from parsed data
 */

/**
 * @typedef {Object} GraphNode
 * @property {string} t - type (class/func)
 * @property {string} [x] - extends
 * @property {string[]} [m] - methods
 * @property {string[]} [$] - properties (init$)
 * @property {string[]} [i] - imports
 * @property {string[]} [→] - calls (outgoing)
 * @property {string[]} [←] - usedBy (incoming)
 * @property {string} [f] - source file path
 * @property {boolean} [e] - exported flag (functions)
 */

/**
 * @typedef {Object} Graph
 * @property {number} v - version
 * @property {Object<string, string>} legend - minified name → full name
 * @property {Object<string, string>} reverseLegend - full name → minified
 * @property {Object} stats - { files, classes, functions }
 * @property {Object<string, GraphNode>} nodes
 * @property {Array<[string, string, string]>} edges - [from, type, to]
 * @property {string[]} orphans
 * @property {Object<string, string[]>} duplicates
 * @property {string[]} files - list of parsed file paths
 */

/**
 * Create minified legend from names
 * Strategy: Use camelCase initials + suffix if collision
 * @param {string[]} names 
 * @returns {Object<string, string>}
 */
export function minifyLegend(names) {
  const legend = {};
  const used = new Set();

  for (const name of names) {
    let short = createShortName(name);
    let suffix = 1;

    while (used.has(short)) {
      short = createShortName(name) + suffix;
      suffix++;
    }

    used.add(short);
    legend[name] = short;
  }

  return legend;
}

/**
 * Create short name from full name
 * SymNode → SN, togglePin → tP, autoArrange → aA
 * @param {string} name 
 * @returns {string}
 */
function createShortName(name) {
  // For PascalCase: extract uppercase letters
  const upperOnly = name.replace(/[a-z]/g, '');
  if (upperOnly.length >= 2) {
    return upperOnly.slice(0, 3);
  }

  // For camelCase: first letter + next uppercase
  const firstUpper = name.match(/[A-Z]/g);
  if (firstUpper && firstUpper.length > 0) {
    return name[0].toLowerCase() + firstUpper[0];
  }

  // Fallback: first 2 letters
  return name.slice(0, 2);
}

/**
 * Build graph from parsed project data
 * @param {import('./parser.js').ParseResult} parsed 
 * @returns {Graph}
 */
export function buildGraph(parsed) {
  // Collect all names for legend
  const classes = parsed.classes || [];
  const functions = parsed.functions || [];

  const allNames = [
    ...classes.map(c => c.name),
    ...functions.map(f => f.name),
    ...classes.flatMap(c => c.methods || []),
  ];

  const legend = minifyLegend([...new Set(allNames)]);
  const reverseLegend = Object.fromEntries(
    Object.entries(legend).map(([k, v]) => [v, k])
  );

  const graph = {
    v: 1,
    legend,
    reverseLegend,
    stats: {
      files: (parsed.files || []).length,
      classes: classes.length,
      functions: functions.length,
    },
    nodes: {},
    edges: [],
    orphans: [],
    duplicates: {},
    files: parsed.files || [],
  };

  // Build class nodes
  for (const cls of classes) {
    const shortName = legend[cls.name];
    graph.nodes[shortName] = {
      t: 'C',
      x: cls.extends || undefined,
      m: (cls.methods || []).map(m => legend[m] || m),
      $: (cls.properties || []).length ? cls.properties : undefined,
      i: cls.imports?.length ? cls.imports : undefined,
      f: cls.file || undefined,
    };

    // Build edges from calls
    for (const call of cls.calls || []) {
      if (call.includes('.')) {
        // Class.method() pattern
        const [target, method] = call.split('.');
        if (legend[target]) {
          const edge = [shortName, '→', `${legend[target]}.${legend[method] || method}`];
          graph.edges.push(edge);
        }
      } else {
        // Standalone function call
        if (legend[call]) {
          const edge = [shortName, '→', legend[call]];
          graph.edges.push(edge);
        }
      }
    }
  }

  // Build function nodes
  for (const func of functions) {
    const shortName = legend[func.name];
    graph.nodes[shortName] = {
      t: 'F',
      e: func.exported,
      f: func.file || undefined,
    };
  }

  // Detect orphans (nodes with no incoming edges)
  const hasIncoming = new Set();
  for (const edge of graph.edges) {
    const target = edge[2].split('.')[0];
    hasIncoming.add(target);
  }

  for (const name of Object.keys(graph.nodes)) {
    if (!hasIncoming.has(name) && graph.nodes[name].t === 'F' && !graph.nodes[name].e) {
      graph.orphans.push(reverseLegend[name]);
    }
  }

  // Detect duplicates (same method name in multiple classes)
  const methodLocations = {};
  for (const cls of classes) {
    for (const method of cls.methods || []) {
      if (!methodLocations[method]) {
        methodLocations[method] = [];
      }
      methodLocations[method].push(`${cls.name}:${cls.line}`);
    }
  }

  for (const [method, locations] of Object.entries(methodLocations)) {
    if (locations.length > 1) {
      graph.duplicates[method] = locations;
    }
  }

  return graph;
}

/**
 * Create compact skeleton (minimal tokens)
 * @param {Graph} graph 
 * @returns {Object}
 */
export function createSkeleton(graph) {
  const legend = {};
  const nodes = {};

  // Build class nodes with file path
  // graph.legend = {fullName → shortName}
  for (const [full, short] of Object.entries(graph.legend)) {
    const node = graph.nodes[short];
    if (!node) continue;

    if (node.t === 'C') {
      // Skip empty classes (0 methods, 0 props)
      const methodCount = node.m?.length || 0;
      const propCount = node.$?.length || 0;
      if (methodCount === 0 && propCount === 0) continue;

      legend[short] = full;
      const entry = { m: methodCount };
      if (propCount > 0) entry.$ = propCount;
      if (node.f) entry.f = node.f;
      nodes[short] = entry;
    }
  }

  // Build exported functions grouped by file: { "file.js": ["shortName1", ...] }
  // Also add function names to legend
  const exportsByFile = {};
  for (const [full, short] of Object.entries(graph.legend)) {
    const node = graph.nodes[short];
    if (node?.t === 'F' && node.e) {
      legend[short] = full;
      const file = node.f || '?';
      if (!exportsByFile[file]) exportsByFile[file] = [];
      exportsByFile[file].push(short);
    }
  }

  // Build file tree grouped by directory (only files not covered by n/X)
  const coveredFiles = new Set();
  for (const v of Object.values(nodes)) {
    if (v.f) coveredFiles.add(v.f);
  }
  for (const file of Object.keys(exportsByFile)) {
    coveredFiles.add(file);
  }

  const fileTree = {};
  for (const filePath of graph.files || []) {
    if (coveredFiles.has(filePath)) continue;
    const lastSlash = filePath.lastIndexOf('/');
    const dir = lastSlash >= 0 ? filePath.slice(0, lastSlash + 1) : './';
    const file = lastSlash >= 0 ? filePath.slice(lastSlash + 1) : filePath;
    if (!fileTree[dir]) fileTree[dir] = [];
    fileTree[dir].push(file);
  }

  const result = {
    v: graph.v,
    L: legend,
    s: graph.stats,
    n: nodes,
    X: exportsByFile,
    e: graph.edges.length,
    o: graph.orphans.length,
    d: Object.keys(graph.duplicates).length,
  };

  // Only add uncovered files if there are any
  if (Object.keys(fileTree).length > 0) {
    result.f = fileTree;
  }

  return result;
}
