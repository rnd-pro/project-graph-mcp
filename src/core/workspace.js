// @ctx workspace.ctx
import { resolve, isAbsolute, dirname } from "path";
import { fileURLToPath } from "url";

let allowedRoots = [];
const __dirname = dirname(fileURLToPath(import.meta.url));
const defaultRoot = resolve(__dirname, "..", "..");

const argRoot = process.argv.find(r => r.startsWith("--workspace="));
if (argRoot) {
  let p = argRoot.split("=")[1];
  allowedRoots.push(p);
  console.error(`[project-graph] Workspace from arg: ${p}`);
}

export function setRoots(roots) {
  if (roots && roots.length > 0) {
    allowedRoots = roots.map(r => {
      let uri = r.uri;
      if (uri.startsWith("file://")) uri = uri.slice(7);
      return uri;
    });
    console.error(`[project-graph] Workspace roots configured: ${allowedRoots.length} paths`);
  }
}

export function getWorkspaceRoot() {
  if (allowedRoots.length > 0) return allowedRoots[0];
  return process.env.PROJECT_ROOT ? process.env.PROJECT_ROOT : defaultRoot;
}

export function resolvePath(targetPath) {
  if (!targetPath) return getWorkspaceRoot();
  
  // If no roots explicitly set, fallback to single root logic
  let fallbackRoot = getWorkspaceRoot();
  let resolved = isAbsolute(targetPath) ? targetPath : resolve(fallbackRoot, targetPath);
  
  if (allowedRoots.length > 0) {
    // Check against all allowed roots
    let isAllowed = allowedRoots.some(root => resolved.startsWith(root));
    if (!isAllowed) {
      throw new Error(`Path traversal blocked: '${targetPath}' resolves outside all configured workspace roots.`);
    }
  } else {
    // Check against fallback root
    if (!resolved.startsWith(fallbackRoot)) {
      throw new Error(`Path traversal blocked: '${targetPath}' resolves outside fallback workspace root '${fallbackRoot}'.`);
    }
  }
  return resolved;
}