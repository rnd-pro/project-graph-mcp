import { resolve, isAbsolute } from 'path';

let workspaceRoot = null;

// Auto-detect --workspace arg at module load
const wsArg = process.argv.find(a => a.startsWith('--workspace='));
if (wsArg) {
  workspaceRoot = wsArg.split('=')[1];
  console.error(`[project-graph] Workspace from arg: ${workspaceRoot}`);
}

export function setRoots(roots) {
  if (roots && roots.length > 0) {
    let uri = roots[0].uri;
    // Strip file:// protocol if present
    if (uri.startsWith('file://')) {
      uri = uri.slice(7);
    }
    workspaceRoot = uri;
    console.error(`[project-graph] Workspace root: ${workspaceRoot}`);
  }
}

export function getWorkspaceRoot() {
  if (workspaceRoot) {
    return workspaceRoot;
  }
  if (process.env.PROJECT_ROOT) {
    return process.env.PROJECT_ROOT;
  }
  return process.cwd();
}

export function resolvePath(inputPath) {
  if (!inputPath) {
    return getWorkspaceRoot();
  }
  const root = getWorkspaceRoot();
  const resolved = isAbsolute(inputPath) ? inputPath : resolve(root, inputPath);

  // Prevent path traversal — resolved path must stay within workspace
  if (!resolved.startsWith(root)) {
    throw new Error(`Path traversal blocked: '${inputPath}' resolves outside workspace root '${root}'`);
  }

  return resolved;
}
