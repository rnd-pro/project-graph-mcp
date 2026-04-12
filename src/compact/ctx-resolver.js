// @ctx .context/src/compact/ctx-resolver.ctx
import{readFileSync as t,existsSync as s}from"fs";import{join as i,basename as a,extname as c,dirname as p,relative as l}from"path";
export function resolveCtxPath(e,n){const o=a(n,c(n))+".ctx",r=p(n),d=i(e,".context",r,o);if(s(d))return d;const f=i(e,r,o);return s(f)?f:null}
export function resolveCtxRelPath(e,n){const o=l(n,e),r=a(o,c(o))+".ctx",u=p(o),d=i(n,".context",u,r);if(s(d))return".context/"+u+"/"+r;const f=i(n,u,r);return s(f)?u+"/"+r:null}
export function readCtxFile(e,n){const o=resolveCtxPath(e,n);return o?t(o,"utf-8"):null}
