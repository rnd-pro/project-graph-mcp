import Symbiote from '@symbiotejs/symbiote';
import { api, state, events, emit } from '../app.js';

/**
 * <pg-dep-graph> — Dependency viewer panel.
 * Shows imports, exports, functions/classes for selected file.
 * Clickable imports navigate to the target file.
 * Shows reverse deps (who imports this file).
 */
export class DepGraph extends Symbiote {
  init$ = {
    contentHTML: '<div class="pg-placeholder">Select a file to see dependencies</div>',
  };

  initCallback() {
    events.addEventListener('file-selected', (e) => this._loadDeps(e.detail.path));
    events.addEventListener('skeleton-loaded', () => this._renderOverview());
    if (state.skeleton) this._renderOverview();

    // Delegated click handler for clickable deps
    this.addEventListener('click', (e) => {
      const el = /** @type {HTMLElement} */ (e.target).closest('[data-file]');
      if (el) {
        const filepath = el.dataset.file;
        state.activeFile = filepath;
        emit('file-selected', { path: filepath });
      }
    });
  }

  _renderOverview() {
    if (!state.skeleton) return;
    const stats = state.skeleton.s || {};
    const X = state.skeleton.X || {};
    const nodes = Object.values(state.skeleton.n || {});
    const html = ['<div class="pg-graph-stats">'];

    const totalFiles = stats.files || Object.keys(X).length;
    const totalFn = stats.functions || 0;
    const totalCls = stats.classes || 0;
    const totalExports = Object.values(X).reduce((s, v) => s + v.length, 0);

    html.push(`<div class="pg-stat"><span class="pg-stat-val">${totalFiles}</span><span class="pg-stat-label">Files</span></div>`);
    html.push(`<div class="pg-stat"><span class="pg-stat-val">${totalFn}</span><span class="pg-stat-label">Functions</span></div>`);
    html.push(`<div class="pg-stat"><span class="pg-stat-val">${totalCls}</span><span class="pg-stat-label">Classes</span></div>`);
    html.push(`<div class="pg-stat"><span class="pg-stat-val">${totalExports}</span><span class="pg-stat-label">Exports</span></div>`);
    html.push('</div>');

    // Top connected files (most exports from skeleton.X)
    const connectivity = [];
    for (const [file, symbols] of Object.entries(X)) {
      connectivity.push({ file, exports: symbols.length });
    }
    connectivity.sort((a, b) => b.exports - a.exports);

    html.push('<div class="pg-dep-section"><div class="pg-dep-label">Most Exported</div>');
    for (const item of connectivity.slice(0, 10)) {
      html.push(`<div class="pg-dep-item pg-dep-nav" data-file="${item.file}">
        <span class="pg-dep-file">${item.file}</span>
        <span class="pg-dep-badge">${item.exports} exports</span>
      </div>`);
    }
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

      // Imports — clickable navigation to source file
      if (node.i?.length) {
        html.push('<div class="pg-dep-section"><div class="pg-dep-label">Imports</div>');
        for (const imp of node.i) {
          const source = imp.s || imp;
          // Find the actual file in the skeleton
          const targetNode = Object.values(state.skeleton.n).find(n =>
            n.f === source || n.f?.endsWith('/' + source) || n.f?.endsWith(source + '.js')
          );
          if (targetNode) {
            html.push(`<div class="pg-dep-item pg-dep-nav pg-dep-import" data-file="${targetNode.f}">
              <span class="material-symbols-outlined" style="font-size:14px">arrow_back</span>
              ${source}
            </div>`);
          } else {
            html.push(`<div class="pg-dep-item pg-dep-import">
              <span class="material-symbols-outlined" style="font-size:14px">arrow_back</span>
              ${source}
              <span class="pg-dep-ext">external</span>
            </div>`);
          }
        }
        html.push('</div>');
      }

      // Reverse deps — who imports THIS file
      const importers = [];
      for (const n of Object.values(state.skeleton?.n || {})) {
        if (n.f === filepath) continue;
        const imports = n.i || [];
        for (const imp of imports) {
          const source = imp.s || imp;
          if (source === filepath || filepath.endsWith(source) || filepath.endsWith(source + '.js')) {
            importers.push(n.f);
            break;
          }
        }
      }
      if (importers.length) {
        html.push('<div class="pg-dep-section"><div class="pg-dep-label">Imported By</div>');
        for (const imp of importers) {
          html.push(`<div class="pg-dep-item pg-dep-nav pg-dep-importer" data-file="${imp}">
            <span class="material-symbols-outlined" style="font-size:14px">arrow_forward</span>
            ${imp}
          </div>`);
        }
        html.push('</div>');
      }

      // Exports
      if (node.e?.length) {
        html.push('<div class="pg-dep-section"><div class="pg-dep-label">Exports</div>');
        for (const exp of node.e) {
          html.push(`<div class="pg-dep-item pg-dep-export">→ ${exp}</div>`);
        }
        html.push('</div>');
      }

      // Functions
      if (node.fn?.length) {
        html.push('<div class="pg-dep-section"><div class="pg-dep-label">Functions</div>');
        for (const fn of node.fn) {
          const name = fn.n || fn;
          const params = fn.p ? `(${fn.p})` : '()';
          html.push(`<div class="pg-dep-item pg-dep-fn">ƒ ${name}${params}</div>`);
        }
        html.push('</div>');
      }

      // Classes
      if (node.c?.length) {
        html.push('<div class="pg-dep-section"><div class="pg-dep-label">Classes</div>');
        for (const cls of node.c) {
          const name = cls.n || cls;
          const ext = cls.x ? ` extends ${cls.x}` : '';
          const methods = cls.m?.map(m => m.n || m).join(', ') || '';
          html.push(`<div class="pg-dep-item pg-dep-class">◆ ${name}${ext}</div>`);
          if (methods) {
            html.push(`<div class="pg-dep-item pg-dep-methods">&nbsp;&nbsp;methods: ${methods}</div>`);
          }
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
  .pg-graph-stats { display:flex; gap:8px; margin-bottom:16px; flex-wrap:wrap; }
  .pg-stat {
    background: var(--sn-node-bg, hsl(40, 33%, 96%));
    border: 1px solid var(--sn-node-border, hsl(35, 18%, 80%));
    border-radius: 6px;
    padding: 10px 14px;
    text-align: center;
    flex: 1;
    min-width: 60px;
  }
  .pg-stat-val { display:block; font-size:22px; font-weight:700; color:var(--sn-cat-server, hsl(210, 45%, 45%)); font-family:monospace; }
  .pg-stat-label { font-size:9px; text-transform:uppercase; color:var(--sn-text-dim); letter-spacing:0.5px; }
  .pg-dep-title { font-size:13px; color:var(--sn-text); margin:0 0 12px 0; font-family:monospace; }
  .pg-dep-section { margin-bottom:12px; }
  .pg-dep-label { font-size:10px; text-transform:uppercase; letter-spacing:0.5px; color:var(--sn-text-dim); margin-bottom:4px; font-weight:600; }
  .pg-dep-item {
    padding: 4px 8px;
    border-radius: 4px;
    font-family: 'SF Mono', 'Fira Code', monospace;
    font-size: 11px;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .pg-dep-nav {
    cursor: pointer;
    transition: background 120ms ease;
  }
  .pg-dep-nav:hover {
    background: var(--sn-node-hover, hsl(36, 22%, 88%));
  }
  .pg-dep-import { color: hsl(210, 45%, 45%); }
  .pg-dep-importer { color: hsl(30, 55%, 50%); }
  .pg-dep-export { color: hsl(150, 40%, 38%); }
  .pg-dep-fn { color: hsl(250, 35%, 50%); }
  .pg-dep-class { color: hsl(330, 40%, 50%); }
  .pg-dep-methods { color: var(--sn-text-dim); font-size:10px; }
  .pg-dep-ext {
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    opacity: 0.5;
    margin-left: auto;
  }
  .pg-dep-file { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .pg-dep-badge {
    font-size: 10px;
    color: var(--sn-text-dim);
    white-space: nowrap;
  }
  .pg-placeholder { color:var(--sn-text-dim); text-align:center; padding:30px; font-style:italic; }
  .pg-pulse { animation:pulse 1.5s ease infinite; }
  @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
`;

DepGraph.reg('pg-dep-graph');
