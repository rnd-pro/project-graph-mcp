import Symbiote from '@symbiotejs/symbiote';
import { state, events, emit } from '../app.js';

/**
 * <pg-quick-open> — Cmd+K file finder overlay.
 * Fuzzy searches across all project files.
 * Arrow keys to navigate, Enter to open, Escape to close.
 */
export class QuickOpen extends Symbiote {
  init$ = {
    visible: false,
    query: '',
    resultsHTML: '',
    selectedIdx: 0,
  };

  /** @type {Array<{file: string, score: number}>} */
  _results = [];

  /** @type {string[]} */
  _allFiles = [];

  renderCallback() {
    // Collect file list when skeleton loads
    events.addEventListener('skeleton-loaded', (e) => this._collectFiles(e.detail));
    if (state.skeleton) this._collectFiles(state.skeleton);

    // Get overlay element
    this._overlay = this.querySelector('.qo-overlay');

    // Click outside to close
    this._overlay.addEventListener('click', (e) => {
      if (e.target === this._overlay) this._close();
    });

    // Global keyboard shortcut
    document.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        this._toggle();
      }
      if (e.key === 'Escape' && this.$.visible) {
        e.preventDefault();
        this._close();
      }
    });

    // Subscribe to visibility for DOM updates
    this.sub('visible', (v) => {
      if (!this._overlay) return;
      this._overlay.style.display = v ? 'flex' : 'none';
      if (v) {
        requestAnimationFrame(() => {
          const input = this.querySelector('.qo-input');
          if (input) {
            input.value = '';
            input.focus();
          }
        });
      }
    });
  }

  _collectFiles(skeleton) {
    const files = new Set();
    // From exports (X)
    for (const f of Object.keys(skeleton.X || {})) files.add(f);
    // From nodes (n)
    for (const n of Object.values(skeleton.n || {})) { if (n.f) files.add(n.f); }
    // From uncovered (f)
    for (const [dir, list] of Object.entries(skeleton.f || {})) {
      for (const f of list) files.add(dir === './' ? f : `${dir}${f}`);
    }
    // From non-source (a)
    for (const [dir, list] of Object.entries(skeleton.a || {})) {
      for (const f of list) files.add(dir === './' ? f : `${dir}${f}`);
    }
    this._allFiles = [...files].sort();
  }

  _toggle() {
    this.$.visible = !this.$.visible;
    if (this.$.visible) {
      this.$.query = '';
      this.$.selectedIdx = 0;
      this._search('');
    }
  }

  _close() {
    this.$.visible = false;
  }

  _onInput(e) {
    this.$.query = e.target.value;
    this.$.selectedIdx = 0;
    this._search(this.$.query);
  }

  _onKeydown(e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      this.$.selectedIdx = Math.min(this.$.selectedIdx + 1, this._results.length - 1);
      this._renderResults();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      this.$.selectedIdx = Math.max(this.$.selectedIdx - 1, 0);
      this._renderResults();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const selected = this._results[this.$.selectedIdx];
      if (selected) {
        this._close();
        state.activeFile = selected.file;
        emit('file-selected', { path: selected.file });
        // Navigate to explorer if not there
        if (!location.hash.startsWith('#explorer')) {
          location.hash = `explorer/${selected.file}`;
        } else {
          history.replaceState(null, '', `#explorer/${selected.file}`);
        }
      }
    }
  }

  _search(query) {
    const q = query.toLowerCase().trim();
    if (!q) {
      // Show recent/all files
      this._results = this._allFiles.slice(0, 15).map(f => ({ file: f, score: 0 }));
    } else {
      // Fuzzy match — match characters in order
      const scored = [];
      for (const file of this._allFiles) {
        const score = QuickOpen._fuzzyScore(q, file.toLowerCase());
        if (score > 0) scored.push({ file, score });
      }
      scored.sort((a, b) => b.score - a.score);
      this._results = scored.slice(0, 15);
    }
    this._renderResults();
  }

  static _fuzzyScore(query, target) {
    // Exact substring match gets highest score
    if (target.includes(query)) return 100 + (query.length / target.length * 50);

    // Fuzzy: match characters in order
    let qi = 0;
    let consecutiveBonus = 0;
    let score = 0;
    for (let ti = 0; ti < target.length && qi < query.length; ti++) {
      if (target[ti] === query[qi]) {
        qi++;
        score += 10 + consecutiveBonus;
        consecutiveBonus += 5;
        // Bonus for matching at word boundaries
        if (ti === 0 || target[ti - 1] === '/' || target[ti - 1] === '-' || target[ti - 1] === '.') {
          score += 15;
        }
      } else {
        consecutiveBonus = 0;
      }
    }
    return qi === query.length ? score : 0;
  }

  _renderResults() {
    if (this._results.length === 0) {
      this.$.resultsHTML = '<div class="qo-empty">No files found</div>';
      return;
    }
    const html = [];
    for (let i = 0; i < this._results.length; i++) {
      const { file } = this._results[i];
      const name = file.split('/').pop();
      const dir = file.includes('/') ? file.substring(0, file.lastIndexOf('/')) : '';
      const sel = i === this.$.selectedIdx ? ' qo-selected' : '';
      html.push(`<div class="qo-item${sel}" data-idx="${i}" data-file="${file}">
        <span class="qo-name">${name}</span>
        <span class="qo-path">${dir}</span>
      </div>`);
    }
    this.$.resultsHTML = html.join('');
  }
}

