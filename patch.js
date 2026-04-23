const fs = require('fs');
let code = fs.readFileSync('web/test-force-sim.html', 'utf8');

// Add adjMap and interactionDepths declarations
code = code.replace('let edges = [];', 'let edges = [];\nlet adjMap = new Map();\nlet interactionDepths = new Map();');

// Update generateGraph to populate adjMap? No, better to do it globally after updates
const rebuildAdjCode = `
function rebuildAdjMap() {
  adjMap.clear();
  for (const n of nodes) adjMap.set(n.id, new Set());
  for (const e of edges) {
    if (adjMap.has(e.from)) adjMap.get(e.from).add(e.to);
    if (adjMap.has(e.to)) adjMap.get(e.to).add(e.from);
  }
}
function updateInteractionDepths() {
  interactionDepths.clear();
  if (!dragNode) return;
  const queue = [[dragNode.id, 0]];
  const visited = new Set([dragNode.id]);
  interactionDepths.set(dragNode.id, 0);

  while (queue.length > 0) {
    const [curr, depth] = queue.shift();
    if (depth >= 3) continue;
    const neighbors = adjMap.get(curr) || new Set();
    for (const n of neighbors) {
      if (!visited.has(n)) {
        visited.add(n);
        interactionDepths.set(n, depth + 1);
        queue.push([n, depth + 1]);
      }
    }
  }
}
`;

code = code.replace('// Init', rebuildAdjCode + '\n// Init');
code = code.replace('startWorker();', 'rebuildAdjMap();\nstartWorker();');

// Also need to call rebuildAdjMap when graph changes (Add 10, Add 50, Reset)
code = code.replace('worker.postMessage({ type: \'update\', nodes: initial.nodes, edges: initial.edges });', 'rebuildAdjMap();\n    worker.postMessage({ type: \'update\', nodes: initial.nodes, edges: initial.edges });');
code = code.replace('worker.postMessage({ type: \'add\', nodes: extra.nodes, edges: extra.edges });', 'rebuildAdjMap();\n    worker.postMessage({ type: \'add\', nodes: extra.nodes, edges: extra.edges });');

// Call updateInteractionDepths when dragNode changes
code = code.replace('dragNode = hit;', 'dragNode = hit;\n    updateInteractionDepths();');
code = code.replace('dragNode = null;', 'dragNode = null;\n    updateInteractionDepths();');

// Modify draw() to sort nodes and apply effects
const drawReplaceStart = '  // Nodes\n  for (const node of nodes) {';
const drawReplaceEnd = `  // Sort nodes so background is drawn first, dragged is drawn last
  const sortedNodes = dragNode 
    ? [...nodes].sort((a, b) => {
        const dA = interactionDepths.has(a.id) ? interactionDepths.get(a.id) : 4;
        const dB = interactionDepths.has(b.id) ? interactionDepths.get(b.id) : 4;
        return dB - dA;
      })
    : nodes;

  for (const node of sortedNodes) {
    const depth = dragNode ? (interactionDepths.has(node.id) ? interactionDepths.get(node.id) : 4) : 0;
    const scale = dragNode ? (depth === 0 ? 1.5 : depth === 1 ? 1.2 : depth === 2 ? 0.9 : depth === 3 ? 0.7 : 0.5) : 1;
    const opacity = dragNode ? (depth === 0 ? 1 : depth === 1 ? 0.9 : depth === 2 ? 0.6 : depth === 3 ? 0.4 : 0.15) : 1;
    const blur = dragNode ? (depth === 0 ? 0 : depth === 1 ? 0 : depth === 2 ? 1 : depth === 3 ? 2 : 4) : 0;
    
    ctx.globalAlpha = opacity;
    ctx.filter = dragNode ? \`blur(\${blur}px)\` : 'none';
`;

code = code.replace(drawReplaceStart, drawReplaceEnd);

const arcReplace = 'ctx.arc(pos.x, pos.y, DOT_RADIUS, 0, Math.PI * 2);';
const arcReplaceEnd = 'ctx.arc(pos.x, pos.y, DOT_RADIUS * scale, 0, Math.PI * 2);';
code = code.replace(arcReplace, arcReplaceEnd);

const rectReplace = 'const x = pos.x, y = pos.y, w = node.w, h = node.h;';
const rectReplaceEnd = 'const w = node.w * scale, h = node.h * scale, x = pos.x - (w - node.w)/2, y = pos.y - (h - node.h)/2;';
code = code.replace(rectReplace, rectReplaceEnd);

// Fix edge colors based on depth
const edgeReplaceStart = '  for (const edge of edges) {';
const edgeReplaceEnd = `  for (const edge of edges) {
    let edgeAlpha = 0.25;
    let edgeWidth = Math.max(1, 1.5 / zoom);
    if (dragNode) {
      const d1 = interactionDepths.has(edge.from) ? interactionDepths.get(edge.from) : 4;
      const d2 = interactionDepths.has(edge.to) ? interactionDepths.get(edge.to) : 4;
      const minD = Math.min(d1, d2);
      if (minD === 0) { edgeAlpha = 0.8; edgeWidth = Math.max(2, 2.5 / zoom); }
      else if (minD === 1) { edgeAlpha = 0.4; edgeWidth = Math.max(1.5, 2 / zoom); }
      else if (minD === 2) { edgeAlpha = 0.15; edgeWidth = Math.max(1, 1.5 / zoom); }
      else { edgeAlpha = 0.05; edgeWidth = Math.max(0.5, 1 / zoom); }
      ctx.strokeStyle = \`rgba(74, 158, 255, \${edgeAlpha})\`;
      ctx.lineWidth = edgeWidth;
    } else {
      ctx.strokeStyle = 'rgba(74, 158, 255, 0.25)';
      ctx.lineWidth = Math.max(1, 1.5 / zoom);
    }
`;
code = code.replace(edgeReplaceStart, edgeReplaceEnd);

// remove globalAlpha reset after loop
const loopEnd = `    }
  }

  // Stats (cached DOM elements)`;

const loopEndReplace = `    }
  }
  ctx.globalAlpha = 1;
  ctx.filter = 'none';

  // Stats (cached DOM elements)`;
code = code.replace(loopEnd, loopEndReplace);

fs.writeFileSync('web/test-force-sim.html', code);
console.log("Patched test-force-sim.html");
