// @ctx .context/web/follow-controller.ctx
/**
 * FollowController — Central orchestrator for Follow Mode.
 *
 * Classifies incoming tool-events and dispatches debounced focus-change
 * signals to subscribed panels (graph, code-viewer, monitor).
 * Also manages the status ribbon text shown during active follow.
 *
 * NOTE: Does NOT import from app.js to avoid circular dependency.
 * Call init(events, emit) before enable().
 */

/** Debounce delay for heavy visual updates (camera, code loading) */
const HEAVY_DEBOUNCE = 800;

class FollowController {
  /** @type {boolean} */
  enabled = false;
  /** @type {{type: string, target: any, action?: string, meta?: object}|null} */
  currentFocus = null;
  /** @type {string} */
  statusText = '';
  /** @type {number|null} */
  _debounceTimer = null;
  /** @type {string|null} Previous hash before entering follow mode */
  _previousHash = null;
  /** @type {Function|null} */
  _boundHandler = null;
  /** @type {EventTarget|null} */
  _events = null;
  /** @type {Function|null} */
  _emit = null;

  /**
   * Late-bind events bus and emit function (breaks circular import).
   * Must be called once before enable().
   * @param {EventTarget} events
   * @param {Function} emit
   */
  init(events, emit) {
    this._events = events;
    this._emit = emit;
  }

  enable() {
    if (this.enabled) return;
    this.enabled = true;

    // Save current location for restoring later
    this._previousHash = location.hash;

    // Bind tool-event listener
    this._boundHandler = (e) => this._onToolEvent(e.detail);
    this._events.addEventListener('tool-event', this._boundHandler);

    this._emit('follow-state-changed', { enabled: true });
  }

  disable() {
    if (!this.enabled) return;
    this.enabled = false;

    // Clean up
    if (this._boundHandler) {
      this._events.removeEventListener('tool-event', this._boundHandler);
      this._boundHandler = null;
    }
    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
      this._debounceTimer = null;
    }

    this.currentFocus = null;
    this._emitStatus('');

    this._emit('follow-state-changed', { enabled: false });
  }

  /** @returns {string|null} */
  getPreviousHash() {
    return this._previousHash;
  }

  /**
   * Main tool-event dispatcher. Classifies the event and routes to appropriate action.
   * @param {object} event - Tool event from WebSocket
   */
  _onToolEvent(event) {
    if (!this.enabled) return;

    const toolName = event.tool || event.name || '';
    const args = event.args || {};
    const isCall = event.type === 'tool_call';
    const isResult = event.type === 'tool_result';

    // Extract short tool name (strip prefixes like 'default_api:', 'mcp_project-graph_')
    const shortName = this._shortName(toolName);

    // Status ribbon — update immediately on call
    if (isCall) {
      const statusText = this._buildStatusText(shortName, args);
      if (statusText) this._emitStatus(statusText);
    }

    // Visual focus — classify and dispatch (debounced for heavy ops)
    const action = this._classify(shortName, args, isCall, isResult, event);
    if (action) {
      if (action.immediate) {
        this._emitFocusNow(action.focus);
      } else {
        this._emitFocusDebounced(action.focus, action.debounce || HEAVY_DEBOUNCE);
      }
    }
  }

  /**
   * Classify tool event into a visual action.
   * Only handles tools emitted by our MCP server (navigate, get_skeleton, etc.).
   * IDE-local tools (view_file, grep_search) never arrive over WebSocket.
   * @returns {{focus: object, debounce?: number, immediate?: boolean}|null}
   */
  _classify(tool, args, isCall, isResult, raw) {
    if (!isCall) return null;

    // === Graph navigation ===
    if (tool === 'navigate') {
      if (args.action === 'expand' && args.symbol) {
        return { focus: { type: 'graph', target: args.symbol, action: 'focus' }, debounce: HEAVY_DEBOUNCE };
      }
      if (args.action === 'deps' && args.symbol) {
        return { focus: { type: 'graph', target: args.symbol, action: 'deps' }, debounce: HEAVY_DEBOUNCE };
      }
      if (args.action === 'usages' && args.symbol) {
        return { focus: { type: 'graph', target: args.symbol, action: 'deps' }, debounce: HEAVY_DEBOUNCE };
      }
      if (args.action === 'call_chain' && args.from && args.to) {
        return { focus: { type: 'graph', target: { from: args.from, to: args.to }, action: 'chain' }, immediate: true };
      }
    }

    // === Skeleton / Overview ===
    if (tool === 'get_skeleton' || tool === 'get_ai_context') {
      return { focus: { type: 'graph', action: 'fit' }, immediate: true };
    }

    // === Code compaction (compact_file action has a file path) ===
    if (tool === 'compact' && args.path) {
      return { focus: { type: 'file', target: args.path }, debounce: HEAVY_DEBOUNCE };
    }

    // === Analysis ===
    if (tool === 'analyze') {
      return { focus: { type: 'analysis' }, immediate: true };
    }

    return null;
  }

  /**
   * Build human-readable status text for the ribbon.
   * Only MCP-server tools arrive here (navigate, get_skeleton, compact, analyze, docs, etc.).
   * @param {string} tool
   * @param {object} args
   * @returns {string}
   */
  _buildStatusText(tool, args) {
    const file = args.path || '';
    const short = file ? file.split('/').slice(-2).join('/') : '';

    switch (tool) {
      case 'navigate': {
        if (args.action === 'expand') return `Expanding ${args.symbol}`;
        if (args.action === 'deps') return `Tracing deps of ${args.symbol}`;
        if (args.action === 'usages') return `Finding usages of ${args.symbol}`;
        if (args.action === 'call_chain') return `Tracing ${args.from} → ${args.to}`;
        if (args.action === 'sub_projects') return `Scanning sub-projects`;
        return `Navigating graph`;
      }
      case 'get_skeleton': return `Scanning project structure`;
      case 'get_ai_context': return `Loading AI context`;
      case 'compact': return `Compacting ${short}`;
      case 'analyze': return `Analyzing: ${args.action || ''}`;
      case 'docs': return `Documentation: ${args.action || ''}`;
      case 'jsdoc': return `JSDoc: ${args.action || ''}`;
      case 'db': return `Database: ${args.action || ''}`;
      case 'testing': return `Tests: ${args.action || ''}`;
      case 'filters': return `Filters: ${args.action || ''}`;
      default: return tool ? `Running ${tool}` : '';
    }
  }

  /**
   * Extract short tool name from full prefixed name.
   * 'default_api:view_file' → 'view_file'
   * 'mcp_project-graph_navigate' → 'navigate'
   */
  _shortName(full) {
    // Strip 'default_api:' prefix
    let name = full.replace(/^default_api:/, '');
    // Strip 'mcp_project-graph_' prefix
    name = name.replace(/^mcp_project-graph_/, '');
    return name;
  }

  /**
   * Emit focus change immediately (for urgent actions like call_chain).
   */
  _emitFocusNow(focus) {
    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
      this._debounceTimer = null;
    }
    this.currentFocus = focus;
    this._emit('follow-focus-changed', focus);
  }

  /**
   * Emit focus change with debounce (for rapid file reads, etc.).
   */
  _emitFocusDebounced(focus, delay) {
    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
    }
    this._debounceTimer = setTimeout(() => {
      this._debounceTimer = null;
      this.currentFocus = focus;
      this._emit('follow-focus-changed', focus);
    }, delay);
  }

  /**
   * Emit status text for the ribbon.
   */
  _emitStatus(text) {
    this.statusText = text;
    this._emit('follow-status-changed', { text });
  }
}

/** Singleton instance */
export const followController = new FollowController();
