import Symbiote from "@symbiotejs/symbiote";

export class CodeWidget extends Symbiote {
  init$ = {
    '@source': '',
    truncatedSource: '',
    expanded: false,
    hasMore: false
  };

  renderCallback() {
    this.sub('@source', (src) => {
      if (!src) return;
      const lines = src.split('\n');
      if (lines.length > 10) {
        this.$.hasMore = true;
        this.$.truncatedSource = lines.slice(0, 10).join('\n') + '\n...';
      } else {
        this.$.hasMore = false;
        this.$.truncatedSource = src;
      }
    });
  }
}

CodeWidget.template = `
<div class="code-widget">
  <pre class="code-block" ${{ textContent: 'truncatedSource' }}></pre>
</div>
`;

CodeWidget.reg('pg-code-widget');
