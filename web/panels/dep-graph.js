import Symbiote from '@symbiotejs/symbiote';
import { api, state, events } from '../app.js';

export class DepGraph extends Symbiote {
  init$ = {
    contentHTML: '<div class="pg-placeholder">Select a file to see dependencies</div>',
  };

  initCallback() {
    events.addEventListener('file-selected', (e) => this._loadDeps(e.detail.path));
    events.addEventListener('skeleton-loaded', () => this._renderOverview());
    if (state.skeleton) this._renderOverview();
  }

  _renderOverview() {
    if (!state.skeleton?.n) return;
    const nodes = Object.values(state.skeleton.n);
    const html = ['<div class="pg-graph-stats">'];
    html.push(`<div class="pg-stat"><span class="pg-stat-val">${nodes.length}</span><span class="pg-stat-label">Files</span></div>`);

    let totalFn = 0, totalCls = 0, totalImp = 0;
    for (const n of nodes) {
      totalFn += (n.fn || []).length;
      totalCls += (n.c || []).length;
      totalImp += (n.i || []).length;
    }
    html.push(`<div class="pg-stat"><span class="pg-stat-val">${totalFn}</span><span class="pg-stat-label">Functions</span></div>`);
    html.push(`<div class="pg-stat"><span class="pg-stat-val">${totalCls}</span><span class="pg-stat-label">Classes</span></div>`);
    html.push(`<div class="pg-stat"><span class="pg-stat-val">${totalImp}</span><span class="pg-stat-label">Imports</span></div>`);
    html.push('</div>');
    this.$.contentHTML = html.join('');
  }

  async _loadDeps(filepath) {
    this.$.contentHTML = '<div class="pg-placeholder pg-pulse">Loading dependencies...</div>';
    try {
      const node = Object.values(state.skeleton?.n || {}).find(n => n.f === filepath);
      if (!node) {
        this.$.contentHTML = '<div class="pg-placeholder">File not in graph</div>';
        return;
      }

      const html = [];
      html.push(`<h3 class="pg-dep-title">${filepath}</h3>`);

      if (node.i?.length) {
        html.push('<div class="pg-dep-section"><div class="pg-dep-label">Imports</div>');
        for (const imp of node.i) {
          html.push(`<div class="pg-dep-item pg-dep-import">← ${imp.s || imp}</div>`);
        }
        html.push('</div>');
      }

      if (node.e?.length) {
        html.push('<div class="pg-dep-section"><div class="pg-dep-label">Exports</div>');
        for (const exp of node.e) {
          html.push(`<div class="pg-dep-item pg-dep-export">→ ${exp}</div>`);
        }
        html.push('</div>');
      }

      if (node.fn?.length) {
        html.push('<div class="pg-dep-section"><div class="pg-dep-label">Functions</div>');
        for (const fn of node.fn) {
          html.push(`<div class="pg-dep-item pg-dep-fn">ƒ ${fn.n || fn}</div>`);
        }
        html.push('</div>');
      }

      this.$.contentHTML = html.join('');
    } catch (err) {
      this.$.contentHTML = `<div class="pg-placeholder" style="color:var(--sn-danger-color)">Error: ${err.message}</div>`;
    }
  }
}

DepGraph.template = /*html*/`<div class="pg-graph-body" bind="innerHTML: contentHTML"></div>`;

DepGraph.rootStyles = /*css*/`
  pg-dep-graph { display:block; height:100%; overflow-y:auto; padding:12px; font-size:12px; font-family:var(--sn-font, Georgia, serif); }
  .pg-graph-stats { display:flex; gap:12px; margin-bottom:16px; flex-wrap:wrap; }
  .pg-stat {
    background: var(--sn-node-bg, hsl(40, 33%, 96%));
    border: 1px solid var(--sn-node-border, hsl(35, 18%, 80%));
    border-radius: 6px;
    padding: 12px 16px;
    text-align: center;
    flex: 1;
    min-width: 80px;
  }
  .pg-stat-val { display:block; font-size:24px; font-weight:700; color:var(--sn-cat-server, hsl(210, 45%, 45%)); font-family:monospace; }
  .pg-stat-label { font-size:10px; text-transform:uppercase; color:var(--sn-text-dim); letter-spacing:0.5px; }
  .pg-dep-title { font-size:13px; color:var(--sn-text); margin-bottom:12px; font-family:monospace; }
  .pg-dep-section { margin-bottom:12px; }
  .pg-dep-label { font-size:10px; text-transform:uppercase; letter-spacing:0.5px; color:var(--sn-text-dim); margin-bottom:4px; font-weight:600; }
  .pg-dep-item { padding:3px 8px; border-radius:4px; font-family:monospace; font-size:11px; }
  .pg-dep-import { color: hsl(210, 45%, 45%); }
  .pg-dep-export { color: hsl(150, 40%, 38%); }
  .pg-dep-fn { color: hsl(250, 35%, 50%); }
  .pg-dep-item:hover { background:var(--sn-node-hover); }
  .pg-placeholder { color:var(--sn-text-dim); text-align:center; padding:30px; font-style:italic; }
  .pg-pulse { animation:pulse 1.5s ease infinite; }
  @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
`;

DepGraph.reg('pg-dep-graph');