QuickOpen.template = /*html*/`
  <div class="qo-overlay">
    <div class="qo-dialog" onclick="event.stopPropagation()">
      <div class="qo-input-wrap">
        <span class="material-symbols-outlined qo-icon">search</span>
        <input class="qo-input" type="text" placeholder="Search files… (↑↓ navigate, Enter open)"
          oninput="this.closest('pg-quick-open')._onInput(event)"
          onkeydown="this.closest('pg-quick-open')._onKeydown(event)">
        <kbd class="qo-kbd">ESC</kbd>
      </div>
      <div class="qo-results" bind="innerHTML: resultsHTML"
        onclick="const item=event.target.closest('.qo-item');if(item){this.closest('pg-quick-open').$.selectedIdx=+item.dataset.idx;this.closest('pg-quick-open')._onKeydown({key:'Enter',preventDefault(){}});}"></div>
    </div>
  </div>
`;

QuickOpen.rootStyles = /*css*/`
  pg-quick-open { position: fixed; inset: 0; z-index: 9999; pointer-events: none; }
  .qo-overlay {
    position: fixed; inset: 0; z-index: 9999;
    background: rgba(0,0,0,0.5);
    display: none; justify-content: center; padding-top: 15vh;
    pointer-events: all;
    animation: qo-fadein 100ms ease;
  }
  .qo-hidden { display: none !important; pointer-events: none; }
  .qo-dialog {
    width: 520px;
    max-height: 420px;
    background: var(--sn-panel-bg, hsl(228, 14%, 18%));
    border: 1px solid var(--sn-node-border, hsl(228, 10%, 28%));
    border-radius: 10px;
    box-shadow: 0 20px 60px rgba(0,0,0,0.5);
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }
  .qo-input-wrap {
    display: flex;
    align-items: center;
    padding: 8px 12px;
    gap: 8px;
    border-bottom: 1px solid var(--sn-node-border, hsl(228, 10%, 28%));
  }
  .qo-icon { color: var(--sn-text-dim); font-size: 20px; }
  .qo-input {
    flex: 1;
    background: transparent;
    border: none;
    color: var(--sn-text, #e0e0e0);
    font-size: 15px;
    font-family: inherit;
    outline: none;
    padding: 6px 0;
  }
  .qo-input::placeholder { color: var(--sn-text-dim); }
  .qo-kbd {
    font-size: 10px;
    padding: 2px 6px;
    border-radius: 4px;
    background: var(--sn-node-bg, hsl(228, 14%, 22%));
    border: 1px solid var(--sn-node-border);
    color: var(--sn-text-dim);
    font-family: monospace;
  }
  .qo-results {
    overflow-y: auto;
    padding: 4px 0;
    max-height: 350px;
  }
  .qo-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 16px;
    cursor: pointer;
    transition: background 80ms ease;
  }
  .qo-item:hover { background: var(--sn-node-hover, hsl(228, 14%, 22%)); }
  .qo-item.qo-selected {
    background: hsla(210, 55%, 45%, 0.2);
  }
  .qo-name {
    font-size: 13px;
    color: var(--sn-text, #e0e0e0);
    font-weight: 500;
  }
  .qo-path {
    font-size: 11px;
    color: var(--sn-text-dim);
    margin-left: auto;
    font-family: 'SF Mono', monospace;
  }
  .qo-empty {
    padding: 20px;
    text-align: center;
    color: var(--sn-text-dim);
    font-style: italic;
  }
  @keyframes qo-fadein { from { opacity: 0; } to { opacity: 1; } }
`;

QuickOpen.reg('pg-quick-open');
