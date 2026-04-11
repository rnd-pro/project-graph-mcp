import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'fs';
import { join, basename, extname, dirname, relative } from 'path';
import { minify } from '../vendor/terser.mjs';
import { parse } from '../vendor/acorn.mjs';
import { simple as walk } from '../vendor/walk.mjs';

// ────────────────────────────────────────────────────────
// .ctx Parser → extract typed signatures for JSDoc injection
// ────────────────────────────────────────────────────────

function parseCtxSignatures(ctxContent) {
  const sigs = new Map(); // funcName → { params, returnType, description, exported }
  if (!ctxContent) return sigs;

  for (const line of ctxContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('---') || trimmed.startsWith('@') ||
        trimmed.startsWith('CALLS') || trimmed.startsWith('R→') ||
        trimmed.startsWith('W→') || trimmed.startsWith('PATTERNS:') ||
        trimmed.startsWith('EDGE_CASES:') || trimmed.startsWith('Rules:') ||
        trimmed.startsWith('Save this')) continue;

    // Class: class Name extends Parent|meta|description
    const classMatch = trimmed.match(/^class\s+([\w]+)([^|]*)\|([^|]*)\|?(.*)$/);
    if (classMatch) {
      sigs.set(classMatch[1], {
        type: 'class',
        extends: classMatch[2].replace(/\s*extends\s*/, '').trim() || null,
        meta: classMatch[3].trim(),
        description: classMatch[4]?.trim() || '',
        exported: false,
      });
      continue;
    }

    // Method: .methodName(params)|description
    const methodMatch = trimmed.match(/^\s+\.(\w+)\(([^)]*)\)\|?(.*)$/);
    if (methodMatch) {
      sigs.set(methodMatch[1], {
        type: 'method',
        params: parseCtxParams(methodMatch[2]),
        description: methodMatch[3]?.trim() || '',
      });
      continue;
    }

    // Function: [export] name(params)→calls|description
    // Extract typed params from .ctx format: name(param1:type1, param2?:type2)
    const funcMatch = trimmed.match(/^(export\s+)?(\w+)\(([^)]*)\)(→[^|]*)?\|(.*)$/);
    if (funcMatch) {
      const name = funcMatch[2];
      const paramStr = funcMatch[3];
      const callChain = funcMatch[4] || '';
      const descPart = funcMatch[5] || '';

      // Split description: first pipe-separated segment before further |
      const descParts = descPart.split('|');
      const description = descParts[0]?.trim() || '';

      sigs.set(name, {
        type: 'function',
        params: parseCtxParams(paramStr),
        returnType: extractReturnType(callChain),
        description,
        exported: !!funcMatch[1],
      });
      continue;
    }
  }

  return sigs;
}

function parseCtxParams(paramStr) {
  if (!paramStr || !paramStr.trim()) return [];
  return paramStr.split(',').map(p => {
    const trimmed = p.trim();
    if (!trimmed) return null;

    // param:Type or param?:Type or param=
    const typed = trimmed.match(/^(\w+)(\?)?(?::(\w[\w<>\[\]|.]*))?(=)?$/);
    if (typed) {
      return {
        name: typed[1],
        type: typed[3] || null,
        optional: !!(typed[2] || typed[4]),
      };
    }

    // Simple param name (no type info)
    const simple = trimmed.match(/^(\w+)(=)?$/);
    if (simple) {
      return { name: simple[1], type: null, optional: !!simple[2] };
    }

    // Rest/spread
    if (trimmed === '...') return { name: 'args', type: null, rest: true };

    return { name: trimmed.replace(/[=?:].*/g, ''), type: null };
  }).filter(Boolean);
}

function extractReturnType(callChain) {
  if (!callChain) return null;
  // →TypeName or →method1,method2 (calls, not type)
  // If starts with uppercase, likely a type
  const match = callChain.match(/^→([A-Z][\w<>\[\]|]*)/);
  if (match) return match[1];
  return null;
}

// ────────────────────────────────────────────────────────
// JSDoc Generator from .ctx signatures
// ────────────────────────────────────────────────────────

