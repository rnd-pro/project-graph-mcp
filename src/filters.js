// @ctx .context/src/filters.ctx
import{readFileSync as e,existsSync as t}from"fs";import{join as r}from"path";
const i=["node_modules","dist","build","coverage",".next",".nuxt",".output","__pycache__",".cache",".turbo","out"],n=["*.test.js","*.spec.js","*.min.js","*.bundle.js","*.d.ts",".project-graph-cache.json"];
let s={excludeDirs:[...i],excludePatterns:[...n],includeHidden:!1,useGitignore:!0,gitignorePatterns:[]};
export function getFilters(){return{...s}}
export function setFilters(e){return void 0!==e.excludeDirs&&(s.excludeDirs=e.excludeDirs),void 0!==e.excludePatterns&&(s.excludePatterns=e.excludePatterns),void 0!==e.includeHidden&&(s.includeHidden=e.includeHidden),void 0!==e.useGitignore&&(s.useGitignore=e.useGitignore),getFilters()}
export function addExcludes(e){return s.excludeDirs=[...new Set([...s.excludeDirs,...e])],getFilters()}
export function removeExcludes(e){return s.excludeDirs=s.excludeDirs.filter(t=>!e.includes(t)),getFilters()}
export function resetFilters(){return s={excludeDirs:[...i],excludePatterns:[...n],includeHidden:!1,useGitignore:!0,gitignorePatterns:[]},getFilters()}
export function parseGitignore(i){const n=r(i,".gitignore");if(!t(n))return[];try{const t=e(n,"utf-8").split("\n").map(e=>e.trim()).filter(e=>e&&!e.startsWith("#")).map(e=>e.replace(/\/$/,""));return s.gitignorePatterns=t,t}catch(e){return[]}}
export function shouldExcludeDir(e,t=""){if(!s.includeHidden&&e.startsWith("."))return!0;if(s.excludeDirs.includes(e))return!0;if(s.useGitignore)for(const r of s.gitignorePatterns)if(matchGitignorePattern(r,e,t))return!0;return!1}
export function shouldExcludeFile(e,t=""){for(const t of s.excludePatterns)if(matchWildcard(t,e))return!0;if(s.useGitignore)for(const r of s.gitignorePatterns)if(matchGitignorePattern(r,e,t))return!0;return!1}
function matchWildcard(e,t){const r=e.replace(/\./g,"\\.").replace(/\*/g,".*");return new RegExp(`^${r}$`).test(t)}
function matchGitignorePattern(e,t,r){return e===t||(e.includes("*")?matchWildcard(e,t):!!(r?`${r}/${t}`:t).includes(e))}