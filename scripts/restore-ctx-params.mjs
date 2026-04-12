#!/usr/bin/env node
/**
 * Restore original parameter names in .ctx files from git history.
 * Walks git history backwards to find the earliest readable (non-minified) version
 * of each file's exported functions, then updates .ctx signatures with real param names.
 */
import{execSync}from'child_process';
import{readFileSync,writeFileSync,existsSync}from'fs';
import{join,dirname,basename,extname,relative}from'path';
import{parse}from'../vendor/acorn.mjs';
import{simple}from'../vendor/walk.mjs';

const ROOT=process.cwd();

// File mapping: current path → historical path(s) to search
// bdf8ca4 moved files into src/ subdirectories
const HISTORY_COMMITS=['42c0be5','84d53fc','44c19a3','bdf8ca4'];

// Map current src/ structure back to old flat structure
function getHistoricalPaths(currentPath){
  const base=basename(currentPath);
  const paths=[currentPath];
  // Old flat structure: src/tools.js etc
  if(currentPath.startsWith('src/')){
    paths.push('src/'+base);
  }
  return paths;
}

function getOriginalFunctions(commit, filePath){
  const fns=new Map();
  for(const p of getHistoricalPaths(filePath)){
    let code;
    try{
      code=execSync(`git show ${commit}:${p}`,{cwd:ROOT,encoding:'utf-8',stdio:['pipe','pipe','pipe']});
    }catch{continue}
    
    // Check if code is readable (not minified) — readable code has multi-line functions
    const lines=code.split('\n');
    if(lines.length<5)continue; // Single-line = minified
    
    try{
      const ast=parse(code,{ecmaVersion:'latest',sourceType:'module'});
      simple(ast,{
        FunctionDeclaration(node){
          if(node.id){
            const params=node.params.map(p=>{
              if(p.type==='Identifier')return p.name;
              if(p.type==='AssignmentPattern'&&p.left.type==='Identifier')return p.left.name+'=';
              if(p.type==='RestElement'&&p.argument.type==='Identifier')return'...'+p.argument.name;
              return'?';
            });
            fns.set(node.id.name,{params,exported:false});
          }
        }
      });
      // Check which are exported
      for(const node of ast.body){
        if(node.type==='ExportNamedDeclaration'){
          if(node.declaration?.id){
            const fn=fns.get(node.declaration.id.name);
            if(fn)fn.exported=true;
          }
          if(node.specifiers){
            for(const sp of node.specifiers){
              const fn=fns.get(sp.local.name);
              if(fn){fn.exported=true;fn.exportedAs=sp.exported.name}
            }
          }
        }
      }
    }catch{continue}
    
    if(fns.size>0)return fns;
  }
  return fns;
}

// Get all .ctx files
function walkDir(dir,ext){
  const out=[];
  try{
    for(const f of require('fs').readdirSync(dir)){
      const p=join(dir,f);
      if(require('fs').statSync(p).isDirectory())out.push(...walkDir(p,ext));
      else if(f.endsWith(ext))out.push(p);
    }
  }catch{}
  return out;
}

const ctxFiles=execSync('find .context -name "*.ctx" -type f',{cwd:ROOT,encoding:'utf-8'}).split('\n').filter(Boolean);

let totalUpdated=0;
let totalParamsFixed=0;

for(const ctxRel of ctxFiles){
  const ctxPath=join(ROOT,ctxRel);
  let ctxContent=readFileSync(ctxPath,'utf-8');
  
  // Determine source file path
  const srcRel=ctxRel.replace('.context/','').replace('.ctx','.js');
  
  // Try each historical commit to find readable version
  let origFns=null;
  for(const commit of HISTORY_COMMITS){
    const fns=getOriginalFunctions(commit, srcRel);
    if(fns.size>0){
      origFns=fns;
      break;
    }
  }
  if(!origFns||origFns.size===0)continue;
  
  // Now get current minified function names to create mapping
  const srcPath=join(ROOT,srcRel);
  if(!existsSync(srcPath))continue;
  const srcCode=readFileSync(srcPath,'utf-8');
  
  const currentFns=[];
  try{
    const ast=parse(srcCode,{ecmaVersion:'latest',sourceType:'module'});
    simple(ast,{
      FunctionDeclaration(node){
        if(node.id)currentFns.push({
          name:node.id.name,
          params:node.params.length,
          exported:false
        });
      }
    });
    for(const node of ast.body){
      if(node.type==='ExportNamedDeclaration'){
        if(node.declaration?.id){
          const fn=currentFns.find(f=>f.name===node.declaration.id.name);
          if(fn)fn.exported=true;
        }
        if(node.specifiers){
          for(const sp of node.specifiers){
            const fn=currentFns.find(f=>f.name===sp.local.name);
            if(fn){fn.exported=true;fn.exportedAs=sp.exported.name}
          }
        }
      }
    }
  }catch{continue}
  
  // Map current→original by exported name match
  const origArr=[...origFns.entries()];
  let changed=false;
  
  for(const currFn of currentFns){
    const exportName=currFn.exportedAs||currFn.name;
    // Find original by same export name
    let origEntry=origFns.get(exportName);
    if(!origEntry){
      // Try by exportedAs
      for(const[name,fn] of origFns){
        if(fn.exportedAs===exportName||name===exportName){
          origEntry=fn;break;
        }
      }
    }
    if(!origEntry)continue;
    
    // Build regex to find this function in .ctx and replace params
    const origParams=origEntry.params.join(',');
    // Find: export? currentName(anything) or currentName(anything)
    const patterns=[
      new RegExp(`(export\\s+${exportName})\\([^)]*\\)`, 'g'),
      new RegExp(`(export\\s+${currFn.name})\\([^)]*\\)`, 'g'),
      new RegExp(`(^${currFn.name})\\([^)]*\\)`, 'gm'),
    ];
    
    for(const pat of patterns){
      const newCtx=ctxContent.replace(pat, `$1(${origParams})`);
      if(newCtx!==ctxContent){
        ctxContent=newCtx;
        changed=true;
        totalParamsFixed++;
      }
    }
  }
  
  // Also fix (auto-documented) → try to get description from original JSDoc
  if(ctxContent.includes('(auto-documented)')){
    // For now just flag it — real descriptions need manual work or AI generation
    ctxContent=ctxContent.replace(/\(auto-documented\)/g,'{NEEDS_DESCRIPTION}');
    changed=true;
  }
  
  if(changed){
    writeFileSync(ctxPath, ctxContent);
    totalUpdated++;
    console.log(`Updated: ${ctxRel}`);
  }
}

console.log(`\nDone: ${totalUpdated} files updated, ${totalParamsFixed} param signatures restored`);