function sanitizeJSDocText(text) {
  // Escape */ inside JSDoc to prevent premature comment closure
  return text.replace(/\*\//g, '*\\/');
}

function generateJSDoc(sig) {
  const lines = ['/**'];

  if (sig.description && sig.description !== '{DESCRIBE}') {
    lines.push(` * ${sanitizeJSDocText(sig.description)}`);
  }

  if (sig.params && sig.params.length > 0) {
    for (const param of sig.params) {
      const type = param.type || '*';
      const opt = param.optional ? `[${param.name}]` : param.name;
      lines.push(` * @param {${type}} ${opt}`);
    }
  }

  if (sig.returnType) {
    lines.push(` * @returns {${sig.returnType}}`);
  }

  lines.push(' */');
  return lines.join('\n');
}

// ────────────────────────────────────────────────────────
// Decompile: compact → beautified + JSDoc
// ────────────────────────────────────────────────────────

export async function decompileFile(filePath, ctxContent, options = {}) {
  const { indentLevel = 2 } = options;

  const source = readFileSync(filePath, 'utf-8');
  if (!source.trim()) return { code: '', injected: 0, original: 0, decompiled: 0 };

  // Step 1: Beautify via Terser
  let beautified;
  try {
    const result = await minify(source, {
      compress: false,
      mangle: false,
      module: true,
      output: {
        beautify: true,
        comments: false,
        indent_level: indentLevel,
        semicolons: true,
      },
    });
    beautified = result.code || source;
  } catch {
    beautified = source;
  }

  // Step 2: Parse .ctx signatures
  const sigs = parseCtxSignatures(ctxContent);
  if (sigs.size === 0) {
    return {
      code: beautified,
      injected: 0,
      original: source.length,
      decompiled: beautified.length,
    };
  }

  // Step 3: Parse beautified AST to find injection points
  let ast;
  try {
    ast = parse(beautified, {
      ecmaVersion: 'latest',
      sourceType: 'module',
      locations: true,
    });
  } catch {
    return {
      code: beautified,
      injected: 0,
      original: source.length,
      decompiled: beautified.length,
    };
  }

  // Step 4: Collect injection points (sorted by position, reverse order for safe injection)
  const injections = [];

  walk(ast, {
    ExportNamedDeclaration(node) {
      const decl = node.declaration;
      if (!decl) return;

      if (decl.type === 'FunctionDeclaration' && decl.id?.name) {
        const sig = sigs.get(decl.id.name);
        if (sig) {
          injections.push({ pos: node.start, jsdoc: generateJSDoc(sig) });
        }
      }
      if (decl.type === 'ClassDeclaration' && decl.id?.name) {
        const sig = sigs.get(decl.id.name);
        if (sig && sig.description) {
          injections.push({
            pos: node.start,
            jsdoc: `/**\n * ${sig.description}\n */`,
          });
        }
      }
    },
    FunctionDeclaration(node) {
      if (!node.id?.name) return;
      // Skip if the parent is ExportNamedDeclaration (handled above)
      const sig = sigs.get(node.id.name);
      if (sig && !sig.exported) {
        injections.push({ pos: node.start, jsdoc: generateJSDoc(sig) });
      }
    },
    ClassDeclaration(node) {
      if (!node.id?.name) return;
      const sig = sigs.get(node.id.name);
      if (sig && !sig.exported && sig.description) {
        injections.push({
          pos: node.start,
          jsdoc: `/**\n * ${sig.description}\n */`,
        });
      }
    },
  });

  // Step 5: Inject JSDoc comments (reverse order to preserve positions)
  injections.sort((a, b) => b.pos - a.pos);

  let result = beautified;
  let injected = 0;
  for (const { pos, jsdoc } of injections) {
    // Find the line start to preserve indentation
    const beforePos = result.lastIndexOf('\n', pos - 1);
    const lineStart = beforePos === -1 ? 0 : beforePos + 1;
    const indent = result.slice(lineStart, pos).match(/^(\s*)/)?.[1] || '';

    const indentedJsdoc = jsdoc.split('\n').map(line => indent + line).join('\n');
    result = result.slice(0, pos) + indentedJsdoc + '\n' + result.slice(pos);
    injected++;
  }

  return {
    code: result,
    injected,
    original: source.length,
    decompiled: result.length,
  };
}

// ────────────────────────────────────────────────────────
// Decompile project: src/ → .full/
// ────────────────────────────────────────────────────────

const SKIP_DIRS = new Set(['node_modules', '.git', 'vendor', '.context', 'dev-docs', '.agent', '.agents', '.full', 'web']);
const SUPPORTED = new Set(['.js', '.mjs']);

function walkJSFiles(dir, rootDir = dir) {
  const results = [];
  try {
    for (const entry of readdirSync(dir)) {
      if (entry.startsWith('.') && entry !== '.') continue;
      const full = join(dir, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        if (!SKIP_DIRS.has(entry)) results.push(...walkJSFiles(full, rootDir));
      } else if (SUPPORTED.has(extname(entry).toLowerCase())) {
        results.push(full);
      }
    }
  } catch { /* skip */ }
  return results;
}

function resolveCtx(projectPath, relFile) {
  const ctxName = basename(relFile, extname(relFile)) + '.ctx';
  const fileDir = dirname(relFile);

  // 1. Colocated
  const colocated = join(projectPath, fileDir, ctxName);
  if (existsSync(colocated)) return readFileSync(colocated, 'utf-8');

  // 2. Mirror
  const mirrored = join(projectPath, '.context', fileDir, ctxName);
  if (existsSync(mirrored)) return readFileSync(mirrored, 'utf-8');

  return null;
}

export async function decompileProject(projectPath, options = {}) {
  const { dryRun = false, outputDir } = options;
  const fullDir = outputDir || join(projectPath, '.full');
  const srcDir = join(projectPath, 'src');

  if (!existsSync(srcDir)) {
    return { error: 'No src/ directory found', files: 0 };
  }

  const files = walkJSFiles(srcDir, projectPath);
  const processed = [];
  const errors = [];
  let totalInjected = 0;

  for (const filePath of files) {
    const relFile = relative(projectPath, filePath);
    try {
      const ctxContent = resolveCtx(projectPath, relFile);
      const result = await decompileFile(filePath, ctxContent);

      if (!dryRun) {
        const outPath = join(fullDir, relFile);
        const outDir = dirname(outPath);
        if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
        writeFileSync(outPath, result.code, 'utf-8');
      }

      processed.push({
        file: relFile,
        injected: result.injected,
        original: result.original,
        decompiled: result.decompiled,
      });
      totalInjected += result.injected;
    } catch (e) {
      errors.push({ file: relFile, error: e.message });
    }
  }

  return {
    outputDir: fullDir,
    files: processed.length,
    totalJSDocInjected: totalInjected,
    fileDetails: processed,
    errors: errors.length > 0 ? errors : undefined,
    dryRun,
  };
}

// ────────────────────────────────────────────────────────
// Error coordinate mapping: .full/ line → compact source line
// ────────────────────────────────────────────────────────

/**
 * Extract function/class declaration positions from code via AST
 * @param {string} code - JavaScript source code
 * @returns {Array<{name: string, line: number, endLine: number, type: string}>}
 */
function extractDeclarations(code) {
  const decls = [];
  try {
    const ast = parse(code, { ecmaVersion: 'latest', sourceType: 'module', locations: true });
    walk(ast, {
      FunctionDeclaration(node) {
        decls.push({
          name: node.id?.name || '<anonymous>',
          line: node.loc.start.line,
          endLine: node.loc.end.line,
          type: 'function',
        });
      },
      ClassDeclaration(node) {
        decls.push({
          name: node.id?.name || '<anonymous>',
          line: node.loc.start.line,
          endLine: node.loc.end.line,
          type: 'class',
        });
      },
      VariableDeclaration(node) {
        for (const decl of node.declarations) {
          if (decl.init && (decl.init.type === 'ArrowFunctionExpression' || decl.init.type === 'FunctionExpression')) {
            decls.push({
              name: decl.id?.name || '<anonymous>',
              line: node.loc.start.line,
              endLine: node.loc.end.line,
              type: 'function',
            });
          }
        }
      },
    });
  } catch { /* parse error — return empty */ }
  return decls;
}

/**
 * Build line mapping between compact source and decompiled .full/ code
 * Maps at symbol granularity: each function/class in .full/ maps to its compact counterpart
 * @param {string} compactCode - Compact (minified) source code
 * @param {string} fullCode - Decompiled (beautified + JSDoc) code
 * @returns {Map<number, {compactLine: number, symbol: string, type: string}>}
 */
export function buildLineMap(compactCode, fullCode) {
  const compactDecls = extractDeclarations(compactCode);
  const fullDecls = extractDeclarations(fullCode);
  const lineMap = new Map();

  // Match by name: for each declaration in .full/, find the same in compact
  const compactByName = new Map();
  for (const d of compactDecls) {
    compactByName.set(d.name, d);
  }

  for (const fullDecl of fullDecls) {
    const compactDecl = compactByName.get(fullDecl.name);
    if (!compactDecl) continue;

    // Map every line within this function's range in .full/ to the compact start line
    for (let line = fullDecl.line; line <= fullDecl.endLine; line++) {
      lineMap.set(line, {
        compactLine: compactDecl.line,
        symbol: fullDecl.name,
        type: fullDecl.type,
      });
    }
  }

  return lineMap;
}

/**
 * Map a .full/ file line number back to compact source coordinates
 * @param {string} compactFilePath - Path to compact source file
 * @param {string} fullFilePath - Path to decompiled .full/ file
 * @param {number} fullLine - Line number in the .full/ file
 * @returns {{compactLine: number, symbol: string, type: string} | null}
 */
export function mapFullToCompact(compactFilePath, fullFilePath, fullLine) {
  try {
    const compactCode = readFileSync(compactFilePath, 'utf-8');
    const fullCode = readFileSync(fullFilePath, 'utf-8');
    const lineMap = buildLineMap(compactCode, fullCode);
    return lineMap.get(fullLine) || null;
  } catch {
    return null;
  }
}
