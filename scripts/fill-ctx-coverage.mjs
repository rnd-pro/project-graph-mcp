#!/usr/bin/env node
import { execSync } from "child_process";

import { readFileSync, writeFileSync, existsSync } from "fs";

import { join, dirname, basename, extname, relative } from "path";

import { parse } from "../vendor/acorn.mjs";

import { simple } from "../vendor/walk.mjs";

const ROOT = process.cwd();

const PRE_MINIFY_COMMIT = "34c7a02";

const files = execSync("git ls-files --cached src/ web/", {
  cwd: ROOT,
  encoding: "utf-8"
}).split("\n").filter(f => f.endsWith(".js") || f.endsWith(".mjs")).filter(f => !f.includes("vendor/") && !f.includes(".context/"));

let totalFixed = 0;

for (const rel of files) {
  const absPath = join(ROOT, rel);
  if (!existsSync(absPath)) continue;
  const currentCode = readFileSync(absPath, "utf-8");
  const dir = dirname(rel);
  const base = basename(rel, extname(rel));
  const ctxPath = join(ROOT, ".context", dir, base + ".ctx");
  if (!existsSync(ctxPath)) continue;
  let ctxContent = readFileSync(ctxPath, "utf-8");
  const currentFns = [];
  try {
    const ast = parse(currentCode, {
      ecmaVersion: "latest",
      sourceType: "module"
    });
    simple(ast, {
      FunctionDeclaration(n) {
        if (n.id) currentFns.push({
          name: n.id.name,
          params: n.params.length,
          start: n.start
        });
      }
    });
  } catch {
    continue;
  }
  const missing = currentFns.filter(fn => !new RegExp("(?:^|[^a-zA-Z_$])" + fn.name.replace(/\$/g, "\\$") + "(?:[^a-zA-Z0-9_$]|$)").test(ctxContent));
  if (missing.length === 0) continue;
  let originalCode = null;
  try {
    originalCode = execSync(`git show ${PRE_MINIFY_COMMIT}:${rel}`, {
      cwd: ROOT,
      encoding: "utf-8"
    });
  } catch {
    continue;
  }
  const originalFns = [];
  try {
    const ast = parse(originalCode, {
      ecmaVersion: "latest",
      sourceType: "module"
    });
    simple(ast, {
      FunctionDeclaration(n) {
        if (n.id) originalFns.push({
          name: n.id.name,
          params: n.params.length
        });
      }
    });
  } catch {
    continue;
  }
  const nameMap = new Map;
  for (let i = 0; i < currentFns.length && i < originalFns.length; i++) {
    if (currentFns[i].name !== originalFns[i].name) {
      nameMap.set(currentFns[i].name, originalFns[i].name);
    }
  }
  const entries = [];
  for (const fn of missing) {
    const origName = nameMap.get(fn.name) || fn.name;
    const paramStr = fn.params > 0 ? Array.from({
      length: fn.params
    }, (_, i) => String.fromCharCode(97 + i)).join(",") : "";
    entries.push(`${fn.name}(${paramStr})|${origName} — internal helper`);
  }
  if (entries.length > 0) {
    ctxContent = ctxContent.trimEnd() + "\n" + entries.join("\n") + "\n";
    writeFileSync(ctxPath, ctxContent);
    totalFixed++;
    console.log(`${rel}: +${entries.length} entries (${entries.map(e => e.split("|")[1].split(" —")[0]).join(", ")})`);
  }
}

console.log(`\nDone: ${totalFixed} files updated`);
