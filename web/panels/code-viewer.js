import Symbiote from '@symbiotejs/symbiote';
import { api, events, state } from '../app.js';
import '../components/code-block.js';

/**
 * <pg-code-viewer> — file loading panel for the Explorer.
 * Fetches file content from API, delegates rendering to <code-block>.
 */
export class CodeViewer extends Symbiote {
  init$ = {
    filename: 'Select a file',
    hasFile: false,
  };

  initCallback() {
    events.addEventListener('file-selected', (e) => this._loadFile(e.detail.path));
  }

  renderCallback() {
    this.sub('hasFile', (val) => {
      this.toggleAttribute('has-file', val);
    });
  }

  _getCodeBlock() {
    return this.querySelector('code-block');
  }

  async _loadFile(filepath) {
    this.$.filename = filepath;
    this.$.hasFile = false;

    try {
      const data = await api('/api/file', { path: filepath });
      const code = typeof data.compressed === 'string' ? data.compressed
        : typeof data.code === 'string' ? data.code
        : data.content || JSON.stringify(data, null, 2);

      const cb = this._getCodeBlock();
      if (cb) cb.$.code = code;
      this.$.hasFile = true;
    } catch (err) {
      const cb = this._getCodeBlock();
      if (cb) cb.$.code = `// Error: ${err.message}`;
      this.$.hasFile = true;
    }
  }
}

CodeViewer.template = /*html*/`
  <div class="pg-code-header" bind="textContent: filename"></div>
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
    padding: 6px 12px;
    font-family: 'SF Mono', 'Fira Code', monospace;
    font-size: 11px;
    color: var(--sn-text-dim, hsl(30, 10%, 45%));
    border-bottom: 1px solid var(--sn-node-border, hsl(35, 18%, 80%));
    background: var(--sn-node-header-bg, hsl(37, 25%, 93%));
  }
  code-block {
    flex: 1;
    min-height: 0;
  }
`;

CodeViewer.reg('pg-code-viewer');
