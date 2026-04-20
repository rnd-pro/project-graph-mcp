const fs = require('fs');
const ctx = JSON.parse(fs.readFileSync('.context/project.ctx'));
let edgeCount = 0;
let filesSet = new Set(Object.keys(ctx.n || {}));
const edgesAdded = new Set();
for (const [srcFile, sources] of Object.entries(ctx.I || {})) {
  for (const impPath of sources) {
    if (impPath.startsWith('node:') || (!impPath.startsWith('.') && !impPath.startsWith('/'))) continue;
    let targetFile = null;
    edgeCount++;
  }
}
console.log('Total files in ctx.n:', filesSet.size);
console.log('Total import statements matching our criteria:', edgeCount);
