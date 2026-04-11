import { Layout, LayoutTree, applyTheme } from 'symbiote-node';
import { CARBON } from './vendor/symbiote-node/themes/carbon.js';

import './panels/ProjectList/ProjectList.js';
import './panels/ActionBoard/ActionBoard.js';
import { state, events, emit } from './dashboard-state.js';

async function fetchGatewayInfo() {
  const res = await fetch('/api/gateway-info');
  if (!res.ok) {
    const text = await res.text();
    console.error('[dashboard] fetchGatewayInfo failed:', res.status, text);
    throw new Error(`Gateway info failed: ${res.status}`);
  }
  return res.json();
}

function initWebSockets(projects) {
  if (!projects.length) {
    console.warn('[dashboard] No projects to connect WebSockets for');
    return;
  }

  const wsBase = location.protocol === 'https:' ? 'wss://' : 'ws://';
  const host = location.host;

  for (const p of projects) {
    connectProject(p, wsBase, host);
  }
}

function connectProject(p, wsBase, host) {
  const wsUrl = `${wsBase}${host}${p.prefix}/ws/monitor`;
  const ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    console.log('[dashboard] WS connected:', p.projectName);
  };

  ws.onmessage = (event) => {
    let msg;
    try { msg = JSON.parse(event.data); } catch { return; }

    // JSON-RPC 2.0 snapshot — update project info from reactive state
    if (msg.method === 'snapshot' && msg.params?.state) {
      const snap = msg.params.state;
      const existing = state.projects.find(pr => pr.prefix === p.prefix);
      if (existing && snap.project) {
        Object.assign(existing, {
          projectName: snap.project.name,
          projectPath: snap.project.path,
          color: snap.project.color,
          agents: snap.project.agents,
          pid: snap.project.pid,
          connected: true,
        });
        emit('projects-updated', state.projects);
      }
      return;
    }

    // JSON-RPC 2.0 patch — update specific project field
    if (msg.method === 'patch' && msg.params) {
      const existing = state.projects.find(pr => pr.prefix === p.prefix);
      if (existing && msg.params.path === 'project.agents') {
        existing.agents = msg.params.value;
        emit('projects-updated', state.projects);
      }
      return;
    }

    // JSON-RPC 2.0 event — tool calls/results
    if (msg.method === 'event' && msg.params) {
      const data = msg.params;
      data._projectPrefix = p.prefix;
      data._projectName = p.projectName;
      state.events.push(data);
      if (state.events.length > 1000) state.events.shift();
      emit('global-tool-event', data);
      return;
    }

    // Legacy event format (backward compat)
    if (msg.type) {
      msg._projectPrefix = p.prefix;
      msg._projectName = p.projectName;
      state.events.push(msg);
      if (state.events.length > 1000) state.events.shift();
      emit('global-tool-event', msg);
    }
  };

  ws.onerror = () => {
    console.error('[dashboard] WS error:', p.projectName);
  };

  ws.onclose = (e) => {
    console.warn('[dashboard] WS closed:', p.projectName, e.code);
    const existing = state.projects.find(pr => pr.prefix === p.prefix);
    if (existing) {
      existing.connected = false;
      emit('projects-updated', state.projects);
    }
    setTimeout(() => connectProject(p, wsBase, host), 5000);
  };
}

const PANEL_TYPES = {
  'project-list': { title: 'Projects', icon: 'dashboard', component: 'pg-project-list' },
  'action-board': { title: 'Action Board', icon: 'monitor_heart', component: 'pg-action-board' },
};

async function init() {
  applyTheme(document.documentElement, CARBON);

  const workspace = document.querySelector('.app-workspace');
  const contentArea = workspace.querySelector('.app-content');

  const layout = document.createElement('panel-layout');
  layout.setAttribute('storage-key', 'pg-dashboard-layout');
  layout.setAttribute('min-panel-size', '200');
  layout.id = 'dashboard-layout';
  contentArea.appendChild(layout);

  requestAnimationFrame(async () => {
    for (const [name, config] of Object.entries(PANEL_TYPES)) {
      layout.registerPanelType(name, config);
    }

    const saved = localStorage.getItem('pg-dashboard-layout');
    if (!saved) {
      layout.setLayout(
        LayoutTree.createSplit(
          'vertical',
          LayoutTree.createPanel('project-list'),
          LayoutTree.createPanel('action-board'),
          0.3
        )
      );
    }

    const info = await fetchGatewayInfo();
    state.projects = Object.entries(info.routes || {}).map(([prefix, p]) => ({
      prefix,
      ...p,
      connected: false,
      agents: 0,
    }));
    emit('projects-updated', state.projects);

    initWebSockets(state.projects);
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  setTimeout(init, 100);
}
