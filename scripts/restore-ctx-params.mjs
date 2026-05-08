#!/usr/bin/env node
import { execSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, dirname, basename, extname, relative } from 'path';
import { parse } from '../vendor/acorn.mjs';
import { simple } from '../vendor/walk.mjs';

const ROOT = process.cwd();
const HISTORY_COMMITS = [ '42c0be5', '84d53fc', '44c19a3', 'bdf8ca4' ];

function getHistoricalPaths(currentPath) {
  let base = basename(currentPath);
  let paths = [ currentPath ];
  if (currentPath.startsWith('src/')) {
    paths.push('src/' + base);
  }
  return paths;
}

function getOriginalFunctions(commit, filePath) {
  let fns = new Map();
  for (let p of getHistoricalPaths(filePath)) {
    let code;
    try {
      code = execSync(`git show ${commit}:${p}`, {
        cwd: ROOT,
        encoding: 'utf-8',
        stdio: [ 'pipe', 'pipe', 'pipe' ],
      });
    } catch {
      continue;
    }
    let lines = code.split('\n');
    if (lines.length < 5) continue;
    try {
      let ast = parse(code, {
        ecmaVersion: 'latest',
        sourceType: 'module',
      });
      simple(ast, {
        FunctionDeclaration(node) {
          if (node.id) {
            let params = node.params.map(p => {
              if (p.type === 'Identifier') return p.name;
              if (p.type === 'AssignmentPattern' && p.left.type === 'Identifier') {
                return p.left.name + '=';
              }
              if (p.type === 'RestElement' && p.argument.type === 'Identifier') {
                return '...' + p.argument.name;
              }
              return '?';
            });
            fns.set(node.id.name, {
              params: params,
              exported: false,
            });
          }
        },
      });
      for (let node of ast.body) {
        if (node.type === 'ExportNamedDeclaration') {
          if (node.declaration?.id) {
            let fn = fns.get(node.declaration.id.name);
            if (fn) fn.exported = true;
          }
          if (node.specifiers) {
            for (let sp of node.specifiers) {
              let fn = fns.get(sp.local.name);
              if (fn) {
                fn.exported = true;
                fn.exportedAs = sp.exported.name;
              }
            }
          }
        }
      }
    } catch {
      continue;
    }
    if (fns.size > 0) return fns;
  }
  return fns;
}

function walkDir(dir, ext) {
  let out = [];
  try {
    for (let f of readdirSync(dir)) {
      let p = join(dir, f);
      if (statSync(p).isDirectory()) {
        out.push(...walkDir(p, ext));
      } else if (f.endsWith(ext)) {
        out.push(p);
      }
    }
  } catch {}
  return out;
}

let ctxFiles = execSync('find .context -name "*.ctx" -type f', {
  cwd: ROOT,
  encoding: 'utf-8',
}).split('\n').filter(Boolean);

let totalUpdated = 0;
let totalParamsFixed = 0;

for (let ctxRel of ctxFiles) {
  let ctxPath = join(ROOT, ctxRel);
  let ctxContent = readFileSync(ctxPath, 'utf-8');
  let srcRel = ctxRel.replace('.context/', '').replace('.ctx', '.js');
  let origFns = null;
  for (let commit of HISTORY_COMMITS) {
    let fns = getOriginalFunctions(commit, srcRel);
    if (fns.size > 0) {
      origFns = fns;
      break;
    }
  }
  if (!origFns || origFns.size === 0) continue;
  let srcPath = join(ROOT, srcRel);
  if (!existsSync(srcPath)) continue;
  let srcCode = readFileSync(srcPath, 'utf-8');
  let currentFns = [];
  try {
    let ast = parse(srcCode, {
      ecmaVersion: 'latest',
      sourceType: 'module',
    });
    simple(ast, {
      FunctionDeclaration(node) {
        if (node.id) {
          currentFns.push({
            name: node.id.name,
            params: node.params.length,
            exported: false,
          });
        }
      },
    });
    for (let node of ast.body) {
      if (node.type === 'ExportNamedDeclaration') {
        if (node.declaration?.id) {
          let fn = currentFns.find(f => f.name === node.declaration.id.name);
          if (fn) fn.exported = true;
        }
        if (node.specifiers) {
          for (let sp of node.specifiers) {
            let fn = currentFns.find(f => f.name === sp.local.name);
            if (fn) {
              fn.exported = true;
              fn.exportedAs = sp.exported.name;
            }
          }
        }
      }
    }
  } catch {
    continue;
  }
  let origArr = [ ...origFns.entries() ];
  let changed = false;
  for (let currFn of currentFns) {
    let exportName = currFn.exportedAs || currFn.name;
    let origEntry = origFns.get(exportName);
    if (!origEntry) {
      for (let [name, fn] of origFns) {
        if (fn.exportedAs === exportName || name === exportName) {
          origEntry = fn;
          break;
        }
      }
    }
    if (!origEntry) continue;
    let origParams = origEntry.params.join(',');
    let patterns = [
      new RegExp(`(export\\s+${exportName})\\([^)]*\\)`, 'g'),
      new RegExp(`(export\\s+${currFn.name})\\([^)]*\\)`, 'g'),
      new RegExp(`(^${currFn.name})\\([^)]*\\)`, 'gm'),
    ];
    for (let pat of patterns) {
      let newCtx = ctxContent.replace(pat, `$1(${origParams})`);
      if (newCtx !== ctxContent) {
        ctxContent = newCtx;
        changed = true;
        totalParamsFixed++;
      }
    }
  }
  if (ctxContent.includes('(auto-documented)')) {
    ctxContent = ctxContent.replace(/\(auto-documented\)/g, '{NEEDS_DESCRIPTION}');
    changed = true;
  }
  if (changed) {
    writeFileSync(ctxPath, ctxContent);
    totalUpdated++;
    console.log(`Updated: ${ctxRel}`);
  }
}

console.log(`\nDone: ${totalUpdated} files updated, ${totalParamsFixed} param signatures restored`);
