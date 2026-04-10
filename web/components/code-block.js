import Symbiote from '@symbiotejs/symbiote';
import { highlight } from '../highlight.js';

/**
 * <code-block> — reusable syntax-highlighted code display.
 * 
 * Usage:
 *   const el = document.createElement('code-block');
 *   el.$.code = sourceString;
 *   // or via state: this.$.code = '...';
 * 
 * Accepts `code` (string) and `lang` (string, default: javascript).
 * Highlighting is done via the project's own tokenizer.
 */
export class CodeBlock extends Symbiote {
  init$ = {
    code: '',
    highlighted: '',
  };

  renderCallback() {
    this.sub('code', (val) => {
      if (!val) {
        this.$.highlighted = '';
        return;
      }
      this.$.highlighted = highlight(val);
    });
  }
}

CodeBlock.template = /*html*/`
  <pre class="cb-pre"><code bind="innerHTML: highlighted"></code></pre>
`;

// symbiotejs.org palette
CodeBlock.rootStyles = /*css*/`
  code-block {
    display: block;
    height: 100%;
    overflow: hidden;
  }
  code-block .cb-pre {
    margin: 0;
    padding: 12px;
    height: 100%;
    overflow: auto;
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
