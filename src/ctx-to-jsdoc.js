/**
 * CTX-to-JSDoc Generator
 * 
 * Generates JSDoc blocks from .ctx contract files and injects them
 * into source code. Also supports stripping JSDoc from source.
 * 
 * This is a BUILD STEP for IDE IntelliSense support when working
 * in Compact Code Mode (where documentation lives in .ctx files only).
 */

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, extname, relative, dirname, basename } from 'path';
import { parse } from '../vendor/acorn.mjs';
import { simple as walk } from '../vendor/walk.mjs';

const SUPPORTED = new Set(['.js', '.mjs']);
const SKIP_DIRS = new Set(['node_modules', '.git', 'vendor', '.context', 'dev-docs', '.agent', '.agents']);

/**
 * Parse a .ctx file into structured signature data
 * @param {string} ctxContent - Content of .ctx file
 * @returns {{ file: string|null, functions: Array<{name: string, params: string, exported: boolean, description: string}> }}
 */
export function parseCtxFile(ctxContent) {
  const lines = ctxContent.split('\n');
  const result = { file: null, functions: [] };

  for (const line of lines) {
    // File header: --- src/workspace.js ---
    const fileMatch = line.match(/^--- (.+) ---$/);
    if (fileMatch) {
      result.file = fileMatch[1];
      continue;
    }

    // Function signature: [export] name(params)[→ReturnType][→calls]|description
    const funcMatch = line.match(/^(export\s+)?(\w+)\(([^)]*)\)((?:→[^→|]+)*)(?:\|(.*))?$/);
    if (funcMatch) {
      const [, exp, name, params, arrowParts, desc] = funcMatch;

      // Parse arrow parts: →ReturnType→call1,call2 or just →call1,call2
      let returns = '';
      if (arrowParts) {
        const parts = arrowParts.split('→').filter(Boolean);
        // First part is return type if it doesn't contain commas (calls always have commas or known names)
        // Heuristic: if first part looks like a type (capitalized or has <>), treat as return type
        if (parts.length > 0 && /^[A-Z]|^Promise|^Array|^Object|^string|^number|^boolean|^void|^null/.test(parts[0])) {
          returns = parts[0];
        }
      }

      // Skip {DESCRIBE} markers
      const description = (desc && desc !== '{DESCRIBE}') ? desc.trim() : '';
      result.functions.push({
        name,
        params: params || '',
        exported: !!exp,
        description,
        returns,
      });
      continue;
    }

    // Class signature
    const classMatch = line.match(/^class\s+(\w+)/);
    if (classMatch) {
      // Classes tracked but not JSDoc-injected here (complex)
      continue;
    }
  }

  return result;
}

/**
 * Build a JSDoc block from ctx signature data
 * @param {{ name: string, params: string, exported: boolean, description: string }} funcInfo
 * @returns {string} JSDoc block
 */
function buildJSDocBlock(funcInfo) {
  const lines = ['/**'];

  // Description
  if (funcInfo.description) {
    lines.push(` * ${funcInfo.description}`);
  } else {
    lines.push(` * ${funcInfo.name}`);
  }

  // Parameters
  if (funcInfo.params) {
    const params = funcInfo.params.split(',').map(p => p.trim()).filter(Boolean);
    for (const param of params) {
      // Handle typed params: name:Type
      const typedMatch = param.match(/^(\.\.\.)?(\w+)(?::(\w+(?:<[^>]+>)?))?(=)?$/);
      if (typedMatch) {
        const [, rest, name, type, optional] = typedMatch;
        const paramType = type || '*';
        const prefix = rest || '';
        if (optional) {
          lines.push(` * @param {${paramType}} [${prefix}${name}]`);
        } else {
          lines.push(` * @param {${paramType}} ${prefix}${name}`);
        }
      }
    }
  }

  // Return type
  if (funcInfo.returns) {
    lines.push(` * @returns {${funcInfo.returns}}`);
  }
  lines.push(' */');
  return lines.join('\n');
}

/**
 * Find .ctx file for a given source file
 * @param {string} sourceFile - Relative path like 'src/workspace.js'
 * @param {string} projectRoot
 * @returns {string|null} Path to .ctx file or null
 */
function findCtxFile(sourceFile, projectRoot) {
  const base = sourceFile.replace(/\.[^.]+$/, '.ctx');

  // Check .context/ directory first
  const contextPath = join(projectRoot, '.context', base);
  if (existsSync(contextPath)) return contextPath;

  // Check colocated
  const colocated = join(projectRoot, base);
  if (existsSync(colocated)) return colocated;

  return null;
}

/**
 * Inject JSDoc blocks from .ctx files into source code
 * @param {string} dir - Directory to process
 * @param {Object} [options]
 * @param {boolean} [options.dryRun=false] - Preview without writing
 * @returns {{ files: number, injected: number, skipped: number, details: Array }}
 */
