// @ctx ai-context.ctx
import{estimateTokens}from"../core/utils.js";import{resolve as e,extname as t,relative as _rel,join as _join,basename as _base}from"path";import{getSkeleton as s,getGraph as o}from"../mcp/tools.js";import{getProjectDocs as n}from"./doc-dialect.js";import{compressFile as i}from"./compress.js";import{findJSFiles as r}from"../core/parser.js";import{readFileSync as _rf,existsSync as _ex,writeFileSync as _wf}from"fs";
const c=new Set([".js",".mjs",".ts",".tsx"]);
const IGNORE_FILE=".contextignore";
const DEFAULT_IGNORE=`# Files and directories excluded from AI context (get_ai_context includeFiles: ["*"])
# Glob patterns — one per line

# Vendored / bundled libs
vendor/
*.min.js
*.bundle.js
chart.js
d3.js
three.js
lodash.js
jquery*.js

# Generated
dist/
build/
coverage/
*.d.ts

# Tests
*.test.js
*.spec.js
`;
function _loadIgnore(p){const f=_join(p,IGNORE_FILE);if(!_ex(f)){try{_wf(f,DEFAULT_IGNORE)}catch{}return _parseIgnore(DEFAULT_IGNORE)}return _parseIgnore(_rf(f,"utf-8"))}
function _parseIgnore(s){return s.split("\n").map(l=>l.trim()).filter(l=>l&&!l.startsWith("#"))}
function _shouldIgnore(relPath,patterns){for(const p of patterns){if(p.endsWith("/")&&relPath.startsWith(p.slice(0,-1)))return true;if(p.endsWith("/")&&relPath.includes("/"+p.slice(0,-1)))return true;const re=new RegExp("^"+p.replace(/\./g,"\\.").replace(/\*/g,".*").replace(/\?/g,".")+"$");if(re.test(_base(relPath))||re.test(relPath))return true}return false}
export async function getAiContext(a,l={}){if(!a)return{error:"path is required",hint:'Usage: get_ai_context({ path: ".", includeFiles: ["*"] })',modes:{overview:'get_ai_context({ path: "." }) → skeleton + docs (~2-3k tokens)',code:'get_ai_context({ path: ".", includeFiles: ["*"] }) → all source files',full:'get_ai_context({ path: ".", includeFiles: ["*"], includeSkeleton: true, includeDocs: true }) → everything'}};const p=e(a);if(!_ex(p))return{error:`Path not found: ${p}`,hint:"Provide an existing directory path"};const f=l.includeFiles||[];if(typeof f==="string")return{error:"includeFiles must be an array, got string",hint:`Use includeFiles: ["${f}"] or includeFiles: ["*"] for all files`};const u={};const allJS=r(p);const wantAll=f.includes("*");const useSkeleton="includeSkeleton"in l?l.includeSkeleton:!wantAll;const useDocs="includeDocs"in l?l.includeDocs:!wantAll;if(allJS.length===0){u.hint="No JS/TS files found. Check the path — it should point to your source directory.";}
let g=0;if(useSkeleton&&(u.skeleton=await s(p),g+=estimateTokens(u.skeleton)),useDocs){const e=await o(p);u.docs=n(e,p),g+=estimateTokens(u.docs)}if(wantAll||f.length>0){u.files={};const ignorePatterns=wantAll?_loadIgnore(p):[];
let targets;if(wantAll){targets=allJS.map(e=>_rel(p,e)).filter(f=>!_shouldIgnore(f,ignorePatterns));u.ignored=allJS.length-targets.length}else{targets=f}for(const s of targets){const jsMatch=allJS.find(e=>e.endsWith(s)||e.endsWith("/"+s));if(jsMatch){const n=t(jsMatch).toLowerCase();if(c.has(n))try{const e=await i(jsMatch,{beautify:!1,legend:!1});u.files[s]=e.code,g+=e.compressed}catch(e){u.files[s]={error:e.message}}else{const txt=_rf(jsMatch,"utf-8");u.files[s]=txt;g+=estimateTokens(txt)}}else{const absPath=_join(p,s);if(_ex(absPath)){try{const txt=_rf(absPath,"utf-8");u.files[s]=txt;g+=estimateTokens(txt)}catch(e){u.files[s]={error:e.message}}}else{u.files[s]={error:`File not found: ${s}`}}}}}
let k=0;for(const e of allJS)try{k+=estimateTokens(_rf(e,"utf-8"))}catch{}const y=k>0?Math.round(100*(1-g/k)):0;return u.totalTokens=g,u.vsOriginal=k,u.savings=`${y}%`,u}