// Project Graph Web UI — Main Application
// Uses symbiote-node as a library for BSP layout + sidebar navigation

// Import from symbiote-node library (resolved via importmap)
import { Layout, LayoutTree, applyTheme } from 'symbiote-node';
import { CARBON } from './vendor/symbiote-node/themes/carbon.js';
import { state as reactiveState, subscribe, onEvent, call, connect } from './state.js';

// Import panel components (self-registering)
import './panels/file-tree.js';
import './panels/code-viewer.js';
import './panels/ctx-panel.js';
import './panels/dep-graph.js';
import './panels/health-panel.js';
import './panels/live-monitor.js';
import './panels/SettingsPanel/SettingsPanel.js';
import './components/quick-open.js';

// ═══ Shared state (legacy — panels still use this) ═══
export const state = {
  skeleton: null,
  activeFile: null,
  ws: null,
  monitorEvents: [],
};

// ═══ Legacy API helper (backward compat — panels still use this) ═══
const API_BASE = new URL('.', import.meta.url).href;

export async function api(endpoint, params = {}) {
  // Prefer WS call if connected, fallback to HTTP
  if (reactiveState.connected && endpoint.startsWith('/api/')) {
    const wsResult = await apiViaWS(endpoint, params);
    if (wsResult !== null) return wsResult;
  }
  const qs = new URLSearchParams(params).toString();
  const path = endpoint.replace(/^\//, '');
  const url = qs ? `${API_BASE}${path}?${qs}` : `${API_BASE}${path}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

/** Route legacy api() calls through WebSocket */
async function apiViaWS(endpoint, params) {
  const TOOL_MAP = {
    '/api/skeleton': { name: 'get_skeleton', args: (p) => ({ path: p.path }) },
    '/api/file': { name: 'compact', args: (p) => ({ action: 'compress_file', path: p.path, beautify: true }) },
    '/api/docs': { name: 'docs', args: (p) => ({ action: 'get', path: p.path, file: p.file }) },
    '/api/analysis': { name: 'analyze', args: (p) => ({ action: 'full_analysis', path: p.path }) },
    '/api/analysis-summary': { name: 'analyze', args: (p) => ({ action: 'analysis_summary', path: p.path }) },
    '/api/deps': { name: 'navigate', args: (p) => ({ action: 'deps', symbol: p.symbol }) },
    '/api/usages': { name: 'navigate', args: (p) => ({ action: 'usages', symbol: p.symbol }) },
    '/api/expand': { name: 'navigate', args: (p) => ({ action: 'expand', symbol: p.symbol }) },
    '/api/chain': { name: 'navigate', args: (p) => ({ action: 'call_chain', from: p.from, to: p.to }) },
  };
  const mapping = TOOL_MAP[endpoint];
  if (!mapping) return null; // Unknown — fallback to HTTP
  return call(mapping.name, mapping.args(params));
}

// ═══ PubSub for cross-panel communication (legacy — panels still use this) ═══
export const events = new EventTarget();

export function emit(name, detail = {}) {
  events.dispatchEvent(new CustomEvent(name, { detail }));
}

// ═══ Panel type registry ═══
const PANEL_TYPES = {
  'file-tree':   { title: 'Files',        icon: 'folder',        component: 'pg-file-tree' },
  'code-viewer': { title: 'Code',         icon: 'code',          component: 'pg-code-viewer' },
  'ctx-panel':   { title: 'Documentation', icon: 'description',  component: 'pg-ctx-panel' },
  'dep-graph':   { title: 'Dependencies', icon: 'account_tree',  component: 'pg-dep-graph' },
  'health':      { title: 'Health',       icon: 'analytics',     component: 'pg-health-panel' },
  'monitor':     { title: 'Live Monitor', icon: 'monitor_heart', component: 'pg-live-monitor' },
  'settings':    { title: 'Settings',     icon: 'settings',      component: 'pg-settings-panel' },
};

// ═══ Sidebar section definitions ═══
const SIDEBAR_SECTIONS = [
  { id: 'explorer', icon: 'folder_open', label: 'Explorer' },
  { id: 'analysis', icon: 'analytics',   label: 'Analysis' },
  { id: 'monitor',  icon: 'monitor_heart', label: 'Monitor' },
  { id: 'settings', icon: 'settings',    label: 'Settings' },
];

// Layout presets per section
const SECTION_LAYOUTS = {
  explorer: () => LayoutTree.createSplit(
    'horizontal',
    LayoutTree.createPanel('file-tree'),
    LayoutTree.createSplit(
      'horizontal',
      LayoutTree.createPanel('code-viewer'),
      LayoutTree.createPanel('ctx-panel'),
      0.65,
    ),
    0.2,
  ),
  analysis: () => LayoutTree.createSplit(
    'horizontal',
    LayoutTree.createPanel('health'),
    LayoutTree.createPanel('dep-graph'),
    0.5,
  ),
  monitor: () => LayoutTree.createPanel('monitor'),
  settings: () => LayoutTree.createPanel('settings'),
};

// ═══ Initialize ═══
function initLayout() {
  // Apply CARBON theme to :root
  applyTheme(document.documentElement, CARBON);

  const workspace = document.querySelector('.app-workspace');

  // --- Sidebar ---
  /** @type {*} */
  const sidebar = document.createElement('layout-sidebar');
  workspace.prepend(sidebar);

  // --- Content area with panel-layout ---
  const contentArea = workspace.querySelector('.app-content');

  /** @type {*} */
  const layout = document.createElement('panel-layout');
  layout.setAttribute('storage-key', 'pg-explorer-layout');
  layout.setAttribute('min-panel-size', '150');
  layout.id = 'main-layout';
  contentArea.appendChild(layout);

  requestAnimationFrame(() => {
    // Register all panel types
    for (const [name, config] of Object.entries(PANEL_TYPES)) {
      layout.registerPanelType(name, config);
    }

    // Configure sidebar sections
    sidebar.setSections(SIDEBAR_SECTIONS);

    // Listen for route changes (sidebar uses navigate → hashchange)
    function applyRouteLayout() {
      const raw = location.hash.replace('#', '') || 'explorer';
      const qIdx = raw.indexOf('?');
      const pathPart = qIdx >= 0 ? raw.substring(0, qIdx) : raw;
      const slashIdx = pathPart.indexOf('/');
      const section = slashIdx >= 0 ? pathPart.substring(0, slashIdx) : pathPart;
      const filePath = slashIdx >= 0 ? pathPart.substring(slashIdx + 1) : '';

      if (SECTION_LAYOUTS[section]) {
        layout.setLayout(SECTION_LAYOUTS[section]());
      }

      // Deep-link to file: #explorer/src/parser.js → open file
      if (section === 'explorer' && filePath) {
        // Defer to let layout render
        requestAnimationFrame(() => {
          state.activeFile = filePath;
          emit('file-selected', { path: filePath, fromRoute: true });
        });
      }
    }

    window.addEventListener('hashchange', applyRouteLayout);

    // Update hash when file is selected via click
    events.addEventListener('file-selected', (e) => {
      if (e.detail.fromRoute) return; // Don't loop
      const filePath = e.detail.path;
      if (filePath) {
        history.replaceState(null, '', `#explorer/${filePath}`);
      }
    });

    // Set default layout — explorer
    const saved = localStorage.getItem('pg-explorer-layout');
    if (!saved) {
      layout.setLayout(SECTION_LAYOUTS.explorer());
    }

    // Apply initial route (may contain deep-link)
    if (!location.hash || location.hash === '#') {
      location.hash = 'explorer';
    } else {
      applyRouteLayout();
    }
  });
}

