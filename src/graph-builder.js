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
  // Only include class names in legend for compactness
  const classLegend = {};
  for (const [full, short] of Object.entries(graph.legend)) {
    if (graph.nodes[short]?.t === 'C') {
      classLegend[short] = full;
    }
  }

  // Compact node representation
  const nodes = {};
  for (const [k, v] of Object.entries(graph.nodes)) {
    if (v.t === 'C') {
      nodes[k] = { m: v.m?.length || 0, $: v.$?.length || 0 };
    }
  }

  return {
    v: graph.v,
    _keys: {
      L: 'Legend (symbol → full name)',
      s: 'Stats (files, classes, functions)',
      n: 'Nodes (class name → {m: methods count, $: properties count})',
      e: 'Edges count (calls between symbols)',
      o: 'Orphans count (unused non-exported functions)',
      d: 'Duplicates count (same method name in multiple classes)',
      F: 'Functions count (standalone)',
    },
    L: classLegend, // Legend for classes only
    s: graph.stats,
    n: nodes,      // Class nodes only
    e: graph.edges.length,
    o: graph.orphans.length,
    d: Object.keys(graph.duplicates).length,
    F: Object.keys(graph.nodes).filter(k => graph.nodes[k].t === 'F').length, // Function count
  };
}