export function injectJSDoc(dir, options = {}) {
  const { dryRun = false } = options;
  const projectRoot = dir;
  const files = walkJSFiles(dir);
  let totalInjected = 0;
  let totalSkipped = 0;
  const details = [];

  for (const filePath of files) {
    const relPath = relative(projectRoot, filePath);
    const ctxPath = findCtxFile(relPath, projectRoot);

    if (!ctxPath) {
      totalSkipped++;
      continue;
    }

    const ctxContent = readFileSync(ctxPath, 'utf-8');
    const ctxData = parseCtxFile(ctxContent);

    if (ctxData.functions.length === 0) {
      totalSkipped++;
      continue;
    }

    let source = readFileSync(filePath, 'utf-8');
    let modified = false;
    let injectedCount = 0;

    // Parse AST to find function locations
    let ast;
    try {
      ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module', locations: true });
    } catch {
      totalSkipped++;
      continue;
    }

    // Collect insertion points (reverse order to preserve line numbers)
    const insertions = [];

    // Find the real start position (including export keyword if present)
    function findExportStart(funcNode) {
      // Check if this function is inside an ExportNamedDeclaration
      for (const bodyNode of ast.body) {
        if (bodyNode.type === 'ExportNamedDeclaration' && bodyNode.declaration === funcNode) {
          return bodyNode.start;
        }
      }
      return funcNode.start;
    }

    walk(ast, {
      FunctionDeclaration(node) {
        if (!node.id) return;
        const funcName = node.id.name;
        const ctxFunc = ctxData.functions.find(f => f.name === funcName);
        if (!ctxFunc) return;

        const realStart = findExportStart(node);

        // Check if JSDoc already exists — scan backwards, skipping blank lines
        const textBefore = source.slice(0, realStart).trimEnd();
        if (textBefore.endsWith('*/')) return; // Already has JSDoc

        const jsdoc = buildJSDocBlock(ctxFunc);
        insertions.push({ position: realStart, jsdoc });
        injectedCount++;
      },
    });

    // Apply insertions in reverse order
    insertions.sort((a, b) => b.position - a.position);
    for (const { position, jsdoc } of insertions) {
      // Find the line start for proper indentation
      const before = source.slice(0, position);
      const lineStart = before.lastIndexOf('\n') + 1;
      const indent = source.slice(lineStart, position).match(/^(\s*)/)?.[1] || '';

      const indentedJSDoc = jsdoc.split('\n').map(l => indent + l).join('\n') + '\n';
      source = source.slice(0, position) + indentedJSDoc + source.slice(position);
      modified = true;
    }

    if (modified && !dryRun) {
      writeFileSync(filePath, source, 'utf-8');
    }

    if (injectedCount > 0) {
      totalInjected += injectedCount;
      details.push({ file: relPath, injected: injectedCount });
    }
  }

  return {
    files: files.length,
    injected: totalInjected,
    skipped: totalSkipped,
    dryRun,
    details,
  };
}

/**
 * Strip all JSDoc blocks from source files
 * @param {string} dir - Directory to process
 * @param {Object} [options]
 * @param {boolean} [options.dryRun=false]
 * @returns {{ files: number, stripped: number, savedBytes: number }}
 */
export function stripJSDoc(dir, options = {}) {
  const { dryRun = false } = options;
  const files = walkJSFiles(dir);
  let totalStripped = 0;
  let savedBytes = 0;
  const details = [];

  for (const filePath of files) {
    const source = readFileSync(filePath, 'utf-8');
    // Use AST to find JSDoc comment ranges, avoiding false matches inside strings
    const comments = [];
    let parsedOk = false;
    try {
      parse(source, {
        ecmaVersion: 'latest',
        sourceType: 'module',
        onComment: comments,
      });
      parsedOk = true;
    } catch {
      // Fallback to regex for unparseable files
    }

    let stripped;
    if (parsedOk) {
      // Remove JSDoc comments found by parser (safe — ignores strings)
      const jsdocRanges = comments
        .filter(c => c.type === 'Block' && c.value.startsWith('*'))
        .sort((a, b) => b.start - a.start); // reverse order

      stripped = source;
      for (const { start, end } of jsdocRanges) {
        // Also remove trailing newline
        let trimEnd = end;
        while (trimEnd < stripped.length && (stripped[trimEnd] === '\n' || stripped[trimEnd] === '\r')) trimEnd++;
        stripped = stripped.slice(0, start) + stripped.slice(trimEnd);
      }
    } else {
      // Regex fallback (less safe but works for broken files)
      stripped = source.replace(/\/\*\*[\s\S]*?\*\/\s*\n?/g, '');
    }
    // Clean up excessive blank lines
    const cleaned = stripped.replace(/\n{3,}/g, '\n\n');

    const bytesSaved = source.length - cleaned.length;
    if (bytesSaved > 0) {
      totalStripped++;
      savedBytes += bytesSaved;
      details.push({ file: relative(dir, filePath), saved: bytesSaved });
      if (!dryRun) {
        writeFileSync(filePath, cleaned, 'utf-8');
      }
    }
  }

  return {
    files: files.length,
    stripped: totalStripped,
    savedBytes,
    dryRun,
    details,
  };
}

/**
 * Walk directory for JS files
 * @param {string} dir
 * @returns {string[]}
 */
function walkJSFiles(dir) {
  const results = [];
  try {
    for (const entry of readdirSync(dir)) {
      if (entry.startsWith('.') && entry !== '.') continue;
      const full = join(dir, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        if (!SKIP_DIRS.has(entry)) {
          results.push(...walkJSFiles(full));
        }
      } else if (SUPPORTED.has(extname(entry).toLowerCase())) {
        results.push(full);
      }
    }
  } catch { /* skip unreadable */ }
  return results;
}