async function init() {
  initLayout();

  // ═══ Connect reactive state via WebSocket ═══
  connect();

  // Bridge reactive state → legacy UI elements
  subscribe('project', (project) => {
    if (!project) return;
    document.title = `${project.name} — Project Graph`;
    document.getElementById('project-name').textContent = project.name;
    document.documentElement.style.setProperty('--project-accent', project.color);
    updateAgentBadge(project.agents);
  });

  subscribe('skeleton', (skeleton) => {
    if (!skeleton) return;
    state.skeleton = skeleton;

    // Count all files from skeleton
    const allFiles = new Set();
    for (const node of Object.values(skeleton.n || {})) { if (node.f) allFiles.add(node.f); }
    for (const file of Object.keys(skeleton.X || {})) { allFiles.add(file); }
    for (const [dir, files] of Object.entries(skeleton.f || {})) {
      for (const f of files) allFiles.add(dir === './' ? f : `${dir}${f}`);
    }
    // Non-source files (HTML, CSS, templates, configs, etc.)
    for (const [dir, files] of Object.entries(skeleton.a || {})) {
      for (const f of files) allFiles.add(dir === './' ? f : `${dir}${f}`);
    }
    const subtitle = document.getElementById('project-files');
    if (subtitle) subtitle.textContent = `${allFiles.size} files`;

    emit('skeleton-loaded', skeleton);
  });

  subscribe('connected', (connected) => {
    const indicator = document.getElementById('status-indicator');
    if (indicator) {
      indicator.className = connected ? 'status connected' : 'status disconnected';
    }
  });

  // Bridge reactive events → legacy panel events
  onEvent((event) => {
    if (event.type === 'agent_connect' || event.type === 'agent_disconnect') {
      updateAgentBadge(event.agents);
      emit('agent-event', event);
      return;
    }
    state.monitorEvents.push(event);
    if (state.monitorEvents.length > 500) state.monitorEvents.shift();
    emit('tool-event', event);
  });
}

// ═══ Agent badge helper ═══
function updateAgentBadge(count) {
  let badge = document.getElementById('agent-badge');
  if (!badge) {
    const topbar = document.querySelector('.app-topbar');
    if (!topbar) return;
    badge = document.createElement('span');
    badge.id = 'agent-badge';
    badge.className = 'agent-badge';
    topbar.appendChild(badge);
  }
  badge.textContent = count > 0 ? `● ${count} agent${count !== 1 ? 's' : ''}` : '';
  badge.style.display = count > 0 ? '' : 'none';
}

// Mount global components
function mountGlobalComponents() {
  if (!document.querySelector('pg-quick-open')) {
    document.body.appendChild(document.createElement('pg-quick-open'));
  }
}

// Auto-init
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => { init(); mountGlobalComponents(); });
} else {
  setTimeout(() => { init(); mountGlobalComponents(); }, 100);
}

