/**
 * Graph Scale Performance Test (Node.js, no browser needed)
 *
 * Generates synthetic skeletons of increasing size
 * and measures each pipeline phase to find the bottleneck.
 *
 * Usage: node tests/perf-graph-scale.js
 */

import { NodeEditor } from '../vendor/symbiote-node/core/Editor.js';
import { Node } from '../vendor/symbiote-node/core/Node.js';
import { Connection } from '../vendor/symbiote-node/core/Connection.js';
import { Input, Output } from '../vendor/symbiote-node/core/Socket.js';
import { computeAutoLayout } from '../vendor/symbiote-node/canvas/AutoLayout.js';

// ─── Synthetic Skeleton Generator ───
function generateSkeleton(nodeCount, edgeDensity = 0.03) {
  const skeleton = { n: {}, X: {}, I: {}, f: {}, a: {} };
  const files = [];
  const dirs = [
    'src/', 'src/core/', 'src/utils/', 'src/api/', 'src/models/',
    'src/services/', 'src/controllers/', 'src/middleware/', 'src/config/',
    'src/views/', 'src/helpers/', 'src/routes/', 'src/db/', 'src/auth/', 'src/tests/',
  ];

  for (let i = 0; i < nodeCount; i++) {
    const dir = dirs[i % dirs.length];
    const filename = `module-${i}.js`;
    const fullPath = dir + filename;
    files.push(fullPath);
    if (!skeleton.f[dir]) skeleton.f[dir] = [];
    skeleton.f[dir].push(filename);
    if (i % 3 === 0) skeleton.X[fullPath] = [`fn_${i}`, `const_${i}`];
  }

  // Generate imports using DIRECT file paths (not relative)
  // so resolveImport's known.has(imp) check matches immediately
  let edgeCount = 0;
  for (let i = 0; i < files.length; i++) {
    const imports = [];
    const importCount = 1 + Math.floor(Math.random() * Math.min(5, Math.ceil(edgeDensity * 10)));
    for (let j = 0; j < importCount; j++) {
      const target = Math.floor(Math.random() * files.length);
      if (target !== i) { imports.push(files[target]); edgeCount++; }
    }
    if (imports.length > 0) skeleton.I[files[i]] = imports;
  }

  return { skeleton, fileCount: files.length, edgeCount };
}

// ─── Graph building (extracted from dep-graph.js) ───
const S_EXPORT = 'export';
const S_IMPORT = 'import';

function dirOf(f) { const i = f.lastIndexOf('/'); return i >= 0 ? f.substring(0, i + 1) : './'; }
function baseName(f) { const i = f.lastIndexOf('/'); return i >= 0 ? f.substring(i + 1) : f; }

