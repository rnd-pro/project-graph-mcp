// Reactive State Module — JSON-RPC 2.0 over WebSocket
// Single source of truth for all UI data

const API_BASE = new URL('.', import.meta.url).href;

/** @type {Object} Server state (received via snapshot, updated via patches) */
export const state = {
  project: null,
  skeleton: null,
  events: [],
  connected: false,
};

/** PubSub for state change notifications */
const listeners = new Map(); // path → Set<callback>

/** Subscribe to state changes at a path (e.g. 'project.agents', 'skeleton') */
export function subscribe(path, callback) {
  if (!listeners.has(path)) listeners.set(path, new Set());
  listeners.get(path).add(callback);
  return () => listeners.get(path)?.delete(callback);
}

/** Subscribe to all events */
const eventListeners = new Set();
export function onEvent(callback) {
  eventListeners.add(callback);
  return () => eventListeners.delete(callback);
}

/** Notify subscribers for a given path */
function notify(path, value) {
  // Exact match
  listeners.get(path)?.forEach(cb => cb(value, path));
  // Wildcard — notify parent path subscribers
  const dot = path.indexOf('.');
  if (dot > 0) {
    const parent = path.slice(0, dot);
    listeners.get(parent)?.forEach(cb => cb(state[parent], parent));
  }
  // Global '*' subscribers
  listeners.get('*')?.forEach(cb => cb(value, path));
}

// ═══ JSON-RPC 2.0 Request/Response ═══
let nextId = 1;
const pendingCalls = new Map(); // id → { resolve, reject }

/**
 * Call an MCP tool via WebSocket (JSON-RPC 2.0 request/response)
 * @param {string} toolName - Tool name (e.g. 'compact', 'navigate')
 * @param {Object} args - Tool arguments
 * @returns {Promise<*>} Tool result
 */
export function call(toolName, args = {}) {
  return new Promise((resolve, reject) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      reject(new Error('WebSocket not connected'));
      return;
    }
    const id = nextId++;
    pendingCalls.set(id, { resolve, reject });
    ws.send(JSON.stringify({
      jsonrpc: '2.0',
      id,
      method: 'tool',
      params: { name: toolName, args },
    }));
    // Timeout after 30s
    setTimeout(() => {
      if (pendingCalls.has(id)) {
        pendingCalls.delete(id);
        reject(new Error(`Tool call timeout: ${toolName}`));
      }
    }, 30000);
  });
}

// ═══ WebSocket Connection ═══
let ws = null;
let reconnectTimer = null;

function applySnapshot(snapshot) {
  Object.assign(state, snapshot);
  state.connected = true;
  notify('*', state);
  // Notify individual top-level keys
  for (const key of Object.keys(snapshot)) {
    notify(key, snapshot[key]);
  }
}

function applyPatch(path, value) {
  const keys = path.split('.');
  let target = state;
  for (let i = 0; i < keys.length - 1; i++) {
    if (!target[keys[i]]) target[keys[i]] = {};
    target = target[keys[i]];
  }
  target[keys[keys.length - 1]] = value;
  notify(path, value);
}

function handleMessage(data) {
  let msg;
  try { msg = JSON.parse(data); } catch { return; }

  // JSON-RPC 2.0 response (to our call())
  if (msg.id && (msg.result !== undefined || msg.error)) {
    const pending = pendingCalls.get(msg.id);
    if (pending) {
      pendingCalls.delete(msg.id);
      if (msg.error) {
        pending.reject(new Error(msg.error.message || 'Tool error'));
      } else {
        pending.resolve(msg.result);
      }
    }
    return;
  }

  // JSON-RPC 2.0 notification (from server)
  if (msg.method === 'snapshot') {
    applySnapshot(msg.params.state);
    return;
  }

  if (msg.method === 'patch') {
    applyPatch(msg.params.path, msg.params.value);
    return;
  }

  if (msg.method === 'event') {
    eventListeners.forEach(cb => cb(msg.params));
    return;
  }

  // Legacy event format (backward compat with old server)
  if (msg.type) {
    eventListeners.forEach(cb => cb(msg));
  }
}

export function connect() {
  if (ws) return;

  const wsBase = API_BASE.replace(/^http/, 'ws');
  ws = new WebSocket(`${wsBase}ws/monitor`);

  ws.onopen = () => {
    state.connected = true;
    notify('connected', true);
    // Cancel pending reconnect
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  };

  ws.onmessage = (event) => handleMessage(event.data);

  ws.onclose = () => {
    state.connected = false;
    ws = null;
    notify('connected', false);
    // Reject all pending calls
    for (const [id, { reject }] of pendingCalls) {
      reject(new Error('WebSocket disconnected'));
    }
    pendingCalls.clear();
    // Auto-reconnect
    reconnectTimer = setTimeout(connect, 3000);
  };

  ws.onerror = () => {
    // onclose will fire after this
  };
}

export function disconnect() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (ws) {
    ws.close();
    ws = null;
  }
}
