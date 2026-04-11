// @ctx .context/src/analysis/test-annotations.ctx
import{readFileSync as t,readdirSync as e,statSync as s,writeFileSync as n}from"fs";import{join as o,relative as r,resolve as a}from"path";function findCtxMdFiles(t){const n=[];try{for(const r of e(t)){const e=o(t,r);s(e).isDirectory()&&!r.startsWith(".")?n.push(...findCtxMdFiles(e)):r.endsWith(".ctx.md")&&n.push(e)}}catch(t){}return n}
export function parseAnnotations(t,e){const s=t.split("\n"),n=[];
let o=!1,r=[];for(const t of s){if(t.startsWith("## ")){o&&r.length&&(n.push(...groupByName(r,e)),r=[]),o=t.startsWith("## Tests");continue}if(!o)continue;
const s=t.match(/^- \[([ x!])\] (\w+):\s*(.+)$/);if(!s)continue;const[,a,i,c]=s,f=c.split("→").map(t=>t.trim()),u=f[0],l=f[1]||null;
let p=null,d="pending";if("x"===a&&(d="passed"),"!"===a){d="failed";
const t=u.match(/\(FAILED:\s*(.+)\)$/);t&&(p=t[1].trim())}r.push({name:i,action:u,expected:l,status:d,failReason:p})}return o&&r.length&&n.push(...groupByName(r,e)),n}
function groupByName(t,e){const s={};
let n={};for(const e of t)s[e.name]||(s[e.name]=[],n[e.name]=0),s[e.name].push({id:`${e.name}.${n[e.name]++}`,action:e.action,expected:e.expected,status:e.status,failReason:e.failReason});return Object.entries(s).map(([t,s])=>({name:t,tests:s,file:e}))}
export function getAllFeatures(e){const s=findCtxMdFiles(o(a(e),".context")),n=[];for(const e of s)try{const s=parseAnnotations(t(e,"utf-8"),e);n.push(...s)}catch(t){}return n}
export function getPendingTests(t){const e=a(t),s=getAllFeatures(t),n=[];for(const t of s)for(const s of t.tests)"pending"===s.status&&n.push({...s,feature:t.name,file:r(e,t.file)});return n}
export function markTestPassed(t){return updateTestState(t.split(".")[0],t,"x")}
export function markTestFailed(t,e){return updateTestState(t.split(".")[0],t,"!",e)}
function updateTestState(e,s,r,a){const i=process.cwd(),c=findCtxMdFiles(o(i,".context")),f=parseInt(s.split(".")[1],10);for(const o of c)try{const i=t(o,"utf-8").split("\n");
let c=!1,u=0;for(let t=0;t<i.length;t++){if(i[t].startsWith("## ")){c=i[t].startsWith("## Tests");continue}if(!c)continue;
const l=i[t].match(/^- \[([ x!])\] (\w+):\s*(.+)$/);if(l&&l[2]===e){if(u===f){const c=l[3].replace(/\s*\(FAILED:.*\)$/,""),f=a?` (FAILED: ${a})`:"";return i[t]=`- [${r}] ${e}: ${c}${f}`,n(o,i.join("\n"),"utf-8"),{success:!0,testId:s,...a?{reason:a}:{}}}u++}}}catch(t){}return{success:!1,testId:s,error:"Test not found"}}
export function getTestSummary(t){const e=getAllFeatures(t);
let s=0,n=0,o=0,r=0;
const a=[];for(const t of e)for(const e of t.tests)s++,"passed"===e.status?n++:"failed"===e.status?(o++,a.push({id:e.id,reason:e.failReason})):r++;return{total:s,passed:n,failed:o,pending:r,progress:s>0?Math.round((n+o)/s*100):0,failures:a}}
export function resetTestState(){const e=process.cwd(),s=findCtxMdFiles(o(e,".context"));for(const e of s)try{let s=t(e,"utf-8");
const o=s.replace(/^(- )\[([x!])\] (\w+:\s*.+?)(?:\s*\(FAILED:.*\))?$/gm,"$1[ ] $3");o!==s&&n(e,o,"utf-8")}catch(t){}return{success:!0}}