function resolveImport(imp, from, known) {
  if (known.has(imp)) return imp;
  if (known.has(imp + '.js')) return imp + '.js';
  if (imp.startsWith('.')) {
    const dir = dirOf(from);
    let resolved = dir + imp.replace(/^\.\//, '');
    const parts = resolved.split('/');
    const norm = [];
    for (const p of parts) { if (p === '..') norm.pop(); else if (p !== '.') norm.push(p); }
    resolved = norm.join('/');
    if (known.has(resolved)) return resolved;
    if (known.has(resolved + '.js')) return resolved + '.js';
  }
  return null;
}

function buildFileGraph(skeleton) {
  const editor = new NodeEditor();
  const fileMap = new Map();
  const files = new Set();

  for (const data of Object.values(skeleton.n || {})) if (data.f) files.add(data.f);
  for (const file of Object.keys(skeleton.X || {})) files.add(file);
  for (const [dir, names] of Object.entries(skeleton.f || {}))
    for (const name of names) files.add(dir === './' ? name : dir + name);
  for (const [dir, names] of Object.entries(skeleton.a || {}))
    for (const name of names) files.add(dir === './' ? name : dir + name);

  if (files.size === 0) return { editor, fileMap };

  const dirFiles = new Map();
  for (const file of files) {
    const dir = dirOf(file);
    if (!dirFiles.has(dir)) dirFiles.set(dir, []);
    dirFiles.get(dir).push(file);
  }

  for (const file of files) {
    const node = new Node(baseName(file), { type: 'file', category: 'file' });
    node.params = { path: file, dir: dirOf(file) };
    node.addOutput('out', new Output(S_EXPORT, ''));
    node.addInput('in', new Input(S_IMPORT, ''));
    editor.addNode(node);
    fileMap.set(file, node.id);
  }

  // Build edges directly (bypass resolveImport — we use absolute paths)
  const edgesAdded = new Set();
  for (const [srcFile, targets] of Object.entries(skeleton.I || {})) {
    const srcId = fileMap.get(srcFile);
    if (!srcId) continue;
    for (const tgtFile of targets) {
      const tgtId = fileMap.get(tgtFile);
      if (!tgtId || tgtId === srcId) continue;
      const key = `${srcId}->${tgtId}`;
      if (edgesAdded.has(key)) continue;
      edgesAdded.add(key);
      try { editor.addConnection(new Connection(editor.getNode(srcId), 'out', editor.getNode(tgtId), 'in')); } catch {}
    }
  }

  const groups = {};
  for (const [dir, fls] of dirFiles.entries()) {
    const ids = [];
    for (const f of fls) if (fileMap.has(f)) ids.push(fileMap.get(f));
    if (ids.length > 0) groups[dir] = ids;
  }

  return { editor, fileMap, dirFiles, groups };
}

// ─── Measure helper ───
function measure(fn) {
  const t0 = performance.now();
  const result = fn();
  return { result, ms: performance.now() - t0 };
}

// ─── Single scale test ───
function testScale(nodeCount) {
  const gen = measure(() => generateSkeleton(nodeCount));
  const { skeleton } = gen.result;

  const build = measure(() => buildFileGraph(skeleton));
  const { editor, groups } = build.result;

  const nodes = editor.getNodes().length;
  const conns = editor.getConnections().length;

  const layout = measure(() => computeAutoLayout(editor, { groups }));

  return {
    scale: nodeCount,
    nodes,
    conns,
    generate: gen.ms,
    buildGraph: build.ms,
    autoLayout: layout.ms,
    total: gen.ms + build.ms + layout.ms,
  };
}

// ─── Main ───
const scales = [100, 500, 1000, 2000, 3000, 5000];
const results = [];

console.log('🔬 Graph Scale Performance Test\n');
console.log('Scale  | Nodes | Conns | generate | buildGraph | autoLayout | TOTAL');
console.log('-------|-------|-------|----------|------------|------------|------');

for (const n of scales) {
  const r = testScale(n);
  results.push(r);

  const pad = (v, w = 7) => String(v).padStart(w);
  const ms = (v) => pad(v.toFixed(0) + 'ms', 10);

  console.log(
    `${pad(r.scale, 6)} | ${pad(r.nodes)} | ${pad(r.conns)} | ${ms(r.generate)} | ${ms(r.buildGraph)} | ${ms(r.autoLayout)} | ${ms(r.total)}`
  );
}

// ─── Growth rate ───
console.log('\n📈 Growth Rate (each row = 2x scale increase)');
console.log('Transition      | buildGraph | autoLayout | TOTAL');
console.log('----------------|------------|------------|------');

for (let i = 1; i < results.length; i++) {
  const prev = results[i - 1];
  const curr = results[i];
  const ratio = (key) => {
    const v = prev[key] > 0.1 ? (curr[key] / prev[key]).toFixed(1) : '—';
    return String(v + 'x').padStart(10);
  };
  const label = `${prev.scale} → ${curr.scale}`.padEnd(15);
  console.log(`${label} | ${ratio('buildGraph')} | ${ratio('autoLayout')} | ${ratio('total')}`);
}

// ─── Bottleneck ───
const last = results[results.length - 1];
const phases = [
  { name: 'generate', ms: last.generate },
  { name: 'buildGraph', ms: last.buildGraph },
  { name: 'autoLayout', ms: last.autoLayout },
];
phases.sort((a, b) => b.ms - a.ms);
const top = phases[0];
const pct = ((top.ms / last.total) * 100).toFixed(0);
console.log(`\n🎯 Bottleneck at ${last.scale} nodes: ${top.name} — ${top.ms.toFixed(0)}ms (${pct}% of total)`);

// ─── Complexity estimate ───
if (results.length >= 4) {
  const r1 = results[results.length - 3];
  const r2 = results[results.length - 1];
  const scaleRatio = r2.scale / r1.scale;
  for (const key of ['buildGraph', 'autoLayout']) {
    const timeRatio = r2[key] / Math.max(r1[key], 0.01);
    const exponent = Math.log(timeRatio) / Math.log(scaleRatio);
    const complexity = exponent < 1.2 ? 'O(n)' : exponent < 2.2 ? 'O(n²)' : `O(n^${exponent.toFixed(1)})`;
    console.log(`   ${key}: ~${complexity} (growth exponent: ${exponent.toFixed(2)})`);
  }
}
