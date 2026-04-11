// @ctx .context/src/analysis/custom-rules.ctx
import{readFileSync as e,writeFileSync as t,readdirSync as s,existsSync as n,statSync as r}from"fs";import{join as o,relative as i,dirname as c,resolve as l}from"path";import{fileURLToPath as u}from"url";import{shouldExcludeDir as f,shouldExcludeFile as a,parseGitignore as d}from"../core/filters.js";
const p=c(u(import.meta.url)),h=o(p,"..","..","rules");
let m=[];function parseGraphignore(t){m=[];
let s=t;for(;s!==c(s);){const t=o(s,".graphignore");if(n(t))try{const s=e(t,"utf-8");return void(m=s.split("\n").map(e=>e.trim()).filter(e=>e&&!e.startsWith("#")))}catch(e){}s=c(s)}}
function isGraphignored(e){const t=e.split("/").pop();for(const s of m)if(s.endsWith("*")){const n=s.slice(0,-1);if(e.startsWith(n)||t.startsWith(n))return!0}else if(s.startsWith("*")){const n=s.slice(1);if(e.endsWith(n)||t.endsWith(n))return!0}else if(e.includes(s)||t===s)return!0;return!1}
function loadRuleSets(){const t={};if(!n(h))return t;for(const n of s(h))if(n.endsWith(".json"))try{const s=e(o(h,n),"utf-8"),r=JSON.parse(s);t[r.name]=r}catch(e){}return t}
function saveRuleSet(e){const s=o(h,`${e.name}.json`);t(s,JSON.stringify(e,null,2))}
function findFiles(e,t,n=e){e===n&&(d(n),parseGraphignore(n));
const c=[],l=t.replace("*","");try{for(const u of s(e)){const s=o(e,u),d=i(n,s);r(s).isDirectory()?f(u,d)||c.push(...findFiles(s,t,n)):u.endsWith(l)&&(a(u,d)||isGraphignored(d)||c.push(s))}}catch(e){}return c}
function isExcluded(e,t=[]){for(const s of t){const t=s.replace("*","");if(e.endsWith(t))return!0}return!1}
function isInStringOrComment(e,t){const s=e.indexOf("//");if(-1!==s&&t>s)return!0;
let n=!1,r=null;for(let s=0;s<t;s++){const t=e[s],o=s>0?e[s-1]:"";n||'"'!==t&&"'"!==t&&"`"!==t?n&&t===r&&"\\"!==o&&(n=!1,r=null):(n=!0,r=t)}return n}
function isWithinContext(e,t,s){const n=s,r=`</${n.replace(/[<>]/g,"")}>`;
let o=0;for(let s=0;s<=t;s++){const t=e[s];
let i=0;for(;i<t.length;){const e=t.indexOf(n,i),s=t.indexOf(r,i);if(-1===e&&-1===s)break;-1!==e&&(-1===s||e<s)?(o++,i=e+n.length):(o--,i=s+r.length)}}return o>0}
function checkFileAgainstRule(t,s,n){if(isExcluded(t,s.exclude))return[];
const r=[],o=e(t,"utf-8").split("\n"),c=i(n,t);for(let e=0;e<o.length;e++){const t=o[e];
let n=!1,i="";if("regex"===s.patternType)try{const e=new RegExp(s.pattern,"g");
let r;for(;null!==(r=e.exec(t));)if(!isInStringOrComment(t,r.index)){n=!0,i=r[0];break}}catch(e){}else{const e=t.indexOf(s.pattern);-1===e||isInStringOrComment(t,e)||(n=!0,i=s.pattern)}n&&s.contextRequired&&!isWithinContext(o,e,s.contextRequired)||n&&r.push({ruleId:s.id,ruleName:s.name,severity:s.severity,file:c,line:e+1,match:i,replacement:s.replacement})}return r}
export async function getCustomRules(){const e=loadRuleSets();
let t=0;
const s={};for(const[n,r]of Object.entries(e))s[n]={description:r.description,ruleCount:r.rules.length,rules:r.rules.map(e=>({id:e.id,name:e.name,severity:e.severity}))},t+=r.rules.length;return{ruleSets:s,totalRules:t}}
export async function setCustomRule(e,t){const s=loadRuleSets();s[e]||(s[e]={name:e,description:`Custom rules for ${e}`,rules:[]});
const n=s[e],r=n.rules.findIndex(e=>e.id===t.id);return r>=0?n.rules[r]=t:n.rules.push(t),saveRuleSet(n),{success:!0,message:r>=0?`Updated rule "${t.id}" in ${e}`:`Added rule "${t.id}" to ${e}`}}
export async function deleteCustomRule(e,t){const s=loadRuleSets();if(!s[e])return{success:!1,message:`Ruleset "${e}" not found`};
const n=s[e],r=n.rules.findIndex(e=>e.id===t);return r<0?{success:!1,message:`Rule "${t}" not found`}:(n.rules.splice(r,1),saveRuleSet(n),{success:!0,message:`Deleted rule "${t}" from ${e}`})}
export function detectProjectRuleSets(t){const s=loadRuleSets(),r=[],c={};
let l=[];try{const s=o(t,"package.json");if(n(s)){const t=JSON.parse(e(s,"utf-8"));l=[...Object.keys(t.dependencies||{}),...Object.keys(t.devDependencies||{})]}}catch(e){}for(const[n,o]of Object.entries(s)){if(!o.detect)continue;
const s=o.detect;if(s.packageJson)for(const e of s.packageJson)if(l.includes(e)){r.push(n),c[n]=`Found "${e}" in package.json`;break}if(!r.includes(n)&&(s.imports||s.patterns)){const o=findFiles(t,"*.js");e:for(const l of o.slice(0,50))try{const o=e(l,"utf-8");if(s.imports)for(const e of s.imports)if(o.includes(e)){r.push(n),c[n]=`Found "${e}" in ${i(t,l)}`;break e}if(s.patterns)for(const e of s.patterns)if(o.includes(e)){r.push(n),c[n]=`Found "${e}" in ${i(t,l)}`;break e}}catch(e){}}}return{detected:r,reasons:c}}
export async function checkCustomRules(e,t={}){const s=l(e),n=loadRuleSets();
let r=[],o=null;if(t.ruleSet)n[t.ruleSet]&&(r=n[t.ruleSet].rules);else if(!1!==t.autoDetect){if(o=detectProjectRuleSets(e),o.detected.length>0)for(const e of o.detected)n[e]&&r.push(...n[e].rules);for(const[e,t]of Object.entries(n))t.alwaysApply&&!o.detected.includes(e)&&r.push(...t.rules)}else for(const e of Object.values(n))r.push(...e.rules);
const i={};for(const e of r){const t=e.filePattern||"*.js";i[t]||(i[t]=[]),i[t].push(e)}const c=[];for(const[t,n]of Object.entries(i)){const r=findFiles(e,t);for(const e of r)for(const t of n){const n=checkFileAgainstRule(e,t,s);c.push(...n)}}const u=new Set,f=c.filter(e=>{const t=`${e.file}:${e.line}:${e.match}`;return!u.has(t)&&(u.add(t),!0)});
let a=f;t.severity&&(a=f.filter(e=>e.severity===t.severity));
const d={error:0,warning:1,info:2};a.sort((e,t)=>{const s=d[e.severity]-d[t.severity];return 0!==s?s:e.file.localeCompare(t.file)});
const p={error:a.filter(e=>"error"===e.severity).length,warning:a.filter(e=>"warning"===e.severity).length,info:a.filter(e=>"info"===e.severity).length},h={};for(const e of a)h[e.ruleId]=(h[e.ruleId]||0)+1;return{basePath:e,total:a.length,bySeverity:p,byRule:h,violations:a.slice(0,50),...o&&{detected:o}}}