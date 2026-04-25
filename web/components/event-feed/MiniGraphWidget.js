import Symbiote from "@symbiotejs/symbiote";

export class MiniGraphWidget extends Symbiote {
  init$ = {
    '@data': '',
    svgContent: ''
  };

  renderCallback() {
    this.sub('@data', (dataStr) => {
      if (!dataStr) return;
      let data;
      try {
        data = JSON.parse(dataStr);
      } catch {
        return;
      }
      this._renderSVG(data);
    });
  }

  _renderSVG(data) {
    // Basic SVG renderer for mini graphs to avoid WebGL context explosion
    // Extracts nodes and links if present in the data
    const nodes = data.nodes || (data.n ? Object.keys(data.n).map(id => ({ id, ...data.n[id] })) : []);
    const links = data.links || [];

    if (!nodes.length) {
      this.$.svgContent = '<text x="10" y="20" fill="var(--sn-text-dim)">No graph data</text>';
      return;
    }

    // Simple circle layout for demonstration
    const width = 300;
    const height = 150;
    const cx = width / 2;
    const cy = height / 2;
    const radius = 50;

    let svg = '';
    
    // Draw links
    // (Needs actual layout logic, this is a placeholder circle layout)
    
    // Draw nodes
    nodes.forEach((n, i) => {
      const angle = (i / nodes.length) * Math.PI * 2;
      const x = cx + Math.cos(angle) * radius;
      const y = cy + Math.sin(angle) * radius;
      svg += `<circle cx="${x}" cy="${y}" r="4" fill="var(--sn-node-selected, #4c8bf5)"></circle>`;
      svg += `<text x="${x + 6}" y="${y + 3}" fill="var(--sn-text)" font-size="10">${this._esc(n.id || n.name || 'node')}</text>`;
    });

    this.$.svgContent = svg;
  }

  _esc(s) {
    if (typeof s !== 'string') return '';
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/'/g, "&#39;").replace(/"/g, "&quot;");
  }
}

MiniGraphWidget.template = `
<div class="mini-graph-widget">
  <svg width="100%" height="150" viewBox="0 0 300 150" bind="innerHTML: svgContent"></svg>
</div>
`;

MiniGraphWidget.reg('pg-mini-graph');
