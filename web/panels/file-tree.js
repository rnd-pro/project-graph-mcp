import Symbiote from '@symbiotejs/symbiote';
import { api, state, events, emit } from '../app.js';

export class FileTree extends Symbiote {
  init$ = {
    treeHTML: '<div class="pg-placeholder">Loading files...</div>',
    filterText: '',
    onFilterInput: (e) => {
      this.$.filterText = e.target.value.toLowerCase();
      this._applyFilter();
    },
  };

  initCallback() {
    events.addEventListener('skeleton-loaded', (e) => {
      this._renderTree(e.detail);
      // After tree renders, apply deep-link if present
      if (state.activeFile) {
        requestAnimationFrame(() => this._highlightFile(state.activeFile));
      }
    });
    if (state.skeleton) this._renderTree(state.skeleton);

    // Route-based file selection (deep-link)
    events.addEventListener('file-selected', (e) => {
      if (e.detail.fromRoute) {
        requestAnimationFrame(() => this._highlightFile(e.detail.path));
      }
    });

    // Event delegation — single click handler on the whole component
    this.addEventListener('click', (e) => {
      const fileEl = e.target.closest('.pg-tree-file');
      if (!fileEl) return;

      // Remove active from all, set on clicked
      this.querySelectorAll('.pg-tree-file.active').forEach(f => f.classList.remove('active'));
      fileEl.classList.add('active');

      state.activeFile = fileEl.dataset.file;
      emit('file-selected', { path: fileEl.dataset.file });
    });
  }

  _highlightFile(filePath) {
    const el = this.querySelector(`.pg-tree-file[data-file="${CSS.escape(filePath)}"]`);
    if (!el) return;
    this.querySelectorAll('.pg-tree-file.active').forEach(f => f.classList.remove('active'));
    el.classList.add('active');
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  _renderTree(skeleton) {
    const nodesObj = skeleton?.n;
    if (!nodesObj || Object.keys(nodesObj).length === 0) {
      this.$.treeHTML = '<div class="pg-placeholder">No files found</div>';
      return;
    }
    const nodes = Object.values(nodesObj);

    // Deduplicate by file path
    const fileMap = new Map();
    for (const node of nodes) {
      const f = node.f || '';
      if (f && !fileMap.has(f)) fileMap.set(f, node);
    }

    const dirs = {};
    for (const [filepath, node] of fileMap) {
      const dir = filepath.includes('/') ? filepath.substring(0, filepath.lastIndexOf('/')) : '.';
      if (!dirs[dir]) dirs[dir] = [];
      dirs[dir].push(node);
    }

    const html = [];
    for (const [dir, files] of Object.entries(dirs).sort()) {
      html.push(`<div class="pg-tree-dir"><span class="material-symbols-outlined" style="font-size:16px">folder</span> ${dir}/</div>`);
      for (const file of files.sort((a, b) => (a.f || '').localeCompare(b.f || ''))) {
        const name = file.f.split('/').pop();
        const funcs = (file.fn || []).length;
        const cls = (file.c || []).length;
        const badge = funcs + cls > 0 ? `<span class="pg-badge">${funcs}f${cls ? ' ' + cls + 'c' : ''}</span>` : '';
        html.push(`<div class="pg-tree-file" data-file="${file.f}"><span class="material-symbols-outlined" style="font-size:14px">insert_drive_file</span> ${name}${badge}</div>`);
      }
    }

    this.$.treeHTML = html.join('');
  }

  _applyFilter() {
    const query = this.$.filterText;
    this.querySelectorAll('.pg-tree-file').forEach(el => {
      el.hidden = query && !el.dataset.file.toLowerCase().includes(query);
    });
  }
}

FileTree.template = /*html*/`
  <div class="pg-panel-toolbar">
    <input type="search" placeholder="Filter files..." bind="oninput: onFilterInput">
  </div>
  <div class="pg-tree-content" bind="innerHTML: treeHTML"></div>
`;

FileTree.rootStyles = /*css*/`
  pg-file-tree {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
    font-size: 12px;
    font-family: var(--sn-font, Georgia, serif);
  }
  pg-file-tree .pg-panel-toolbar {
    padding: 6px 8px;
    border-bottom: 1px solid var(--sn-node-border, hsl(35, 18%, 80%));
  }
  pg-file-tree .pg-panel-toolbar input {
    width: 100%;
    background: var(--sn-bg, hsl(37, 30%, 91%));
    border: 1px solid var(--sn-node-border, hsl(35, 18%, 80%));
    color: var(--sn-text, hsl(30, 15%, 18%));
    padding: 4px 8px;
    border-radius: 4px;
    font-size: 11px;
    font-family: inherit;
    outline: none;
  }
  pg-file-tree .pg-panel-toolbar input:focus {
    border-color: var(--sn-node-selected, hsl(210, 55%, 42%));
  }
  pg-file-tree .pg-tree-content {
    flex: 1;
    overflow-y: auto;
    padding: 4px;
  }
  pg-file-tree .pg-tree-dir {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 3px 6px;
    color: var(--sn-text-dim, hsl(30, 10%, 45%));
    font-weight: 600;
    font-size: 11px;
  }
  pg-file-tree .pg-tree-file {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 3px 6px 3px 20px;
    cursor: pointer;
    border-radius: 4px;
    color: var(--sn-text-dim, hsl(30, 10%, 45%));
    transition: all 100ms ease;
  }
  pg-file-tree .pg-tree-file:hover {
    background: var(--sn-node-hover, hsl(36, 22%, 88%));
    color: var(--sn-text, hsl(30, 15%, 18%));
  }
  pg-file-tree .pg-tree-file.active {
    background: hsla(210, 45%, 45%, 0.12);
    color: var(--sn-cat-server, hsl(210, 45%, 45%));
  }
  pg-file-tree .pg-tree-file[hidden] { display: none; }
  pg-file-tree .pg-badge {
    margin-left: auto;
    font-size: 10px;
    padding: 0 5px;
    border-radius: 8px;
    background: var(--sn-node-hover, hsl(36, 22%, 88%));
    color: var(--sn-text-dim, hsl(30, 10%, 45%));
  }
  pg-file-tree .pg-placeholder {
    color: var(--sn-text-dim, hsl(30, 10%, 45%));
    text-align: center;
    padding: 30px 16px;
    font-style: italic;
  }
`;

FileTree.reg('pg-file-tree');
