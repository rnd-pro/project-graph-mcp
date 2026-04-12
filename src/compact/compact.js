// @ctx .context/src/compact/compact.ctx
import{resolveCtxRelPath as resolveCtxPath}from"./ctx-resolver.js";import{walkJSFiles}from"../core/file-walker.js";import{readFileSync as e,writeFileSync as t,readdirSync as n,statSync as o,existsSync as s}from"fs";import{join as r,extname as c,relative as a,basename as i,dirname as l}from"path";import{minify as u}from"../../vendor/terser.mjs";

function addTopLevelNewlines(e){return e.replace(/;(import )/g,";\n$1").replace(/;(export )/g,";\n$1").replace(/\}(export )/g,"}\n$1").replace(/\}(function )/g,"}\n$1").replace(/\}(async function )/g,"}\n$1").replace(/\}(class )/g,"}\n$1").replace(/;(const |let |var )/g,";\n$1")}

async function compactFile(n,o){const s=e(n,"utf-8"),r=s.length;if(!s.trim())return{original:0,compacted:0};
const c=await u(s,{compress:{dead_code:!0,drop_console:!1,passes:1,reduce_funcs:!1,inline:!1},mangle:{keep_fnames:!0,module:!0},module:!0,output:{beautify:!1,comments:!1,semicolons:!0}});if(c.error)throw c.error;
let a=addTopLevelNewlines(c.code);if(o){const e=resolveCtxPath(n,o);e&&(a.startsWith("#!")?a=a.replace(/^(#![^\n]*\n)/,"$1// @ctx "+e+"\n"):a="// @ctx "+e+"\n"+a)}return t(n,a,"utf-8"),{original:r,compacted:a.length}}
async function beautifyFile(n){const o=e(n,"utf-8"),s=o.length;if(!o.trim())return{original:0,beautified:0};
const r=await u(o,{compress:!1,mangle:!1,module:!0,output:{beautify:!0,comments:!1,indent_level:2,semicolons:!0}});if(r.error)throw r.error;return t(n,r.code+"\n","utf-8"),{original:s,beautified:r.code.length}}
export async function compactProject(t,n={}){const{dryRun:o=!1}=n,s=walkJSFiles(t);
let r=0,c=0;
const i=[],l=[];for(const n of s){const s=a(t,n);try{const a=e(n,"utf-8");if(r+=a.length,o)c+=addTopLevelNewlines((await u(a,{compress:{dead_code:!0,drop_console:!1,passes:1,reduce_funcs:!1,inline:!1},mangle:{keep_fnames:!0,module:!0},module:!0,output:{beautify:!1,comments:!1}})).code||"").length||a.length;else{const{compacted:e}=await compactFile(n,t);c+=e}i.push(s)}catch(e){l.push({file:s,error:e.message})}}const d=r>0?Math.round(100*(1-c/r)):0;return{files:i.length,fileList:i,originalBytes:r,compactedBytes:c,savings:`${d}%`,errors:l.length>0?l:void 0,dryRun:o}}
export async function expandProject(t,n={}){const{dryRun:o=!1}=n,s=walkJSFiles(t);
let r=0,c=0;
const i=[],l=[];for(const n of s){const s=a(t,n);try{const t=e(n,"utf-8");if(r+=t.length,o){const e=await u(t,{compress:!1,mangle:!1,module:!0,output:{beautify:!0,comments:!1,indent_level:2}});c+=e.code?.length||t.length}else{const{beautified:e}=await beautifyFile(n);c+=e}i.push(s)}catch(e){l.push({file:s,error:e.message})}}return{files:i.length,fileList:i,originalBytes:r,beautifiedBytes:c,errors:l.length>0?l:void 0,dryRun:o}}