// @ctx .context/src/core/file-walker.ctx
import{readdirSync as n,statSync as o}from"fs";import{join as r,extname as c}from"path";
const f=new Set(["node_modules",".git","vendor",".context","dev-docs",".agent",".agents",".expanded","web"]),d=new Set([".js",".mjs"]);
export function walkJSFiles(e,t=e){const s=[];try{for(const a of n(e)){if(a.startsWith(".")&&"."!==a)continue;const n=r(e,a);o(n).isDirectory()?f.has(a)||s.push(...walkJSFiles(n,t)):d.has(c(a).toLowerCase())&&s.push(n)}}catch{}return s}
