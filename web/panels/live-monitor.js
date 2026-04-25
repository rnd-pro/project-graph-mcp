// @ctx .context/web/panels/live-monitor.ctx
import Symbiote from "@symbiotejs/symbiote";
import { events as globalEvents } from "../app.js";

import "../components/event-feed/CodeWidget.js";
import "../components/event-feed/MiniGraphWidget.js";
import "../components/event-feed/ListWidget.js";
import "../components/event-feed/EventWidget.js";

export class LiveMonitor extends Symbiote {
  init$ = {
    eventCount: "0",
    eventsList: []
  };

  _events = [];

  initCallback() {
    globalEvents.addEventListener("tool-event", (e) => this._addEvent(e.detail));
  }

  _addEvent(event) {
    this._events.unshift(event);
    if (this._events.length > 100) {
      this._events.pop(); // Keep max 100 for performance
    }
    
    this.$.eventCount = String(this._events.length);
    
    // Update the itemize list reactively
    this.$.eventsList = this._events.map(ev => ({
      eventData: JSON.stringify(ev)
    }));
  }
}

LiveMonitor.template = `
  <div class="pg-mon-header">
    <span>Events: </span><span bind="textContent: eventCount"></span>
  </div>
  <div class="pg-mon-body">
    <div \${{ itemize: 'eventsList', 'item-tag': 'pg-event-widget' }}></div>
    <div class="pg-placeholder" \${{ hidden: 'eventCount' }}>Waiting for tool calls...</div>
  </div>
`;

LiveMonitor.rootStyles = `
  pg-live-monitor { display:flex; flex-direction:column; height:100%; overflow:hidden; font-size:12px; font-family:var(--sn-font, Georgia, serif); }
  .pg-mon-header { padding:6px 12px; border-bottom:1px solid var(--sn-node-border); background:var(--sn-node-header-bg); font-size:11px; color:var(--sn-text-dim); flex-shrink: 0; }
  .pg-mon-body { flex:1; overflow-y:auto; padding:8px; display: flex; flex-direction: column; gap: 8px; }
  
  pg-event-widget { display: block; border: 1px solid var(--sn-node-border); border-radius: 6px; background: rgba(0,0,0,0.2); }
  .pg-mon-event { padding: 8px; animation: slideIn 0.2s ease; }
  .event-header { display:flex; align-items:center; gap:8px; font-family:monospace; font-size:11px; margin-bottom: 6px; }
  .pg-mon-arrow { font-weight:bold; width:14px; }
  .pg-mon-event[data-is-call="true"] .pg-mon-arrow { color: var(--sn-cat-server, hsl(210, 45%, 45%)); }
  .pg-mon-event[data-is-call="false"] .pg-mon-arrow { color: var(--sn-success-color, hsl(150, 55%, 38%)); }
  .pg-mon-tool { color:var(--sn-text); font-weight:600; min-width:100px; }
  .pg-mon-time { color:var(--sn-text-dim); font-size:10px; flex:1; text-align:right; }
  .pg-mon-duration { color: hsl(250, 35%, 50%); font-size: 10px; }
  
  .event-body { font-family: monospace; font-size: 11px; color: var(--sn-text-dim); background: rgba(0,0,0,0.3); padding: 6px; border-radius: 4px; word-break: break-all; }
  .result-body { color: var(--sn-text); }
  
  .code-widget pre { margin: 0; white-space: pre-wrap; font-family: 'JetBrains Mono', 'Fira Code', monospace; font-size: 10px; color: #a9b7c6; }
  .list-widget-ul { margin: 0; padding-left: 16px; font-size: 10px; color: #a9b7c6; }
  .list-widget-more { font-size: 10px; color: var(--sn-text-dim); margin-top: 4px; font-style: italic; }
  
  .raw-output { margin: 0; white-space: pre-wrap; font-size: 10px; max-height: 200px; overflow-y: auto; color: #a9b7c6; }
  .error-msg { color: var(--sn-danger-color, hsl(4, 55%, 48%)); font-weight: bold; }
  
  .pg-placeholder { color:var(--sn-text-dim); text-align:center; padding:30px; font-style:italic; }
  @keyframes slideIn { from{opacity:0;transform:translateY(-8px)} to{opacity:1;transform:translateY(0)} }
`;

LiveMonitor.reg("pg-live-monitor");