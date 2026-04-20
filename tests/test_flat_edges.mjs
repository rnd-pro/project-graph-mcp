import fs from 'fs';
import path from 'path';

const projectCtx = JSON.parse(fs.readFileSync('.context/project.ctx', 'utf8'));
const fileMap = new Map();
const edgesAdded = new Set();
let caughtError = null;
let edgeCount = 0;

for (const file of Object.keys(projectCtx.X || {})) { fileMap.set(file, 'n_X_'+file); }
for (const [dir, names] of Object.entries(projectCtx.f || {})) {
  for (const name of names) { fileMap.set(dir === './' ? name : dir + name, 'n_f_'+name); }
}

for (const [srcFile, sources] of Object.entries(projectCtx.I || {})) {
  const srcId = fileMap.get(srcFile);
  if (!srcId) continue;

  for (const impPath of sources) {
    if (impPath.startsWith('node:') || (!impPath.startsWith('.') && !impPath.startsWith('/'))) continue;
    let targetFile = null;
    // rough mock of resolveImport
    if (fileMap.has(impPath)) targetFile = impPath;
    else {
      let base = impPath.split('/').pop();
      for (const known of fileMap.keys()) {
        if (known.endsWith('/' + base) || known.endsWith('/' + base + '.js')) { targetFile = known; break; }
      }
    }
    
    if (!targetFile) continue;
    const tgtId = fileMap.get(targetFile);
    if (!tgtId || tgtId === srcId) continue;

    const edgeKey = `${srcId}->${tgtId}`;
    if (edgesAdded.has(edgeKey)) continue;
    edgesAdded.add(edgeKey);
    edgeCount++;
  }
}
console.log('edgesAdded size:', edgesAdded.size, 'edgeCount variable:', edgeCount);
