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
  // From nodes (classes) — each has .f (file) property
  for (const data of Object.values(skeleton.n || {})) {
    if (data.f) files.add(data.f);
  }
  // From exports map — keys are files
  for (const file of Object.keys(skeleton.X || {})) {
    files.add(file);
  }
  // From asset files
  for (const [dir, names] of Object.entries(skeleton.f || {})) {
    for (const name of names) {
      files.add(dir === './' ? name : dir + name);
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
    const node = new Node(label, {
      type: 'file',
      category: 'file',
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

  return { editor, fileMap, dirMap, dirFiles };
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

  // Module name match (last segment)
  const base = importPath.split('/').pop();
  for (const file of knownFiles) {
    if (file.endsWith('/' + base) || file.endsWith('/' + base + '.js')) {
      return file;
    }
  }

  return null;
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

  // ── Level 0: Directory SubgraphNodes ──
  const dirNodeMap = new Map();

  for (const [dir, dirFileList] of dirFiles) {
    const dirLabel = dir.replace(/\/$/, '').split('/').pop() || 'root';

    const dirSubgraph = new SubgraphNode(dirLabel, {
      category: 'directory',
    });
    dirSubgraph.params = { path: dir, isDirectory: true };
    dirSubgraph.addOutput('out', new Output(S_EXPORT, ''));
    dirSubgraph.addInput('in', new Input(S_IMPORT, ''));

    // ── Level 1: File nodes inside directory ──
    const innerEditor = dirSubgraph.getInnerEditor();

    for (const file of dirFileList) {
      const fileLabel = baseName(file);
      const exports = skeleton.X?.[file] || []; // array of abbreviated strings
      const fileCategory = classifyFile(file);
      const classes = fileClasses.get(file);

      let fileNode;
      if (exports.length > 0) {
        // File with exports → SubgraphNode (drill-down into symbols)
        fileNode = new SubgraphNode(fileLabel, {
          category: fileCategory,
        });
        fileNode.params = { path: file, dir };

        // ── Level 2: Symbol nodes inside file ──
        const fileInnerEditor = fileNode.getInnerEditor();
        for (const abbr of exports) {
          const fullName = resolveName(abbr);
          // Classify: is this abbreviation a known class?
          const isClass = classes && classes.has(fullName);
          const fnNode = new Node(fullName, {
            type: isClass ? 'class' : 'function',
            category: isClass ? 'class' : 'function',
          });
          fnNode.params = { name: fullName, file };
          fileInnerEditor.addNode(fnNode);
        }
      } else {
        // No exports → leaf Node
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

    // ── File-level import edges within directory ──
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

    editor.addNode(dirSubgraph);
    dirNodeMap.set(dir, dirSubgraph.id);
  }

  // ── Cross-directory edges (Level 0) ──
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

      const srcNode = editor.getNode(srcDirId);
      const tgtNode = editor.getNode(tgtDirId);
      if (srcNode && tgtNode) {
        try {
          editor.addConnection(new Connection(srcNode, 'out', tgtNode, 'in'));
        } catch { /* skip */ }
      }
    }
  }

  // ── Pre-compute inner positions for drill-down ──
  for (const dirSubgraph of editor.getNodes()) {
    if (!dirSubgraph._isSubgraph) continue;
    const inner = dirSubgraph.getInnerEditor();
    const innerPos = computeAutoLayout(inner, { nodeHeight: 80, gapY: 60 });
    dirSubgraph.setInnerPositions(innerPos);

    for (const fileNode of inner.getNodes()) {
      if (!fileNode._isSubgraph) continue;
      const fileInner = fileNode.getInnerEditor();
      const filePos = computeAutoLayout(fileInner, { nodeHeight: 50, gapY: 40, gapX: 60 });
      fileNode.setInnerPositions(filePos);
    }
  }

  return { editor, fileMap, dirFiles, dirNodeMap };
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
  /** @type {string} Current LOD level */
  _currentLod = 'collapsed';
  /** @type {Map<string, string[]>} nodeId → resolved export names */
  _pinCache = new Map();
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
      </div>
      <node-canvas></node-canvas>
      <div class="pcb-stats"></div>
    `;

    this._canvas = this.querySelector('node-canvas');

    // Toolbar handlers
    this.querySelector('[data-action="fit"]').addEventListener('click', () => {
      this._fitView();
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

    // View mode toggle
    this._viewMode = 'structured';
    const viewModeBtn = this.querySelector('[data-action="view-mode"]');
    if (viewModeBtn) {
      viewModeBtn.querySelector('.material-symbols-outlined').textContent = 'grid_view';
      viewModeBtn.lastChild.textContent = 'TREE';
    }
    viewModeBtn?.addEventListener('click', () => {
      this._viewMode = this._viewMode === 'flat' ? 'structured' : 'flat';
      const label = this._viewMode === 'flat' ? 'FLAT' : 'TREE';
      const icon = this._viewMode === 'flat' ? 'account_tree' : 'grid_view';
      viewModeBtn.innerHTML = `<span class="material-symbols-outlined">${icon}</span>${label}`;
      if (this._viewMode === 'structured') {
        viewModeBtn.setAttribute('data-active', '');
      } else {
        viewModeBtn.removeAttribute('data-active');
      }
      // Rebuild graph in new mode
      this._graphBuilt = false;
      if (state.skeleton) {
        this._buildGraph(state.skeleton);
      }
    });

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
      const file = e.detail.path;
      if (file) {
        history.replaceState(null, '', `#graph/${file}`);
        this._focusNode(file);
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
      // Find node data to get stable file path
      const node = this._editor?.getNode(nodeId);
      const path = node?.params?.path;
      if (path) {
        history.replaceState(null, '', `#graph/${path}`);
      }
    });

    // Track drill-down navigation → update hash with directory path + ?in=1
    this._canvas?.addEventListener('subgraph-enter', (e) => {
      const node = e.detail?.node;
      const path = node?.params?.path;
      if (path) {
        history.replaceState(null, '', `#graph/${path}?in=1`);
      }
    });
    this._canvas?.addEventListener('subgraph-exit', () => {
      history.replaceState(null, '', '#graph');
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
   * Build visual graph from skeleton data
   * @param {object} skeleton
   */
  _buildGraph(skeleton) {
    if (!skeleton || !this._canvas) return;
    // Guard: both ResizeObserver and skeleton-loaded schedule rAF calls
    // that check _graphBuilt BEFORE the rAF. If both fire in the same
    // frame, _buildGraph runs twice → double nodes. Guard here too.
    if (this._graphBuilt) return;
    this._graphBuilt = true;

    const isStructured = this._viewMode === 'structured';

    let editor, fileMap, dirFiles, dirNodeMap;
    if (isStructured) {
      ({ editor, fileMap, dirFiles, dirNodeMap } = buildStructuredGraph(skeleton));
    } else {
      ({ editor, fileMap, dirFiles } = buildFileGraph(skeleton));
    }
    this._editor = editor;
    this._fileMap = fileMap;

    // Set editor on canvas
    this._canvas.setEditor(editor);

    // Apply settings
    this._canvas.setReadonly(true);
    this._canvas.setPathStyle('pcb');

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
      // Build dirPaths map: { nodeId: dirPath }
      const dirPaths = {};
      for (const [dir, nodeId] of dirNodeMap.entries()) {
        dirPaths[nodeId] = dir;
      }

      positions = computeTreeLayout(editor, {
        dirPaths,
        nodeWidth: 250,
        nodeHeight: 100,
        gapX: 40,
        gapY: 20,
        startX: 60,
        startY: 60,
      });
    } else {
      // FLAT mode: Sugiyama graph layout
      const layoutOpts = { existingPositions, groups };
      positions = computeAutoLayout(editor, layoutOpts);
    }

    this._canvas.setBatchMode(true);
    for (const [nodeId, pos] of Object.entries(positions)) {
      this._canvas.setNodePosition(nodeId, pos.x, pos.y);
    }
    this._canvas.setBatchMode(false);

    // Attach ResizeObserver to all graph-nodes so that if their dimensions expand
    // (e.g. late render of PortItems), we correctly refresh the connection curves.
    requestAnimationFrame(() => {
      if (!this._resizeObserver || !this._canvas) return;
      const nodes = this._canvas.querySelectorAll('graph-node');
      for (const el of nodes) {
        this._resizeObserver.observe(el);
      }
    });

    // --- Pass 2: Measure actual DOM sizes → re-layout with real dimensions ---
    // Wait for Symbiote.js custom elements to inflate and render inner ports
    setTimeout(() => {
      if (!this._canvas) return;
      const nodeSizes = this._canvas.measureNodeSizes();
      if (Object.keys(nodeSizes).length === 0) return;

      let correctedPositions;
      if (isStructured && dirFiles) {
        const dirPaths = {};
        for (const [dir, nodeId] of dirNodeMap.entries()) {
          dirPaths[nodeId] = dir;
        }
        correctedPositions = computeTreeLayout(editor, {
          dirPaths, nodeSizes,
          nodeWidth: 250, nodeHeight: 100,
          gapX: 40, gapY: 20,
          startX: 60, startY: 60,
        });
      } else {
        correctedPositions = computeAutoLayout(editor, {
          groups, nodeSizes,
        });
      }

      this._canvas.setBatchMode(true);
      for (const [nodeId, pos] of Object.entries(correctedPositions)) {
        this._canvas.setNodePosition(nodeId, pos.x, pos.y);
      }
      this._canvas.setBatchMode(false);
      console.log('[DepGraph] Pass 2 relayout with measured sizes:', Object.keys(nodeSizes).length, 'nodes');

      // Compute initial view — restore drill-down from hash
      const hash = location.hash.replace('#', '');
      
      let cleanHash = hash;
      let isInside = false;
      const qIdx = hash.indexOf('?');
      if (qIdx >= 0) {
        cleanHash = hash.substring(0, qIdx);
        const params = new URLSearchParams(hash.substring(qIdx + 1));
        if (params.get('in') === '1') isInside = true;
      }
      
      const slashIdx = cleanHash.indexOf('/');
      const focusPath = slashIdx >= 0 ? cleanHash.substring(slashIdx + 1) : '';

      let restored = false;
      if (focusPath && isStructured && isInside) {
        // Try to restore drill-down state ONLY if query param ?in=1 is provided
        restored = this._restoreDrillDown(focusPath, editor);
      }
      if (!restored && focusPath) {
        restored = this._focusNode(focusPath);
      }
      if (!restored) {
        this._fitView();
      }

      this._canvas.updateLOD?.();

      // Refresh connections one final time after DOM layout and camera moves
      this._canvas.refreshConnections();
    }, 150);

    // Phase 3: Directory frames (flat mode only)
    // DISABLED: Zone group frames temporarily turned off
    // if (!isStructured) this._addDirectoryFrames(editor, fileMap, dirFiles, positions);

    // Store skeleton for Phase 2 pin resolution (flat mode only)
    this._skeleton = skeleton;
    this._pinCache.clear();
    if (!isStructured) {
      this._buildPinCache(skeleton, fileMap);
      this._attachZoomLOD();
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
   * Fit all nodes in view
   */
  _fitView() {
    if (!this._canvas || !this._editor) return;
    // Use ViewportActions fitView if available, otherwise manual center
    const nodes = this._editor.getNodes();
    if (nodes.length === 0) return;

    const positions = this._canvas.getPositions();
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const pos of Object.values(positions)) {
      if (pos[0] < minX) minX = pos[0];
      if (pos[1] < minY) minY = pos[1];
      if (pos[0] + 150 > maxX) maxX = pos[0] + 150;
      if (pos[1] + 40 > maxY) maxY = pos[1] + 40;
    }

    const graphW = maxX - minX;
    const graphH = maxY - minY;
    const canvasRect = this._canvas.getBoundingClientRect();
    const scaleX = (canvasRect.width - 80) / graphW;
    const scaleY = (canvasRect.height - 80) / graphH;
    const scale = Math.max(0.2, Math.min(scaleX, scaleY, 1.5));

    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;

    this._canvas.$.zoom = scale;
    this._canvas.$.panX = canvasRect.width / 2 - centerX * scale;
    this._canvas.$.panY = canvasRect.height / 2 - centerY * scale;
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
    this._canvas.refreshConnections();
    this._fitView();
  }

  /**
   * Restore drill-down state from a path (directory or file).
   * Finds the SubgraphNode whose params.path matches and drills in.
   * @param {string} targetPath - e.g. 'src/core/' or 'src/core/parser.js'
   * @param {NodeEditor} editor
   * @returns {boolean}
   */
  _restoreDrillDown(targetPath, editor) {
    if (!this._canvas) return false;

    // Try to find a directory SubgraphNode matching the path
    for (const node of editor.getNodes()) {
      if (!node._isSubgraph) continue;
      const nodePath = node.params?.path;
      if (!nodePath) continue;

      // Exact directory match (e.g. 'src/core/')
      if (nodePath === targetPath) {
        this._canvas.drillDown(node.id);
        requestAnimationFrame(() => this._fitView());
        return true;
      }

      // File inside this directory — drill into dir, then focus file
      if (targetPath.startsWith(nodePath)) {
        this._canvas.drillDown(node.id);
        // Now try to find and focus the file node inside
        requestAnimationFrame(() => {
          const innerEditor = node.getInnerEditor();
          for (const fileNode of innerEditor.getNodes()) {
            if (fileNode.params?.path === targetPath) {
              // Found — select and center it
              this._canvas.selectNode?.(fileNode.id);
              break;
            }
          }
          this._fitView();
        });
        return true;
      }
    }

    return false;
  }

  /**
   * Focus viewport on a specific node by file path
   * @param {string} filePath - e.g. 'src/core/event-bus.js'
   * @returns {boolean} true if node found and focused
   */
  _focusNode(filePath) {
    if (!this._canvas || !this._fileMap) return false;

    // Find node ID by file path
    let targetId = null;
    for (const [path, nodeId] of this._fileMap) {
      if (path === filePath) {
        targetId = nodeId;
        break;
      }
    }
    if (!targetId) return false;

    const positions = this._canvas.getPositions();
    const pos = positions[targetId];
    if (!pos) return false;

    const canvasRect = this._canvas.getBoundingClientRect();
    const scale = 0.8;
    const nodeX = pos[0] + 75; // center of node (~150px wide)
    const nodeY = pos[1] + 20; // center of node (~40px tall)

    const newPanX = canvasRect.width / 2 - nodeX * scale;
    const newPanY = canvasRect.height / 2 - nodeY * scale;

    // Skip zoom/pan if already focused on this node (avoids full recalc cascade)
    const dz = Math.abs(this._canvas.$.zoom - scale);
    const dx = Math.abs(this._canvas.$.panX - newPanX);
    const dy = Math.abs(this._canvas.$.panY - newPanY);
    if (dz < 0.01 && dx < 2 && dy < 2) {
      // Already focused — just ensure selection is correct
      this._canvas.selectNode?.(targetId);
      return true;
    }

    this._canvas.$.zoom = scale;
    this._canvas.$.panX = newPanX;
    this._canvas.$.panY = newPanY;

    // Select the node visually
    this._canvas.selectNode?.(targetId);

    return true;
  }

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
        this._pinCache.set(nodeId, pins);
      }
    }
  }

  /**
   * Attach zoom change listener for LOD-based pin expansion.
   * When zoom > 0.7, pins appear. When zoom < 0.5, pins hide.
   */
  _attachZoomLOD() {
    if (!this._canvas || this._canvas._depGraphLodAttached) return;
    this._canvas._depGraphLodAttached = true;

    const canvas = this._canvas;
    
    // Determine initial LOD state and apply immediately
    const initialZoom = canvas.$.zoom || 1;
    let lastLod = initialZoom >= 0.7 ? 'expanded' : 'collapsed';
    this._currentLod = lastLod;
    this._applyLOD(lastLod);

    // Poll zoom for future changes
    canvas.sub('zoom', (zoom) => {
      const newLod = zoom >= 0.7 ? 'expanded' : 'collapsed';
      if (newLod === lastLod) return;
      lastLod = newLod;
      this._currentLod = newLod;

      // Toggle pin overlays on all nodes
      requestAnimationFrame(() => this._applyLOD(newLod));
    });
  }

  /**
   * Apply LOD state to all file nodes
   * @param {'collapsed'|'expanded'} lod
   */
  _applyLOD(lod) {
    if (!this._canvas) return;
    const nodeViews = this._canvas._getNodeView
      ? null // can't iterate private map from outside
      : null;

    // Iterate all nodes in pinCache
    for (const [nodeId, pins] of this._pinCache) {
      const el = this._canvas._getNodeView?.(nodeId);
      if (!el) continue;

      if (lod === 'expanded') {
        this._renderPinsForNode(el, pins);
      } else {
        // Hide pin overlay
        const overlay = el.querySelector('.pcb-pin-overlay');
        if (overlay) overlay.removeAttribute('data-visible');
      }
    }
  }

  /**
   * Render pin labels around a node element's border
   * @param {HTMLElement} el - graph-node element
   * @param {Array<{name: string, kind: string, line?: number, file?: string}>} pins
   */
  _renderPinsForNode(el, pins) {
    if (!pins || pins.length === 0) return;

    // Create or reuse pin overlay
    let overlay = el.querySelector('.pcb-pin-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.className = 'pcb-pin-overlay';
      el.appendChild(overlay);
    }

    // Only rebuild pin DOM if not already populated
    if (overlay.children.length === 0) {
      const maxPins = Math.min(pins.length, 12); // cap at 12 visible pins
      const half = Math.ceil(maxPins / 2);

      const createPinEl = (pin, side, yPct) => {
        const pinEl = document.createElement('span');
        pinEl.className = 'pcb-pin';
        pinEl.setAttribute('data-side', side);
        pinEl.setAttribute('data-kind', pin.kind);

        // Phase 4: show line number suffix if available
        const label = pin.line ? `${pin.name} :${pin.line}` : pin.name;
        pinEl.textContent = label;
        pinEl.style.top = `${yPct}%`;

        // Phase 4: click → navigate to file:line
        if (pin.file) {
          pinEl.style.cursor = 'pointer';
          pinEl.title = pin.line ? `${pin.file}:${pin.line}` : pin.file;
          pinEl.addEventListener('click', (e) => {
            e.stopPropagation();
            state.activeFile = pin.file;
            emit('file-selected', { path: pin.file, line: pin.line || 1 });
          });
        }

        return pinEl;
      };

      // Right side: first half of pins (exports)
      for (let i = 0; i < half; i++) {
        const yPct = ((i + 1) / (half + 1)) * 100;
        overlay.appendChild(createPinEl(pins[i], 'right', yPct));
      }

      // Left side: remaining pins
      for (let i = half; i < maxPins; i++) {
        const yPct = ((i - half + 1) / (maxPins - half + 1)) * 100;
        overlay.appendChild(createPinEl(pins[i], 'left', yPct));
      }
    }

    // Animate in
    requestAnimationFrame(() => overlay.setAttribute('data-visible', ''));
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
        this._fitView();
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