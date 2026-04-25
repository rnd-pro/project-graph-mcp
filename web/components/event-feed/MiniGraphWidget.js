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
    const nodes = data.nodes || (data.n ? Object.keys(data.n).map(id => ({ id, ...data.n[id] })) : []);
    const rawLinks = data.links || data.e || [];
    
    // Some formats use {from, to}, some use {source, target}
    const links = rawLinks.map(l => ({
      from: l.from || l.source,
      to: l.to || l.target
    }));

    if (!nodes.length) {
      this.$.svgContent = '<text x="10" y="20" fill="var(--sn-text-dim)">No graph data</text>';
      return;
    }

    const width = 300;
    const height = 150;
    
    // Initial deterministic positions (circle)
    nodes.forEach((n, i) => {
      const angle = (i / nodes.length) * Math.PI * 2;
      n.x = width / 2 + Math.cos(angle) * (Math.min(width, height) / 4);
      n.y = height / 2 + Math.sin(angle) * (Math.min(width, height) / 4);
      n.vx = 0; n.vy = 0;
    });

    const K = 0.05; // Spring
    const L = 40;  // Ideal length
    const REP = 300; // Repulsion
    const DAMP = 0.8; 

    // Run 100 iterations
    for (let i = 0; i < 100; i++) {
      for (let j = 0; j < nodes.length; j++) {
        for (let k = j + 1; k < nodes.length; k++) {
          const a = nodes[j], b = nodes[k];
          let dx = a.x - b.x, dy = a.y - b.y;
          let dist = Math.sqrt(dx*dx + dy*dy) || 0.1;
          let f = REP / (dist * dist);
          const fx = (dx / dist) * f;
          const fy = (dy / dist) * f;
          a.vx += fx; a.vy += fy;
          b.vx -= fx; b.vy -= fy;
        }
      }
      links.forEach(link => {
        const a = nodes.find(n => n.id === link.from);
        const b = nodes.find(n => n.id === link.to);
        if (!a || !b) return;
        let dx = b.x - a.x, dy = b.y - a.y;
        let dist = Math.sqrt(dx*dx + dy*dy) || 0.1;
        let f = (dist - L) * K;
        const fx = (dx / dist) * f;
        const fy = (dy / dist) * f;
        a.vx += fx; a.vy += fy;
        b.vx -= fx; b.vy -= fy;
      });
      nodes.forEach(n => {
        n.vx += (width/2 - n.x) * 0.015;
        n.vy += (height/2 - n.y) * 0.015;
        n.vx *= DAMP; n.vy *= DAMP;
        n.x += n.vx; n.y += n.vy;
      });
    }

    // Now build SVG
    let svg = '';
    
    // Bounds and scaling to fit within 300x150
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    nodes.forEach(n => {
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x);
      maxY = Math.max(maxY, n.y);
    });
    
    const pad = 20;
    const gW = Math.max(1, maxX - minX);
    const gH = Math.max(1, maxY - minY);
    const scale = Math.min((width - pad*2) / gW, (height - pad*2) / gH, 1.2);
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const offX = width / 2 - cx * scale;
    const offY = height / 2 - cy * scale;

    // Draw Links
    svg += '<g stroke="var(--sn-edge, #666)" stroke-width="1.5" opacity="0.5">';
    links.forEach(link => {
      const a = nodes.find(n => n.id === link.from);
      const b = nodes.find(n => n.id === link.to);
      if (!a || !b) return;
      const x1 = a.x * scale + offX;
      const y1 = a.y * scale + offY;
      const x2 = b.x * scale + offX;
      const y2 = b.y * scale + offY;
      
      // Curved paths
      const dx = x2 - x1, dy = y2 - y1;
      const cx1 = x1 + dx * 0.3 - dy * 0.1;
      const cy1 = y1 + dy * 0.3 + dx * 0.1;
      const cx2 = x1 + dx * 0.7 - dy * 0.1;
      const cy2 = y1 + dy * 0.7 + dx * 0.1;
      
      svg += `<path d="M${x1},${y1} C${cx1},${cy1} ${cx2},${cy2} ${x2},${y2}" fill="none" />`;
    });
    svg += '</g>';

    // Draw Nodes
    svg += '<g>';
    nodes.forEach(n => {
      const x = n.x * scale + offX;
      const y = n.y * scale + offY;
      const tc = n.type === 'action' ? '#ff968c' : 
                 n.type === 'output' ? '#78d2aa' : 
                 n.type === 'config' ? '#ffc878' : '#78b4ff';
                 
      svg += `<circle cx="${x}" cy="${y}" r="4" fill="${tc}"></circle>`;
      svg += `<text x="${x + 6}" y="${y + 3}" fill="var(--sn-text)" font-size="10">${this._esc(n.id || n.name || 'node')}</text>`;
    });
    svg += '</g>';

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
