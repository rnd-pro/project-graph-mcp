import Symbiote from '@symbiotejs/symbiote';

const INIT_NODE_COUNT = 40;
const EDGE_RATIO = 1.2;
const DOT_RADIUS = 6;
const HIT_RADIUS = 14;

const NODE_TYPES = ['data', 'action', 'output', 'config', 'external'];
const TYPE_COLORS = {
  data:     [74, 158, 255],
  action:   [255, 107, 107],
  output:   [16, 185, 129],
  config:   [251, 191, 36],
  external: [168, 85, 247],
  group:    [100, 220, 220],
};

const MENU_ITEMS = [
  { action: 'drill', label: 'Enter Group', path: 'M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z' },
  { action: 'explore', label: 'Explore', path: 'M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z' },
  { action: 'view-code', label: 'View Code', path: 'M9.4 16.6L4.8 12l4.6-4.6L8 6l-6 6 6 6 1.4-1.4zm5.2 0L19.2 12l-4.6-4.6L16 6l6 6-6 6-1.4-1.4z' },
];

export class CanvasGraph extends Symbiote {
  init$ = {
    // These defaults will be updated from external controller if needed
    chargeStrength: -150,
    linkDistance: 150,
    linkStrength: 0.25,
    centerStrength: 0,
    velocityDecay: 0.92,
    collideStrength: 1.0,
    alphaDecay: 0.015,
    theta: 0.7,
    alphaFloor: 0.0001,
    alphaTarget: 0.0001,
    brownian: 0,
    brownianThresh: 0.001,
    pinReheat: 0.02,
    pinCap: 0.08,
    wellStrength: 0.8,
    centerPull: 0.3,
    wellRepulsion: 5.0,
    crossLinkScale: 0.2,
  };

  _bgR = 15;
  _bgG = 23;
  _bgB = 42;
  _ghostColor = 'rgb(22,30,50)';

  initCallback() {
    this.nodes = [];
    this.edges = [];
    this.nodeMap = new Map();
    this.adjMap = new Map();
    this.interactionDepths = new Map();
    this.nodePositions = new Map();
    this.nodeIds = [];
    
    this.worker = null;
    this.paused = false;
    this.dragNode = null;
    this.activeNode = null;
    this.hoverNode = null;
    this.nextActiveNode = null;
    this.deactivating = false;
    this.menuAnim = 0;
    this.dragOffset = { x: 0, y: 0 };
    this.renderMode = 'dots';
    
    this.focusX = 0;
    this.focusY = 0;
    this.focusActive = false;
    
    this.panX = 0;
    this.panY = 0;
    this.zoom = 0.5;
    this._targetZoom = 0.5;
    this._targetPanX = null;  // null = no animation target
    this._targetPanY = null;
    this._zoomAnchor = null;  // {mx, my} — screen point to keep stable during zoom
    this.isPanning = false;
    this.panStart = { x: 0, y: 0, px: 0, py: 0 };
    
    this.frameCount = 0;
    this.tickCount = 0;
    this.lastFpsTime = performance.now();
    this.lastAlpha = 0;
    
    this.smoothPositions = new Map();
    this.prevPositions = new Map();
    this.smoothing = 0.99;
    
    this.graphDB = { nodes: new Map(), edges: [], rootNodes: [] };
    this.currentGroupId = null;
    this._loopRunning = false;  // Whether the rAF draw loop is active
    this._idleFrames = 0;      // Count consecutive frames with no visual change
    this._prevDragDeltaX = 0;  // Previous frame's focus drag delta X
    this._prevDragDeltaY = 0;  // Previous frame's focus drag delta Y
    this._skeleton = null;     // Skeleton data reference for metadata

    // Info panel state (typewriter HUD to the right of active node)
    this._infoPanel = {
      nodeId: null,
      lines: [],
      opacity: 0,
      startTime: 0,
      totalExtent: 0,
      totalExtentY: 0,
      _centeredForNode: null,  // Track which node we've centered for
    };
    
    this.canvas = document.createElement('canvas');
    this.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    
    this.offscreenCanvases = {};
    for (let i = 1; i <= 4; i++) {
      const oc = document.createElement('canvas');
      this.offscreenCanvases[i] = { canvas: oc, ctx: oc.getContext('2d', { alpha: true }) };
    }
    
    this.layerAnim = {
      0: { scale: 1, opacity: 1, parallax: 0 },
      1: { scale: 1, opacity: 1, parallax: 0 },
      2: { scale: 1, opacity: 1, parallax: 0 },
      3: { scale: 1, opacity: 1, parallax: 0 },
      4: { scale: 1, opacity: 1, parallax: 0 }
    };
    
    this.LAYER_TARGETS = {
      scale:    [1.12, 1.0,  0.95, 0.88, 0.78],
      opacity:  [1.0,  0.9,  0.55, 0.06, 0.03],
      blur:     [0,    0,    1,    3,    5],
      parallax: [0,    0,    0.02, 0.04, 0.07]
    };
    
    this.depthGroups = { 
      0: { edges: [], nodes: [] }, 
      1: { edges: [], nodes: [] }, 
      2: { edges: [], nodes: [] }, 
      3: { edges: [], nodes: [] }, 
      4: { edges: [], nodes: [] } 
    };

    const resizeObserver = new ResizeObserver(() => this.resizeCanvas());
    resizeObserver.observe(this);
    this.resizeCanvas();
    
    this.bindEvents();
    
    this._wakeLoop();
    
    // Bind existing graph-breadcrumb from symbiote-node
    if (this.ref.breadcrumb) {
      this.ref.breadcrumb.onNavigate((levelStr) => {
        // levelStr is the path string we passed into 'level' property
        this.setPath(levelStr || null);
      });
    }
    
    setTimeout(() => {
       let rawBg = getComputedStyle(document.body).getPropertyValue('--sn-bg').trim();
       if (!rawBg) rawBg = getComputedStyle(document.body).backgroundColor;
       
       // Robust way to parse ANY color in browser
       const tempCtx = document.createElement('canvas').getContext('2d');
       tempCtx.fillStyle = '#1a1a1a'; // fallback
       tempCtx.fillStyle = rawBg;
       this._bgR = 26; this._bgG = 26; this._bgB = 26; // Default
       
       if (tempCtx.fillStyle.startsWith('#')) {
         const hex = tempCtx.fillStyle;
         this._bgR = parseInt(hex.length === 4 ? hex[1]+hex[1] : hex.slice(1,3), 16);
         this._bgG = parseInt(hex.length === 4 ? hex[2]+hex[2] : hex.slice(3,5), 16);
         this._bgB = parseInt(hex.length === 4 ? hex[3]+hex[3] : hex.slice(5,7), 16);
       }
       
       // If the background is extremely dark, we need a larger boost to be visible
       const boost = 25; 
       this._ghostColor = `rgb(${Math.min(255, this._bgR + boost)}, ${Math.min(255, this._bgG + boost)}, ${Math.min(255, this._bgB + boost)})`;
    }, 100);
  }
  
  disconnectedCallback() {
    this._loopRunning = false;
    if (this._animationFrame) cancelAnimationFrame(this._animationFrame);
    if (this.worker) this.worker.terminate();
  }

  /**
   * Ensure the rAF draw loop is running. Safe to call repeatedly.
   * Called by all state-changing entry points (interaction, worker, resize).
   */
  _wakeLoop() {
    if (this._loopRunning) return;
    this._loopRunning = true;
    this._idleFrames = 0;
    this._animationFrame = requestAnimationFrame(() => this.draw());
  }

  resizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.getBoundingClientRect();
    this._wakeLoop();  // Dimensions changed — redraw
    if (rect.width === 0) return;
    this.canvas.style.width = rect.width + 'px';
    this.canvas.style.height = rect.height + 'px';
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
  }

  resetView() {
    this.fitView();
  }

  fitView(padding = 60, animate = true) {
    if (!this.nodePositions.size) return;
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const pos of this.nodePositions.values()) {
      if (pos.x < minX) minX = pos.x;
      if (pos.y < minY) minY = pos.y;
      if (pos.x > maxX) maxX = pos.x;
      if (pos.y > maxY) maxY = pos.y;
    }

    const graphW = maxX - minX || 1;
    const graphH = maxY - minY || 1;
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;

    const newZoom = Math.max(0.02, Math.min(
      (rect.width - padding * 2) / graphW,
      (rect.height - padding * 2) / graphH,
      2.0
    ));
    const newPanX = rect.width / 2 - cx * newZoom;
    const newPanY = rect.height / 2 - cy * newZoom;

    if (animate) {
      this._targetZoom = newZoom;
      this._targetPanX = newPanX;
      this._targetPanY = newPanY;
      this._zoomAnchor = null;
    } else {
      this.zoom = newZoom;
      this._targetZoom = newZoom;
      this.panX = newPanX;
      this.panY = newPanY;
      this._targetPanX = null;
      this._targetPanY = null;
    }
    this.needsDraw = true;
    this._wakeLoop();
  }

  flyToNode(nodeId, options = {}) {
    const node = this.graphDB?.nodes.get(nodeId);
    if (node && node.parentId) {
      if (node.parentId !== this.currentGroupId) {
        this.loadLevel(node.parentId);
        setTimeout(() => this.flyToNode(nodeId, options), 500);
        return;
      }
    }

    const pos = this.getSmooth(nodeId) || this.nodePositions.get(nodeId);
    if (!pos) return;

    const rect = this.canvas.getBoundingClientRect();
    if (rect.width === 0) return;

    // Set zoom target: use provided zoom level, or force a comfortable minimum for focus
    const targetZoom = options.zoom || Math.max(1.2, Math.min(2.0, this.zoom));
    this._targetZoom = targetZoom;
    this._targetPanX = rect.width / 2 - pos.x * targetZoom;
    this._targetPanY = rect.height / 2 - pos.y * targetZoom;
    this._zoomAnchor = null;

    // Activate the node
    const foundNode = this.nodeMap?.get(nodeId);
    if (foundNode) {
      this.activeNode = foundNode;
      this.updateInteractionDepths();
    }
    this.needsDraw = true;
    this._wakeLoop();
  }

  setPath(pathStr) {
    if (!pathStr) {
      if (this.currentGroupId) this.loadLevel(null);
      return;
    }
    
    // The pathStr is exactly the group ID in our new universal routing model
    if (pathStr !== this.currentGroupId) {
      this.loadLevel(pathStr);
    }
  }

  // ─── HELPERS ───
  _dirOf(filePath) {
    const idx = filePath.lastIndexOf('/');
    return idx >= 0 ? filePath.slice(0, idx + 1) : './';
  }

  _resolveImport(importPath, fromFile, knownFiles) {
    if (knownFiles.has(importPath)) return importPath;
    if (knownFiles.has(importPath + '.js')) return importPath + '.js';
    if (importPath.startsWith('.')) {
      const dir = this._dirOf(fromFile);
      let resolved = dir + importPath.replace(/^\.\//,  '');
      const parts = resolved.split('/');
      const normalized = [];
      for (const part of parts) {
        if (part === '..') normalized.pop();
        else if (part !== '.') normalized.push(part);
      }
      resolved = normalized.join('/');
      if (knownFiles.has(resolved)) return resolved;
      if (knownFiles.has(resolved + '.js')) return resolved + '.js';
      if (knownFiles.has(resolved + '/index.js')) return resolved + '/index.js';
    }
    return null;
  }

  _classifyFile(file, classFiles) {
    const name = file.split('/').pop().toLowerCase();
    const ext = name.split('.').pop();
    if (classFiles.has(file)) return 'action';  // has classes/exports → action (coral)
    if (ext === 'css' || ext === 'scss') return 'config';       // amber
    if (ext === 'html' || ext === 'tpl') return 'output';       // emerald
    if (ext === 'json' || ext === 'yaml' || ext === 'yml' || ext === 'env') return 'data'; // blue
    if (ext === 'md' || ext === 'txt' || ext === 'svg' || ext === 'png') return 'data';
    if (name.includes('test') || name.includes('spec')) return 'external'; // purple
    if (name === 'index.js' || name === 'index.mjs') return 'output';      // emerald — entry points
    if (ext === 'js' || ext === 'ts' || ext === 'mjs' || ext === 'py') return 'action'; // coral
    return 'data'; // blue default
  }

  // ─── SKELETON PARSER ───
  setSkeleton(skeleton) {
    this._skeleton = skeleton;
    this.graphDB = { nodes: new Map(), edges: [], rootNodes: [] };
    const N = skeleton.n || {};
    const X = skeleton.X || {};
    const I = skeleton.I || {};
    const L = skeleton.L || {};

    // 1. Collect all known files
    const allFiles = new Set();
    const classFiles = new Set(); // files that have classes/exports
    for (const data of Object.values(N)) {
      if (data.f) { allFiles.add(data.f); classFiles.add(data.f); }
    }
    for (const file of Object.keys(X)) allFiles.add(file);
    // skeleton.f = { "dirPath/": ["file1.js", ...] }
    for (const [dir, names] of Object.entries(skeleton.f || {})) {
      for (const name of names) allFiles.add(dir === './' ? name : dir + name);
    }
    // skeleton.a = asset files (non-source)
    for (const [dir, names] of Object.entries(skeleton.a || {})) {
      for (const name of names) allFiles.add(dir === './' ? name : dir + name);
    }

    // 2. Build directory hierarchy from file paths
    const dirs = new Set();
    for (const file of allFiles) {
      const parts = file.split('/');
      for (let i = 1; i < parts.length; i++) {
        dirs.add(parts.slice(0, i).join('/'));
      }
    }
    // Create directory group nodes
    for (const dir of [...dirs].sort()) {
      const parentDir = dir.includes('/') ? dir.substring(0, dir.lastIndexOf('/')) : null;
      const label = dir.split('/').pop();
      const node = { id: dir, label, w: 160, h: 40, type: 'group', isGroup: true, parentId: parentDir, children: [] };
      this.graphDB.nodes.set(dir, node);
      if (!parentDir || !dirs.has(parentDir)) {
        this.graphDB.rootNodes.push(dir);
      }
    }
    // Link child directories to parents
    for (const node of this.graphDB.nodes.values()) {
      if (node.parentId && this.graphDB.nodes.has(node.parentId)) {
        this.graphDB.nodes.get(node.parentId).children.push(node.id);
      }
    }

    // 3. Create file nodes
    for (const file of allFiles) {
      const parentId = this._dirOf(file).replace(/\/$/, '') || null;
      const actualParent = parentId && this.graphDB.nodes.has(parentId) ? parentId : null;
      const type = this._classifyFile(file, classFiles);
      const label = file.split('/').pop();
      const node = { id: file, label, w: 160, h: 40, type, isGroup: false, parentId: actualParent, children: [] };
      this.graphDB.nodes.set(file, node);
      if (actualParent) {
        this.graphDB.nodes.get(actualParent).children.push(file);
      } else {
        this.graphDB.rootNodes.push(file);
      }
    }

    // 4. Extract edges from skeleton.I (import sources)
    const edgeList = [];
    const edgeSet = new Set();
    for (const [srcFile, imports] of Object.entries(I)) {
      if (!allFiles.has(srcFile)) continue;
      for (const impPath of imports) {
        // Skip bare module imports (node_modules)
        if (!impPath.startsWith('.') && !impPath.startsWith('/')) continue;
        const targetFile = this._resolveImport(impPath, srcFile, allFiles);
        if (!targetFile || targetFile === srcFile) continue;
        const key = srcFile + '>' + targetFile;
        if (edgeSet.has(key)) continue;
        edgeSet.add(key);
        edgeList.push({ from: srcFile, to: targetFile });
      }
    }
    this.graphDB.edges = edgeList;

    // Center viewport BEFORE worker starts — prevents nodes flashing at top-left
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width > 0) {
      this.panX = rect.width / 2;
      this.panY = rect.height / 2;
    }

    this.loadLevel(null);
  }

  // ... (Other test-force-sim logic converted to class methods with `this.`)
  rebuildNodeMap() { this.nodeMap = new Map(this.nodes.map(n => [n.id, n])); }
  
  rebuildAdjMap() {
    this.adjMap.clear();
    for (const n of this.nodes) this.adjMap.set(n.id, new Set());
    for (const e of this.edges) {
      if (this.adjMap.has(e.from)) this.adjMap.get(e.from).add(e.to);
      if (this.adjMap.has(e.to)) this.adjMap.get(e.to).add(e.from);
    }
  }

  updateInteractionDepths() {
    this.interactionDepths.clear();
    const activeGroupId = this.currentGroupId;
    const focusNode = this.activeNode || this.dragNode;
    
    // Establish baseline target depths for all nodes
    for (const node of this.nodes) {
      if (activeGroupId) {
        if (node.parentId === activeGroupId) node.targetDepth = focusNode ? 3 : 0;
        else if (node.id === activeGroupId) node.targetDepth = 4; // Hide the container group itself
        else node.targetDepth = 4; // Other nodes hidden when inside a group
      } else {
        node.targetDepth = focusNode ? 3 : 0; // Dim to 3 if focused, 0 otherwise
      }
    }
    
    for (const edge of this.edges) { edge.targetDepth = 4; edge.minTargetDepth = 4; }
    
    if (!focusNode) {
      for (const edge of this.edges) {
        const d1 = this.nodeMap.get(edge.from)?.targetDepth ?? 4;
        const d2 = this.nodeMap.get(edge.to)?.targetDepth ?? 4;
        edge.targetDepth = Math.max(d1, d2);
        edge.minTargetDepth = Math.min(d1, d2);
      }
      return;
    }
    
    // BFS from focusNode
    const queue = [[focusNode.id, 0]];
    const visited = new Set([focusNode.id]);
    this.interactionDepths.set(focusNode.id, 0);

    while (queue.length > 0) {
      const [curr, depth] = queue.shift();
      const currNode = this.nodeMap.get(curr);
      if (currNode) currNode.targetDepth = depth;
      
      if (depth >= 3) continue;
      const neighbors = this.adjMap.get(curr) || new Set();
      for (const n of neighbors) {
        if (!visited.has(n)) {
          visited.add(n);
          this.interactionDepths.set(n, depth + 1);
          queue.push([n, depth + 1]);
        }
      }
    }
    
    for (const edge of this.edges) {
      const d1 = this.interactionDepths.has(edge.from) ? this.interactionDepths.get(edge.from) : 4;
      const d2 = this.interactionDepths.has(edge.to) ? this.interactionDepths.get(edge.to) : 4;
      edge.targetDepth = Math.max(d1, d2);
      edge.minTargetDepth = Math.min(d1, d2);
    }
  }

  loadLevel(groupId = null) {
    this._wakeLoop();  // View changed — resume rendering
    this.activeNode = null;
    this.dragNode = null;
    this.hoverNode = null;
    this.menuAnim = 0;
    this.deactivating = false;
    
    for (const node of this.graphDB.nodes.values()) {
      if (node.isGroup) {
        node.w = DOT_RADIUS * 3;
        node.h = DOT_RADIUS * 3;
      }
    }

    let activeIds = [...this.graphDB.rootNodes];
    
    if (!groupId) {
      this.currentGroupId = null;
      if (this.ref.breadcrumb) this.ref.breadcrumb.setPath([]);
    } else {
      const group = this.graphDB.nodes.get(groupId);
      if (group) {
        this.currentGroupId = groupId;
        if (!activeIds.includes(groupId)) activeIds.push(groupId);
        activeIds.push(...group.children);
        
        const childR = DOT_RADIUS * 1.5;
        const dynamicSize = Math.sqrt(group.children.length) * childR * 3 + childR * 4;
        group.w = dynamicSize;
        group.h = dynamicSize;

        // Render existing symbiote-node breadcrumbs
        if (this.ref.breadcrumb) {
          const parts = groupId.split('/');
          const pathArr = [{ label: 'Root', level: '' }];
          let acc = '';
          for (let i = 0; i < parts.length; i++) {
            if (!parts[i]) continue;
            acc += (acc ? '/' : '') + parts[i];
            pathArr.push({ label: parts[i], level: acc });
          }
          this.ref.breadcrumb.setPath(pathArr);
        }

      } else {
        // Fallback to root if group not found
        this.currentGroupId = null;
        if (this.ref.breadcrumb) this.ref.breadcrumb.setPath([]);
      }
    }
    
    this.nodes = activeIds.map(id => this.graphDB.nodes.get(id)).filter(Boolean);
    
    for (const n of this.nodes) {
      if (n.parentId && n.parentId === groupId) {
        n.w = this.renderMode === 'dots' ? DOT_RADIUS * 1.5 : 160 * 0.6;
        n.h = this.renderMode === 'dots' ? DOT_RADIUS * 1.5 : 40 * 0.6;
      }
    }
    
    const activeSet = new Set(activeIds);
    this.edges = this.graphDB.edges.filter(e => activeSet.has(e.from) || activeSet.has(e.to));
    
    this.rebuildNodeMap();
    this.rebuildAdjMap();
    this.updateInteractionDepths();
    
    const options = {
      chargeStrength: this.$.chargeStrength,
      linkDistance: this.$.linkDistance,
      linkStrength: this.$.linkStrength,
      centerStrength: this.$.centerStrength,
      velocityDecay: this.$.velocityDecay,
      collideStrength: this.$.collideStrength,
      alphaDecay: this.$.alphaDecay,
      theta: this.$.theta,
      nodeWidth: this.renderMode === 'dots' ? DOT_RADIUS * 2 : 160,
      nodeHeight: this.renderMode === 'dots' ? DOT_RADIUS * 2 : 40,
      mode: 'continuous',
      activeGroupId: groupId,
      boundaryRadius: groupId ? this.graphDB.nodes.get(groupId).w / 2 : null,
      attractors: null,
    };
    
    this.startWorker(options);
    
    this.dispatchEvent(new CustomEvent('path-changed', { detail: { path: this.currentGroupId || '' } }));
  }

  startWorker(customOptions = null) {
    if (this.worker) this.worker.terminate();
    const workerUrl = new URL('../../vendor/symbiote-node/canvas/ForceWorker.js', location.href).href;
    this.worker = new Worker(workerUrl);

    this.worker.onmessage = (e) => {
      const { type } = e.data;
      if (type === 'nodeIds') this.nodeIds = e.data.ids;
      if (type === 'tick') {
        const draggedId = this.dragNode ? this.dragNode.id : null;
        if (e.data.packed) {
          const buf = new Float32Array(e.data.packed);
          for (let i = 0; i < this.nodeIds.length; i++) {
            const id = this.nodeIds[i];
            if (id === draggedId) continue;
            const pos = this.nodePositions.get(id);
            if (pos) { pos.x = buf[i * 2]; pos.y = buf[i * 2 + 1]; }
            else this.nodePositions.set(id, { x: buf[i * 2], y: buf[i * 2 + 1] });
          }
        } else if (e.data.positions) {
          for (const [id, p] of Object.entries(e.data.positions)) {
            if (id === draggedId) continue;
            const pos = this.nodePositions.get(id);
            if (pos) { pos.x = p.x; pos.y = p.y; }
            else this.nodePositions.set(id, p);
          }
        }
        this.lastAlpha = e.data.alpha || 0;
        this.tickCount++;
        this.frameCount++;
        this._wakeLoop();  // Worker sent new positions — resume rendering
        this.dispatchEvent(new CustomEvent('layout-tick', { detail: { alpha: this.lastAlpha } }));
      }
      if (type === 'done' && e.data.positions) {
        for (const [id, pos] of Object.entries(e.data.positions)) this.nodePositions.set(id, pos);
        this.dispatchEvent(new CustomEvent('layout-done'));
      }
    };

    const options = customOptions || {
      chargeStrength: this.$.chargeStrength,
      linkDistance: this.$.linkDistance,
      linkStrength: this.$.linkStrength,
      centerStrength: this.$.centerStrength,
      velocityDecay: this.$.velocityDecay,
      collideStrength: this.$.collideStrength,
      alphaDecay: this.$.alphaDecay,
      theta: this.$.theta,
      wellStrength: this.$.wellStrength,
      centerPull: this.$.centerPull,
      wellRepulsion: this.$.wellRepulsion,
      crossLinkScale: this.$.crossLinkScale,
      nodeWidth: this.renderMode === 'dots' ? DOT_RADIUS * 2 : 160,
      nodeHeight: this.renderMode === 'dots' ? DOT_RADIUS * 2 : 40,
      mode: 'continuous',
    };

    this.worker.postMessage({
      type: 'init',
      nodes: this.nodes.map(n => {
        const pos = this.smoothPositions.get(n.id);
        let finalW = n.w, finalH = n.h;
        if (this.renderMode === 'dots') {
          const conns = this.adjMap.get(n.id)?.size || 0;
          const hubScale = 1 + Math.min(conns, 8) * 0.1;
          let r = DOT_RADIUS * hubScale;
          if (n.isGroup) r *= 1.5;
          finalW = finalH = r * 2;
        }
        return {
          id: n.id, type: n.type, parentId: n.parentId, isGroup: !!n.isGroup,
          children: n.children || [], x: pos?.x, y: pos?.y, w: finalW, h: finalH,
        };
      }),
      edges: this.edges.filter(e => this.nodeMap.has(e.from) && this.nodeMap.has(e.to)),
      groups: {}, options
    });

    this.worker.postMessage({ type: 'updateConfig', config: {
      contAlphaFloor: this.$.alphaFloor, contAlphaTarget: this.$.alphaTarget,
      brownian: this.$.brownian, brownianThresh: this.$.brownianThresh,
      pinReheat: this.$.pinReheat, pinCap: this.$.pinCap,
    }});

    this.smoothPositions.clear();
    this.paused = false;
  }

  getSmooth(id) { return this.smoothPositions.get(id) || this.nodePositions.get(id); }
  
  nodeCenter(id) {
    const pos = this.getSmooth(id);
    if (!pos) return null;
    if (this.renderMode === 'dots') return { x: pos.x, y: pos.y };
    const node = this.nodeMap.get(id);
    if (!node) return { x: pos.x, y: pos.y };
    return { x: pos.x + node.w / 2, y: pos.y + node.h / 2 };
  }

  resizeOffscreenCanvases() {
    const dpr = window.devicePixelRatio || 1;
    for (let i = 1; i <= 4; i++) {
      const oc = this.offscreenCanvases[i].canvas;
      if (oc.width !== this.canvas.width || oc.height !== this.canvas.height) {
        oc.width = this.canvas.width;
        oc.height = this.canvas.height;
      }
    }
  }

  blendBg(r, g, b, alpha) {
    const br = this._bgR, bg = this._bgG, bb = this._bgB;
    const rr = (r * alpha + br * (1 - alpha)) | 0;
    const gg = (g * alpha + bg * (1 - alpha)) | 0;
    const bbb = (b * alpha + bb * (1 - alpha)) | 0;
    return `rgb(${rr},${gg},${bbb})`;
  }

  draw() {
    if (!this.canvas) return;
    const dpr = window.devicePixelRatio || 1;
    
    // Smooth zoom interpolation
    const zoomAnimating = Math.abs(this._targetZoom - this.zoom) > 0.0001;
    if (zoomAnimating) {
      const oldZoom = this.zoom;
      this.zoom += (this._targetZoom - this.zoom) * 0.15;
      // Keep anchor point stable during wheel zoom
      if (this._zoomAnchor) {
        const { mx, my } = this._zoomAnchor;
        this.panX = mx - (mx - this.panX) * (this.zoom / oldZoom);
        this.panY = my - (my - this.panY) * (this.zoom / oldZoom);
      }
    }
    
    // Smooth pan interpolation (for fitView / flyToNode animations)
    if (this._targetPanX !== null) {
      const panDx = this._targetPanX - this.panX;
      const panDy = this._targetPanY - this.panY;
      if (Math.abs(panDx) < 0.5 && Math.abs(panDy) < 0.5) {
        this.panX = this._targetPanX;
        this.panY = this._targetPanY;
        this._targetPanX = null;
        this._targetPanY = null;
      } else {
        this.panX += panDx * 0.15;
        this.panY += panDy * 0.15;
      }
    }
    
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    
    this.resizeOffscreenCanvases();
    const mainCtx = this.ctx;
    const isIdle = (!this.activeNode && !this.currentGroupId) || this.deactivating;

    if (this.deactivating && this.activeNode) {
      const settled = Math.abs(this.layerAnim[0].scale - 1) < 0.01 && Math.abs(this.layerAnim[4].scale - 1) < 0.01;
      if (settled) {
        if (this.nextActiveNode) {
          this.activeNode = this.nextActiveNode;
          this.nextActiveNode = null;
        } else {
          this.activeNode = null;
          this.dispatchEvent(new CustomEvent('node-deselected'));
        }
        this.deactivating = false;
        this.updateInteractionDepths();
      }
    }

    const inGroupMode = !!this.currentGroupId;
    const lerpSpeed = isIdle ? 0.08 : 0.06;
    for (let d = 0; d <= 4; d++) {
      const la = this.layerAnim[d];
      const tScale    = isIdle ? 1 : this.LAYER_TARGETS.scale[d];
      const tOpacity  = isIdle ? 1 : this.LAYER_TARGETS.opacity[d];
      const tParallax = isIdle ? 0 : this.LAYER_TARGETS.parallax[d];
      
      const speed = (inGroupMode && d >= 3) ? 0.3 : lerpSpeed;
      la.scale    += (tScale    - la.scale)    * speed;
      la.opacity  += (tOpacity  - la.opacity)  * speed;
      la.parallax += (tParallax - la.parallax) * speed;
    }

    const vcx = this.canvas.width / 2;
    const vcy = this.canvas.height / 2;
    let dragDeltaX = 0, dragDeltaY = 0;
    
    if (this.activeNode && !this.deactivating) {
      const dp = this.nodePositions.get(this.activeNode.id);
      if (dp) {
        // Center the combined node+panel area — only once per node activation
        if (this._infoPanel._centeredForNode !== this.activeNode.id && this._infoPanel.totalExtent > 0) {
          this._infoPanel._centeredForNode = this.activeNode.id;
          const panelOffsetX = this._infoPanel.totalExtent / 2;
          const panelOffsetY = this._infoPanel.totalExtentY / 2;
          const rect = this.canvas.getBoundingClientRect();
          if (rect.width > 0) {
            this._targetPanX = rect.width / 2 - (dp.x + panelOffsetX) * this.zoom;
            this._targetPanY = rect.height / 2 - (dp.y + panelOffsetY) * this.zoom;
          }
        }

        const targetFX = dpr * this.zoom * dp.x + dpr * this.panX;
        const targetFY = dpr * this.zoom * dp.y + dpr * this.panY;
        if (!this.focusActive) {
          this.focusX = targetFX;
          this.focusY = targetFY;
          this.focusActive = true;
        } else {
          this.focusX += (targetFX - this.focusX) * 0.12;
          this.focusY += (targetFY - this.focusY) * 0.12;
        }
        dragDeltaX = this.focusX - vcx;
        dragDeltaY = this.focusY - vcy;
      }
    } else {
      this.focusX += (vcx - this.focusX) * 0.08;
      this.focusY += (vcy - this.focusY) * 0.08;
      dragDeltaX = this.focusX - vcx;
      dragDeltaY = this.focusY - vcy;
      if (Math.abs(dragDeltaX) < 1 && Math.abs(dragDeltaY) < 1) {
        this.focusActive = false;
        dragDeltaX = 0;
        dragDeltaY = 0;
      }
    }

    for (let i = 1; i <= 4; i++) {
      const octx = this.offscreenCanvases[i].ctx;
      const la = this.layerAnim[i];
      const s = la.scale;
      const pOffX = -la.parallax * dragDeltaX;
      const pOffY = -la.parallax * dragDeltaY;
      
      octx.setTransform(1, 0, 0, 1, 0, 0);
      octx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      octx.setTransform(s * dpr * this.zoom, 0, 0, s * dpr * this.zoom,
                        s * dpr * this.panX + vcx * (1 - s) + pOffX,
                        s * dpr * this.panY + vcy * (1 - s) + pOffY);
    }

    const t = 1 - this.smoothing;
    for (const [id, raw] of this.nodePositions) {
      const prev = this.smoothPositions.get(id);
      if (!prev) {
        this.smoothPositions.set(id, { x: raw.x, y: raw.y });
      } else {
        if (this.dragNode && this.dragNode.id === id) {
          prev.x = raw.x; prev.y = raw.y;
        } else {
          prev.x += (raw.x - prev.x) * t;
          prev.y += (raw.y - prev.y) * t;
        }
      }
    }

    for (let i = 0; i <= 4; i++) {
      this.depthGroups[i].edges.length = 0;
      this.depthGroups[i].nodes.length = 0;
    }

    for (const edge of this.edges) {
      this.depthGroups[edge.targetDepth !== undefined ? edge.targetDepth : 4].edges.push(edge);
    }

    const focusNodes = [];
    for (const node of this.nodes) {
      if (node === this.activeNode || node === this.dragNode || node === this.hoverNode) {
        focusNodes.push(node);
      } else {
        this.depthGroups[node.targetDepth !== undefined ? node.targetDepth : 4].nodes.push(node);
      }
    }
    for (const node of focusNodes) {
      this.depthGroups[node.targetDepth !== undefined ? node.targetDepth : 4].nodes.push(node);
    }

    const getLayerTransform = (d) => {
      const s = this.layerAnim[d].scale;
      if (d > 0) {
        const pOffX = -this.layerAnim[d].parallax * dragDeltaX;
        const pOffY = -this.layerAnim[d].parallax * dragDeltaY;
        return { A: s * dpr * this.zoom, E: s * dpr * this.panX + vcx * (1 - s) + pOffX, F: s * dpr * this.panY + vcy * (1 - s) + pOffY };
      } else {
        if (this.focusActive && Math.abs(s - 1) > 0.001) {
          return { A: s * dpr * this.zoom, E: this.focusX * (1 - s) + s * dpr * this.panX, F: this.focusY * (1 - s) + s * dpr * this.panY };
        } else {
          return { A: dpr * this.zoom, E: dpr * this.panX, F: dpr * this.panY };
        }
      }
    };

    const drawDepth = (d, currentCtx) => {
      const la = this.layerAnim[d];
      const layerOpacity = la.opacity;
      const isGhost = inGroupMode && d >= 3;
      const GHOST_COLOR = this._ghostColor;
      const tCurrent = getLayerTransform(d);
      
      const mapPosToEdgeLayer = (pos, nodeDepth) => {
        if (!pos || nodeDepth === d) return pos;
        const tNode = getLayerTransform(nodeDepth);
        const screenX = tNode.A * pos.x + tNode.E;
        const screenY = tNode.A * pos.y + tNode.F;
        return { x: (screenX - tCurrent.E) / tCurrent.A, y: (screenY - tCurrent.F) / tCurrent.A };
      };

      currentCtx.strokeStyle = 'rgba(74, 158, 255, 0.25)';
      currentCtx.lineWidth = 1.5;

      // Edges
      for (const edge of this.depthGroups[d].edges) {
        let from = this.nodeCenter(edge.from);
        let to = this.nodeCenter(edge.to);
        
        if ((!from || !to) && this.currentGroupId) {
          const activeId = this.currentGroupId;
          const activePos = this.smoothPositions.get(activeId);
          const activeNode = this.graphDB.nodes.get(activeId);
          if (activePos && activeNode) {
            const radius = activeNode.w / 2;
            if (!from && to) {
              const angle = parseInt(edge.from.slice(-1), 16) || 0;
              from = { x: activePos.x + Math.cos(angle) * radius, y: activePos.y + Math.sin(angle) * radius };
            } else if (from && !to) {
              const angle = parseInt(edge.to.slice(-1), 16) || 0;
              to = { x: activePos.x + Math.cos(angle) * radius, y: activePos.y + Math.sin(angle) * radius };
            }
          }
        }
        
        if (!from || !to) continue;
        
        let tAlpha = 0.5, tWidth = 1.5;
        if (this.dragNode) {
          const minD = edge.minTargetDepth;
          if (minD === 0) { tAlpha = 1; tWidth = 3.0; }
          else if (minD === 1) { tAlpha = 0.8; tWidth = 2.0; }
          else if (minD === 2) { tAlpha = 0.4; tWidth = 1.5; }
          else { tAlpha = 0.05; tWidth = 1.0; }
        }
        
        const edgeOpacity = tAlpha * layerOpacity;
        edge.aAlpha = edge.aAlpha !== undefined ? edge.aAlpha : 0.5;
        edge.aWidth = edge.aWidth || 1.5;
        edge.aAlpha += (edgeOpacity - edge.aAlpha) * 0.1;
        edge.aWidth += (tWidth - edge.aWidth) * 0.1;
        
        const nodeFrom = this.nodeMap ? this.nodeMap.get(edge.from) : null;
        const nodeTo = this.nodeMap ? this.nodeMap.get(edge.to) : null;
        const fromDepth = nodeFrom?.targetDepth ?? 4;
        const toDepth = nodeTo?.targetDepth ?? 4;

        from = mapPosToEdgeLayer(from, fromDepth);
        to = mapPosToEdgeLayer(to, toDepth);
        
        const zoomFactor = this.zoom * (this.layerAnim[d]?.scale || 1);
        const wFrom = (edge.aWidth * 2.0) / zoomFactor, wTo = wFrom;
        const dx = to.x - from.x, dy = to.y - from.y;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len < 0.1) continue;
        
        const nx = -dy / len, ny = dx / len;
        
        let fillStyle;
        if (isGhost) {
          fillStyle = GHOST_COLOR;
        } else if (this.dragNode || this.activeNode) {
          const fromOpacity = this.layerAnim[fromDepth].opacity;
          const toOpacity = this.layerAnim[toDepth].opacity;
          const fromTC = TYPE_COLORS[nodeFrom?.type] || TYPE_COLORS.data;
          const toTC = TYPE_COLORS[nodeTo?.type] || TYPE_COLORS.data;
          const grad = currentCtx.createLinearGradient(from.x, from.y, to.x, to.y);
          grad.addColorStop(0, this.blendBg(fromTC[0], fromTC[1], fromTC[2], fromOpacity * 0.7));
          grad.addColorStop(1, this.blendBg(toTC[0], toTC[1], toTC[2], toOpacity * 0.7));
          fillStyle = grad;
        } else {
          const fromTC = TYPE_COLORS[nodeFrom?.type] || TYPE_COLORS.data;
          fillStyle = this.blendBg(fromTC[0], fromTC[1], fromTC[2], 0.35);
        }
        
        currentCtx.fillStyle = fillStyle;
        currentCtx.beginPath();
        const midX = from.x + dx * 0.5, midY = from.y + dy * 0.5;
        const pinchRatio = Math.max(0.001, Math.pow(20 / Math.max(20, len), 2.8));
        const pinchW = Math.min(wFrom, wTo) * pinchRatio;
        const ang = Math.atan2(dy, dx);

        currentCtx.moveTo(from.x + nx * wFrom, from.y + ny * wFrom);
        currentCtx.quadraticCurveTo(midX + nx * pinchW, midY + ny * pinchW, to.x + nx * wTo, to.y + ny * wTo);
        currentCtx.arc(to.x, to.y, wTo, ang + Math.PI/2, ang - Math.PI/2, true);
        currentCtx.quadraticCurveTo(midX - nx * pinchW, midY - ny * pinchW, from.x - nx * wFrom, from.y - ny * wFrom);
        currentCtx.arc(from.x, from.y, wFrom, ang - Math.PI/2, ang - Math.PI * 1.5, true);
        currentCtx.closePath();
        currentCtx.fill();
      }

      // Nodes
      for (const node of this.depthGroups[d].nodes) {
        if (this.currentGroupId && node.id === this.currentGroupId) continue;
        const pos = this.getSmooth(node.id);
        if (!pos) continue;
        const isActive = this.activeNode && this.activeNode.id === node.id;
        const tc = TYPE_COLORS[node.type] || TYPE_COLORS.data;
        const conns = this.adjMap.get(node.id)?.size || 0;
        const hubScale = 1 + Math.min(conns, 8) * 0.1;
        
        const targetScale = isActive ? 1.5 : 1;
        node.aScale = node.aScale !== undefined ? node.aScale : 1;
        node.aScale += (targetScale - node.aScale) * 0.12;
        
        node.aGlow = node.aGlow !== undefined ? node.aGlow : 0;
        node.aGlow += ((isActive ? 1 : 0) - node.aGlow) * 0.1;
        
        if (this.renderMode === 'dots') {
          let r = DOT_RADIUS * hubScale * node.aScale;
          if (node.isGroup) r *= 1.5;
          
          if (isGhost) {
            currentCtx.beginPath();
            currentCtx.arc(pos.x, pos.y, r * 0.7, 0, Math.PI * 2);
            currentCtx.fillStyle = GHOST_COLOR;
            currentCtx.fill();
          } else if (node.isGroup) {
            const ringW = r * 0.25;
            currentCtx.beginPath();
            currentCtx.arc(pos.x, pos.y, r, 0, Math.PI * 2);
            currentCtx.fillStyle = `rgba(${this._bgR}, ${this._bgG}, ${this._bgB}, ${layerOpacity})`;
            currentCtx.fill();
            
            currentCtx.beginPath();
            currentCtx.arc(pos.x, pos.y, r, 0, Math.PI * 2);
            currentCtx.arc(pos.x, pos.y, r - ringW, 0, Math.PI * 2, true);
            currentCtx.fillStyle = this.blendBg(tc[0], tc[1], tc[2], layerOpacity);
            currentCtx.fill();
            
            const innerR = r * 0.18, orbitR = r * 0.42;
            const isHovered = this.hoverNode && this.hoverNode.id === node.id;
            node.aRotSpeed = node.aRotSpeed || 0;
            const targetRotSpeed = (isActive || isHovered) ? 0.025 : 0;
            node.aRotSpeed += (targetRotSpeed - node.aRotSpeed) * 0.05;
            node.aRot = (node.aRot || 0) + node.aRotSpeed;

            for (let k = 0; k < 3; k++) {
              const angle = (k * Math.PI * 2 / 3) - Math.PI / 2 + node.aRot;
              const cx = pos.x + Math.cos(angle) * orbitR;
              const cy = pos.y + Math.sin(angle) * orbitR;
              currentCtx.beginPath();
              currentCtx.arc(cx, cy, innerR, 0, Math.PI * 2);
              currentCtx.fillStyle = this.blendBg(tc[0], tc[1], tc[2], layerOpacity * 0.7);
              currentCtx.fill();
            }
            if (node.aGlow > 0.01) {
              currentCtx.strokeStyle = `rgba(${tc[0]},${tc[1]},${tc[2]},${layerOpacity * 0.6 * node.aGlow})`;
              currentCtx.lineWidth = 2 * node.aGlow;
              currentCtx.beginPath();
              currentCtx.arc(pos.x, pos.y, r + 4 * node.aGlow, 0, Math.PI * 2);
              currentCtx.stroke();
            }
          } else {
            currentCtx.beginPath();
            currentCtx.arc(pos.x, pos.y, r, 0, Math.PI * 2);
            currentCtx.fillStyle = this.blendBg(tc[0], tc[1], tc[2], layerOpacity);
            currentCtx.fill();
            if (node.aGlow > 0.01) {
              currentCtx.strokeStyle = `rgba(${tc[0]},${tc[1]},${tc[2]},${layerOpacity * 0.6 * node.aGlow})`;
              currentCtx.lineWidth = 2 * node.aGlow;
              currentCtx.beginPath();
              currentCtx.arc(pos.x, pos.y, r + 4 * node.aGlow, 0, Math.PI * 2);
              currentCtx.stroke();
            }
          }
        }
      }
    };

    for (let d = 4; d >= 1; d--) drawDepth(d, this.offscreenCanvases[d].ctx);
    
    mainCtx.setTransform(1, 0, 0, 1, 0, 0);
    for (let d = 4; d >= 1; d--) {
      const blurPx = this.LAYER_TARGETS.blur[d];
      const blurIntensity = Math.abs(1 - this.layerAnim[d].scale) * blurPx * 8;
      mainCtx.filter = blurIntensity > 0.3 ? `blur(${blurIntensity.toFixed(1)}px)` : 'none';
      mainCtx.drawImage(this.offscreenCanvases[d].canvas, 0, 0);
    }
    mainCtx.filter = 'none';

    {
      const s = this.layerAnim[0].scale;
      if (this.focusActive && Math.abs(s - 1) > 0.001) {
        mainCtx.setTransform(s * dpr * this.zoom, 0, 0, s * dpr * this.zoom, this.focusX * (1 - s) + s * dpr * this.panX, this.focusY * (1 - s) + s * dpr * this.panY);
      } else {
        mainCtx.setTransform(dpr * this.zoom, 0, 0, dpr * this.zoom, dpr * this.panX, dpr * this.panY);
      }
      drawDepth(0, mainCtx);
    }

    const showMenu = this.activeNode && !this.dragNode && !this.deactivating;
    if (showMenu) {
      this.menuAnim = Math.min(1, this.menuAnim + 0.08);
    } else {
      this.menuAnim = Math.max(0, this.menuAnim - 0.15);
    }

    if (this.menuAnim > 0.01 && this.activeNode) {
      const apos = this.getSmooth(this.activeNode.id);
      if (apos) {
        const conns = this.adjMap.get(this.activeNode.id)?.size || 0;
        const hubScale = 1 + Math.min(conns, 8) * 0.1;
        let nodeR = DOT_RADIUS * hubScale * (this.activeNode.aScale || 1.5);
        if (this.activeNode.isGroup) nodeR *= 1.5;
        const menuDist = nodeR + 14;
        const itemR = 6;
        
        const easeOut = 1 - Math.pow(1 - this.menuAnim, 3);
        const mr = menuDist * easeOut;
        const ir = itemR * Math.max(0, easeOut);
        
        const s = this.layerAnim[0].scale;
        if (this.focusActive && Math.abs(s - 1) > 0.001) {
          mainCtx.setTransform(s * dpr * this.zoom, 0, 0, s * dpr * this.zoom, this.focusX * (1 - s) + s * dpr * this.panX, this.focusY * (1 - s) + s * dpr * this.panY);
        } else {
          mainCtx.setTransform(dpr * this.zoom, 0, 0, dpr * this.zoom, dpr * this.panX, dpr * this.panY);
        }
        
        const tc = TYPE_COLORS[this.activeNode.type] || TYPE_COLORS.data;
        for (let i = 0; i < MENU_ITEMS.length; i++) {
          const item = MENU_ITEMS[i];
          const angle = (i / MENU_ITEMS.length) * Math.PI * 2 - Math.PI / 2;
          const ix = apos.x + Math.cos(angle) * mr;
          const iy = apos.y + Math.sin(angle) * mr;
          
          mainCtx.beginPath();
          mainCtx.arc(ix, iy, ir, 0, Math.PI * 2);
          mainCtx.fillStyle = item.danger ? `rgba(60, 20, 20, ${0.9 * easeOut})` : `rgba(${tc[0]}, ${tc[1]}, ${tc[2]}, ${0.9 * easeOut})`;
          mainCtx.fill();
          
          mainCtx.save();
          const iconScale = (ir * 1.2) / 24;
          if (iconScale > 0) {
            mainCtx.translate(ix - 12 * iconScale, iy - 12 * iconScale);
            mainCtx.scale(iconScale, iconScale);
            const p = new Path2D(item.path);
            mainCtx.fillStyle = item.danger ? `rgba(255, 107, 107, ${easeOut})` : `rgba(${this._bgR}, ${this._bgG}, ${this._bgB}, ${easeOut})`;
            mainCtx.fill(p);
          }
          mainCtx.restore();
        }
      }
    }

    // Info panel — typewriter HUD to the right of active node
    this._drawInfoPanel(mainCtx, dpr, dragDeltaX, dragDeltaY, vcx, vcy);

    // Idle detection: stop the loop when nothing is animating
    const zoomSettled = Math.abs(this._targetZoom - this.zoom) < 0.001;
    // Track focus movement rate (delta-of-delta), not absolute offset
    const prevDX = this._prevDragDeltaX || 0;
    const prevDY = this._prevDragDeltaY || 0;
    const focusMovement = Math.abs(dragDeltaX - prevDX) + Math.abs(dragDeltaY - prevDY);
    this._prevDragDeltaX = dragDeltaX;
    this._prevDragDeltaY = dragDeltaY;
    const focusSettled = focusMovement < 0.1;
    const layerSettled = this.layerAnim[0] && Math.abs(this.layerAnim[0].scale - (isIdle ? 1 : this.LAYER_TARGETS.scale[0])) < 0.005;
    const workerActive = this.lastAlpha > 0.001;
    const hasDrag = !!this.dragNode || this.isPanning;
    const hasActiveAnim = this.deactivating;
    const hasPanAnim = this._targetPanX !== null;

    const infoPanelAnimating = this._infoPanel.opacity > 0.01 && (this._infoPanel.opacity < 0.99 || this._infoPanel.lines.some(l => l.revealed < l.text.length));
    if (zoomSettled && focusSettled && layerSettled && !workerActive && !hasDrag && !hasActiveAnim && !hasPanAnim && !infoPanelAnimating) {
      this._idleFrames++;
    } else {
      this._idleFrames = 0;
    }

    // Allow 3 extra frames after convergence to flush final sub-pixel lerps
    if (this._idleFrames > 3) {
      this._loopRunning = false;
      return;
    }

    this._animationFrame = requestAnimationFrame(() => this.draw());
  }

  /**
   * Build metadata lines for the info panel from skeleton + node data
   * @param {object} node - graph node
   * @returns {string[]}
   */
  _buildInfoLines(node) {
    const lines = [];
    lines.push(node.label);
    if (node.id !== node.label) lines.push(node.id);
    lines.push('');

    const typeLabels = { data: 'Data', action: 'Action', output: 'Output', config: 'Config', external: 'External', group: 'Directory' };
    lines.push(`Type: ${typeLabels[node.type] || node.type}`);

    const conns = this.adjMap.get(node.id)?.size || 0;
    if (conns > 0) lines.push(`Connections: ${conns}`);

    if (node.children?.length > 0) {
      lines.push(`Children: ${node.children.length}`);
    }

    if (this._skeleton) {
      const X = this._skeleton.X || {};
      const exports = X[node.id];
      if (exports && exports.length > 0) {
        lines.push('');
        lines.push('Exports:');
        for (const exp of exports.slice(0, 8)) {
          lines.push(`  ${exp}`);
        }
        if (exports.length > 8) lines.push(`  ... +${exports.length - 8}`);
      }

      const L = this._skeleton.L || {};
      const loc = L[node.id];
      if (loc) lines.push(`Lines: ${loc}`);
    }

    return lines;
  }

  /**
   * Draw info panel HUD to the right of the active node
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} dpr
   * @param {number} dragDeltaX
   * @param {number} dragDeltaY
   * @param {number} vcx
   * @param {number} vcy
   */
  _drawInfoPanel(ctx, dpr, dragDeltaX, dragDeltaY, vcx, vcy) {
    const ip = this._infoPanel;
    const showPanel = this.activeNode && !this.dragNode && !this.deactivating;

    if (showPanel && this.activeNode) {
      if (ip.nodeId !== this.activeNode.id) {
        ip.nodeId = this.activeNode.id;
        ip.lines = this._buildInfoLines(this.activeNode).map(text => ({ text, revealed: 0 }));
        ip.startTime = performance.now();
        ip.opacity = 0;
      }
      ip.opacity = Math.min(1, ip.opacity + 0.06);
    } else {
      ip.opacity = Math.max(0, ip.opacity - 0.12);
      if (ip.opacity <= 0) { ip.nodeId = null; ip.lines = []; ip.totalExtent = 0; ip.totalExtentY = 0; ip._centeredForNode = null; }
    }

    if (ip.opacity <= 0.01 || ip.lines.length === 0) return;

    const elapsed = performance.now() - ip.startTime;
    const CHAR_SPEED = 18;
    const LINE_DELAY = 60;
    let charBudget = Math.floor(elapsed / CHAR_SPEED);
    for (let i = 0; i < ip.lines.length; i++) {
      const line = ip.lines[i];
      const available = Math.max(0, charBudget - i * LINE_DELAY / CHAR_SPEED);
      line.revealed = Math.min(line.text.length, Math.floor(available));
    }

    const apos = this.activeNode ? this.getSmooth(this.activeNode.id) : null;
    if (!apos) return;

    // Apply depth-0 transform — panel lives in world-space, scales with nodes
    const s = this.layerAnim[0].scale;
    if (this.focusActive && Math.abs(s - 1) > 0.001) {
      ctx.setTransform(s * dpr * this.zoom, 0, 0, s * dpr * this.zoom,
        this.focusX * (1 - s) + s * dpr * this.panX,
        this.focusY * (1 - s) + s * dpr * this.panY);
    } else {
      ctx.setTransform(dpr * this.zoom, 0, 0, dpr * this.zoom, dpr * this.panX, dpr * this.panY);
    }

    // All dimensions in world units
    const fontSize = 11;
    const smallFontSize = 9;
    const lineHeight = 15;
    const padX = 14;
    const padY = 10;

    // Compute actual node radius to avoid overlap
    // Must account for: dot radius + glow + radial menu items
    const conns = this.adjMap.get(this.activeNode.id)?.size || 0;
    const hubScale = 1 + Math.min(conns, 8) * 0.1;
    let dotR = DOT_RADIUS * hubScale * (this.activeNode.aScale || 1.5);
    if (this.activeNode.isGroup) dotR *= 1.5;
    // Menu orbits at dotR + 14, each item has radius 6
    const menuExtent = dotR + 14 + 6;
    const panelGap = 10;
    const panelX = apos.x + menuExtent + panelGap;
    const panelY = apos.y - padY;

    ctx.font = `600 ${fontSize}px 'Inter', 'SF Mono', system-ui, sans-serif`;

    // Measure panel width from FULL text content (not just revealed)
    // This ensures totalExtent is stable from the first frame — no oscillation
    let maxW = 60;
    for (const line of ip.lines) {
      const w = ctx.measureText(line.text).width;
      if (w > maxW) maxW = w;
    }
    const panelW = maxW + padX * 2;
    const panelH = ip.lines.length * lineHeight + padY * 2;

    // Store total extent for focus centering
    ip.totalExtent = menuExtent + panelGap + panelW;
    // Vertical: panel extends from (apos.y - padY) to (apos.y - padY + panelH + 16)
    // The offset from node center to the vertical midpoint of the panel
    ip.totalExtentY = (panelH + 16) / 2 - padY;

    const tc = TYPE_COLORS[this.activeNode?.type] || TYPE_COLORS.data;
    const cornerR = 6;

    ctx.save();
    ctx.globalAlpha = ip.opacity;

    // Blurred backdrop
    ctx.filter = 'blur(16px)';
    ctx.beginPath();
    ctx.roundRect(panelX, panelY, panelW, panelH + 16, cornerR);
    ctx.fillStyle = `rgba(${this._bgR}, ${this._bgG}, ${this._bgB}, ${0.85 * ip.opacity})`;
    ctx.fill();
    ctx.filter = 'none';

    // Border
    ctx.beginPath();
    ctx.roundRect(panelX, panelY, panelW, panelH + 16, cornerR);
    ctx.strokeStyle = `rgba(${tc[0]}, ${tc[1]}, ${tc[2]}, ${0.15 * ip.opacity})`;
    ctx.lineWidth = 0.8;
    ctx.stroke();

    // Left accent
    ctx.beginPath();
    ctx.moveTo(panelX, panelY + cornerR);
    ctx.lineTo(panelX, panelY + panelH + 16 - cornerR);
    ctx.strokeStyle = `rgba(${tc[0]}, ${tc[1]}, ${tc[2]}, ${0.5 * ip.opacity})`;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Text lines
    let textY = panelY + padY + fontSize;
    for (let i = 0; i < ip.lines.length; i++) {
      const line = ip.lines[i];
      const text = line.text.substring(0, line.revealed);
      if (!text) { textY += lineHeight; continue; }

      if (i === 0) {
        ctx.font = `700 ${fontSize}px 'Inter', 'SF Mono', system-ui, sans-serif`;
        ctx.fillStyle = `rgba(${tc[0]}, ${tc[1]}, ${tc[2]}, ${ip.opacity})`;
      } else if (i === 1 && this.activeNode?.id !== this.activeNode?.label) {
        ctx.font = `400 ${smallFontSize}px 'SF Mono', 'JetBrains Mono', monospace`;
        ctx.fillStyle = `rgba(255, 255, 255, ${0.35 * ip.opacity})`;
      } else if (line.text.startsWith('  ')) {
        ctx.font = `400 ${smallFontSize}px 'SF Mono', 'JetBrains Mono', monospace`;
        ctx.fillStyle = `rgba(${tc[0]}, ${tc[1]}, ${tc[2]}, ${0.6 * ip.opacity})`;
      } else if (line.text.includes(':')) {
        ctx.font = `500 ${smallFontSize}px 'Inter', system-ui, sans-serif`;
        ctx.fillStyle = `rgba(255, 255, 255, ${0.5 * ip.opacity})`;
      } else {
        ctx.font = `500 ${smallFontSize}px 'Inter', system-ui, sans-serif`;
        ctx.fillStyle = `rgba(255, 255, 255, ${0.6 * ip.opacity})`;
      }

      ctx.fillText(text, panelX + padX, textY);

      if (line.revealed < line.text.length && line.revealed > 0) {
        const cursorX = panelX + padX + ctx.measureText(text).width + 2;
        if (Math.floor(performance.now() / 400) % 2 === 0) {
          ctx.fillStyle = `rgba(${tc[0]}, ${tc[1]}, ${tc[2]}, ${0.8 * ip.opacity})`;
          ctx.fillRect(cursorX, textY - fontSize + 2, 1.5, fontSize);
        }
      }
      textY += lineHeight;
    }

    ctx.restore();
  }

  screenToWorld(sx, sy) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: (sx - rect.left - this.panX) / this.zoom,
      y: (sy - rect.top - this.panY) / this.zoom,
    };
  }

  hitTest(wx, wy) {
    const inGroup = !!this.currentGroupId;
    const activeGroupId = this.currentGroupId;
    for (let i = this.nodes.length - 1; i >= 0; i--) {
      const node = this.nodes[i];
      if (inGroup && node.parentId !== activeGroupId && node.id !== activeGroupId) continue;
      const pos = this.getSmooth(node.id);
      if (!pos) continue;

      if (this.renderMode === 'dots') {
        const dx = wx - pos.x, dy = wy - pos.y;
        const hitR = node.isGroup ? HIT_RADIUS * 1.5 : HIT_RADIUS;
        if (dx * dx + dy * dy <= hitR * hitR) return node;
      }
    }
    return null;
  }

  bindEvents() {
    this.canvas.addEventListener('pointerdown', (e) => {
      this._wakeLoop();  // User interaction — resume rendering
      const world = this.screenToWorld(e.clientX, e.clientY);
      
      if (this.activeNode && !this.dragNode && this.menuAnim > 0.5) {
        const apos = this.getSmooth(this.activeNode.id);
        if (apos) {
          const conns = this.adjMap.get(this.activeNode.id)?.size || 0;
          const hubScale = 1 + Math.min(conns, 8) * 0.1;
          let nodeR = DOT_RADIUS * hubScale * (this.activeNode.aScale || 1.5);
          if (this.activeNode.isGroup) nodeR *= 1.5;
          const menuDist = nodeR + 14;
          const itemR = 6;
          
          for (let i = 0; i < MENU_ITEMS.length; i++) {
            const angle = (i / MENU_ITEMS.length) * Math.PI * 2 - Math.PI / 2;
            const ix = apos.x + Math.cos(angle) * menuDist;
            const iy = apos.y + Math.sin(angle) * menuDist;
            const dx = world.x - ix, dy = world.y - iy;
            if (dx * dx + dy * dy < itemR * itemR * 2) {
              const action = MENU_ITEMS[i].action;
              if (action === 'drill') {
                if (this.activeNode.isGroup) this.loadLevel(this.activeNode.id);
              } else {
                // Dispatch prod action
                this.dispatchEvent(new CustomEvent('toolbar-action', {
                  detail: { action, nodeId: this.activeNode.id },
                  bubbles: true,
                  composed: true
                }));
              }
              e.preventDefault();
              return;
            }
          }
        }
      }

      const hit = this.hitTest(world.x, world.y);
      if (hit) {
        const vis = this.getSmooth(hit.id);
        const sim = this.nodePositions.get(hit.id);
        if (vis && sim) { sim.x = vis.x; sim.y = vis.y; }
        
        if (this.activeNode && this.activeNode.id !== hit.id) {
          if (this.currentGroupId) {
            // Instant switch inside group
            this.activeNode = hit;
            this.dragNode = hit;
            this.menuAnim = 0;
            this.updateInteractionDepths();
          } else {
            this.nextActiveNode = hit;
            this.deactivating = true;
            this.dragNode = hit;
          }
        } else {
          this.activeNode = hit;
          this.dragNode = hit;
          this.deactivating = false;
          this.updateInteractionDepths();
        }
        const pos = this.nodePositions.get(hit.id);
        this.dragOffset.x = world.x - pos.x;
        this.dragOffset.y = world.y - pos.y;
        this._dragStartX = e.clientX;
        this._dragStartY = e.clientY;
        this.canvas.style.cursor = 'grabbing';
        this.canvas.setPointerCapture(e.pointerId);
        this.worker.postMessage({ type: 'pin', id: hit.id, x: pos.x, y: pos.y });
        e.preventDefault();
      } else {
        // Start panning — cancel any fitView/flyToNode animation
        this._targetPanX = null;
        this._targetPanY = null;
        this.isPanning = true;
        this._dragStartX = e.clientX;
        this._dragStartY = e.clientY;
        this.panStart = { x: this.panX, y: this.panY, px: e.clientX, py: e.clientY };
        this.canvas.style.cursor = 'grabbing';
        this.canvas.setPointerCapture(e.pointerId);
      }
    });

    this.canvas.addEventListener('pointermove', (e) => {
      if (this.dragNode) {
        this._wakeLoop();  // Dragging node — resume rendering
        const world = this.screenToWorld(e.clientX, e.clientY);
        const newX = world.x - this.dragOffset.x;
        const newY = world.y - this.dragOffset.y;
        this.nodePositions.set(this.dragNode.id, { x: newX, y: newY });
        this.worker.postMessage({ type: 'pin', id: this.dragNode.id, x: newX, y: newY });
        this.hoverNode = null;
      } else if (this.isPanning) {
        this._wakeLoop();  // Panning — resume rendering
        this.panX = this.panStart.x + (e.clientX - this.panStart.px);
        this.panY = this.panStart.y + (e.clientY - this.panStart.py);
        this.hoverNode = null;
      } else {
        const world = this.screenToWorld(e.clientX, e.clientY);
        this.hoverNode = this.hitTest(world.x, world.y);
      }
    });

    this.canvas.addEventListener('pointerup', (e) => {
      if (this.dragNode) {
        this.worker.postMessage({ type: 'unpin', id: this.dragNode.id });
        this.dragNode = null;
      }
      this.isPanning = false;
      this.canvas.style.cursor = 'default';
      
      // Detect click vs drag: if pointer moved less than 5px, it's a click
      const dx = e.clientX - (this._dragStartX || 0);
      const dy = e.clientY - (this._dragStartY || 0);
      const wasClick = (dx * dx + dy * dy) < 25;
      
      if (wasClick) {
        const world = this.screenToWorld(e.clientX, e.clientY);
        const node = this.hitTest(world.x, world.y);
        if (node) {
          if (node.isGroup) {
            const now = Date.now();
            if (now - this.lastClickTime < 300 && this.lastClickNode === node.id) {
              // Double click on group
              this.loadLevel(node.id);
            } else {
              // Single click on group
              this.dispatchEvent(new CustomEvent('group-selected', { detail: { path: node.id } }));
            }
            this.lastClickTime = now;
            this.lastClickNode = node.id;
          } else {
            // File node click
            this.dispatchEvent(new CustomEvent('file-selected', { detail: { path: node.id } }));
          }
        } else {
          // Click on empty space → deselect active node
          if (this.activeNode && !this.deactivating) {
            this.deactivating = true;
            this.dragNode = null;
            this.dispatchEvent(new CustomEvent('node-deselected'));
          }
        }
      }
      this._dragStartX = 0;
      this._dragStartY = 0;
    });

    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = this.canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      const factor = e.deltaY > 0 ? 0.92 : 1.08;
      this._targetZoom = Math.max(0.02, Math.min(5, this._targetZoom * factor));
      this._zoomAnchor = { mx, my };
      this._wakeLoop();  // Zoom changed — resume rendering
    }, { passive: false });

    this.canvas.addEventListener('dblclick', (e) => {
      // Check if we didn't hit a node
      const world = this.screenToWorld(e.clientX, e.clientY);
      if (!this.hitTest(world.x, world.y)) {
        if (!this.nodePositions.size) return;
        let sx = 0, sy = 0, count = 0;
        for (const pos of this.nodePositions.values()) { sx += pos.x; sy += pos.y; count++; }
        const cx = sx / count, cy = sy / count;
        const rect = this.canvas.getBoundingClientRect();
        this.panX = rect.width / 2 - cx * this.zoom;
        this.panY = rect.height / 2 - cy * this.zoom;
        this._wakeLoop();  // Double-click recenter — resume rendering
      }
    });
  }
}

CanvasGraph.template = /*html*/`
<style>
  :host {
    display: block;
    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
    background: #0f172a;
  }
  pg-canvas-graph > canvas {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    display: block;
    outline: none;
    user-select: none;
    cursor: default;
  }
  pg-canvas-graph > canvas.grabbing { cursor: grabbing; }
</style>
<graph-breadcrumb ref="breadcrumb" style="position: absolute; top: 16px; left: 16px; z-index: 10;"></graph-breadcrumb>
`;

CanvasGraph.reg('pg-canvas-graph');
