/**
 * Workspace Root Resolution
 * 
 * Resolves relative paths against the correct workspace root.
 * Priority: MCP initialize roots → PROJECT_ROOT env → process.cwd()
 */

import { resolve, isAbsolute } from 'path';

/** @type {string|null} */
let workspaceRoot = null;

/**
 * Set workspace root from MCP initialize roots
 * @param {Array<{uri: string, name?: string}>} roots
 */
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

/**
 * Get current workspace root
 * @returns {string}
 */
export function getWorkspaceRoot() {
  if (workspaceRoot) {
    return workspaceRoot;
  }
  if (process.env.PROJECT_ROOT) {
    return process.env.PROJECT_ROOT;
  }
  return process.cwd();
}

/**
 * Resolve a path argument against workspace root.
 * Absolute paths are returned as-is.
 * Relative paths are resolved against the workspace root.
 * @param {string} path
 * @returns {string}
 */
export function resolvePath(path) {
  if (!path) {
    return getWorkspaceRoot();
  }
  if (isAbsolute(path)) {
    return path;
  }
  return resolve(getWorkspaceRoot(), path);
}
