// @ctx .context/src/tools.ctx
import{parseProject as e,parseFile as t,findJSFiles as n,findAllProjectFiles as r}from"./parser.js";import{buildGraph as s,createSkeleton as o}from"./graph-builder.js";import{readFileSync as c,statSync as i,writeFileSync as a,existsSync as l,unlinkSync as f}from"fs";import{execSync as u}from"child_process";import{join as p}from"path";
let h=null,d=null,m=new Map;function saveDiskCache(e,t){try{const n=p(e,".project-graph-cache.json"),r={version:1,path:e,mtimes:Object.fromEntries(m),graph:t};a(n,JSON.stringify(r),"utf-8")}catch(e){}}
function loadDiskCache(e){try{const t=p(e,".project-graph-cache.json");if(!l(t))return!1;
const n=c(t,"utf-8"),r=JSON.parse(n);if(1!==r.version||r.path!==e)return!1;m.clear();for(const[e,t]of Object.entries(r.mtimes))m.set(e,t);return h=r.graph,d=e,!detectChanges(e)||(h=null,d=null,m.clear(),!1)}catch(e){return!1}}
export async function getGraph(t){if(h&&d===t){if(!detectChanges(t))return h}else if(!h&&loadDiskCache(t))return h;
const n=await e(t);return h=s(n),d=t,snapshotMtimes(t),saveDiskCache(t,h),h}
function detectChanges(e){if(0===m.size)return!0;try{const t=n(e),r=new Set(t),s=new Set(m.keys());if(t.length!==m.size)return!0;for(const e of t)if(!s.has(e))return!0;for(const e of s)if(!r.has(e))return!0;for(const e of t)try{if(i(e).mtimeMs!==m.get(e))return!0}catch{return!0}return!1}catch{return!0}}
function snapshotMtimes(e){m.clear();try{const t=n(e);for(const e of t)try{m.set(e,i(e).mtimeMs)}catch{}}catch{}}
export async function getSkeleton(e){const t=await getGraph(e),n=r(e);return o(t,n)}
export async function getFocusZone(e={}){const n=e.path||"src/components",r=await getGraph(n);
let s=e.recentFiles||[];if(e.useGitDiff)try{s=u("git diff --name-only HEAD~5",{encoding:"utf-8"}).split("\n").filter(e=>e.endsWith(".js"))}catch(e){}const o={};for(const e of s){const n=c(e,"utf-8"),s=await t(n,e);for(const e of s.classes){const t=r.legend[e.name];t&&r.nodes[t]&&(o[t]={...r.nodes[t],methods:e.methods,properties:e.properties,file:e.file,line:e.line})}}return{focusFiles:s,expanded:o,expandable:Object.keys(r.nodes).filter(e=>!o[e])}}
export async function expand(t){const n=d||"src/components",r=await getGraph(n),[s,o]=t.split("."),i=r.reverseLegend[s];if(!i)return{error:`Unknown symbol: ${t}. Run get_skeleton on your project first, then use symbols from the L (Legend) field.`};
const a=await e(n),l=a.classes.find(e=>e.name===i),f=a.functions.find(e=>e.name===i);if(!l&&!f)return{error:`Symbol not found: ${i}`};if(f&&!o)return{symbol:t,fullName:i,type:"function",file:f.file,line:f.line,exported:f.exported,calls:f.calls};if(o&&l){const e=r.reverseLegend[o]||o,n=extractMethod(c(l.file,"utf-8"),e);return{symbol:t,fullName:`${i}.${e}`,file:l.file,line:l.line,code:n}}return{symbol:t,fullName:i,file:l.file,line:l.line,extends:l.extends,methods:l.methods,properties:l.properties,calls:l.calls}}
export async function deps(e){const t=d||"src/components",n=await getGraph(t),r=n.nodes[e];if(!r)return{error:`Unknown symbol: ${e}. Run get_skeleton on your project first, then use symbols from the L (Legend) field.`};
const s=n.edges.filter(t=>t[2].startsWith(e)).map(e=>e[0]),o=n.edges.filter(t=>t[0]===e).map(e=>e[2]);return{symbol:e,imports:r.i||[],usedBy:[...new Set(s)],calls:[...new Set(o)]}}
export async function usages(t){const n=d||"src/components",r=await getGraph(n),s=await e(n),o=r.reverseLegend[t]||t,c=[];for(const e of s.classes)(e.calls?.includes(o)||e.calls?.some(e=>e.includes(o)))&&c.push({file:e.file,line:e.line,context:`${e.name} calls ${o}`});return c}
function extractMethod(e,t){const n=new RegExp(`((?:\\/\\*\\*[\\s\\S]*?\\*\\/\\s*)?)(?:async\\s+)?${t}\\s*\\([^)]*\\)\\s*{`,"g").exec(e);if(!n)return"";
const r=n.index;
let s=0,o=n.index+n[0].length-1;for(;o<e.length;){if("{"===e[o])s++;else if("}"===e[o]&&(s--,0===s))return e.slice(r,o+1);o++}return e.slice(r)}
export async function getCallChain(e={}){const{from:t,to:n,path:r}=e;if(!t||!n)return{error:'Both "from" and "to" parameters are required'};
const s=r||d||"src/components",o=await getGraph(s),c=o.legend[t]||t,i=o.legend[n]||n,a={};for(const[e,t,n]of o.edges)a[e]||(a[e]=[]),a[e].push(n);
const l=[{current:c,path:[c]}],f=new Set,u=new Set;for(f.add(c);l.length>0;){const{current:e,path:t}=l.shift(),n=e.split(".")[0],r=e.split(".")[1];if(e===i||n===i||r===i)return t.map(e=>{const t=e.split("."),n=o.reverseLegend[t[0]]||t[0];return 2===t.length?`${n}.${o.reverseLegend[t[1]]||t[1]}`:n});if(u.has(n))continue;u.add(n);
const s=a[n]||[];for(const e of s)f.has(e)||(f.add(e),l.push({current:e,path:[...t,e]}))}return{error:`No call path found from "${t}" to "${n}"`}}
export function invalidateCache(){if(d)try{const e=p(d,".project-graph-cache.json");l(e)&&f(e)}catch(e){}h=null,d=null,m.clear()}