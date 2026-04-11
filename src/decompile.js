import{readFileSync as t,writeFileSync as e,mkdirSync as n,existsSync as o,readdirSync as r,statSync as i}from"fs";import{join as s,basename as c,extname as a,dirname as l,relative as p}from"path";import{minify as u}from"../vendor/terser.mjs";import{parse as m}from"../vendor/acorn.mjs";import{simple as d}from"../vendor/walk.mjs";function parseCtxSignatures(t){const e=new Map;if(!t)return e;for(const n of t.split("\n")){const t=n.trim();if(!t||t.startsWith("---")||t.startsWith("@")||t.startsWith("CALLS")||t.startsWith("R→")||t.startsWith("W→")||t.startsWith("PATTERNS:")||t.startsWith("EDGE_CASES:")||t.startsWith("Rules:")||t.startsWith("Save this"))continue;
const o=t.match(/^class\s+([\w]+)([^|]*)\|([^|]*)\|?(.*)$/);if(o){e.set(o[1],{type:"class",extends:o[2].replace(/\s*extends\s*/,"").trim()||null,meta:o[3].trim(),description:o[4]?.trim()||"",exported:!1});continue}const r=t.match(/^\s+\.(\w+)\(([^)]*)\)\|?(.*)$/);if(r){e.set(r[1],{type:"method",params:parseCtxParams(r[2]),description:r[3]?.trim()||""});continue}const i=t.match(/^(export\s+)?(\w+)\(([^)]*)\)(→[^|]*)?\|(.*)$/);if(i){const t=i[2],n=i[3],o=i[4]||"",r=(i[5]||"").split("|"),s=r[0]?.trim()||"";e.set(t,{type:"function",params:parseCtxParams(n),returnType:extractReturnType(o),description:s,exported:!!i[1]});continue}}return e}
function parseCtxParams(t){return t&&t.trim()?t.split(",").map(t=>{const e=t.trim();if(!e)return null;
const n=e.match(/^(\w+)(\?)?(?::(\w[\w<>\[\]|.]*))?(=)?$/);if(n)return{name:n[1],type:n[3]||null,optional:!(!n[2]&&!n[4])};
const o=e.match(/^(\w+)(=)?$/);return o?{name:o[1],type:null,optional:!!o[2]}:"..."===e?{name:"args",type:null,rest:!0}:{name:e.replace(/[=?:].*/g,""),type:null}}).filter(Boolean):[]}
function extractReturnType(t){if(!t)return null;
const e=t.match(/^→([A-Z][\w<>\[\]|]*)/);return e?e[1]:null}
function sanitizeJSDocText(t){return t.replace(/\*\//g,"*\\/")}
function generateJSDoc(t){const e=["/**"];if(t.description&&"{DESCRIBE}"!==t.description&&e.push(` * ${sanitizeJSDocText(t.description)}`),t.params&&t.params.length>0)for(const n of t.params){const t=n.type||"*",o=n.optional?`[${n.name}]`:n.name;e.push(` * @param {${t}} ${o}`)}return t.returnType&&e.push(` * @returns {${t.returnType}}`),e.push(" */"),e.join("\n")}
export async function decompileFile(e,n,o={}){const{indentLevel:r=2}=o,i=t(e,"utf-8");if(!i.trim())return{code:"",injected:0,original:0,decompiled:0};
let s;try{s=(await u(i,{compress:!1,mangle:!1,module:!0,output:{beautify:!0,comments:!1,indent_level:r,semicolons:!0}})).code||i}catch{s=i}const c=parseCtxSignatures(n);if(0===c.size)return{code:s,injected:0,original:i.length,decompiled:s.length};
let a;try{a=m(s,{ecmaVersion:"latest",sourceType:"module",locations:!0})}catch{return{code:s,injected:0,original:i.length,decompiled:s.length}}const l=[];d(a,{ExportNamedDeclaration(t){const e=t.declaration;if(e){if("FunctionDeclaration"===e.type&&e.id?.name){const n=c.get(e.id.name);n&&l.push({pos:t.start,jsdoc:generateJSDoc(n)})}if("ClassDeclaration"===e.type&&e.id?.name){const n=c.get(e.id.name);n&&n.description&&l.push({pos:t.start,jsdoc:`/**\n * ${n.description}\n */`})}}},FunctionDeclaration(t){if(!t.id?.name)return;
const e=c.get(t.id.name);e&&!e.exported&&l.push({pos:t.start,jsdoc:generateJSDoc(e)})},ClassDeclaration(t){if(!t.id?.name)return;
const e=c.get(t.id.name);e&&!e.exported&&e.description&&l.push({pos:t.start,jsdoc:`/**\n * ${e.description}\n */`})}}),l.sort((t,e)=>e.pos-t.pos);
function extractImportLegend(ast) {
  const aliases = [];
  d(ast, { ImportDeclaration(node) {
    for (const spec of node.specifiers) {
      if ("ImportSpecifier" === spec.type && spec.imported.name !== spec.local.name)
        aliases.push({ original: spec.imported.name, alias: spec.local.name, source: node.source.value });
      else if ("ImportDefaultSpecifier" === spec.type)
        aliases.push({ original: "default", alias: spec.local.name, source: node.source.value });
      else if ("ImportNamespaceSpecifier" === spec.type && spec.local.name.length <= 2)
        aliases.push({ original: "*", alias: spec.local.name, source: node.source.value });
    }
  }});
  if (0 === aliases.length) return "";
  const bySource = new Map;
  for (const a of aliases) {
    const key = a.source.split("/").pop().replace(/\.\w+$/, "");
    bySource.has(key) || bySource.set(key, []);
    bySource.get(key).push(a.alias + "=" + ("*" === a.original ? "* (namespace)" : a.original));
  }
  const lines = [];
  for (const [src, maps] of bySource) lines.push(` * ${src}: ${maps.join(", ")}`);
  return "/**\n * @names Import aliases\n" + lines.join("\n") + "\n */\n";
}
function addParamHints(code, ast, ctxMap) {
  const replacements = [];
  const seen = new Set;
  const visitor = node => {
    const fn = node.declaration || node;
    if ("FunctionDeclaration" !== fn.type || !fn.id?.name) return;
    if (seen.has(fn.id.name)) return;
    seen.add(fn.id.name);
    const ctx = ctxMap.get(fn.id.name);
    if (!ctx || !ctx.params || 0 === ctx.params.length) return;
    const mangledParams = fn.params.map(p => "Identifier" === p.type ? p.name : "AssignmentPattern" === p.type && "Identifier" === p.left.type ? p.left.name : null).filter(Boolean);
    const hints = [];
    for (let i = 0; i < Math.min(mangledParams.length, ctx.params.length); i++) {
      if (mangledParams[i] !== ctx.params[i].name) hints.push(mangledParams[i] + "=" + ctx.params[i].name);
    }
    if (0 === hints.length) return;
    const closeParenIdx = code.indexOf(")", fn.params[fn.params.length - 1].end);
    if (closeParenIdx > -1) replacements.push({ pos: closeParenIdx + 1, text: " /* " + hints.join(", ") + " */" });
  };
  d(ast, { FunctionDeclaration: visitor, ExportNamedDeclaration(node) { node.declaration && "FunctionDeclaration" === node.declaration.type && visitor(node); } });
  replacements.sort((a, b) => b.pos - a.pos);
  let result = code;
  for (const r of replacements) result = result.slice(0, r.pos) + r.text + result.slice(r.pos);
  return result;
}
let p=s,f=0;for(const{pos:t,jsdoc:e}of l){const n=p.lastIndexOf("\n",t-1),o=-1===n?0:n+1,r=p.slice(o,t).match(/^(\s*)/)?.[1]||"",i=e.split("\n").map(t=>r+t).join("\n");p=p.slice(0,t)+i+"\n"+p.slice(t),f++}try{const legendAst=m(p,{ecmaVersion:"latest",sourceType:"module",locations:!0});p=addParamHints(p,legendAst,c);const legend=extractImportLegend(legendAst);legend&&(p=legend+p)}catch{}return{code:p,injected:f,original:i.length,decompiled:p.length}}const f=new Set(["node_modules",".git","vendor",".context","dev-docs",".agent",".agents",".full","web"]),h=new Set([".js",".mjs"]);function walkJSFiles(t,e=t){const n=[];try{for(const o of r(t)){if(o.startsWith(".")&&"."!==o)continue;
const r=s(t,o);i(r).isDirectory()?f.has(o)||n.push(...walkJSFiles(r,e)):h.has(a(o).toLowerCase())&&n.push(r)}}catch{}return n}
function resolveCtx(e,n){const r=c(n,a(n))+".ctx",i=l(n),p=s(e,i,r);if(o(p))return t(p,"utf-8");
const u=s(e,".context",i,r);return o(u)?t(u,"utf-8"):null}
export async function decompileProject(t,r={}){const{dryRun:i=!1,outputDir:c}=r,a=c||s(t,".full"),u=s(t,"src");if(!o(u))return{error:"No src/ directory found",files:0};
const m=walkJSFiles(u,t),d=[],f=[];
let h=0;for(const r of m){const c=p(t,r);try{const p=resolveCtx(t,c),u=await decompileFile(r,p);if(!i){const t=s(a,c),r=l(t);o(r)||n(r,{recursive:!0}),e(t,u.code,"utf-8")}d.push({file:c,injected:u.injected,original:u.original,decompiled:u.decompiled}),h+=u.injected}catch(t){f.push({file:c,error:t.message})}}return{outputDir:a,files:d.length,totalJSDocInjected:h,fileDetails:d,errors:f.length>0?f:void 0,dryRun:i}}
function extractDeclarations(t){const e=[];try{const n=m(t,{ecmaVersion:"latest",sourceType:"module",locations:!0});d(n,{FunctionDeclaration(t){e.push({name:t.id?.name||"<anonymous>",line:t.loc.start.line,endLine:t.loc.end.line,type:"function"})},ClassDeclaration(t){e.push({name:t.id?.name||"<anonymous>",line:t.loc.start.line,endLine:t.loc.end.line,type:"class"})},VariableDeclaration(t){for(const n of t.declarations)!n.init||"ArrowFunctionExpression"!==n.init.type&&"FunctionExpression"!==n.init.type||e.push({name:n.id?.name||"<anonymous>",line:t.loc.start.line,endLine:t.loc.end.line,type:"function"})}})}catch{}return e}
export function buildLineMap(t,e){const n=extractDeclarations(t),o=extractDeclarations(e),r=new Map,i=new Map;for(const t of n)i.set(t.name,t);for(const t of o){const e=i.get(t.name);if(e)for(let n=t.line;n<=t.endLine;n++)r.set(n,{compactLine:e.line,symbol:t.name,type:t.type})}return r}
export function mapFullToCompact(e,n,o){try{const r=t(e,"utf-8"),i=t(n,"utf-8");return buildLineMap(r,i).get(o)||null}catch{return null}}