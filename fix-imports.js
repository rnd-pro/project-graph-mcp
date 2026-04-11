const t=require("fs"),e=require("path");
const r=function getAllFiles(r){let s=[];return t.readdirSync(r).forEach(i=>{i=e.join(r,i);
const n=t.statSync(i);n&&n.isDirectory()?s=s.concat(getAllFiles(i)):i.endsWith(".js")&&s.push(i)}),s}(e.join(__dirname,"src")),s={};r.forEach(t=>{s[e.basename(t)]=t}),r.forEach(r=>{let i=t.readFileSync(r,"utf-8"),n=!1;i=i.replace(/(from|import)(\s*\(?\s*)(['"])\.\/([^'"]+\.js)\3(\)?)/g,(t,i,c,o,a,l)=>{if(s[a]){const t=s[a];
let d=e.relative(e.dirname(r),t);return d.startsWith(".")||(d="./"+d),n=!0,`${i}${c}${o}${d}${o}${l}`}return t}),n&&(t.writeFileSync(r,i,"utf-8"),console.log(`Updated ${e.relative(__dirname,r)}`))});
const i=e.join(__dirname,"tests/compact.test.js");if(t.existsSync(i)){let r=t.readFileSync(i,"utf-8"),n=!1;
const c=/(from|import)(\s*\(?\s*)(['"])\.\.\/src\/([^'"]+\.js)\3(\)?)/g;r=r.replace(c,(t,r,c,o,a,l)=>{if(s[a]){const t=s[a];
let d=e.relative(e.dirname(i),t);return d.startsWith(".")||(d="./"+d),n=!0,`${r}${c}${o}${d}${o}${l}`}return t}),n&&(t.writeFileSync(i,r,"utf-8"),console.log("Updated tests/compact.test.js"))}