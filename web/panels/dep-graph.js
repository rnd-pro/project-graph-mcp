/**
 * dep-graph.js — Visual Project Graph (PCB Board Style)
 *
 * Renders the project dependency graph as an interactive
 * node-canvas visualization styled like a printed circuit board.
 * Uses symbiote-node's NodeCanvas with orthogonal routing,
 * readonly mode, and auto-layout.
 *
 * Phase 1: File-level graph (each file = node, imports = traces).
 */
import Symbiote from '@symbiotejs/symbiote';
import {
  NodeEditor,
  Node,
  SubgraphNode,
  Connection,
  Socket,
  Input,
  Output,
  NodeCanvas,
  Frame,
  computeAutoLayout,
  computeTreeLayout,
  applyTheme,
} from 'symbiote-node';
import { SubgraphRouter } from '../vendor/symbiote-node/canvas/SubgraphRouter.js';
import { LODManager } from '../vendor/symbiote-node/canvas/LODManager.js';
import { PinExpansion } from '../vendor/symbiote-node/canvas/PinExpansion.js';
import { ForceLayout } from '../vendor/symbiote-node/canvas/ForceLayout.js';
import { PCB_DARK } from '../vendor/symbiote-node/themes/pcb.js';
import { api, state, events, emit } from '../app.js';

// ── Socket types (for wire coloring) ──
const S_IMPORT = new Socket('import');
S_IMPORT.color = '#c87533';   // copper
const S_EXPORT = new Socket('export');
S_EXPORT.color = '#d4a04a';   // gold

/**
 * Extract directory from file path
 * @param {string} filePath
 * @returns {string}
 */
function dirOf(filePath) {
  if (!filePath) return './';
  const idx = filePath.lastIndexOf('/');
  return idx >= 0 ? filePath.slice(0, idx + 1) : './';
}

/**
 * Short filename for node label
 * @param {string} filePath
 * @returns {string}
 */
function baseName(filePath) {
  if (!filePath) return '?';
  const idx = filePath.lastIndexOf('/');
  return idx >= 0 ? filePath.slice(idx + 1) : filePath;
}


/**
 * Build a file-level graph from skeleton data.
 * Each file becomes a Node, each import relationship becomes a Connection.
 *
 * @param {object} skeleton - skeleton from get_skeleton
 * @returns {{ editor: NodeEditor, fileMap: Map<string, string> }}
 */
function buildFileGraph(skeleton) {
  const editor = new NodeEditor();
  const fileMap = new Map(); // filePath → nodeId
  const dirMap = new Map(); // dirPath → nodeId (hub nodes)

  // Collect all files that have symbols
  const files = new Set();
  const assetFiles = new Set(); // non-source files (.css, .html, .json, .md, etc.)
  // From nodes (classes) — each has .f (file) property
  for (const data of Object.values(skeleton.n || {})) {
    if (data.f) files.add(data.f);
  }
  // From exports map — keys are files
  for (const file of Object.keys(skeleton.X || {})) {
    files.add(file);
  }
  // From source files without symbols
  for (const [dir, names] of Object.entries(skeleton.f || {})) {
    for (const name of names) {
      files.add(dir === './' ? name : dir + name);
    }
  }
  // From non-source/asset files (.css, .html, .json, .md, etc.)
  for (const [dir, names] of Object.entries(skeleton.a || {})) {
    for (const name of names) {
      const fullPath = dir === './' ? name : dir + name;
      files.add(fullPath);
      assetFiles.add(fullPath);
    }
  }

  if (files.size === 0) return { editor, fileMap };

  // Group files by directory
  const dirFiles = new Map();
  for (const file of files) {
    const dir = dirOf(file);
    if (!dirFiles.has(dir)) dirFiles.set(dir, []);
    dirFiles.get(dir).push(file);
  }

  // TODO Phase 2: Create directory hub nodes when LOD zoom expansion is ready
  // Hub nodes without connections create disconnected groups — skip for now
  // for (const [dir, dirFileList] of dirFiles) {
  //   if (dirFileList.length < 2) continue;
  //   const dirLabel = dir.replace(/\/$/, '').split('/').pop() || 'root';
  //   const hubNode = new Node(dirLabel, { type: 'directory', category: 'server', shape: 'hexagon' });
  //   hubNode.params = { path: dir, dir, isHub: true };
  //   hubNode.addOutput('out', new Output(S_EXPORT, ''));
  //   hubNode.addInput('in', new Input(S_IMPORT, ''));
  //   editor.addNode(hubNode);
  //   dirMap.set(dir, hubNode.id);
  // }

  // Create file nodes (standard HTML nodes with icons)
  for (const file of files) {
    const dir = dirOf(file);
    const label = baseName(file);
    const isAsset = assetFiles.has(file);
    const node = new Node(label, {
      type: isAsset ? 'asset' : 'file',
      category: isAsset ? 'asset' : 'file',
    });
    node.params = { path: file, dir };

    // Every file has one output (exports) and one input (imports)
    node.addOutput('out', new Output(S_EXPORT, ''));
    node.addInput('in', new Input(S_IMPORT, ''));

    editor.addNode(node);
    fileMap.set(file, node.id);
  }

  // Build import edges from skeleton.I (file-level import map)
  // skeleton.I[file] = [source1, source2, ...]
  const edgesAdded = new Set();
  for (const [srcFile, sources] of Object.entries(skeleton.I || {})) {
    const srcId = fileMap.get(srcFile);
    if (!srcId) continue;

    for (const impPath of sources) {
      // Skip node builtins and external packages
      if (impPath.startsWith('node:') || (!impPath.startsWith('.') && !impPath.startsWith('/'))) continue;

      const targetFile = resolveImport(impPath, srcFile, files);
      if (!targetFile) continue;

      const tgtId = fileMap.get(targetFile);
      if (!tgtId || tgtId === srcId) continue;

      const edgeKey = `${srcId}->${tgtId}`;
      if (edgesAdded.has(edgeKey)) continue;
      edgesAdded.add(edgeKey);

      const srcNode = editor.getNode(srcId);
      const tgtNode = editor.getNode(tgtId);
      try {
        const conn = new Connection(srcNode, 'out', tgtNode, 'in');
        // Phase 3: tag cross-directory connections as "via"
        const srcDir = dirOf(srcFile);
        const tgtDir = dirOf(targetFile);
        if (srcDir !== tgtDir) {
          conn._via = true;
          conn._srcDir = srcDir;
          conn._tgtDir = tgtDir;
        }
        editor.addConnection(conn);
      } catch {
        // Skip invalid connections
      }
    }
  }

  // Hub node: find node with highest connectivity → module category
  const connCounts = new Map();
  for (const conn of editor.getConnections()) {
    connCounts.set(conn.from, (connCounts.get(conn.from) || 0) + 1);
    connCounts.set(conn.to, (connCounts.get(conn.to) || 0) + 1);
  }
  let maxConns = 0;
  let hubId = null;
  for (const [nodeId, count] of connCounts) {
    if (count > maxConns) {
      maxConns = count;
      hubId = nodeId;
    }
  }
  if (hubId) {
    const hubNode = editor.getNode(hubId);
    if (hubNode && hubNode.options) {
      hubNode.options.category = 'module';
    }
  }

  // ── Build Reverse ID Lookup ──
  const idToPath = new Map();
  for (const [path, id] of fileMap.entries()) idToPath.set(id, path);

  return { editor, fileMap, dirMap, dirFiles, idToPath };
}

/**
 * Resolve import path to a known file
 * @param {string} importPath
 * @param {string} fromFile
 * @param {Set<string>} knownFiles
 * @returns {string|null}
 */
