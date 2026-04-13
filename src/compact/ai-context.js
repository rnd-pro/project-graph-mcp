// @ctx .context/src/compact/ai-context.ctx
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
export async function getAiContext(a,l={}){const f=l.includeFiles||[],p=e(a),u={};const allJS=r(p);const wantAll=f.includes("*");const useSkeleton="includeSkeleton"in l?l.includeSkeleton:!wantAll;const useDocs="includeDocs"in l?l.includeDocs:!wantAll;
let g=0;if(useSkeleton&&(u.skeleton=await s(p),g+=estimateTokens(u.skeleton)),useDocs){const e=await o(p);u.docs=n(e,p),g+=estimateTokens(u.docs)}if(wantAll||f.length>0){u.files={};const ignorePatterns=wantAll?_loadIgnore(p):[];
let targets;if(wantAll){targets=allJS.map(e=>_rel(p,e)).filter(f=>!_shouldIgnore(f,ignorePatterns));u.ignored=allJS.length-targets.length}else{targets=f}for(const s of targets){const o=allJS.find(e=>e.endsWith(s)||e.endsWith("/"+s));if(!o){u.files[s]={error:`File not found: ${s}`};continue}const n=t(o).toLowerCase();if(c.has(n))try{const e=await i(o,{beautify:!1,legend:!1});u.files[s]=e.code,g+=e.compressed}catch(e){u.files[s]={error:e.message}}else u.files[s]={error:`Unsupported file type: ${n}`}}}
let k=0;for(const e of allJS)try{k+=estimateTokens(_rf(e,"utf-8"))}catch{}const y=k>0?Math.round(100*(1-g/k)):0;return u.totalTokens=g,u.vsOriginal=k,u.savings=`${y}%`,u}