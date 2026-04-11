import Symbiote from '@symbiotejs/symbiote';
import { api, events, state } from '../app.js';
import '../components/code-block.js';

/**
 * <pg-code-viewer> — file loading panel for the Explorer.
 * Fetches file content from API, delegates rendering to <code-block>.
 * Supports Compact/Raw toggle for Mode 4 demonstration.
 */
export class CodeViewer extends Symbiote {
  init$ = {
    filename: 'Select a file',
    hasFile: false,
    viewMode: 'compact', // 'compact' | 'raw'
    statsText: '',
    onToggleMode: () => {
      this.$.viewMode = this.$.viewMode === 'compact' ? 'raw' : 'compact';
      this._showCurrentMode();
    },
  };

  /** @type {{ compact: string, raw: string, legend: string, original: number, compressed: number, savings: string } | null} */
  _fileData = null;

  initCallback() {
    events.addEventListener('file-selected', (e) => this._loadFile(e.detail.path));
  }

  renderCallback() {
    this.sub('hasFile', (val) => {
      this.toggleAttribute('has-file', val);
    });
    this.sub('viewMode', (mode) => {
      this.toggleAttribute('mode-raw', mode === 'raw');
    });
  }

  _getCodeBlock() {
    return this.querySelector('code-block');
  }

  _showCurrentMode() {
    if (!this._fileData) return;
    const cb = this._getCodeBlock();
    if (!cb) return;
    cb.$.code = this.$.viewMode === 'compact'
      ? this._fileData.compact
      : this._fileData.raw;
  }

  async _loadFile(filepath) {
    this.$.filename = filepath;
    this.$.hasFile = false;
    this._fileData = null;
    this.$.statsText = '';
    this.$.viewMode = 'compact';

    try {
      // Fetch compact (beautified) version
      const data = await api('/api/file', { path: filepath });
      const compactCode = typeof data.code === 'string' ? data.code
        : typeof data.compressed === 'string' ? data.compressed
        : data.content || JSON.stringify(data, null, 2);

      // Try to fetch raw version (original source)
      let rawCode = compactCode;
      try {
        const rawData = await api('/api/raw-file', { path: filepath });
        if (rawData?.content) rawCode = rawData.content;
      } catch {
        // /api/raw-file not available — fallback to compact
      }

      this._fileData = {
        compact: compactCode,
        raw: rawCode,
        original: data.original || 0,
        compressed: data.compressed || 0,
        savings: data.savings || '0%',
      };

      // Update stats
      if (data.original && data.compressed) {
        this.$.statsText = `${data.original} → ${data.compressed} tok (${data.savings})`;
      }

      const cb = this._getCodeBlock();
      if (cb) cb.$.code = compactCode;
      this.$.hasFile = true;
    } catch (err) {
      const cb = this._getCodeBlock();
      if (cb) cb.$.code = `// Error: ${err.message}`;
      this.$.hasFile = true;
    }
  }
}

CodeViewer.template = /*html*/`
  <div class="pg-code-header">
    <span class="pg-code-filename" bind="textContent: filename"></span>
    <div class="pg-code-controls">
      <span class="pg-code-stats" bind="textContent: statsText"></span>
      <button class="pg-mode-toggle" bind="onclick: onToggleMode" title="Toggle Compact/Raw view">
        <span class="material-symbols-outlined" style="font-size:14px">compress</span>
        <span class="pg-mode-label" bind="textContent: viewMode"></span>
      </button>
    </div>
  </div>
  <code-block></code-block>
`;

CodeViewer.rootStyles = /*css*/`
  pg-code-viewer {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
  }
  pg-code-viewer:not([has-file]) code-block {
    display: none;
  }
  .pg-code-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 12px;
    font-family: 'SF Mono', 'Fira Code', monospace;
    font-size: 11px;
    color: var(--sn-text-dim, hsl(30, 10%, 45%));
    border-bottom: 1px solid var(--sn-node-border, hsl(35, 18%, 80%));
    background: var(--sn-node-header-bg, hsl(37, 25%, 93%));
    gap: 8px;
  }
  .pg-code-filename {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
  }
  .pg-code-controls {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
  }
  .pg-code-stats {
    font-size: 10px;
    color: var(--sn-cat-server, hsl(210, 45%, 45%));
    white-space: nowrap;
  }
  .pg-mode-toggle {
    display: flex;
    align-items: center;
    gap: 3px;
    padding: 2px 8px;
    border: 1px solid var(--sn-node-border, hsl(35, 18%, 80%));
    border-radius: 4px;
    background: var(--sn-bg, hsl(37, 30%, 91%));
    color: var(--sn-text-dim, hsl(30, 10%, 45%));
    font-family: inherit;
    font-size: 10px;
    cursor: pointer;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    transition: all 120ms ease;
  }
  .pg-mode-toggle:hover {
    background: var(--sn-node-hover, hsl(36, 22%, 88%));
    color: var(--sn-text, hsl(30, 15%, 18%));
  }
  pg-code-viewer[mode-raw] .pg-mode-toggle {
    background: hsla(210, 45%, 45%, 0.12);
    border-color: var(--sn-cat-server, hsl(210, 45%, 45%));
    color: var(--sn-cat-server, hsl(210, 45%, 45%));
  }
  code-block {
    flex: 1;
    min-height: 0;
  }
`;

CodeViewer.reg('pg-code-viewer');
