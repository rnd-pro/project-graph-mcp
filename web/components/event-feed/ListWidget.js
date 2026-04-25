import Symbiote from "@symbiotejs/symbiote";

export class ListWidget extends Symbiote {
  init$ = {
    '@data': '',
    listHTML: ''
  };

  renderCallback() {
    this.sub('@data', (dataStr) => {
      if (!dataStr) return;
      
      let items = [];
      try {
        const parsed = JSON.parse(dataStr);
        if (Array.isArray(parsed)) items = parsed;
        else if (typeof parsed === 'object') items = Object.entries(parsed).map(([k, v]) => `${k}: ${v}`);
      } catch {
        // If not JSON, split by lines
        items = dataStr.split('\n').filter(Boolean);
      }

      if (items.length === 0) {
        this.$.listHTML = '<div class="pg-placeholder">Empty list</div>';
        return;
      }

      // Truncate to 50 items
      const hasMore = items.length > 50;
      const displayItems = items.slice(0, 50);

      let html = '<ul class="list-widget-ul">';
      displayItems.forEach(item => {
        let text = typeof item === 'string' ? item : JSON.stringify(item);
        html += `<li>${this._esc(text)}</li>`;
      });
      html += '</ul>';

      if (hasMore) {
        html += `<div class="list-widget-more">...and ${items.length - 50} more items</div>`;
      }

      this.$.listHTML = html;
    });
  }

  _esc(s) {
    if (typeof s !== 'string') return '';
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/'/g, "&#39;").replace(/"/g, "&quot;");
  }
}

ListWidget.template = `
<div class="list-widget" bind="innerHTML: listHTML"></div>
`;

ListWidget.reg('pg-list-widget');
