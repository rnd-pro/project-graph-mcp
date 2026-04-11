// @ctx .context/src/core/workspace.ctx
import{resolve as r,isAbsolute as o,dirname as t}from"path";import{fileURLToPath as e}from"url";
let s=null;
const a=t(e(import.meta.url)),p=r(a,"..",".."),c=process.argv.find(r=>r.startsWith("--workspace="));c&&(s=c.split("=")[1],console.error(`[project-graph] Workspace from arg: ${s}`));
export function setRoots(r){if(r&&r.length>0){let o=r[0].uri;o.startsWith("file://")&&(o=o.slice(7)),s=o,console.error(`[project-graph] Workspace root: ${s}`)}}
export function getWorkspaceRoot(){return s||(process.env.PROJECT_ROOT?process.env.PROJECT_ROOT:p)}
export function resolvePath(t){if(!t)return getWorkspaceRoot();
const e=getWorkspaceRoot(),s=o(t)?t:r(e,t);if(!s.startsWith(e))throw new Error(`Path traversal blocked: '${t}' resolves outside workspace root '${e}'`);return s}