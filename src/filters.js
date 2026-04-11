import{readFileSync as e,existsSync as t}from"fs";import{join as r}from"path";
const i=["node_modules","dist","build","coverage",".next",".nuxt",".output","__pycache__",".cache",".turbo","out"],n=["*.test.js","*.spec.js","*.min.js","*.bundle.js","*.d.ts",".project-graph-cache.json"];
let u={excludeDirs:[...i],excludePatterns:[...n],includeHidden:!1,useGitignore:!0,gitignorePatterns:[]};
export function getFilters(){return{...u}}
export function setFilters(e){return void 0!==e.excludeDirs&&(u.excludeDirs=e.excludeDirs),void 0!==e.excludePatterns&&(u.excludePatterns=e.excludePatterns),void 0!==e.includeHidden&&(u.includeHidden=e.includeHidden),void 0!==e.useGitignore&&(u.useGitignore=e.useGitignore),getFilters()}
export function addExcludes(e){return u.excludeDirs=[...new Set([...u.excludeDirs,...e])],getFilters()}
export function removeExcludes(e){return u.excludeDirs=u.excludeDirs.filter(t=>!e.includes(t)),getFilters()}
export function resetFilters(){return u={excludeDirs:[...i],excludePatterns:[...n],includeHidden:!1,useGitignore:!0,gitignorePatterns:[]},getFilters()}
export function parseGitignore(i){const n=r(i,".gitignore");if(!t(n))return[];try{const t=e(n,"utf-8").split("\n").map(e=>e.trim()).filter(e=>e&&!e.startsWith("#")).map(e=>e.replace(/\/$/,""));return u.gitignorePatterns=t,t}catch(e){return[]}}
export function shouldExcludeDir(e,t=""){if(!u.includeHidden&&e.startsWith("."))return!0;if(u.excludeDirs.includes(e))return!0;if(u.useGitignore)for(const r of u.gitignorePatterns)if(matchGitignorePattern(r,e,t))return!0;return!1}
export function shouldExcludeFile(e,t=""){for(const t of u.excludePatterns)if(matchWildcard(t,e))return!0;if(u.useGitignore)for(const r of u.gitignorePatterns)if(matchGitignorePattern(r,e,t))return!0;return!1}
function matchWildcard(e,t){const r=e.replace(/\./g,"\\.").replace(/\*/g,".*");return new RegExp(`^${r}$`).test(t)}
function matchGitignorePattern(e,t,r){if(e===t)return!0;if(e.includes("*"))return matchWildcard(e,t);return!!(r?`${r}/${t}`:t).includes(e)}