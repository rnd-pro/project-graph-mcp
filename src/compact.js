import{readFileSync as e,writeFileSync as t,readdirSync as n,statSync as o}from"fs";import{join as s,extname as r,relative as c}from"path";import{minify as i}from"../vendor/terser.mjs";
const a=new Set([".js",".mjs"]),l=new Set(["node_modules",".git","vendor",".context","dev-docs",".agent",".agents"]);function walkJSFiles(e,t=e){const c=[];try{for(const i of n(e)){if(i.startsWith(".")&&"."!==i)continue;
const n=s(e,i);o(n).isDirectory()?l.has(i)||c.push(...walkJSFiles(n,t)):a.has(r(i).toLowerCase())&&c.push(n)}}catch{}return c}
function addTopLevelNewlines(e){return e.replace(/;(import )/g,";\n$1").replace(/;(export )/g,";\n$1").replace(/\}(export )/g,"}\n$1").replace(/\}(function )/g,"}\n$1").replace(/\}(async function )/g,"}\n$1").replace(/\}(class )/g,"}\n$1").replace(/;(const |let |var )/g,";\n$1")}
async function compactFile(n){const o=e(n,"utf-8"),s=o.length;if(!o.trim())return{original:0,compacted:0};
const r=await i(o,{compress:{dead_code:!0,drop_console:!1,passes:1,reduce_funcs:!1,inline:!1},mangle:{keep_fnames:!0,module:!0},module:!0,output:{beautify:!1,comments:!1,semicolons:!0}});if(r.error)throw r.error;
const c=addTopLevelNewlines(r.code);return t(n,c,"utf-8"),{original:s,compacted:c.length}}
async function beautifyFile(n){const o=e(n,"utf-8"),s=o.length;if(!o.trim())return{original:0,beautified:0};
const r=await i(o,{compress:!1,mangle:!1,module:!0,output:{beautify:!0,comments:!1,indent_level:2,semicolons:!0}});if(r.error)throw r.error;return t(n,r.code+"\n","utf-8"),{original:s,beautified:r.code.length}}
export async function compactProject(t,n={}){const{dryRun:o=!1}=n,s=walkJSFiles(t);
let r=0,a=0;
const l=[],u=[];for(const n of s){const s=c(t,n);try{const t=e(n,"utf-8");if(r+=t.length,o){a+=addTopLevelNewlines((await i(t,{compress:{dead_code:!0,drop_console:!1,passes:1,reduce_funcs:!1,inline:!1},mangle:{keep_fnames:!0,module:!0},module:!0,output:{beautify:!1,comments:!1}})).code||"").length||t.length}else{const{compacted:e}=await compactFile(n);a+=e}l.push(s)}catch(e){u.push({file:s,error:e.message})}}const d=r>0?Math.round(100*(1-a/r)):0;return{files:l.length,fileList:l,originalBytes:r,compactedBytes:a,savings:`${d}%`,errors:u.length>0?u:void 0,dryRun:o}}
export async function expandProject(t,n={}){const{dryRun:o=!1}=n,s=walkJSFiles(t);
let r=0,a=0;
const l=[],u=[];for(const n of s){const s=c(t,n);try{const t=e(n,"utf-8");if(r+=t.length,o){const e=await i(t,{compress:!1,mangle:!1,module:!0,output:{beautify:!0,comments:!1,indent_level:2}});a+=e.code?.length||t.length}else{const{beautified:e}=await beautifyFile(n);a+=e}l.push(s)}catch(e){u.push({file:s,error:e.message})}}return{files:l.length,fileList:l,originalBytes:r,beautifiedBytes:a,errors:u.length>0?u:void 0,dryRun:o}}