function resolveImport(importPath, fromFile, knownFiles) {
  // Direct match
  if (knownFiles.has(importPath)) return importPath;

  // Try with .js extension
  if (knownFiles.has(importPath + '.js')) return importPath + '.js';

  // Relative resolution
  if (importPath.startsWith('.')) {
    const dir = dirOf(fromFile);
    let resolved = dir + importPath.replace(/^\.\//, '');
    // Normalize ../ segments
    const parts = resolved.split('/');
    const normalized = [];
    for (const part of parts) {
      if (part === '..') normalized.pop();
      else if (part !== '.') normalized.push(part);
    }
    resolved = normalized.join('/');

    if (knownFiles.has(resolved)) return resolved;
    if (knownFiles.has(resolved + '.js')) return resolved + '.js';
    // Try index
    if (knownFiles.has(resolved + '/index.js')) return resolved + '/index.js';
  }

  // Module name match via pre-built index — O(1) instead of O(N)
  const base = importPath.split('/').pop();
  const idx = buildBasenameIndex(knownFiles);
  return idx.get(base) || idx.get(base.replace(/\.js$/, '')) || null;
}

let _basenameIndex = null;
let _indexedSet = null;
function buildBasenameIndex(knownFiles) {
  if (_indexedSet === knownFiles) return _basenameIndex;
  _indexedSet = knownFiles;
  _basenameIndex = new Map();
  for (const file of knownFiles) {
    const base = file.split('/').pop();
    _basenameIndex.set(base, file);
    if (!base.endsWith('.js')) {
      _basenameIndex.set(base + '.js', file);
    }
  }
  return _basenameIndex;
}

/**
 * Build a hierarchical SubgraphNode graph:
 *   Level 0: directories (SubgraphNode)
 *   Level 1: files inside directories (SubgraphNode or Node)
 *   Level 2: functions/exports inside files (Node)
 *
 * @param {object} skeleton
 * @returns {{ editor: NodeEditor, fileMap: Map<string, string> }}
 */
function buildStructuredGraph(skeleton) {
  const editor = new NodeEditor();
  const fileMap = new Map();
  const symbolMap = new Map();
  const L = skeleton.L || {}; // legend: abbreviation → full name
  const N = skeleton.n || {}; // classes: className → { f, m, ... }

  // Build class-name set for classification
  const classNames = new Set(Object.keys(N));
  // Map file → set of class names defined in it
  const fileClasses = new Map();
  for (const [className, data] of Object.entries(N)) {
    if (data.f) {
      if (!fileClasses.has(data.f)) fileClasses.set(data.f, new Set());
      fileClasses.get(data.f).add(className);
    }
  }

  // Collect all files
  const files = new Set();
  const assetFiles = new Set();
  for (const data of Object.values(N)) {
    if (data.f) files.add(data.f);
  }
  for (const file of Object.keys(skeleton.X || {})) {
    files.add(file);
  }
  for (const [dir, names] of Object.entries(skeleton.f || {})) {
    for (const name of names) {
      files.add(dir === './' ? name : dir + name);
    }
  }
  // Non-source/asset files (.css, .html, .json, .md, etc.)
  for (const [dir, names] of Object.entries(skeleton.a || {})) {
    for (const name of names) {
      const fullPath = dir === './' ? name : dir + name;
      files.add(fullPath);
      assetFiles.add(fullPath);
    }
  }

  if (files.size === 0) return { editor, fileMap };

  // Group files by directory
  const dirFiles = new Map();
  for (const file of files) {
    const dir = dirOf(file);
    if (!dirFiles.has(dir)) dirFiles.set(dir, []);
    dirFiles.get(dir).push(file);
  }

  /**
   * Classify a file based on its content and name
   * @param {string} file
   * @returns {string} category
   */
  function classifyFile(file) {
    if (assetFiles.has(file)) return 'asset';
    const name = baseName(file).toLowerCase();
    const classes = fileClasses.get(file);
    if (classes && classes.size > 0) return 'class';
    if (name === 'index.js' || name === 'index.mjs') return 'module';
    if (name.includes('test') || name.includes('spec')) return 'control';
    if (name.includes('config') || name.includes('.json')) return 'data';
    return 'file';
  }

  /**
   * Resolve export abbreviation to full name
   * @param {string} abbr
   * @returns {string}
   */
  function resolveName(abbr) {
    return L[abbr] || abbr;
  }

  // ── Phase 1: Create all Directory SubgraphNodes (without nesting yet) ──
  const dirNodeMap = new Map();    // dirPath → nodeId
  const dirSubgraphs = new Map();  // dirPath → SubgraphNode instance

  // Sort directories by depth (shortest first) so parents are created before children
  const sortedDirs = [...dirFiles.keys()].sort((a, b) => {
    const dA = a.split('/').filter(Boolean).length;
    const dB = b.split('/').filter(Boolean).length;
    return dA - dB || a.localeCompare(b);
  });

  for (const dir of sortedDirs) {
    const dirFileList = dirFiles.get(dir);

    // Root directory './' is NOT a node — its contents go directly into the root editor
    const isRoot = (dir === './');
    const targetEditor = isRoot ? editor : null;

    let dirSubgraph = null;
    let innerEditor;

    if (isRoot) {
      innerEditor = editor;
    } else {
      const dirLabel = dir.replace(/\/$/, '').split('/').pop() || 'root';
      dirSubgraph = new SubgraphNode(dirLabel, {
        category: 'directory',
      });
      dirSubgraph.params = { path: dir, isDirectory: true };
      dirSubgraph.addOutput('out', new Output(S_EXPORT, ''));
      dirSubgraph.addInput('in', new Input(S_IMPORT, ''));
      innerEditor = dirSubgraph.getInnerEditor();
    }

    // ── File nodes inside this directory ──
    for (const file of dirFileList) {
      const fileLabel = baseName(file);
      const exports = skeleton.X?.[file] || [];
      const fileCategory = classifyFile(file);
      const classes = fileClasses.get(file);

      let fileNode;
      if (exports.length > 0) {
        fileNode = new SubgraphNode(fileLabel, {
          category: fileCategory,
        });
        fileNode.params = { path: file, dir };

        const fileInnerEditor = fileNode.getInnerEditor();
        for (const abbr of exports) {
          const abbrId = typeof abbr === 'object' ? abbr.id : abbr;
          const fullName = resolveName(abbrId);
          const isClass = classes && classes.has(fullName);
          const fnNode = new Node(fullName, {
            type: isClass ? 'class' : 'function',
            category: isClass ? 'class' : 'function',
          });
          fnNode.params = { name: fullName, file };
          symbolMap.set(fnNode.id, fnNode.params);
          fileInnerEditor.addNode(fnNode);
        }
      } else {
        fileNode = new Node(fileLabel, {
          type: 'file',
          category: fileCategory,
        });
        fileNode.params = { path: file, dir };
      }

      fileNode.addOutput('out', new Output(S_EXPORT, ''));
      fileNode.addInput('in', new Input(S_IMPORT, ''));

      innerEditor.addNode(fileNode);
      fileMap.set(file, fileNode.id);
    }

    // ── File-level import edges within this directory ──
    const edgesAdded = new Set();
    for (const [srcFile, sources] of Object.entries(skeleton.I || {})) {
      const srcId = fileMap.get(srcFile);
      if (!srcId) continue;
      const srcDir = dirOf(srcFile);
      if (srcDir !== dir) continue;

      for (const impPath of sources) {
        if (impPath.startsWith('node:') || (!impPath.startsWith('.') && !impPath.startsWith('/'))) continue;
        const targetFile = resolveImport(impPath, srcFile, files);
        if (!targetFile) continue;

        const tgtId = fileMap.get(targetFile);
        if (!tgtId || tgtId === srcId) continue;
        if (dirOf(targetFile) !== dir) continue;

        const edgeKey = `${srcId}->${tgtId}`;
        if (edgesAdded.has(edgeKey)) continue;
        edgesAdded.add(edgeKey);

        const srcNode = innerEditor.getNode(srcId);
        const tgtNode = innerEditor.getNode(tgtId);
        if (srcNode && tgtNode) {
          try {
            innerEditor.addConnection(new Connection(srcNode, 'out', tgtNode, 'in'));
          } catch { /* skip */ }
        }
      }
    }

    if (dirSubgraph) {
      dirSubgraphs.set(dir, dirSubgraph);
      dirNodeMap.set(dir, dirSubgraph.id);
    }
  }

  // ── Phase 2: Nest child directories inside parent directories ──
  // Root './' is not a node, so its children go directly into root editor.
  for (const dir of sortedDirs) {
    if (dir === './') continue; // root dir contents already in root editor
    const dirSubgraph = dirSubgraphs.get(dir);
    if (!dirSubgraph) continue;
    
    // Find parent directory
    const segments = dir.replace(/\/$/, '').split('/');
    segments.pop();
    
    let parentDir = null;
    while (segments.length > 0) {
      const candidate = segments.join('/') + '/';
      if (dirSubgraphs.has(candidate)) {
        parentDir = candidate;
        break;
      }
      segments.pop();
    }
    
    if (parentDir) {
      // Nest inside parent's inner editor
      const parentSubgraph = dirSubgraphs.get(parentDir);
      parentSubgraph.getInnerEditor().addNode(dirSubgraph);
    } else {
      // No parent (or parent is './') → add to root editor
      editor.addNode(dirSubgraph);
    }
  }

  // ── Cross-directory edges ──
  // Edges between directories that share the same parent go into that parent's inner editor.
  // Edges between top-level directories go into the root editor.
  const crossEdges = new Set();
  for (const [srcFile, sources] of Object.entries(skeleton.I || {})) {
    const srcDir = dirOf(srcFile);
    const srcDirId = dirNodeMap.get(srcDir);
    if (!srcDirId) continue;

    for (const impPath of sources) {
      if (impPath.startsWith('node:') || (!impPath.startsWith('.') && !impPath.startsWith('/'))) continue;
      const targetFile = resolveImport(impPath, srcFile, files);
      if (!targetFile) continue;

      const tgtDir = dirOf(targetFile);
      if (tgtDir === srcDir) continue;

      const tgtDirId = dirNodeMap.get(tgtDir);
      if (!tgtDirId || tgtDirId === srcDirId) continue;

      const edgeKey = `${srcDirId}->${tgtDirId}`;
      if (crossEdges.has(edgeKey)) continue;
      crossEdges.add(edgeKey);

      // Find the common parent editor that contains BOTH directory nodes
      // Walk up both paths to find shared ancestor
      const srcSegments = srcDir.replace(/\/$/, '').split('/');
      const tgtSegments = tgtDir.replace(/\/$/, '').split('/');
      
      // Find common prefix 
      let commonLen = 0;
      while (commonLen < srcSegments.length && commonLen < tgtSegments.length &&
             srcSegments[commonLen] === tgtSegments[commonLen]) {
        commonLen++;
      }
      const commonPath = commonLen > 0 ? srcSegments.slice(0, commonLen).join('/') + '/' : null;
      
      // The editor that holds both nodes is the common parent's inner editor,
      // or the root editor if they share no parent.
      let targetEditor = editor; // default: root editor
      if (commonPath && dirSubgraphs.has(commonPath)) {
        targetEditor = dirSubgraphs.get(commonPath).getInnerEditor();
      }

      const srcNode = targetEditor.getNode(srcDirId);
      const tgtNode = targetEditor.getNode(tgtDirId);
      if (srcNode && tgtNode) {
        try {
          targetEditor.addConnection(new Connection(srcNode, 'out', tgtNode, 'in'));
        } catch { /* skip */ }
      }
    }
  }

  // ── Pre-compute inner positions for drill-down (recursive) ──
  const symbolNodes = []; // Track internal symbol nodes for idToPath linking

  function computeInnerPositions(subgraph) {
    if (!subgraph._isSubgraph) return;
    const inner = subgraph.getInnerEditor();
    const innerPos = computeAutoLayout(inner, { nodeHeight: 80, gapY: 100 });
    subgraph.setInnerPositions(innerPos);

    for (const childNode of inner.getNodes()) {
      if (childNode._isSubgraph) {
        computeInnerPositions(childNode);
        // If it's a file node (has params.path and no isDirectory), collect symbols
        if (childNode.params?.path && !childNode.params?.isDirectory) {
          const fileInner = childNode.getInnerEditor();
          for (const fnNode of fileInner.getNodes()) {
            symbolNodes.push({ id: fnNode.id, file: childNode.params.path });
          }
        }
      }
    }
  }

  for (const rootNode of editor.getNodes()) {
    computeInnerPositions(rootNode);
  }

  // ── Build Reverse ID Lookup ──
  const idToPath = new Map();
  for (const [path, id] of fileMap.entries()) idToPath.set(id, path);
  for (const [path, id] of dirNodeMap.entries()) idToPath.set(id, path);
  for (const node of symbolNodes) idToPath.set(node.id, node.file);

  return { editor, fileMap, dirFiles, dirNodeMap, idToPath, symbolMap };
}

// ── Consumer-specific CSS (toolbar, stats, pin overlay) ──
// Node styling, chip decorations, connection strokes, frame styling
// are all handled by the PCB_DARK theme in the library.
const PCB_CSS = `
  pg-dep-graph {
    display: block;
    height: 100%;
    position: relative;
    overflow: hidden;
    background: var(--sn-bg, #1a1a1a);
    /* Prevent scrollbar oscillation in parent .panel-content (overflow:auto)
       Canvas manages its own viewport — no scrollbars needed */
    contain: strict;
  }

  pg-dep-graph node-canvas {
    width: 100%;
    height: 100%;
  }

  /* Toolbar */
  .pcb-toolbar {
    position: absolute;
    top: 8px;
    right: 8px;
    display: flex;
    gap: 6px;
    z-index: 200;
  }

  .pcb-btn {
    background: var(--sn-node-bg, #222222);
    border: 1px solid var(--sn-node-border, rgba(255,255,255,0.12));
    color: var(--sn-text, #e0e0e0);
    border-radius: 3px;
    padding: 4px 10px;
    font-family: var(--sn-font, 'SF Mono', monospace);
    font-size: 10px;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 4px;
    transition: background 150ms, border-color 150ms;
  }

  .pcb-btn:hover {
    background: var(--sn-node-hover, #2d2d2d);
  }

  .pcb-btn[data-active] {
    border-color: var(--sn-node-selected, #d4a04a);
    background: rgba(212, 160, 74, 0.1);
  }

  .pcb-btn .material-symbols-outlined {
    font-size: 14px;
  }

  /* Stats overlay */
  .pcb-stats {
    position: absolute;
    bottom: 8px;
    left: 8px;
    display: flex;
    gap: 12px;
    z-index: 10;
    font-family: var(--sn-font, 'SF Mono', monospace);
    font-size: 10px;
    color: var(--sn-text-dim, #888888);
    background: rgba(26, 26, 26, 0.9);
    padding: 4px 10px;
    border-radius: 3px;
    border: 1px solid rgba(255, 255, 255, 0.08);
  }

  .pcb-stat-val {
    color: var(--sn-text, #e0e0e0);
    font-weight: 600;
  }

  /* ── Pin Labels (dep-graph-specific feature) ── */
  .pcb-pin-overlay {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    z-index: 2;
    opacity: 0;
    transition: opacity 0.25s ease-in-out;
  }
  .pcb-pin-overlay[data-visible] {
    opacity: 1;
  }
  .pcb-pin {
    position: absolute;
    font-family: var(--sn-font, 'JetBrains Mono', monospace);
    font-size: 8px;
    line-height: 1;
    white-space: nowrap;
    color: var(--sn-text-dim, #888);
    pointer-events: auto;
    cursor: default;
  }
  .pcb-pin::before {
    content: '';
    position: absolute;
    top: 50%;
    width: 4px;
    height: 4px;
    background: var(--sn-conn-color, #c87533);
    border-radius: 50%;
    transform: translateY(-50%);
  }
  .pcb-pin[data-side="left"] {
    left: -4px;
    transform: translateX(-100%);
    text-align: right;
    padding-right: 8px;
  }
  .pcb-pin[data-side="left"]::before {
    right: 0;
  }
  .pcb-pin[data-side="right"] {
    right: -4px;
    transform: translateX(100%);
    text-align: left;
    padding-left: 8px;
  }
  .pcb-pin[data-side="right"]::before {
    left: 0;
  }
  .pcb-pin[data-kind="class"] {
    color: var(--sn-cat-control, #d4a04a);
    font-weight: 600;
  }
  .pcb-pin[data-kind="fn"] {
    color: var(--sn-text, #e0e0e0);
  }
  .pcb-pin:hover {
    color: var(--sn-node-selected, #d4a04a) !important;
    text-shadow: 0 0 4px rgba(212, 160, 74, 0.4);
  }
  .pcb-pin[style*="cursor: pointer"]:hover::after {
    content: '→';
    margin-left: 3px;
    font-size: 7px;
    opacity: 0.6;
  }

  /* Toolbar separator */
  .pcb-toolbar-sep {
    width: 1px;
    background: rgba(255,255,255,0.1);
    margin: 0 4px;
    align-self: stretch;
  }

  /* Layer toggle buttons */
  .pcb-layer-btn {
    font-size: 9px;
    padding: 3px 6px;
    opacity: 0.7;
  }
  .pcb-layer-btn[data-active] {
    opacity: 1;
  }
  .pcb-layer-btn[data-hidden] {
    opacity: 0.3;
    text-decoration: line-through;
  }
`;

export class DepGraph extends Symbiote {
  init$ = {};


  /** @type {NodeEditor|null} */
  _editor = null;
  /** @type {Map<string, string>} */
  _fileMap = new Map();
  /** @type {boolean} */
  _autopilot = false;
  /** @type {HTMLElement|null} */
  _canvas = null;
  /** @type {object|null} Skeleton data for resolving pin names */
  _skeleton = null;
  /** @type {import('../vendor/symbiote-node/canvas/SubgraphRouter.js').SubgraphRouter} */
  _router = null;
  /** @type {import('../vendor/symbiote-node/canvas/PinExpansion.js').PinExpansion} */
  _pinExpansion = null;
  /** @type {import('../vendor/symbiote-node/canvas/LODManager.js').LODManager} */
  _lodManager = null;
  /** @type {boolean} Guard against duplicate graph builds */
  _graphBuilt = false;

  initCallback() {
    // Build DOM
    this.innerHTML = `
      <div class="pcb-toolbar">
        <button class="pcb-btn" data-action="fit" title="Fit view">
          <span class="material-symbols-outlined">fit_screen</span>
          FIT
        </button>
        <button class="pcb-btn" data-action="autopilot" title="Follow agent actions">
          <span class="material-symbols-outlined">smart_toy</span>
          AUTOPILOT
        </button>
        <div class="pcb-toolbar-sep"></div>
        <button class="pcb-btn label-mode-btn" data-mode="always" data-active title="Always show labels">LBL:ALW</button>
        <button class="pcb-btn label-mode-btn" data-mode="hover" title="Hover labels">LBL:HOV</button>
        <button class="pcb-btn label-mode-btn" data-mode="focus" title="Focus labels">LBL:FOC</button>
        <div class="pcb-toolbar-sep"></div>
        <button class="pcb-btn pcb-layer-btn" data-layer="zones" data-active title="Toggle directory zones">ZONES</button>
        <button class="pcb-btn pcb-layer-btn" data-layer="vias" data-active title="Toggle via markers">VIAS</button>
        <div class="pcb-toolbar-sep"></div>
        <button class="pcb-btn" data-action="view-mode" title="Toggle view: Flat ↔ Structured">
          <span class="material-symbols-outlined">account_tree</span>
          FLAT
        </button>
        <button class="pcb-btn" data-action="path-style" title="Toggle lines: PCB ↔ Bezier">
          <span class="material-symbols-outlined">route</span>
          PCB
        </button>
      </div>
      <node-canvas connection-engine="canvas"></node-canvas>
      <div class="pcb-stats"></div>
    `;

    this._canvas = this.querySelector('node-canvas');

    // Toolbar handlers
    this.querySelector('[data-action="fit"]').addEventListener('click', () => {
      this._canvas.fitView();
    });
    this.querySelector('[data-action="autopilot"]').addEventListener('click', (e) => {
      this._autopilot = !this._autopilot;
      const btn = e.currentTarget;
      if (this._autopilot) {
        btn.setAttribute('data-active', '');
      } else {
        btn.removeAttribute('data-active');
      }
    });

    // Label Mode controls
    const labelBtns = this.querySelectorAll('.label-mode-btn');
    labelBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        labelBtns.forEach(b => b.removeAttribute('data-active'));
        btn.setAttribute('data-active', '');
        const mode = btn.getAttribute('data-mode');
        this._canvas.setAttribute('data-label-mode', mode);
      });
    });

    // Phase 3: Layer toggle controls
    this.querySelectorAll('.pcb-layer-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const layer = btn.getAttribute('data-layer');
        const isActive = btn.hasAttribute('data-active');
        if (isActive) {
          btn.removeAttribute('data-active');
          btn.setAttribute('data-hidden', '');
        } else {
          btn.setAttribute('data-active', '');
          btn.removeAttribute('data-hidden');
        }
        this._toggleLayer(layer, !isActive);
      });
    });

    const searchStr = window.location.search || (window.location.hash.includes('?') ? window.location.hash.split('?')[1] : '');
    const urlParams = new URLSearchParams(searchStr);
    // Support both ?mode=flat and legacy ?flat=true
    const modeParam = urlParams.get('mode') || (urlParams.get('flat') === 'true' ? 'flat' : null);
    this._viewMode = modeParam === 'flat' ? 'flat' : 'structured';
    const viewModeBtn = this.querySelector('[data-action="view-mode"]');
    if (viewModeBtn) {
      const icon = modeParam === 'flat' ? 'account_tree' : 'grid_view';
      const text = modeParam === 'flat' ? 'FLAT' : 'TREE';
      viewModeBtn.innerHTML = `<span class="material-symbols-outlined">${icon}</span>${text}`;
      if (modeParam === 'flat') {
        viewModeBtn.removeAttribute('data-active');
      }
    }
    viewModeBtn?.addEventListener('click', () => {
      const wantFlat = this._viewMode !== 'flat';
      this._viewMode = wantFlat ? 'flat' : 'structured';
      const label = this._viewMode === 'flat' ? 'FLAT' : 'TREE';
      const icon = this._viewMode === 'flat' ? 'account_tree' : 'grid_view';
      viewModeBtn.innerHTML = `<span class="material-symbols-outlined">${icon}</span>${label}`;
      if (this._viewMode === 'structured') {
        viewModeBtn.setAttribute('data-active', '');
      } else {
        viewModeBtn.removeAttribute('data-active');
      }

      // Persist mode in URL hash
      this._updateHashParam('mode', this._viewMode === 'flat' ? 'flat' : 'tree');

      // Drill up to root before rebuilding to prevent rendering
      // the full graph on top of a stale subgraph canvas state
      if (this._router?.depth > 0) {
        this._canvas.drillUp?.(0);
      }

      // Rebuild graph in new mode
      this._graphBuilt = false;
      this._initialViewRestored = false;
      if (this._failsafeTimer) { clearTimeout(this._failsafeTimer); this._failsafeTimer = null; }
      if (state.skeleton) {
        this._buildGraph(state.skeleton);
      }
    });

    // Connection Path Style toggling
    const pathStyleBtn = this.querySelector('[data-action="path-style"]');
    if (pathStyleBtn) {
      let currentStyle = urlParams.get('style') || window.localStorage.getItem('connection-style') || 'pcb';
      const styles = ['pcb', 'bezier', 'orthogonal', 'straight'];
      
      const updateStyleUI = () => {
        let icon, text;
        switch(currentStyle) {
          case 'bezier': icon = 'timeline'; text = 'BEZIER'; break;
          case 'orthogonal': icon = 'polyline'; text = 'ORTHO'; break;
          case 'straight': icon = 'horizontal_rule'; text = 'STRAIGHT'; break;
          case 'pcb':
          default:
            icon = 'route'; text = 'PCB'; break;
        }
        pathStyleBtn.innerHTML = `<span class="material-symbols-outlined">${icon}</span>${text}`;
        if (currentStyle === 'pcb') {
          pathStyleBtn.setAttribute('data-active', '');
        } else {
          pathStyleBtn.removeAttribute('data-active');
        }
      };
      updateStyleUI();
      
      pathStyleBtn.addEventListener('click', () => {
        const idx = styles.indexOf(currentStyle);
        currentStyle = styles[(idx + 1) % styles.length] || 'pcb';
        window.localStorage.setItem('connection-style', currentStyle);
        this._canvas.setPathStyle(currentStyle);
        updateStyleUI();
      });
    }

    // Apply PCB theme
    applyTheme(this._canvas, PCB_DARK);

    // Setup ResizeObserver to gracefully handle "Layout preserved" (display: none) hidden panels.
    // Prevents building graphs while they have 0 width/height, dodging layout thrashing & 50,000+ DOM mutations
    const ro = new ResizeObserver((entries) => {
      const rect = entries[0].contentRect;
      if (rect.width > 0 && rect.height > 0) {
        if (!this._graphBuilt && state.skeleton) {
          // Wrap in rAF to prevent loop if ResizeObserver caught mid-render
          requestAnimationFrame(() => this._buildGraph(state.skeleton));
        }
      }
    });
    ro.observe(this);
    this._resizeObserver = ro;

    // Bind and save global listener functions for clean up
    this._onSkeletonLoaded = (e) => {
      if (this._graphBuilt || this.style.display === 'none' || this.offsetWidth === 0) return;
      requestAnimationFrame(() => this._buildGraph(e.detail));
    };
    
    this._onToolEvent = (e) => {
      if (this.style.display === 'none' || this.offsetWidth === 0) return;
      if (this._autopilot) {
        this._handleAutopilot(e.detail);
      }
    };
    
    this._onFileSelected = (e) => {
      if (this.style.display === 'none' || this.offsetWidth === 0) return;
      if (e.detail.source === 'canvas') return; // Prevent echo from our own clicks
      const file = e.detail.path;
      if (file) {
        history.replaceState(null, '', `#graph?focus=${encodeURIComponent(file)}`);
        this._router?.navigateTo(file);
      }
    };

    // Wait for canvas to initialize, then listen for data
    events.addEventListener('skeleton-loaded', this._onSkeletonLoaded);

    // Initial fetch if we don't have it
    if (!state.skeleton) {
      // Self-fetch skeleton (graph panel may mount before FileTree)
      api('/api/skeleton', {}).then((skeleton) => {
        if (skeleton && !this._graphBuilt) {
          state.skeleton = skeleton;
          emit('skeleton-loaded', skeleton);
        }
      }).catch(() => {});
    }

    // Autopilot: listen for agent tool events
    events.addEventListener('tool-event', this._onToolEvent);

    // Update route within graph section
    // On node click → save file path (just focusing)
    this._canvas?.addEventListener('click', (e) => {
      const nodeEl = e.target.closest('graph-node');
      if (!nodeEl) return;
      
      const nodeId = nodeEl.getAttribute('node-id');
      const path = this._idToPath?.get(nodeId);
      const isSymbol = this._symbolMap?.has(nodeId);
      const depth = this._router?.depth || 0;

      if (isSymbol) {
        // Symbol click: keep current drill URL, append &symbol=
        const sym = this._symbolMap.get(nodeId);
        const base = window.location.hash.split('&symbol=')[0]; // strip old symbol
        history.replaceState(null, '', `${base}&symbol=${encodeURIComponent(sym.name)}`);
        // Highlight the parent file in the tree sidebar
        if (sym.file) {
          emit('file-selected', { path: sym.file, source: 'canvas' });
        }
      } else if (path) {
        if (depth === 0) {
          // Root level: path goes into ?focus= parameter
          history.replaceState(null, '', `#graph?focus=${encodeURIComponent(path)}`);
        } else {
          // Inside a group: preserve drill context URL, set &focus= with relative name
          const drillBase = window.location.hash.split('?')[0]; // e.g. #graph/src/analysis/
          const drillPath = drillBase.replace('#graph/', '');
          // Get relative name inside the drilled group
          const relativeName = path.startsWith(drillPath) ? path.slice(drillPath.length) : path;
          history.replaceState(null, '', `${drillBase}?in=1&focus=${encodeURIComponent(relativeName)}`);
        }
        // Sync: highlight file in the tree sidebar
        emit('file-selected', { path, source: 'canvas' });
      }
    });

    // Deselect: when no nodes selected → clear focus from URL
    this._canvas?.addEventListener('selection-changed', (e) => {
      if (e.detail.nodes.length > 0) return; // Still has selection
      if (!this._initialViewRestored) return; // Don't clear URL during initial load
      const hash = window.location.hash;
      if (hash.includes('focus=')) {
        const depth = this._router?.depth || 0;
        if (depth === 0) {
          history.replaceState(null, '', '#graph');
        } else {
          const base = hash.split('?')[0];
          history.replaceState(null, '', `${base}?in=1`);
        }
      }
    });

    // Toolbar custom actions (e.g. explore)
    this._canvas?.addEventListener('toolbar-action', (e) => {
      const { action, nodeId } = e.detail;
      if (action === 'explore') {
        this._exploreFromNode(nodeId);
      }
    });

    events.addEventListener('file-selected', this._onFileSelected);
  }

  disconnectedCallback() {
    super.disconnectedCallback?.();
    if (this._onSkeletonLoaded) events.removeEventListener('skeleton-loaded', this._onSkeletonLoaded);
    if (this._onToolEvent) events.removeEventListener('tool-event', this._onToolEvent);
    if (this._onFileSelected) events.removeEventListener('file-selected', this._onFileSelected);
    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
      this._resizeObserver = null;
    }
  }

  /**
   * Count total files in skeleton (quick, no graph construction)
   * @param {object} skeleton
   * @returns {number}
   */
  _countSkeletonFiles(skeleton) {
    const files = new Set();
    for (const data of Object.values(skeleton.n || {})) if (data.f) files.add(data.f);
    for (const file of Object.keys(skeleton.X || {})) files.add(file);
    for (const [dir, names] of Object.entries(skeleton.f || {}))
      for (const name of names) files.add(dir === './' ? name : dir + name);
    for (const [dir, names] of Object.entries(skeleton.a || {}))
      for (const name of names) files.add(dir === './' ? name : dir + name);
    return files.size;
  }

  /**
   * Update a single URL hash parameter without page reload.
   * Preserves existing hash path and other params.
   * @param {string} key - Parameter name (e.g. 'mode', 'focus')
   * @param {string|null} value - Parameter value, null to remove
   */
  _updateHashParam(key, value) {
    const hash = window.location.hash;
    const [basePath, queryStr] = hash.split('?');
    const params = new URLSearchParams(queryStr || '');
    if (value === null || value === undefined) {
      params.delete(key);
    } else {
      params.set(key, value);
    }
    const newQuery = params.toString();
    const newHash = newQuery ? `${basePath}?${newQuery}` : basePath;
    history.replaceState(null, '', newHash);
  }

  /**
   * Detect disconnected components in the graph and stack smaller ones
   * compactly below the main cluster. Without this, outlier chains
   * (e.g. android.py) stretch BBox 10x+ beyond the main cluster.
   * @param {NodeEditor} editor
   * @param {Object} positions - {nodeId: {x, y}}
   * @returns {Object} compacted positions
   */
  _compactDisconnectedComponents(editor, positions) {
    const nodes = editor.getNodes();
    const conns = editor.getConnections();
    if (nodes.length < 2) return positions;

    // Build adjacency list (undirected)
    const adj = new Map();
    for (const n of nodes) adj.set(n.id, []);
    for (const c of conns) {
      if (adj.has(c.from)) adj.get(c.from).push(c.to);
      if (adj.has(c.to)) adj.get(c.to).push(c.from);
    }

    // BFS to find connected components
    const visited = new Set();
    const components = [];
    for (const n of nodes) {
      if (visited.has(n.id)) continue;
      const component = [];
      const queue = [n.id];
      visited.add(n.id);
      while (queue.length > 0) {
        const id = queue.shift();
        component.push(id);
        for (const neighbor of (adj.get(id) || [])) {
          if (!visited.has(neighbor)) {
            visited.add(neighbor);
            queue.push(neighbor);
          }
        }
      }
      components.push(component);
    }

    // Only one component — nothing to compact
    if (components.length <= 1) return positions;

    // Sort by size desc — largest is the main cluster
    components.sort((a, b) => b.length - a.length);

    // Compute bounding box for each component
    const GAP = 200; // gap between stacked components
    const bboxes = components.map(comp => {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const id of comp) {
        const p = positions[id];
        if (!p) continue;
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x + 180 > maxX) maxX = p.x + 180; // approx node width
        if (p.y + 60 > maxY) maxY = p.y + 60;   // approx node height
      }
      return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
    });

    // Main cluster stays in place. Stack others below it.
    const mainBBox = bboxes[0];
    let cursorY = mainBBox.maxY + GAP;

    for (let i = 1; i < components.length; i++) {
      const comp = components[i];
      const bbox = bboxes[i];
      if (bbox.minX === Infinity) continue; // no positions

      // Offset: shift to align left with main cluster, below current cursor
      const dx = mainBBox.minX - bbox.minX;
      const dy = cursorY - bbox.minY;

      for (const id of comp) {
        if (positions[id]) {
          positions[id] = {
            x: positions[id].x + dx,
            y: positions[id].y + dy,
          };
        }
      }
      cursorY += bbox.h + GAP;
    }

    return positions;
  }

  /**
   * Start radial exploration from a focus node.
   * Shows the node at center with imports (left) and dependents (right).
   * @param {string} nodeId
   */
  _exploreFromNode(nodeId) {
    const editor = this._editor;
    if (!editor || !this._canvas) return;

    const conns = editor.getConnections();
    const nodePath = this._idToPath?.get(nodeId) || nodeId;

    // Find imports (outgoing from this node) and dependents (incoming to this node)
    const imports = [];     // files this node imports
    const dependents = [];  // files that import this node

    for (const c of conns) {
      if (c.from === nodeId && c.to !== nodeId) imports.push(c.to);
      if (c.to === nodeId && c.from !== nodeId) dependents.push(c.from);
    }

    // Dedup
    const importSet = [...new Set(imports)];
    const dependentSet = [...new Set(dependents)];
    const allExplore = new Set([nodeId, ...importSet, ...dependentSet]);

    // Save pre-explore state for back navigation
    if (!this._exploreStack) this._exploreStack = [];
    this._exploreStack.push({
      positions: this._canvas.getPositions(),
      zoom: this._canvas.$.zoom,
      panX: this._canvas.$.panX,
      panY: this._canvas.$.panY,
    });

    // Radial layout: focus at center
    // Imports on LEFT hemisphere, dependents on RIGHT
    const RADIUS_INNER = 500;
    const positions = {};
    positions[nodeId] = { x: 0, y: 0 };

    // Place imports (left hemisphere: angles from 90° to 270°)
    importSet.forEach((id, i) => {
      const t = (i + 1) / (importSet.length + 1); // 0..1 evenly spaced
      const angle = Math.PI / 2 + Math.PI * t;     // 90° → 270° (left)
      positions[id] = {
        x: RADIUS_INNER * Math.cos(angle),
        y: RADIUS_INNER * Math.sin(angle),
      };
    });

    // Place dependents (right hemisphere: angles from -90° to 90°)
    dependentSet.forEach((id, i) => {
      const t = (i + 1) / (dependentSet.length + 1);
      const angle = -Math.PI / 2 + Math.PI * t;     // -90° → 90° (right)
      positions[id] = {
        x: RADIUS_INNER * Math.cos(angle),
        y: RADIUS_INNER * Math.sin(angle),
      };
    });

    // Move explore nodes to radial positions, push others far below
    this._canvas.setBatchMode(true);
    const allNodes = editor.getNodes();
    for (const n of allNodes) {
      if (positions[n.id]) {
        this._canvas.setNodePosition(n.id, positions[n.id].x, positions[n.id].y);
      } else {
        // Move non-explore nodes far offscreen (below)
        this._canvas.setNodePosition(n.id, 0, 50000 + Math.random() * 1000);
      }
    }
    this._canvas.setBatchMode(false);
    this._canvas.syncPhantom?.();

    // Highlight explore connections
    const exploreConnIds = conns
      .filter(c => c.from === nodeId || c.to === nodeId)
      .map(c => c.id);
    this._canvas.setActiveConnections?.(exploreConnIds);

    // Fly to focus node
    this._canvas.flyToNode(nodeId, { zoom: 0.5 });

    // Update URL to reflect explore mode
    history.replaceState(null, '', `#graph?explore=${encodeURIComponent(nodePath)}`);

    // Mark explore mode active
    this._exploreMode = true;
    this._exploreNodeId = nodeId;

    // Dispatch event for status bar / UI feedback
    this.dispatchEvent(new CustomEvent('explore-started', {
      detail: {
        nodeId,
        path: nodePath,
        imports: importSet.length,
        dependents: dependentSet.length,
      },
      bubbles: true,
    }));
  }

  /**
   * Exit explore mode — restore graph to pre-explore state.
   */
  _exitExploreMode() {
    if (!this._exploreStack?.length || !this._canvas) return;

    const state = this._exploreStack.pop();

    this._canvas.setBatchMode(true);
    for (const [nodeId, pos] of Object.entries(state.positions)) {
      this._canvas.setNodePosition(nodeId, pos.x, pos.y);
    }
    this._canvas.setBatchMode(false);
    this._canvas.syncPhantom?.();

    // Restore zoom/pan
    this._canvas.$.zoom = state.zoom;
    this._canvas.$.panX = state.panX;
    this._canvas.$.panY = state.panY;
    this._canvas.refreshConnections();

    // Clear highlight
    this._canvas.setActiveConnections?.(null);

    this._exploreMode = false;
    this._exploreNodeId = null;
    history.replaceState(null, '', '#graph');
  }

  /**
   * Build and render a complete dependency graph from skeleton data.
   */
  _buildGraph(skeleton) {
    if (!skeleton || !this._canvas) return;
    // Guard: both ResizeObserver and skeleton-loaded schedule rAF calls
    // that check _graphBuilt BEFORE the rAF. If both fire in the same
    // frame, _buildGraph runs twice → double nodes. Guard here too.
    if (this._graphBuilt) return;
    this._graphBuilt = true;

    // ── Tear down previous build state ──
    // Disconnect stale ResizeObserver to prevent old callbacks firing on new nodes
    if (this._nodeObserver) {
      this._nodeObserver.disconnect();
      this._nodeObserver = null;
    }
    // Cancel pending layout timers/rAFs from previous build
    if (this._layoutPassTimer) { clearTimeout(this._layoutPassTimer); this._layoutPassTimer = null; }
    if (this._failsafeTimer) { clearTimeout(this._failsafeTimer); this._failsafeTimer = null; }
    if (this._refreshRaf) { cancelAnimationFrame(this._refreshRaf); this._refreshRaf = null; }
    // Reset the view-restored flag so the new build can do its own initial stabilization
    this._initialViewRestored = false;
    this._runRelayoutPass = null;

    // Hide canvas during build to prevent visible flicker (pass 1 → pass 2 jump)
    if (this._canvas) {
      this._canvas.style.opacity = '0';
      this._canvas.style.transition = 'none';
    }

    const isStructured = this._viewMode === 'structured';

    // Cache key: reuse previously built graph for same skeleton+mode
    const cacheKey = isStructured ? 'structured' : 'flat';
    if (!this._graphCache) this._graphCache = {};

    let editor, fileMap, dirFiles, dirNodeMap, idToPath, symbolMap;

    if (this._graphCache[cacheKey] && this._graphCache[cacheKey].skeleton === skeleton) {
      // Reuse cached build result — avoids 5+ second rebuild on mode toggle
      ({ editor, fileMap, dirFiles, dirNodeMap, idToPath, symbolMap } = this._graphCache[cacheKey]);
    } else {
      console.time('[graph] build');
      if (isStructured) {
        ({ editor, fileMap, dirFiles, dirNodeMap, idToPath, symbolMap } = buildStructuredGraph(skeleton));
      } else {
        ({ editor, fileMap, dirFiles, idToPath, symbolMap: symbolMap = new Map() } = buildFileGraph(skeleton));
      }
      console.timeEnd('[graph] build');
      this._graphCache[cacheKey] = { skeleton, editor, fileMap, dirFiles, dirNodeMap, idToPath, symbolMap };
    }
    this._editor = editor;
    this._fileMap = fileMap;
    this._dirNodeMap = dirNodeMap;
    this._idToPath = idToPath;
    this._symbolMap = symbolMap;
    this._drillableFiles = new Set([...symbolMap.values()].map(s => s.file));

    if (this._router) this._router.destroy();
    this._router = new SubgraphRouter(this._canvas, {
      hashPrefix: 'graph',
      fileMap,
      dirNodeMap,
      symbolMap,
      drillableFiles: this._drillableFiles,
      onNavigate: (path) => {
        // Optional hook: focus/pulse upon non-visual navigation
      }
    });

    // Set editor on canvas
    console.time('[graph] setEditor');
    this._canvas.setEditor(editor);
    console.timeEnd('[graph] setEditor');

    // Apply settings
    this._canvas.setReadonly(true);
    const searchStr = window.location.search || (window.location.hash.includes('?') ? window.location.hash.split('?')[1] : '');
    const urlParams = new URLSearchParams(searchStr);
    this._canvas.setPathStyle(urlParams.get('style') || window.localStorage.getItem('connection-style') || 'pcb');

    // Auto-layout
    const rawPos = this._canvas.getPositions() || {};
    const existingPositions = {};
    for (const [id, coords] of Object.entries(rawPos)) {
      if (typeof coords[0] === 'number' && !isNaN(coords[0]) &&
          typeof coords[1] === 'number' && !isNaN(coords[1])) {
        existingPositions[id] = { x: coords[0], y: coords[1] };
      }
    }

    // Groups for layout clustering (flat mode only — structured has fewer top-level nodes)
    const groups = {};
    if (!isStructured && dirFiles) {
      for (const [dir, files] of dirFiles.entries()) {
        const nodeIds = [];
        for (const f of files) {
          if (fileMap.has(f)) nodeIds.push(fileMap.get(f));
        }
        if (nodeIds.length > 0) groups[dir] = nodeIds;
      }
    }

    // --- Layout strategy depends on mode ---
    let positions;

    if (isStructured && dirFiles) {
      // TREE mode: directory tree layout (like file explorer)
      // Build dirPaths map ONLY for nodes that are in the root editor
      const dirPaths = {};
      const rootNodeIds = new Set(editor.getNodes().map(n => n.id));
      for (const [dir, nodeId] of dirNodeMap.entries()) {
        if (rootNodeIds.has(nodeId)) {
          dirPaths[nodeId] = dir;
        }
      }

      positions = computeTreeLayout(editor, {
        dirPaths,
        nodeWidth: 250,
        nodeHeight: 100,
        gapX: 40,
        gapY: 60,
        startX: 60,
        startY: 60,
      });
    } else {
      // FLAT mode: Sugiyama graph layout
      const layoutOpts = { existingPositions, groups };
      const layoutResult = computeAutoLayout(editor, layoutOpts);
      positions = layoutResult.positions ? layoutResult.positions : layoutResult;

      // Compact disconnected components: outlier chains can stretch BBox 10x+
      // beyond the main cluster, making zoom unusably low.
      // Strategy: find connected components, keep the largest in-place,
      // stack smaller ones below/beside with a small gap.
      positions = this._compactDisconnectedComponents(editor, positions);
    }

    this._canvas.setBatchMode(true);
    for (const [nodeId, pos] of Object.entries(positions)) {
      this._canvas.setNodePosition(nodeId, pos.x, pos.y);
    }
    this._canvas.setBatchMode(false);

    // Force sync updated phantom positions to renderer immediately
    // Without this, subsequent fitView/redraw uses stale (0,0) phantom data
    this._canvas.syncPhantom?.();

    // Large phantom-only graphs: skip pass 2 relayout (no DOM nodes for ResizeObserver)
    // Immediately fitView and show canvas — no need for expensive re-run
    const isLargePhantom = editor.getNodes().length > 200;
    if (isLargePhantom) {
      this._initialViewRestored = true;
      requestAnimationFrame(() => {
        if (!this._canvas) return;
        this._canvas.fitView();
        this._canvas.refreshConnections();
        this._canvas.style.transition = 'opacity 0.15s ease-in';
        this._canvas.style.opacity = '1';
      });
    }

    // Force-directed refinement for FLAT mode with 50+ nodes
    const nodeCount = editor.getNodes().length;
    if (!isStructured && nodeCount >= 50) {
      if (!this._forceLayout) {
        const workerUrl = new URL('../vendor/symbiote-node/canvas/ForceWorker.js', import.meta.url).href;
        this._forceLayout = new ForceLayout(workerUrl);
      }

      const editorNodes = [...editor.getNodes()];
      const editorConns = [...editor.getConnections()];
      const forceNodes = editorNodes.map(n => ({
        id: n.id,
        x: positions[n.id]?.x ?? 0,
        y: positions[n.id]?.y ?? 0,
        group: groups ? Object.entries(groups).find(([, ids]) => ids.includes(n.id))?.[0] : null,
      }));
      const forceEdges = editorConns.map(c => ({ from: c.from, to: c.to }));

      this._forceLayout.onTick = (pos) => {
        if (!this._canvas) return;
        this._canvas.setBatchMode(true);
        for (const [nodeId, p] of Object.entries(pos)) {
          this._canvas.setNodePosition(nodeId, p.x, p.y);
        }
        this._canvas.setBatchMode(false);
        this._canvas.refreshConnections();
      };
      this._forceLayout.onDone = () => {
        console.log('[dep-graph] Force layout converged');
        if (this._canvas?.fitView) this._canvas.fitView();
      };

      this._forceLayout.start({
        nodes: forceNodes,
        edges: forceEdges,
        groups: groups || {},
        options: {
          repulsion: nodeCount > 500 ? 400 : 800,
          springLength: nodeCount > 500 ? 80 : 120,
          maxIterations: nodeCount > 1000 ? 150 : 300,
        },
      });
    }

    // Post-drill-in layout: recalculate inner node positions using real DOM sizes
    // Pre-computed innerPositions use hardcoded nodeHeight which may not match actual rendered heights
    // IMPORTANT: Must be registered BEFORE restoreFromHash, which may trigger drillDown on page refresh
    if (!this._drillLayoutListener) {
      this._drillLayoutListener = (e) => {
        if (!this._canvas) return;
        const enteredNode = e.detail?.node;
        if (!enteredNode?._isSubgraph) return;
        const innerEditor = enteredNode.getInnerEditor();
        if (!innerEditor) return;

        // Wait for inner nodes to render, then re-layout with measured sizes
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            const nodeSizes = this._canvas.measureNodeSizes();
            if (!nodeSizes || Object.keys(nodeSizes).length === 0) return;

            const corrected = computeAutoLayout(innerEditor, {
              nodeSizes,
              nodeHeight: 80,
              gapY: 100,
              gapX: 120,
            });

            this._canvas.setBatchMode(true);
            for (const [nodeId, pos] of Object.entries(corrected)) {
              this._canvas.setNodePosition(nodeId, pos.x, pos.y);
            }
            this._canvas.setBatchMode(false);
            this._canvas.refreshConnections();

            if (window.location.hash.includes('focus=')) {
              const searchStr = window.location.search || (window.location.hash.includes('?') ? window.location.hash.split('?')[1] : '');
              const params = new URLSearchParams(searchStr);
              const focusParam = params.get('focus');
              if (focusParam && this._router) {
                // Defer to allow DOM to settle, then fly to the correct newly measured position
                requestAnimationFrame(() => this._router.navigateTo(decodeURIComponent(focusParam)));
              }
            } else if (this._canvas.fitView) {
              requestAnimationFrame(() => this._canvas.fitView());
            }
          });
        });
      };
      this._canvas.addEventListener('subgraph-enter', this._drillLayoutListener);
    }

    // Safety net: update URL on subgraph exit (back to root)
    // SubgraphRouter's handleExit should handle this, but as defense-in-depth
    if (!this._exitUrlListener) {
      this._exitUrlListener = (e) => {
        const level = e.detail?.level;
        if (level === 0) {
          // Exiting to root — extract parent directory from current URL to use as focus
          const hash = window.location.hash;
          const pathMatch = hash.match(/#graph\/([^?&]+)/);
          if (pathMatch) {
            let focusDir = pathMatch[1];
            // Walk up to find known directory
            if (this._dirNodeMap) {
              const segments = focusDir.replace(/\/$/, '').split('/');
              while (segments.length > 0) {
                const candidate = segments.join('/') + '/';
                if (this._dirNodeMap.has(candidate)) {
                  focusDir = candidate;
                  break;
                }
                segments.pop();
              }
            }
            history.replaceState(null, '', `#graph?focus=${encodeURIComponent(focusDir)}`);
          } else {
            history.replaceState(null, '', '#graph');
          }
        }
      };
      this._canvas.addEventListener('subgraph-exit', this._exitUrlListener);
    }

    // NOTE: restoreFromHash is NOT called here (pass 1) because positions aren't stable yet.
    // It will be called from _runRelayoutPass (pass 2) after node sizes are measured.

    // Dedicated node ResizeObserver ensures that late inflation of inner ports
    // triggers not only a line refresh, but initially schedules a full Pass 2 layout
    // so things don't overlap vertically in a messy stack.
    if (!this._nodeObserver) {
      this._nodeObserver = new ResizeObserver((entries) => {
          if (!this._canvas) return;
          let needsRefresh = false;
          for (const entry of entries) {
            if (entry.target.tagName.toLowerCase() === 'graph-node') {
              const el = entry.target;
              const newW = entry.contentRect.width;
              const newH = entry.contentRect.height;
              
              // Ignore culling-induced resizes (when contentVisibility: hidden makes dimensions 0)
              if (newW === 0 || newH === 0) continue;
              
              // Ignore if the dimensions are practically identical to cached (allow up to 3px jitter for transform/zoom text rendering rounding)
              if (el._cachedW && Math.abs(el._cachedW - newW) <= 3 && Math.abs(el._cachedH - newH) <= 3) {
                continue;
              }
              
              // Real resize detected! Update cache and flag refresh
              el._cachedW = newW;
              el._cachedH = newH;
              needsRefresh = true;
            }
          }

          if (needsRefresh) {
          // Immediately secure connections
          if (this._refreshRaf) cancelAnimationFrame(this._refreshRaf);
          this._refreshRaf = requestAnimationFrame(() => this._canvas.refreshConnections());

          // Trigger full layout recalculation debounced ONLY during initial load
          if (!this._initialViewRestored) {
            if (this._layoutPassTimer) clearTimeout(this._layoutPassTimer);
            this._layoutPassTimer = setTimeout(() => {
              this._runRelayoutPass(isStructured, dirFiles, dirNodeMap, editor, groups);
            }, 150);
          }
        }
      });
    }

    // Attach ResizeObserver to all graph-nodes
    requestAnimationFrame(() => {
      if (!this._canvas) return;
      const nodes = this._canvas.querySelectorAll('graph-node');
      for (const el of nodes) {
        this._nodeObserver.observe(el);
      }
    });

    // Provide the dynamic layout function which replaces the old static setTimeout
    this._runRelayoutPass = (isStructured, dirFiles, dirNodeMap, editor, groups) => {
      if (!this._canvas) return;
      const nodeSizes = this._canvas.measureNodeSizes();
      
      let correctedPositions;
      if (isStructured && dirFiles) {
        const dirPaths = {};
        const rootNodeIds = new Set(editor.getNodes().map(n => n.id));
        for (const [dir, nodeId] of dirNodeMap.entries()) {
          if (rootNodeIds.has(nodeId)) {
            dirPaths[nodeId] = dir;
          }
        }
        correctedPositions = computeTreeLayout(editor, {
          dirPaths, nodeSizes,
          nodeWidth: 250, nodeHeight: 100,
          gapX: 40, gapY: 60,
          startX: 60, startY: 60,
        });
      } else {
        // FLAT mode: use force-directed layout with live animation
        const editorNodes = [...editor.getNodes()];
        const editorConns = [...editor.getConnections()];

        // For small graphs, use static AutoLayout (faster)
        if (editorNodes.length < 50) {
          const layoutResult = computeAutoLayout(editor, {
            groups, nodeSizes, existingPositions: this._canvas.getPositions()
          });
          correctedPositions = layoutResult.positions ? layoutResult.positions : layoutResult;
        } else {
          // Initial positions from AutoLayout
          const initialLayout = computeAutoLayout(editor, {
            groups, nodeSizes, existingPositions: this._canvas.getPositions()
          });
          correctedPositions = initialLayout.positions ? initialLayout.positions : initialLayout;

          // Start force simulation to refine positions
          if (!this._forceLayout) {
            const workerUrl = new URL('../vendor/symbiote-node/canvas/ForceWorker.js', import.meta.url).href;
            this._forceLayout = new ForceLayout(workerUrl);
          }

          const forceNodes = editorNodes.map(n => ({
            id: n.id,
            x: correctedPositions[n.id]?.x ?? 0,
            y: correctedPositions[n.id]?.y ?? 0,
            group: groups ? Object.entries(groups).find(([, ids]) => ids.includes(n.id))?.[0] : null,
          }));

          const forceEdges = editorConns.map(c => ({
            from: c.from,
            to: c.to,
          }));

          this._forceLayout.onTick = (positions) => {
            if (!this._canvas) return;
            this._canvas.setBatchMode(true);
            for (const [nodeId, pos] of Object.entries(positions)) {
              this._canvas.setNodePosition(nodeId, pos.x, pos.y);
            }
            this._canvas.setBatchMode(false);
            this._canvas.refreshConnections();
          };

          this._forceLayout.onDone = (positions) => {
            console.log('[dep-graph] Force layout converged');
          };

          this._forceLayout.start({
            nodes: forceNodes,
            edges: forceEdges,
            groups: groups || {},
            options: {
              repulsion: editorNodes.length > 500 ? 400 : 800,
              springLength: editorNodes.length > 500 ? 80 : 120,
              maxIterations: editorNodes.length > 1000 ? 150 : 300,
            },
          });
        }
      }


      this._canvas.setBatchMode(true);
      for (const [nodeId, pos] of Object.entries(correctedPositions)) {

        this._canvas.setNodePosition(nodeId, pos.x, pos.y);
      }
      this._canvas.setBatchMode(false);

      requestAnimationFrame(() => this._canvas.refreshConnections());

      // Only restore view focus/drill-down once after first layout stabilizes
      if (!this._initialViewRestored) {
        this._initialViewRestored = true;

        // restoreFromHash handles path, ?focus=, and ?in= params
        const fullHash = window.location.hash;
        const hasPath = /^#graph\//.test(fullHash);
        const hasParams = fullHash.includes('?');
        if (hasPath || hasParams) {
          this._router?.restoreFromHash(editor);
        } else {
          this._canvas.fitView();
        }



        // Reveal canvas after layout is stable
        requestAnimationFrame(() => {
          if (this._canvas) {
            this._canvas.style.transition = 'opacity 0.15s ease-in';
            this._canvas.style.opacity = '1';
          }
        });
      }

    };

    // Failsafe: if the node dimensions were completely cached/synchronous and 
    // ResizeObserver didn't have anything new to report, we trigger it once manually.
    if (!this._failsafeTimer) {
       this._failsafeTimer = setTimeout(() => {
          if (!this._initialViewRestored && this._runRelayoutPass) {
             this._runRelayoutPass(isStructured, dirFiles, dirNodeMap, editor, groups);
          } else {
             // Handle late layout updates for drilled views
             if (window.location.hash.includes('focus=')) {
               const searchStr = window.location.search || (window.location.hash.includes('?') ? window.location.hash.split('?')[1] : '');
               const params = new URLSearchParams(searchStr);
               const focusParam = params.get('focus');
               if (focusParam && this._router) {
                 this._router.navigateTo(decodeURIComponent(focusParam));
               }
             } else if (this._canvas.fitView) {
               this._canvas.fitView();
             }
             this._canvas.refreshConnections();
          }
       }, 300);
    }
    // Phase 3: Directory frames (flat mode only)
    // DISABLED: Zone group frames temporarily turned off
    // if (!isStructured) this._addDirectoryFrames(editor, fileMap, dirFiles, positions);

    // Store skeleton for Phase 2 pin resolution (flat mode only)
    this._skeleton = skeleton;
    this._pinExpansion?.clearPins();
    if (!isStructured) {
      if (!this._pinExpansion) {
        this._pinExpansion = new PinExpansion(this._canvas, {
          onPinClick: (pin, nodeId) => {
            if (pin.file) {
              state.activeFile = pin.file;
              emit('file-selected', { path: pin.file, line: pin.line || 1 });
            }
          }
        });
      }
      /*
      if (!this._lodManager) {
        this._lodManager = new LODManager(this._canvas, { threshold: 0.7 });
        this._lodManager.onLodChange((lod) => {
          this._pinExpansion?.applyLOD(lod);
        });
        this._lodManager.attach();
      }
      this._lodManager.update();
      */
      this._buildPinCache(skeleton, fileMap);
    }

    // Update stats
    const stats = skeleton.s || {};
    const viaCount = editor.getConnections().filter(c => c._via).length;
    const statsEl = this.querySelector('.pcb-stats');
    if (statsEl) {
      statsEl.innerHTML = `
        <span><span class="pcb-stat-val">${fileMap.size}</span> files</span>
        <span><span class="pcb-stat-val">${stats.functions || 0}</span> fn</span>
        <span><span class="pcb-stat-val">${stats.classes || 0}</span> cls</span>
        <span><span class="pcb-stat-val">${editor.getConnections().length}</span> edges</span>
        ${viaCount > 0 ? `<span><span class="pcb-stat-val">${viaCount}</span> vias</span>` : ''}
      `;
    }
  }


  /**
   * Post-render reflow: measure actual DOM SubgraphNode sizes and re-position
   * to eliminate overlaps. Uses a simple top-to-bottom column packing approach.
   * @param {NodeEditor} editor
   * @param {Object} initialPositions
   */
  _reflowStructuredNodes(editor, initialPositions) {
    if (!this._canvas) return;

    // Collect actual dimensions from DOM
    const entries = [];
    for (const node of editor.getNodes()) {
      const el = this._canvas.getNodeView?.(node.id);
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      const zoom = this._canvas.$.zoom || 1;
      // Convert screen dimensions to world-space
      const w = rect.width / zoom;
      const h = rect.height / zoom;
      const pos = el._position || { x: 0, y: 0 };
      entries.push({ id: node.id, x: pos.x, y: pos.y, w, h });
    }

    if (entries.length === 0) return;

    // Sort by original Y position (preserve column ordering from AutoLayout)
    entries.sort((a, b) => {
      const dx = Math.abs(a.x - b.x);
      // Same column if within 50px horizontally
      if (dx < 50) return a.y - b.y;
      return a.x - b.x;
    });

    // Group into columns (nodes within 50px x-distance = same column)
    const GAP = 40; // px gap between nodes
    const columns = [];
    let currentCol = [entries[0]];
    for (let i = 1; i < entries.length; i++) {
      if (Math.abs(entries[i].x - currentCol[0].x) < 50) {
        currentCol.push(entries[i]);
      } else {
        columns.push(currentCol);
        currentCol = [entries[i]];
      }
    }
    columns.push(currentCol);

    // Reflow each column vertically
    this._canvas.setBatchMode(true);
    for (const col of columns) {
      col.sort((a, b) => a.y - b.y);
      let nextY = col[0].y;
      for (const entry of col) {
        if (entry.y < nextY) {
          this._canvas.setNodePosition(entry.id, entry.x, nextY);
          entry.y = nextY;
        }
        nextY = entry.y + entry.h + GAP;
      }
    }
    this._canvas.setBatchMode(false);

    this._router?.restoreFromHash(editor);
    this._canvas.refreshConnections();
    this._canvas.fitView();
  }

  /**
   * Restore drill-down state from a path (directory or file).
   * Finds the SubgraphNode whose params.path matches and drills in.
   * @param {string} targetPath - e.g. 'src/core/' or 'src/core/parser.js'
   * @param {NodeEditor} editor
   * @returns {boolean}
   */

  // ── Phase 2: IC Chip Expansion ──

  /**
   * Build pin cache: for each file node, resolve its exported symbol names
   * from skeleton.X (minified IDs) via skeleton.L (legend)
   * @param {object} skeleton
   * @param {Map<string, string>} fileMap
   */
  _buildPinCache(skeleton, fileMap) {
    const X = skeleton.X || {};
    const L = skeleton.L || {};
    const n = skeleton.n || {};

    // Build reverse legend: minifiedId → fullName
    const revL = {};
    for (const [minId, fullName] of Object.entries(L)) {
      revL[minId] = fullName;
    }

    for (const [filePath, nodeId] of fileMap) {
      const symbols = X[filePath] || [];
      const pins = [];

      for (const sym of symbols) {
        // Phase 4: X entries can be {id, l} objects with line numbers or plain strings
        const symId = typeof sym === 'object' ? sym.id : sym;
        const line = typeof sym === 'object' ? sym.l : null;
        const fullName = revL[symId] || symId;
        // Determine kind: class or function
        const nodeData = n[symId];
        const kind = nodeData ? 'class' : 'fn';
        pins.push({ name: fullName, kind, line, file: filePath });
      }

      // Also check classes that belong to this file (from skeleton.n)
      for (const [id, data] of Object.entries(n)) {
        if (data.f === filePath) {
          const fullName = revL[id] || id;
          // Avoid duplicates (already in X)
          if (!pins.some(p => p.name === fullName)) {
            pins.push({ name: fullName, kind: 'class', line: data.l || null, file: filePath });
          }
        }
      }

      if (pins.length > 0) {
        this._pinExpansion?.setPins(nodeId, pins);
      }
    }
  }



  // ── Phase 3: Directory Frames & Via Markers ──

  /** @type {string[]} Directory color palette — PCB silkscreen tones */
  static DIR_COLORS = [
    'rgba(200, 117, 51, 0.25)',  // copper
    'rgba(212, 160, 74, 0.20)',  // gold
    'rgba(100, 180, 120, 0.20)', // solder mask green
    'rgba(80, 150, 200, 0.20)',  // blue layer
    'rgba(160, 100, 200, 0.20)', // purple trace
    'rgba(200, 80, 80, 0.20)',   // power layer red
    'rgba(120, 200, 200, 0.20)', // teal
    'rgba(200, 180, 80, 0.20)',  // yellow
  ];

  /**
   * Create directory grouping frames from dirFiles map and node positions
   * @param {NodeEditor} editor
   * @param {Map<string, string>} fileMap
   * @param {Map<string, string[]>} dirFiles
   * @param {Object<string, {x: number, y: number}>} positions
   */
  _addDirectoryFrames(editor, fileMap, dirFiles, positions) {
    if (!dirFiles || dirFiles.size < 2) return; // frames only useful with 2+ dirs

    const padding = 30;
    const nodeW = 120;
    const nodeH = 80;
    let colorIdx = 0;

    for (const [dir, files] of dirFiles) {
      if (files.length < 2) continue; // skip single-file dirs

      // Compute bounding box of all nodes in this directory
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      let hasPositions = false;

      for (const file of files) {
        const nodeId = fileMap.get(file);
        if (!nodeId) continue;
        const pos = positions[nodeId];
        if (!pos) continue;
        hasPositions = true;

        if (pos.x < minX) minX = pos.x;
        if (pos.y < minY) minY = pos.y;
        if (pos.x + nodeW > maxX) maxX = pos.x + nodeW;
        if (pos.y + nodeH > maxY) maxY = pos.y + nodeH;
      }

      if (!hasPositions) continue;

      // Create frame with padding
      const dirLabel = dir.replace(/\/$/, '').split('/').pop() || 'root';
      const color = DepGraph.DIR_COLORS[colorIdx % DepGraph.DIR_COLORS.length];
      colorIdx++;

      try {
        const frame = new Frame(dirLabel, {
          x: minX - padding,
          y: minY - padding,
          width: (maxX - minX) + padding * 2,
          height: (maxY - minY) + padding * 2,
          color,
        });
        editor.addFrame(frame);
      } catch {
        // Skip if frame creation fails
      }
    }
  }

  /**
   * Toggle layer visibility
   * @param {'zones'|'vias'} layer
   * @param {boolean} visible
   */
  _toggleLayer(layer, visible) {
    if (!this._canvas) return;

    if (layer === 'zones') {
      // Toggle all graph-frame elements
      const frames = this._canvas.querySelectorAll('graph-frame');
      for (const frame of frames) {
        frame.style.display = visible ? '' : 'none';
      }
    } else if (layer === 'vias') {
      // Toggle dash styling on via connections
      // We use a data attribute on the canvas itself, CSS handles the rest
      if (visible) {
        this._canvas.removeAttribute('data-hide-vias');
      } else {
        this._canvas.setAttribute('data-hide-vias', '');
      }
    }
  }

  /**
   * Handle agent tool events for autopilot mode
   * @param {object} event
   */
  _handleAutopilot(event) {
    if (!this._editor || !this._canvas) return;

    const toolName = event.tool || event.name || '';
    const args = event.args || {};

    // tool:call events
    if (event.phase === 'call' || event.type === 'tool:call') {
      if (toolName === 'navigate' && args.action === 'expand' && args.symbol) {
        this._focusSymbol(args.symbol);
      } else if (toolName === 'navigate' && args.action === 'deps' && args.symbol) {
        this._highlightDeps(args.symbol);
      } else if (toolName === 'navigate' && args.action === 'call_chain') {
        // Phase 4: animate call chain when agent traces a path
        if (args.from && args.to) {
          this._highlightCallChain(args.from, args.to);
        }
      } else if (toolName === 'navigate' && args.action === 'usages' && args.symbol) {
        this._highlightDeps(args.symbol);
      } else if (toolName === 'get_skeleton') {
        this._canvas.fitView();
      } else if (toolName === 'compact' && args.path) {
        this._pulseFile(args.path);
      } else if (toolName === 'view_file' && args.path) {
        // Agent opened a file — focus it on the board
        this._focusFile(args.path);
        this._pulseFile(args.path);
      }
    }
  }

  // ── Phase 4: Camera Animation & Code Drill-down ──

  /**
   * Smooth camera animation to a node position
   * @param {string} nodeId
   * @param {number} [targetZoom=1]
   * @param {number} [duration=400]
   */
  _animateToNode(nodeId, targetZoom = 1, duration = 400) {
    if (!this._canvas) return;
    const positions = this._canvas.getPositions();
    const pos = positions[nodeId];
    if (!pos) return;

    const canvasRect = this._canvas.getBoundingClientRect();
    const targetPanX = canvasRect.width / 2 - pos[0] * targetZoom;
    const targetPanY = canvasRect.height / 2 - pos[1] * targetZoom;

    const startZoom = this._canvas.$.zoom;
    const startPanX = this._canvas.$.panX;
    const startPanY = this._canvas.$.panY;
    const startTime = performance.now();

    const animate = (now) => {
      const elapsed = now - startTime;
      const t = Math.min(elapsed / duration, 1);
      // Ease-out cubic
      const ease = 1 - Math.pow(1 - t, 3);

      this._canvas.$.zoom = startZoom + (targetZoom - startZoom) * ease;
      this._canvas.$.panX = startPanX + (targetPanX - startPanX) * ease;
      this._canvas.$.panY = startPanY + (targetPanY - startPanY) * ease;

      if (t < 1) requestAnimationFrame(animate);
    };

    requestAnimationFrame(animate);
  }

  /**
   * Focus on a file node with smooth animation
   * @param {string} filePath
   */
  _focusFile(filePath) {
    const nodeId = this._fileMap.get(filePath);
    if (!nodeId) return;
    this._animateToNode(nodeId, 1, 400);
  }

  /**
   * Focus on a symbol (resolve to file first)
   * @param {string} symbol
   */
  _focusSymbol(symbol) {
    if (!this._skeleton) return;
    // Try to find the file containing this symbol
    for (const [key, data] of Object.entries(this._skeleton.n || {})) {
      if (key === symbol && data.f) {
        this._focusFile(data.f);
        this._pulseFile(data.f);
        return;
      }
    }
  }

  /**
   * Highlight dependencies of a symbol with flow animation
   * @param {string} symbol
   */
  _highlightDeps(symbol) {
    if (!this._skeleton) return;
    const data = (this._skeleton.n || {})[symbol];
    if (!data?.f) return;

    // Focus + pulse the main file
    this._focusFile(data.f);
    this._pulseFile(data.f);

    // Highlight connections from this file
    const nodeId = this._fileMap.get(data.f);
    if (!nodeId) return;

    const connections = this._editor.getConnections()
      .filter(c => c.from === nodeId || c.to === nodeId);

    for (const conn of connections) {
      this._canvas.setFlowing(conn.id, true);
    }

    // Stop flow animation after 3 seconds
    setTimeout(() => {
      for (const conn of connections) {
        this._canvas.setFlowing(conn.id, false);
      }
    }, 3000);
  }

  /**
   * Highlight a call chain: animate sequential connection flow from source to target
   * @param {string} fromSymbol
   * @param {string} toSymbol
   */
  _highlightCallChain(fromSymbol, toSymbol) {
    if (!this._skeleton) return;

    // Resolve files
    const fromData = (this._skeleton.n || {})[fromSymbol];
    const toData = (this._skeleton.n || {})[toSymbol];
    const fromFile = fromData?.f;
    const toFile = toData?.f;
    if (!fromFile || !toFile) return;

    const fromId = this._fileMap.get(fromFile);
    const toId = this._fileMap.get(toFile);
    if (!fromId || !toId) return;

    // Find shortest path via BFS on connection graph
    const adj = new Map();
    for (const conn of this._editor.getConnections()) {
      if (!adj.has(conn.from)) adj.set(conn.from, []);
      adj.get(conn.from).push({ to: conn.to, connId: conn.id });
    }

    const visited = new Set([fromId]);
    const queue = [[fromId, []]];
    let path = null;

    while (queue.length > 0) {
      const [current, connPath] = queue.shift();
      if (current === toId) {
        path = connPath;
        break;
      }
      for (const edge of (adj.get(current) || [])) {
        if (!visited.has(edge.to)) {
          visited.add(edge.to);
          queue.push([edge.to, [...connPath, edge.connId]]);
        }
      }
    }

    if (!path || path.length === 0) return;

    // Focus on source node first
    this._animateToNode(fromId, 0.8, 300);

    // Animate flow along the path sequentially
    const stepDuration = 800;
    path.forEach((connId, idx) => {
      setTimeout(() => {
        this._canvas.setFlowing(connId, true);
      }, idx * stepDuration);
    });

    // Stop all flow after chain completes + hold time
    setTimeout(() => {
      for (const connId of path) {
        this._canvas.setFlowing(connId, false);
      }
      // Pan to destination
      this._animateToNode(toId, 1, 400);
      this._pulseFile(toFile);
    }, path.length * stepDuration + 1000);
  }

  /**
   * Pulse a file node (brief highlight)
   * @param {string} filePath
   */
  _pulseFile(filePath) {
    const nodeId = this._fileMap.get(filePath);
    if (!nodeId) return;
    this._canvas.highlightTrace([{ nodeId }], 200);
  }
}

DepGraph.rootStyles = PCB_CSS;
DepGraph.reg('pg-dep-graph');