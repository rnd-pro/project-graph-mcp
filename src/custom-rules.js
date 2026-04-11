import{readFileSync as e,writeFileSync as t,readdirSync as n,existsSync as s,statSync as r}from"fs";import{join as o,relative as i,dirname as c,resolve as l}from"path";import{fileURLToPath as u}from"url";import{shouldExcludeDir as f,shouldExcludeFile as a,parseGitignore as d}from"./filters.js";
const p=c(u(import.meta.url)),h=o(p,"..","rules");
let m=[];function parseGraphignore(t){m=[];
let n=t;for(;n!==c(n);){const t=o(n,".graphignore");if(s(t))try{const n=e(t,"utf-8");return void(m=n.split("\n").map(e=>e.trim()).filter(e=>e&&!e.startsWith("#")))}catch(e){}n=c(n)}}
function isGraphignored(e){const t=e.split("/").pop();for(const n of m)if(n.endsWith("*")){const s=n.slice(0,-1);if(e.startsWith(s)||t.startsWith(s))return!0}else if(n.startsWith("*")){const s=n.slice(1);if(e.endsWith(s)||t.endsWith(s))return!0}else if(e.includes(n)||t===n)return!0;return!1}
function loadRuleSets(){const t={};if(!s(h))return t;for(const s of n(h))if(s.endsWith(".json"))try{const n=e(o(h,s),"utf-8"),r=JSON.parse(n);t[r.name]=r}catch(e){}return t}
function saveRuleSet(e){const n=o(h,`${e.name}.json`);t(n,JSON.stringify(e,null,2))}
function findFiles(e,t,s=e){e===s&&(d(s),parseGraphignore(s));
const c=[],l=t.replace("*","");try{for(const u of n(e)){const n=o(e,u),d=i(s,n);r(n).isDirectory()?f(u,d)||c.push(...findFiles(n,t,s)):u.endsWith(l)&&(a(u,d)||isGraphignored(d)||c.push(n))}}catch(e){}return c}
function isExcluded(e,t=[]){for(const n of t){const t=n.replace("*","");if(e.endsWith(t))return!0}return!1}
function isInStringOrComment(e,t){const n=e.indexOf("//");if(-1!==n&&t>n)return!0;
let s=!1,r=null;for(let n=0;n<t;n++){const t=e[n],o=n>0?e[n-1]:"";s||'"'!==t&&"'"!==t&&"`"!==t?s&&t===r&&"\\"!==o&&(s=!1,r=null):(s=!0,r=t)}return s}
function isWithinContext(e,t,n){const s=n,r=`</${s.replace(/[<>]/g,"")}>`;
let o=0;for(let n=0;n<=t;n++){const t=e[n];
let i=0;for(;i<t.length;){const e=t.indexOf(s,i),n=t.indexOf(r,i);if(-1===e&&-1===n)break;-1!==e&&(-1===n||e<n)?(o++,i=e+s.length):(o--,i=n+r.length)}}return o>0}
function checkFileAgainstRule(t,n,s){if(isExcluded(t,n.exclude))return[];
const r=[],o=e(t,"utf-8").split("\n"),c=i(s,t);for(let e=0;e<o.length;e++){const t=o[e];
let s=!1,i="";if("regex"===n.patternType)try{const e=new RegExp(n.pattern,"g");
let r;for(;null!==(r=e.exec(t));)if(!isInStringOrComment(t,r.index)){s=!0,i=r[0];break}}catch(e){}else{const e=t.indexOf(n.pattern);-1===e||isInStringOrComment(t,e)||(s=!0,i=n.pattern)}s&&n.contextRequired&&!isWithinContext(o,e,n.contextRequired)||s&&r.push({ruleId:n.id,ruleName:n.name,severity:n.severity,file:c,line:e+1,match:i,replacement:n.replacement})}return r}
export async function getCustomRules(){const e=loadRuleSets();
let t=0;
const n={};for(const[s,r]of Object.entries(e))n[s]={description:r.description,ruleCount:r.rules.length,rules:r.rules.map(e=>({id:e.id,name:e.name,severity:e.severity}))},t+=r.rules.length;return{ruleSets:n,totalRules:t}}
export async function setCustomRule(e,t){const n=loadRuleSets();n[e]||(n[e]={name:e,description:`Custom rules for ${e}`,rules:[]});
const s=n[e],r=s.rules.findIndex(e=>e.id===t.id);return r>=0?s.rules[r]=t:s.rules.push(t),saveRuleSet(s),{success:!0,message:r>=0?`Updated rule "${t.id}" in ${e}`:`Added rule "${t.id}" to ${e}`}}
export async function deleteCustomRule(e,t){const n=loadRuleSets();if(!n[e])return{success:!1,message:`Ruleset "${e}" not found`};
const s=n[e],r=s.rules.findIndex(e=>e.id===t);return r<0?{success:!1,message:`Rule "${t}" not found`}:(s.rules.splice(r,1),saveRuleSet(s),{success:!0,message:`Deleted rule "${t}" from ${e}`})}
export function detectProjectRuleSets(t){const n=loadRuleSets(),r=[],c={};
let l=[];try{const n=o(t,"package.json");if(s(n)){const t=JSON.parse(e(n,"utf-8"));l=[...Object.keys(t.dependencies||{}),...Object.keys(t.devDependencies||{})]}}catch(e){}for(const[s,o]of Object.entries(n)){if(!o.detect)continue;
const n=o.detect;if(n.packageJson)for(const e of n.packageJson)if(l.includes(e)){r.push(s),c[s]=`Found "${e}" in package.json`;break}if(!r.includes(s)&&(n.imports||n.patterns)){const o=findFiles(t,"*.js");e:for(const l of o.slice(0,50))try{const o=e(l,"utf-8");if(n.imports)for(const e of n.imports)if(o.includes(e)){r.push(s),c[s]=`Found "${e}" in ${i(t,l)}`;break e}if(n.patterns)for(const e of n.patterns)if(o.includes(e)){r.push(s),c[s]=`Found "${e}" in ${i(t,l)}`;break e}}catch(e){}}}return{detected:r,reasons:c}}
export async function checkCustomRules(e,t={}){const n=l(e),s=loadRuleSets();
let r=[],o=null;if(t.ruleSet)s[t.ruleSet]&&(r=s[t.ruleSet].rules);else if(!1!==t.autoDetect){if(o=detectProjectRuleSets(e),o.detected.length>0)for(const e of o.detected)s[e]&&r.push(...s[e].rules);for(const[e,t]of Object.entries(s))t.alwaysApply&&!o.detected.includes(e)&&r.push(...t.rules)}else for(const e of Object.values(s))r.push(...e.rules);
const i={};for(const e of r){const t=e.filePattern||"*.js";i[t]||(i[t]=[]),i[t].push(e)}const c=[];for(const[t,s]of Object.entries(i)){const r=findFiles(e,t);for(const e of r)for(const t of s){const s=checkFileAgainstRule(e,t,n);c.push(...s)}}const u=new Set,f=c.filter(e=>{const t=`${e.file}:${e.line}:${e.match}`;return!u.has(t)&&(u.add(t),!0)});
let a=f;t.severity&&(a=f.filter(e=>e.severity===t.severity));
const d={error:0,warning:1,info:2};a.sort((e,t)=>{const n=d[e.severity]-d[t.severity];return 0!==n?n:e.file.localeCompare(t.file)});
const p={error:a.filter(e=>"error"===e.severity).length,warning:a.filter(e=>"warning"===e.severity).length,info:a.filter(e=>"info"===e.severity).length},h={};for(const e of a)h[e.ruleId]=(h[e.ruleId]||0)+1;return{basePath:e,total:a.length,bySeverity:p,byRule:h,violations:a.slice(0,50),...o&&{detected:o}}}