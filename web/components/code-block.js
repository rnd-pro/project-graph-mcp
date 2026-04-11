import Symbiote from '@symbiotejs/symbiote';
import { highlight } from '../highlight.js';

/**
 * <code-block> — reusable syntax-highlighted code display with line numbers.
 * 
 * Usage:
 *   const el = document.createElement('code-block');
 *   el.$.code = sourceString;
 * 
 * Accepts `code` (string) and `lang` (string, default: javascript).
 * Highlighting is done via the project's own tokenizer.
 */
export class CodeBlock extends Symbiote {
  init$ = {
    code: '',
    highlighted: '',
    lineNums: '',
  };

  renderCallback() {
    this.sub('code', (val) => {
      if (!val) {
        this.$.highlighted = '';
        this.$.lineNums = '';
        return;
      }
      this.$.highlighted = highlight(val);
      // Generate line numbers
      const lines = val.split('\n').length;
      const nums = [];
      for (let i = 1; i <= lines; i++) nums.push(i);
      this.$.lineNums = nums.join('\n');
    });
  }
}

CodeBlock.template = /*html*/`
  <div class="cb-scroll">
    <pre class="cb-gutter" bind="textContent: lineNums"></pre>
    <pre class="cb-pre"><code bind="innerHTML: highlighted"></code></pre>
  </div>
`;

// symbiotejs.org palette
CodeBlock.rootStyles = /*css*/`
  code-block {
    display: block;
    height: 100%;
    overflow: hidden;
  }
  code-block .cb-scroll {
    display: flex;
    height: 100%;
    overflow: auto;
  }
  code-block .cb-gutter {
    position: sticky;
    left: 0;
    z-index: 1;
    margin: 0;
    padding: 12px 8px 12px 12px;
    font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
    font-size: 12px;
    line-height: 1.6;
    text-align: right;
    color: var(--sn-text-dim, hsl(30, 10%, 55%));
    opacity: 0.45;
    background: var(--sn-bg, hsl(37, 30%, 96%));
    border-right: 1px solid var(--sn-node-border, hsl(35, 18%, 88%));
    user-select: none;
    white-space: pre;
    min-width: 32px;
  }
  code-block .cb-pre {
    margin: 0;
    padding: 12px;
    flex: 1;
    min-width: 0;
    font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
    font-size: 12px;
    line-height: 1.6;
    color: var(--sn-text, hsl(30, 15%, 18%));
    tab-size: 2;
    white-space: pre;
    box-sizing: border-box;
  }
  /* Token colors */
  code-block .t-kw   { color: rgb(254, 165, 176); }
  code-block .t-str  { color: rgb(251, 182, 79); }
  code-block .t-cm   { color: rgb(149, 149, 149); font-style: italic; }
  code-block .t-fn   { color: rgb(180, 243, 255); }
  code-block .t-num  { color: rgb(251, 182, 79); }
  code-block .t-bi   { color: rgb(180, 243, 255); }
  code-block .t-prop { color: rgb(238, 131, 252); }
  code-block .t-lit  { color: rgb(254, 165, 176); }
`;

CodeBlock.reg('code-block');
