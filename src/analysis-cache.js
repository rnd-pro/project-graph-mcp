import{readFileSync as t,writeFileSync as e,mkdirSync as n,existsSync as r}from"fs";import{join as c,dirname as o}from"path";import{createHash as a}from"crypto";
export function computeContentHash(t){return a("md5").update(t).digest("hex").slice(0,8)}
export function getCachePath(t,e){const n=e.replace(/\.[^.]+$/,".json");return c(t,".cache",n)}
export function readCache(e,n){const c=getCachePath(e,n);try{return r(c)?JSON.parse(t(c,"utf-8")):null}catch(t){return null}}
export function writeCache(t,r,c){const a=getCachePath(t,r);try{n(o(a),{recursive:!0}),e(a,JSON.stringify({...c,cachedAt:(new Date).toISOString()},null,2))}catch(t){}}
export function isCacheValid(t,e,n,r="content"){return!!t&&(!(!t.sig||!t.contentHash)&&("sig"===r?t.sig===e:t.sig===e&&t.contentHash===n))}