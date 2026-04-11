import Symbiote from '@symbiotejs/symbiote';
import { api, events, state } from '../app.js';

export class CtxPanel extends Symbiote {
  init$ = {
    contentHTML: '<div class="pg-placeholder">Select a file to view documentation</div>',
    outlineHTML: '',
  };

  initCallback() {
    events.addEventListener('file-selected', (e) => {
      this._loadCtx(e.detail.path);
      this._loadOutline(e.detail.path);
    });
  }

  _loadOutline(filepath) {
    const skeleton = state.skeleton;
    if (!skeleton) { this.$.outlineHTML = ''; return; }

    const X = skeleton.X || {};
    const L = skeleton.L || {};
    const symbols = X[filepath];

    if (!symbols || symbols.length === 0) {
      this.$.outlineHTML = '';
      return;
    }

    const items = symbols.map(sym => {
      const name = L[sym] || sym;
      return `<div class="pg-outline-item" title="${sym}">
        <span class="material-symbols-outlined" style="font-size:13px">function</span>
        <span>${name}</span>
      </div>`;
    }).join('');

    this.$.outlineHTML = `
      <div class="pg-outline-section">
        <div class="pg-outline-title">
          <span class="material-symbols-outlined" style="font-size:14px">account_tree</span>
          Exports · ${symbols.length}
        </div>
        ${items}
      </div>
    `;
  }

  async _loadCtx(filepath) {
    this.$.contentHTML = '<div class="pg-placeholder pg-pulse">Loading docs...</div>';

    try {
      const docs = await api('/api/docs', { file: filepath });
      const content = docs?.docs || docs?.content || '';

      if (!content) {
        this.$.contentHTML = '<div class="pg-placeholder">No .ctx documentation</div>';
        return;
      }

      if (typeof content === 'string') {
        this.$.contentHTML = this._formatCtx(content);
      } else {
        this.$.contentHTML = `<pre class="pg-ctx-raw">${JSON.stringify(content, null, 2)}</pre>`;
      }
    } catch {
      this.$.contentHTML = '<div class="pg-placeholder">No documentation available</div>';
    }
  }

  _formatCtx(text) {
    return text.split('\n').map(line => {
      const esc = line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      if (line.startsWith('export ') || line.match(/^\s+\w/)) {
        return `<div class="pg-ctx-sig">${esc}</div>`;
      }
      if (line.startsWith('- [x]')) return `<div class="pg-ctx-test passed">✅ ${esc.slice(5)}</div>`;
      if (line.startsWith('- [ ]')) return `<div class="pg-ctx-test pending">⬜ ${esc.slice(5)}</div>`;
      if (line.trim()) return `<div class="pg-ctx-desc">${esc}</div>`;
      return '';
    }).join('');
  }
}

CtxPanel.template = /*html*/`
  <div class="pg-ctx-outline" bind="innerHTML: outlineHTML"></div>
  <div class="pg-ctx-body" bind="innerHTML: contentHTML"></div>
`;

CtxPanel.rootStyles = /*css*/`
  pg-ctx-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow-y: auto;
    font-size: 12px;
    padding: 0;
    font-family: var(--sn-font, Georgia, serif);
  }
  .pg-ctx-outline { padding: 0; }
  .pg-ctx-body { padding: 8px; }
  .pg-outline-section {
    border-bottom: 1px solid var(--sn-node-border, hsl(228, 10%, 28%));
    padding: 8px;
  }
  .pg-outline-title {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    font-weight: 600;
    color: var(--sn-text-dim);
    padding: 4px 4px 6px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .pg-outline-item {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px;
    cursor: default;
    border-radius: 4px;
    font-family: 'SF Mono', 'Fira Code', monospace;
    font-size: 11px;
    color: var(--sn-cat-server, hsl(210, 45%, 45%));
    transition: background 80ms ease;
  }
  .pg-outline-item:hover {
    background: var(--sn-node-hover, hsl(228, 14%, 22%));
  }
  .pg-ctx-sig {
    font-family: 'SF Mono', monospace;
    font-size: 11px;
    padding: 6px 8px;
    margin: 4px 0;
    background: var(--sn-bg, hsl(37, 30%, 91%));
    border-radius: 4px;
    border-left: 3px solid var(--sn-cat-server, hsl(210, 45%, 45%));
    color: var(--sn-text-dim, hsl(30, 10%, 45%));
  }
  .pg-ctx-desc { padding: 4px 0; color: var(--sn-text); }
  .pg-ctx-test { padding: 3px 0; font-size: 12px; }
  .pg-ctx-raw { font-size: 11px; color: var(--sn-text-dim); }
  .pg-placeholder { color: var(--sn-text-dim); text-align:center; padding:30px; font-style:italic; }
  .pg-pulse { animation: pulse 1.5s ease infinite; }
  @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
`;

CtxPanel.reg('pg-ctx-panel');
