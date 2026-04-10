import Symbiote from '@symbiotejs/symbiote';
import { events } from '../app.js';

export class LiveMonitor extends Symbiote {
  init$ = {
    eventsHTML: '<div class="pg-placeholder">Waiting for tool calls...</div>',
    eventCount: '0',
  };

  _events = [];

  initCallback() {
    events.addEventListener('tool-event', (e) => this._addEvent(e.detail));
  }

  _addEvent(event) {
    this._events.unshift(event);
    if (this._events.length > 200) this._events.pop();
    this.$.eventCount = String(this._events.length);

    const html = this._events.slice(0, 100).map(ev => {
      if (ev.type === 'tool_call') {
        const args = JSON.stringify(ev.args || {}).slice(0, 80);
        return `<div class="pg-mon-event pg-mon-call">
          <span class="pg-mon-arrow">→</span>
          <span class="pg-mon-tool">${ev.tool}</span>
          <span class="pg-mon-args">${this._esc(args)}</span>
          <span class="pg-mon-time">${this._formatTime(ev.ts)}</span>
        </div>`;
      } else {
        const color = ev.success ? 'pg-mon-ok' : 'pg-mon-err';
        return `<div class="pg-mon-event pg-mon-result ${color}">
          <span class="pg-mon-arrow">←</span>
          <span class="pg-mon-tool">${ev.tool}</span>
          <span class="pg-mon-duration">${ev.duration_ms}ms</span>
          <span class="pg-mon-time">${this._formatTime(ev.ts)}</span>
        </div>`;
      }
    }).join('');

    this.$.eventsHTML = html || '<div class="pg-placeholder">Waiting for tool calls...</div>';
  }

  _esc(str) { return str.replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  _formatTime(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    return d.toLocaleTimeString('en', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }
}

LiveMonitor.template = /*html*/`
  <div class="pg-mon-header">
    <span>Events: </span><span bind="textContent: eventCount"></span>
  </div>
  <div class="pg-mon-body" bind="innerHTML: eventsHTML"></div>
`;

LiveMonitor.rootStyles = /*css*/`
  pg-live-monitor { display:flex; flex-direction:column; height:100%; overflow:hidden; font-size:12px; font-family:var(--sn-font, Georgia, serif); }
  .pg-mon-header { padding:6px 12px; border-bottom:1px solid var(--sn-node-border); background:var(--sn-node-header-bg); font-size:11px; color:var(--sn-text-dim); }
  .pg-mon-body { flex:1; overflow-y:auto; padding:4px; }
  .pg-mon-event {
    display:flex; align-items:center; gap:8px;
    padding:4px 8px; border-radius:4px; font-family:monospace; font-size:11px;
    animation: slideIn 0.15s ease;
  }
  .pg-mon-event:hover { background:var(--sn-node-hover); }
  .pg-mon-arrow { font-weight:bold; width:14px; }
  .pg-mon-call .pg-mon-arrow { color: var(--sn-cat-server, hsl(210, 45%, 45%)); }
  .pg-mon-ok .pg-mon-arrow { color: var(--sn-success-color, hsl(150, 55%, 38%)); }
  .pg-mon-err .pg-mon-arrow { color: var(--sn-danger-color, hsl(4, 55%, 48%)); }
  .pg-mon-tool { color:var(--sn-text); font-weight:600; min-width:100px; }
  .pg-mon-args { color:var(--sn-text-dim); flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .pg-mon-duration { color: hsl(250, 35%, 50%); min-width:50px; text-align:right; }
  .pg-mon-time { color:var(--sn-text-dim); font-size:10px; min-width:60px; text-align:right; }
  .pg-placeholder { color:var(--sn-text-dim); text-align:center; padding:30px; font-style:italic; }
  @keyframes slideIn { from{opacity:0;transform:translateY(-4px)} to{opacity:1;transform:translateY(0)} }
`;

LiveMonitor.reg('pg-live-monitor');
