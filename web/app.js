// Project Graph Web UI — Main Application
// Uses symbiote-node as a library for BSP layout + sidebar navigation

// Import from symbiote-node library (resolved via importmap)
import { Layout, LayoutTree, applyTheme, CARBON } from 'symbiote-node';

// Side-effect imports — register custom elements (same pattern as admin-panel)
import './vendor/symbiote-node/layout/Layout/Layout.js';
import './vendor/symbiote-node/layout/LayoutSidebar/LayoutSidebar.js';

// Import panel components (self-registering)
import './panels/file-tree.js';
import './panels/code-viewer.js';
import './panels/ctx-panel.js';
import './panels/dep-graph.js';
import './panels/health-panel.js';
import './panels/live-monitor.js';

// ═══ Shared state ═══
export const state = {
  skeleton: null,
  activeFile: null,
  ws: null,
  monitorEvents: [],
};

// ═══ API helper ═══
// Base URL from module location — works both direct and through gateway prefix
const API_BASE = new URL('.', import.meta.url).href;

export async function api(endpoint, params = {}) {
  const qs = new URLSearchParams(params).toString();
  const path = endpoint.replace(/^\//, '');
  const url = qs ? `${API_BASE}${path}?${qs}` : `${API_BASE}${path}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

// ═══ PubSub for cross-panel communication ═══
export const events = new EventTarget();

export function emit(name, detail = {}) {
  events.dispatchEvent(new CustomEvent(name, { detail }));
}

// ═══ WebSocket for live monitoring ═══
function initWebSocket() {
  // Derive WS URL from API_BASE (supports gateway prefix)
  const wsBase = API_BASE.replace(/^http/, 'ws');
  const ws = new WebSocket(`${wsBase}ws/monitor`);

  ws.onopen = () => {
    document.getElementById('status-indicator').className = 'status connected';
  };

  ws.onclose = () => {
    document.getElementById('status-indicator').className = 'status disconnected';
    setTimeout(initWebSocket, 3000);
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);

      // Agent lifecycle events
      if (data.type === 'agent_connect' || data.type === 'agent_disconnect') {
        updateAgentBadge(data.agents);
        emit('agent-event', data);
        return;
      }

      state.monitorEvents.push(data);
      if (state.monitorEvents.length > 500) state.monitorEvents.shift();
      emit('tool-event', data);
    } catch { /* ignore */ }
  };

  state.ws = ws;
}

// ═══ Panel type registry ═══
const PANEL_TYPES = {
  'file-tree':   { title: 'Files',        icon: 'folder',        component: 'pg-file-tree' },
  'code-viewer': { title: 'Code',         icon: 'code',          component: 'pg-code-viewer' },
  'ctx-panel':   { title: 'Documentation', icon: 'description',  component: 'pg-ctx-panel' },
  'dep-graph':   { title: 'Dependencies', icon: 'account_tree',  component: 'pg-dep-graph' },
  'health':      { title: 'Health',       icon: 'analytics',     component: 'pg-health-panel' },
  'monitor':     { title: 'Live Monitor', icon: 'monitor_heart', component: 'pg-live-monitor' },
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

  // ═══ Project identity ═══
  try {
    const info = await api('/api/project-info');
    state.projectInfo = info;

    // Set page title & project name
    document.title = `${info.name} — Project Graph`;
    document.getElementById('project-name').textContent = info.name;

    // Set accent color from project hash
    document.documentElement.style.setProperty('--project-accent', info.color);

    // Show agent count
    updateAgentBadge(info.agents);
  } catch {
    // Fallback — no project-info endpoint available
  }

  // Load project skeleton
  try {
    state.skeleton = await api('/api/skeleton');
    const nodes = state.skeleton?.n;
    const fileCount = nodes ? new Set(Object.values(nodes).map(n => n.f)).size : 0;

    // Update subtitle with file count
    const subtitle = document.getElementById('project-files');
    if (subtitle) subtitle.textContent = `${fileCount} files`;

    emit('skeleton-loaded', state.skeleton);
  } catch (err) {
    document.getElementById('project-name').textContent = 'Error';
    console.error('Failed to load skeleton:', err);
  }

  // Start WebSocket
  initWebSocket();
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

// Auto-init
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  setTimeout(init, 100);
}

