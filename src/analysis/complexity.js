// @ctx .context/src/analysis/complexity.ctx
import{readFileSync as t,readdirSync as e,statSync as i}from"fs";import{join as n,relative as o,resolve as r}from"path";import{parse as a}from"../../vendor/acorn.mjs";import*as l from"../../vendor/walk.mjs";import{shouldExcludeDir as s,shouldExcludeFile as c,parseGitignore as m}from"../core/filters.js";function findJSFiles(t,r=t){t===r&&m(r);
const a=[];try{for(const l of e(t)){const e=n(t,l),m=o(r,e);i(e).isDirectory()?s(l,m)||a.push(...findJSFiles(e,r)):!l.endsWith(".js")||l.endsWith(".css.js")||l.endsWith(".tpl.js")||c(l,m)||a.push(e)}}catch(t){}return a}
function calculateComplexity(t){let e=1;return l.simple(t,{IfStatement(){e++},ConditionalExpression(){e++},ForStatement(){e++},ForOfStatement(){e++},ForInStatement(){e++},WhileStatement(){e++},DoWhileStatement(){e++},SwitchCase(t){t.test&&e++},LogicalExpression(t){"&&"!==t.operator&&"||"!==t.operator||e++},BinaryExpression(t){"??"===t.operator&&e++},CatchClause(){e++}}),e}
function getRating(t){return t<=5?"low":t<=10?"moderate":t<=20?"high":"critical"}
export function analyzeComplexityFile(t,e){const i=[];
let n;try{n=a(t,{ecmaVersion:"latest",sourceType:"module",locations:!0})}catch(t){return i}return l.simple(n,{FunctionDeclaration(t){if(!t.id)return;
const n=calculateComplexity(t.body);i.push({name:t.id.name,type:"function",file:e,line:t.loc.start.line,complexity:n,rating:getRating(n)})},ArrowFunctionExpression(t){if("BlockStatement"!==t.body.type)return;
const n=calculateComplexity(t.body);n>5&&i.push({name:"(arrow)",type:"function",file:e,line:t.loc.start.line,complexity:n,rating:getRating(n)})},MethodDefinition(t){if("method"!==t.kind)return;
const n=t.key.name||t.key.value,o=calculateComplexity(t.value.body);i.push({name:n,type:"method",file:e,line:t.loc.start.line,complexity:o,rating:getRating(o)})}}),i}
function analyzeFile(e,i){let n;try{n=t(e,"utf-8")}catch(t){return[]}return analyzeComplexityFile(n,o(i,e))}
export async function getComplexity(t,e={}){const i=e.minComplexity||1,n=e.onlyProblematic||!1,o=r(t),a=findJSFiles(t);
let l=[];for(const t of a)l.push(...analyzeFile(t,o));l=l.filter(t=>!(t.complexity<i||n&&("low"===t.rating||"moderate"===t.rating))),l.sort((t,e)=>e.complexity-t.complexity);
const s={low:l.filter(t=>"low"===t.rating).length,moderate:l.filter(t=>"moderate"===t.rating).length,high:l.filter(t=>"high"===t.rating).length,critical:l.filter(t=>"critical"===t.rating).length,average:l.length>0?Math.round(l.reduce((t,e)=>t+e.complexity,0)/l.length*10)/10:0};return{total:l.length,stats:s,items:l.slice(0,30)}}