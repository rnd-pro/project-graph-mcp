const fs = require('fs');
let code = fs.readFileSync('web/test-force-sim.html', 'utf8');

// Modify the node rendering loop to use animated properties
const nodeStart = '  for (const node of sortedNodes) {';
const nodeLogic = `  for (const node of sortedNodes) {
    const pos = getSmooth(node.id);
    if (!pos) continue;
    const isDragged = dragNode && dragNode.id === node.id;
    
    const targetDepth = dragNode ? (interactionDepths.has(node.id) ? interactionDepths.get(node.id) : 4) : -1;
    if (targetDepth !== -1) node.lastDepth = targetDepth;
    
    const scaleT = targetDepth === -1 ? 1 : (targetDepth === 0 ? 1.5 : targetDepth === 1 ? 1.2 : targetDepth === 2 ? 0.9 : targetDepth === 3 ? 0.7 : 0.5);
    const opacityT = targetDepth === -1 ? 1 : (targetDepth === 0 ? 1 : targetDepth === 1 ? 0.9 : targetDepth === 2 ? 0.6 : targetDepth === 3 ? 0.4 : 0.15);
    const blurT = targetDepth === -1 ? 0 : (targetDepth === 0 ? 0 : targetDepth === 1 ? 0 : targetDepth === 2 ? 1 : targetDepth === 3 ? 2 : 4);
    
    const baseSpeed = targetDepth === -1 ? 0.15 : 0.1;
    const depthMod = (node.lastDepth || 0) * 0.015;
    const speed = Math.max(0.02, baseSpeed - depthMod); // Further nodes animate slightly later/slower
    
    node.aScale = node.aScale || 1;
    node.aOpacity = node.aOpacity !== undefined ? node.aOpacity : 1;
    node.aBlur = node.aBlur || 0;
    
    node.aScale += (scaleT - node.aScale) * speed;
    node.aOpacity += (opacityT - node.aOpacity) * speed;
    node.aBlur += (blurT - node.aBlur) * speed;
    
    const scale = node.aScale;
    const opacity = node.aOpacity;
    const blur = node.aBlur;
    
    ctx.globalAlpha = opacity;
    ctx.filter = blur > 0.1 ? \`blur(\${blur}px)\` : 'none';
`;

code = code.replace(/  for \(const node of sortedNodes\) \{[\s\S]*?ctx\.filter = dragNode \? `blur\(\$\{blur\}px\)` : 'none';/, nodeLogic);

// Modify edge rendering
const edgeStart = '  for (const edge of edges) {';
const edgeLogic = `  for (const edge of edges) {
    const from = nodeCenter(edge.from);
    const to = nodeCenter(edge.to);
    if (!from || !to) continue;
    
    let tAlpha = 0.25;
    let tWidth = Math.max(1, 1.5 / zoom);
    
    if (dragNode) {
      const d1 = interactionDepths.has(edge.from) ? interactionDepths.get(edge.from) : 4;
      const d2 = interactionDepths.has(edge.to) ? interactionDepths.get(edge.to) : 4;
      const minD = Math.min(d1, d2);
      if (minD === 0) { tAlpha = 0.8; tWidth = Math.max(2, 2.5 / zoom); }
      else if (minD === 1) { tAlpha = 0.4; tWidth = Math.max(1.5, 2 / zoom); }
      else if (minD === 2) { tAlpha = 0.15; tWidth = Math.max(1, 1.5 / zoom); }
      else { tAlpha = 0.05; tWidth = Math.max(0.5, 1 / zoom); }
    }
    
    edge.aAlpha = edge.aAlpha !== undefined ? edge.aAlpha : 0.25;
    edge.aWidth = edge.aWidth || Math.max(1, 1.5 / zoom);
    
    edge.aAlpha += (tAlpha - edge.aAlpha) * 0.1;
    edge.aWidth += (tWidth - edge.aWidth) * 0.1;
    
    ctx.strokeStyle = \`rgba(74, 158, 255, \${edge.aAlpha})\`;
    ctx.lineWidth = edge.aWidth;
`;

code = code.replace(/  for \(const edge of edges\) \{[\s\S]*?ctx\.lineWidth = edgeWidth;/m, edgeLogic);

fs.writeFileSync('web/test-force-sim.html', code);
console.log('Patched');
