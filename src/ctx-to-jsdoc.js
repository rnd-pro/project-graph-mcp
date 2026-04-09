import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, extname, relative } from 'path';
import { parse } from '../vendor/acorn.mjs';
import { simple as walk } from '../vendor/walk.mjs';

const SUPPORTED = new Set(['.js', '.mjs']);
const SKIP_DIRS = new Set(['node_modules', '.git', 'vendor', '.context', 'dev-docs', '.agent', '.agents']);

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

function splitTopLevelParams(paramStr) {
  const params = [];
  let depth = 0;
  let current = '';

  for (const ch of paramStr) {
    if (ch === '{' || ch === '<' || ch === '(') depth++;
    else if (ch === '}' || ch === '>' || ch === ')') depth--;

    if (ch === ',' && depth === 0) {
      const trimmed = current.trim();
      if (trimmed) params.push(trimmed);
      current = '';
    } else {
      current += ch;
    }
  }

  const trimmed = current.trim();
  if (trimmed) params.push(trimmed);
  return params;
}

// ============================
// CTX Contract Validator
// ============================

export function validateCtxContracts(dir, options = {}) {
  const strict = options.strict || false;
  const jsFiles = walkJSFiles(dir);
  const violations = [];
  let filesChecked = 0;

  for (const jsFile of jsFiles) {
    const relPath = relative(dir, jsFile);
    const ctxPath = findCtxFile(relPath, dir);
    if (!ctxPath) continue; // No .ctx — skip

    filesChecked++;

    const ctxContent = readFileSync(ctxPath, 'utf-8');
    const ctxData = parseCtxFile(ctxContent);

    // Parse source AST to get actual signatures
    let source;
    try {
      source = readFileSync(jsFile, 'utf-8');
    } catch { continue; }

    let ast;
    try {
      ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module', locations: true });
    } catch { continue; }

    // Extract actual function info from AST
    const astFunctions = new Map();
    walk(ast, {
      FunctionDeclaration(node) {
        if (!node.id) return;
        astFunctions.set(node.id.name, {
          paramCount: node.params.length,
          params: node.params.map(p => {
            if (p.type === 'Identifier') return p.name;
            if (p.type === 'AssignmentPattern' && p.left?.name) return p.left.name;
            if (p.type === 'RestElement' && p.argument?.name) return p.argument.name;
            if (p.type === 'ObjectPattern') return 'options';
            return '?';
          }),
          async: node.async || false,
          line: node.loc.start.line,
        });
      },
    });

    // Check exported status from AST
    const exportedNames = new Set();
    walk(ast, {
      ExportNamedDeclaration(node) {
        if (node.declaration?.id) exportedNames.add(node.declaration.id.name);
        if (node.specifiers) {
          for (const s of node.specifiers) exportedNames.add(s.exported.name);
        }
      },
    });

    // Validate each .ctx function against AST
    for (const ctxFunc of ctxData.functions) {
      const astFunc = astFunctions.get(ctxFunc.name);

      if (!astFunc) {
        violations.push({
          file: relPath,
          severity: 'error',
          message: `Function "${ctxFunc.name}" in .ctx not found in source`,
        });
        continue;
      }

      // Param count check — balanced split (handles {a: string, b: number} as one param)
      const ctxParams = ctxFunc.params ? splitTopLevelParams(ctxFunc.params) : [];
      if (ctxParams.length !== astFunc.paramCount) {
        violations.push({
          file: relPath,
          severity: 'error',
          message: `"${ctxFunc.name}": .ctx has ${ctxParams.length} params, AST has ${astFunc.paramCount}`,
        });
      }

      // Param name check (strip types for comparison)
      for (let i = 0; i < Math.min(ctxParams.length, astFunc.params.length); i++) {
        const ctxName = ctxParams[i].replace(/^\.\.\./, '').replace(/:.*/, '').replace(/=$/, '');
        const astName = astFunc.params[i];
        if (ctxName !== astName && ctxName !== '?' && astName !== '?') {
          violations.push({
            file: relPath,
            severity: 'warning',
            message: `"${ctxFunc.name}" param ${i}: .ctx="${ctxName}", AST="${astName}"`,
          });
        }
      }

      // Export status check
      const astExported = exportedNames.has(ctxFunc.name);
      if (ctxFunc.exported !== astExported) {
        violations.push({
          file: relPath,
          severity: 'warning',
          message: `"${ctxFunc.name}": .ctx says ${ctxFunc.exported ? 'exported' : 'private'}, AST says ${astExported ? 'exported' : 'private'}`,
        });
      }

      // Remove from astFunctions to track unmatched
      astFunctions.delete(ctxFunc.name);
    }

    // Strict mode: report functions in AST but not in .ctx
    if (strict && astFunctions.size > 0) {
      for (const [name] of astFunctions) {
        violations.push({
          file: relPath,
          severity: 'info',
          message: `Function "${name}" in source (line ${astFunctions.get(name)?.line}) not documented in .ctx`,
        });
      }
    }
  }

  const errors = violations.filter(v => v.severity === 'error').length;
  const warnings = violations.filter(v => v.severity === 'warning').length;

  return {
    files: filesChecked,
    violations,
    summary: { errors, warnings },
  };
}
