/**
 * Doc Dialect — Compact documentation format for AI agents
 *
 * Generates ultra-compact, LLM-readable documentation from project graph.
 * Replaces verbose JSDoc with token-efficient .context/ files.
 *
 * Two generation modes:
 *   agent     — returns rich AST-extracted template for calling agent to enrich (free, default)
 *   Enrichment is done via agent-pool delegation with doc-enricher skill.
 *
 * Three doc levels:
 *   PROJECT  — architecture, data flow, key decisions
 *   FILE     — exports, internal mapping, patterns
 *   FUNCTION — signature→return|description, behavior, edge cases
 */

import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync, statSync } from 'fs';
import { join, basename, extname, dirname, relative } from 'path';
import { execSync } from 'child_process';
import { createHash } from 'crypto';
import { writeCache, computeContentHash } from './analysis-cache.js';
import { analyzeComplexityFile } from './complexity.js';
import { checkUndocumentedFile } from './undocumented.js';
import { checkJSDocFile } from './jsdoc-checker.js';

// ────────────────────────────────────────────────────────
// SECTION 1: Auto-generated doc-dialect from graph
// ────────────────────────────────────────────────────────

/**
 * Generate doc-dialect string from project graph
 * @param {import('./graph-builder.js').Graph} graph - Project graph from buildGraph()
 * @param {string} [projectPath] - Project root path (to detect .context/)
 * @returns {string} Compact doc-dialect string
 */
export function generateDocDialect(graph, projectPath) {
  const lines = [];
  const projectName = projectPath ? basename(projectPath) : 'unknown';

  // === PROJECT level ===
  lines.push(`=== PROJECT: ${projectName} ===`);

  const { stats } = graph;
  const parts = [];
  if (stats.files > 0) parts.push(`${stats.files} files`);
  if (stats.classes > 0) parts.push(`${stats.classes} classes`);
  if (stats.functions > 0) parts.push(`${stats.functions} functions`);
  if (stats.tables > 0) parts.push(`${stats.tables} tables`);
  lines.push(`STATS: ${parts.join('|')}`);

  // Edge summary
  const callEdges = graph.edges.filter(e => e[1] === '→').length;
  const dbReads = graph.edges.filter(e => e[1] === 'R→').length;
  const dbWrites = graph.edges.filter(e => e[1] === 'W→').length;
  const edgeParts = [];
  if (callEdges > 0) edgeParts.push(`${callEdges} calls`);
  if (dbReads > 0) edgeParts.push(`${dbReads} db_reads`);
  if (dbWrites > 0) edgeParts.push(`${dbWrites} db_writes`);
  if (edgeParts.length > 0) lines.push(`EDGES: ${edgeParts.join('|')}`);

  if (graph.orphans.length > 0) {
    lines.push(`ORPHANS: ${graph.orphans.join(',')}`);
  }
  if (Object.keys(graph.duplicates).length > 0) {
    lines.push(`DUPLICATES: ${Object.keys(graph.duplicates).join(',')}`);
  }

  // === FILE level ===
  const fileNodes = {};
  for (const [shortName, node] of Object.entries(graph.nodes)) {
    const file = node.f || '?';
    if (!fileNodes[file]) fileNodes[file] = [];
    fileNodes[file].push({ shortName, ...node });
  }

  for (const [file, nodes] of Object.entries(fileNodes)) {
    if (file === '?') continue;
    lines.push('');
    lines.push(`--- ${file} ---`);

    for (const node of nodes) {
      const fullName = graph.reverseLegend[node.shortName] || node.shortName;

      if (node.t === 'C') {
        const ext = node.x ? ` extends ${node.x}` : '';
        const methodCount = node.m?.length || 0;
        const propCount = node.$?.length || 0;
        const classDesc = [];
        if (methodCount > 0) classDesc.push(`${methodCount}m`);
        if (propCount > 0) classDesc.push(`${propCount}$`);
        lines.push(`class ${fullName}${ext}|${classDesc.join(',')}`);

        if (node.m) {
          for (const mShort of node.m) {
            const mFull = graph.reverseLegend[mShort] || mShort;
            lines.push(`  .${mFull}`);
          }
        }
      } else if (node.t === 'F') {
        const exported = node.e ? 'export ' : '';
        lines.push(`${exported}${fullName}()`);
      } else if (node.t === 'T') {
        const cols = node.cols?.join(',') || '';
        lines.push(`TABLE ${fullName}|${cols}`);
      }
    }

    // Add edges for this file
    const fileEdges = graph.edges.filter(e => {
      const fromNode = graph.nodes[e[0]];
      return fromNode?.f === file;
    });
    if (fileEdges.length > 0) {
      const edgeStrs = fileEdges.map(e => {
        const fromFull = graph.reverseLegend[e[0]] || e[0];
        const toFull = graph.reverseLegend[e[2]?.split('.')[0]] || e[2];
        return `${fromFull}${e[1]}${toFull}`;
      });
      const unique = [...new Set(edgeStrs)];
      if (unique.length <= 5) {
        lines.push(`CALLS: ${unique.join('|')}`);
      } else {
        lines.push(`CALLS: ${unique.slice(0, 5).join('|')}|+${unique.length - 5} more`);
      }
    }
  }

  return lines.join('\n');
}

// ────────────────────────────────────────────────────────
// SECTION 2: Read existing .context/ files (mirror + colocated)
// ────────────────────────────────────────────────────────

/**
 * Recursively walk a directory collecting .ctx files
 * @param {string} dir - Directory to walk
 * @param {string} base - Base directory for relative paths
 * @returns {Array<{relPath: string, absPath: string}>}
 */
function walkCtxFiles(dir, base) {
  const results = [];
  if (!existsSync(dir)) return results;
  try {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      try {
        const stat = statSync(full);
        if (stat.isDirectory()) {
          results.push(...walkCtxFiles(full, base));
        } else if (entry.endsWith('.ctx') || entry.endsWith('.ctx.md')) {
          results.push({ relPath: relative(base, full), absPath: full });
        }
      } catch { /* skip unreadable */ }
    }
  } catch { /* skip unreadable dirs */ }
  return results;
}

/**
 * Resolve .ctx path for a source file.
 * Priority: colocated (src/parser.ctx) > mirror (.context/src/parser.ctx)
 * @param {string} projectPath - Project root
 * @param {string} sourceFile - Relative source file path (e.g. src/parser.js)
 * @returns {string|null} Resolved .ctx path or null
 */
function resolveCtxPath(projectPath, sourceFile) {
  const ctxName = basename(sourceFile, extname(sourceFile)) + '.ctx';
  const sourceDir = dirname(sourceFile);

  // 1. Colocated: src/parser.ctx (next to src/parser.js)
  const colocated = join(projectPath, sourceDir, ctxName);
  if (existsSync(colocated)) return colocated;

  // 2. Mirror: .context/src/parser.ctx
  const mirrored = join(projectPath, '.context', sourceDir, ctxName);
  if (existsSync(mirrored)) return mirrored;

  return null;
}

/**
 * Resolve companion .ctx.md path for a source file.
 * Priority: colocated (src/parser.ctx.md) > mirror (.context/src/parser.ctx.md)
 * @param {string} projectPath
 * @param {string} sourceFile
 * @returns {string|null}
 */
function resolveCtxMdPath(projectPath, sourceFile) {
  const ctxMdName = basename(sourceFile, extname(sourceFile)) + '.ctx.md';
  const sourceDir = dirname(sourceFile);

  const colocated = join(projectPath, sourceDir, ctxMdName);
  if (existsSync(colocated)) return colocated;

  const mirrored = join(projectPath, '.context', sourceDir, ctxMdName);
  if (existsSync(mirrored)) return mirrored;

  return null;
}

/**
 * Read existing doc-dialect files: .context/ mirror + colocated overrides
 * @param {string} projectPath - Project root path
 * @returns {{ combined: string, files: string[], hasProjectCtx: boolean }}
 */
export function readContextDocs(projectPath) {
  const contextDir = join(projectPath, '.context');
  const collected = new Map(); // relPath → content (dedup)

  // 1. Walk .context/ recursively (mirror structure)
  for (const { relPath, absPath } of walkCtxFiles(contextDir, contextDir)) {
    try {
      const content = readFileSync(absPath, 'utf-8').trim();
      if (content) collected.set(relPath, content);
    } catch { /* skip */ }
  }

  // 2. Walk project for colocated .ctx files (override mirror)
  // Only check directories that contain source files
  const projectCtxFiles = walkCtxFiles(projectPath, projectPath)
    .filter(f => !f.relPath.startsWith('.context'));
  for (const { relPath, absPath } of projectCtxFiles) {
    try {
      const content = readFileSync(absPath, 'utf-8').trim();
      if (content) collected.set(relPath, content); // overrides mirror
    } catch { /* skip */ }
  }

  // Sort: project.ctx first, then alphabetical
  const sortedKeys = [...collected.keys()].sort((a, b) => {
    if (a === 'project.ctx') return -1;
    if (b === 'project.ctx') return 1;
    if (basename(a).startsWith('_')) return -1;
    if (basename(b).startsWith('_')) return 1;
    return a.localeCompare(b);
  });

  const files = sortedKeys;
  const sections = sortedKeys.map(k => collected.get(k));
  const hasProjectCtx = collected.has('project.ctx');

  return {
    combined: sections.join('\n\n'),
    files,
    hasProjectCtx,
  };
}

/**
 * Get project documentation: merge auto-generated + manual .context/ files
 * Priority for specific file: colocated > mirror > auto-generated
 * @param {import('./graph-builder.js').Graph} graph
 * @param {string} projectPath
 * @param {Object} [options]
 * @param {string} [options.file] - Specific file to get docs for
 * @returns {string}
 */
export function getProjectDocs(graph, projectPath, options = {}) {
  const { file } = options;

  // Read manual docs (mirror + colocated)
  const manual = readContextDocs(projectPath);

  // If requesting specific file docs
  if (file) {
    // Try colocated → mirror → auto-generated
    const ctxPath = resolveCtxPath(projectPath, file);
    let result = '';
    if (ctxPath) {
      result = readFileSync(ctxPath, 'utf-8').trim();
    } else {
      // Fall back to auto-generated for this file
      const autoFull = generateDocDialect(graph, projectPath);
      const fileHeader = `--- ${file} ---`;
      const idx = autoFull.indexOf(fileHeader);
      if (idx === -1) {
        return `No documentation found for: ${file}`;
      }
      const nextHeader = autoFull.indexOf('\n---', idx + fileHeader.length);
      result = nextHeader === -1
        ? autoFull.slice(idx).trim()
        : autoFull.slice(idx, nextHeader).trim();
    }

    // Append companion .ctx.md if exists
    const ctxMdPath = resolveCtxMdPath(projectPath, file);
    if (ctxMdPath) {
      const notes = readFileSync(ctxMdPath, 'utf-8').trim();
      if (notes && !notes.match(/^#[^\n]*\n+## Notes\n+## TODO\n+## Decisions\s*$/)) {
        result += '\n\n' + notes;
      }
    }
    return result;
  }

  // Full docs: manual first, then auto-generated
  if (manual.combined) {
    const auto = generateDocDialect(graph, projectPath);
    return `${manual.combined}\n\n${auto}`;
  }

  return generateDocDialect(graph, projectPath);
}

// ────────────────────────────────────────────────────────
// SECTION 3: Generate .context/ files
// ────────────────────────────────────────────────────────

// ────────────────────────────────────────────────────────
// SECTION 3.1: AST Signature for Staleness Detection
// ────────────────────────────────────────────────────────

/**
 * Compute structural signature hash from parsed AST.
 * Only includes interface-level elements (names, exports, params, methods).
 * Ignores function bodies, comments, formatting.
 * @param {string} file - Relative file path
 * @param {Object} parsed - ParseResult from parseProject()
 * @returns {string} 8-char hex hash
 */
function computeSignature(file, parsed) {
  const parts = [];
  for (const fn of (parsed.functions || []).filter(f => f.file === file)) {
    parts.push(`F:${fn.exported ? 'e' : ''}:${fn.name}(${fn.params?.join(',') || ''})`);
  }
  for (const cls of (parsed.classes || []).filter(c => c.file === file)) {
    const methods = cls.methods?.sort().join(',') || '';
    parts.push(`C:${cls.name}:${cls.extends || ''}:${methods}`);
  }
  parts.sort();
  return createHash('md5').update(parts.join('|')).digest('hex').slice(0, 8);
}

/**
 * Parse existing .ctx file and extract user-written descriptions.
 * Returns a map: key (e.g. "parseProject", "PATTERNS") → description text.
 * Used for merge strategy: preserve existing descriptions when regenerating.
 * @param {string} content - .ctx file content
 * @returns {Map<string, string>} key → description
 */
function parseCtxDescriptions(content) {
  const descriptions = new Map();
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    // Skip headers, empty lines, meta, enrich instructions
    if (!trimmed || trimmed.startsWith('---') || trimmed.startsWith('@sig') ||
        trimmed.startsWith('@enrich') || trimmed.startsWith('Rules:') ||
        trimmed.startsWith('Save this') ||
        trimmed.startsWith('CALLS→') || trimmed.startsWith('R→') || trimmed.startsWith('W→')) {
      continue;
    }
    // PATTERNS: description or EDGE_CASES: description
    const metaMatch = trimmed.match(/^(PATTERNS|EDGE_CASES):\s*(.+)/);
    if (metaMatch && metaMatch[2] !== '{DESCRIBE}') {
      descriptions.set(metaMatch[1], metaMatch[2]);
      continue;
    }
    // Function/class: name()|description or .method()|description
    const funcMatch = trimmed.match(/^(?:export\s+)?(?:class\s+)?\.?([\w]+)\([^)]*\)(?:[^|]*?)\|(.+)/);
    if (funcMatch && funcMatch[2] !== '{DESCRIBE}') {
      descriptions.set(funcMatch[1], funcMatch[2]);
      continue;
    }
    // Class with meta: class Name extends X|meta|description
    const classMatch = trimmed.match(/^class\s+([\w]+)[^|]*\|[^|]*\|(.+)/);
    if (classMatch && classMatch[2] !== '{DESCRIBE}') {
      descriptions.set(classMatch[1], classMatch[2]);
    }
  }
  return descriptions;
}

/**
 * Check staleness of .ctx files against current AST.
 * @param {string} projectPath - Project root
 * @param {Object} parsed - ParseResult from parseProject()
 * @returns {{ stale: string[], fresh: number, unknown: number }}
 */
export function checkStaleness(projectPath, parsed) {
  const contextDir = join(projectPath, '.context');
  const stale = [];
  let fresh = 0;
  let unknown = 0;

  for (const { relPath, absPath } of walkCtxFiles(contextDir, contextDir)) {
    try {
      const content = readFileSync(absPath, 'utf-8');
      const sigMatch = content.match(/@sig\s+(\w+)/);
      const fileMatch = content.match(/^--- (.+) ---/m);

      if (!sigMatch || !fileMatch) {
        unknown++;
        continue;
      }

      const currentSig = computeSignature(fileMatch[1], parsed);
      if (currentSig !== sigMatch[1]) {
        stale.push(fileMatch[1]);
      } else {
        fresh++;
      }
    } catch { /* skip unreadable */ }
  }

  // Also check colocated .ctx files
  for (const { absPath } of walkCtxFiles(projectPath, projectPath)
    .filter(f => !f.relPath.startsWith('.context'))) {
    try {
      const content = readFileSync(absPath, 'utf-8');
      const sigMatch = content.match(/@sig\s+(\w+)/);
      const fileMatch = content.match(/^--- (.+) ---/m);

      if (!sigMatch || !fileMatch) {
        unknown++;
        continue;
      }

      const currentSig = computeSignature(fileMatch[1], parsed);
      if (currentSig !== sigMatch[1]) {
        stale.push(fileMatch[1]);
      } else {
        fresh++;
      }
    } catch { /* skip */ }
  }

  return { stale, fresh, unknown };
}

/**
 * Build rich AST-extracted template for a single file.
 * Uses ParseResult data for signatures, calls, db access.
 * @param {string} file - Relative file path
 * @param {Array} nodes - Graph nodes for this file
 * @param {import('./graph-builder.js').Graph} graph
 * @param {Object} parsed - ParseResult from parseProject()
 * @param {Map<string, string>} [existingDescriptions] - Merge: preserved descriptions
 * @returns {string} Rich template in doc-dialect format
 */
function buildFileTemplate(file, nodes, graph, parsed, existingDescriptions) {
  const sig = computeSignature(file, parsed);
  const lines = [`--- ${file} ---`, `@sig ${sig}`];
  const desc = existingDescriptions || new Map();

  // Build lookup: funcName → ParseResult func data
  const funcLookup = {};
  for (const func of parsed.functions || []) {
    if (func.file === file) {
      funcLookup[func.name] = func;
    }
  }
  const classLookup = {};
  for (const cls of parsed.classes || []) {
    if (cls.file === file) {
      classLookup[cls.name] = cls;
    }
  }

  for (const node of nodes) {
    const fullName = graph.reverseLegend[node.shortName] || node.shortName;

    if (node.t === 'C') {
      const cls = classLookup[fullName] || {};
      const ext = node.x ? ` extends ${node.x}` : '';
      const methodCount = node.m?.length || 0;
      const propCount = node.$?.length || 0;
      const meta = [];
      if (methodCount > 0) meta.push(`${methodCount}m`);
      if (propCount > 0) meta.push(`${propCount}$`);
      const classDesc = desc.get(fullName) || '{DESCRIBE}';
      lines.push(`class ${fullName}${ext}|${meta.join(',')}|${classDesc}`);

      if (node.m) {
        for (const mShort of node.m) {
          const mFull = graph.reverseLegend[mShort] || mShort;
          const methodDesc = desc.get(mFull) || '{DESCRIBE}';
          lines.push(`  .${mFull}()|${methodDesc}`);
        }
      }
      // Class-level calls
      if (cls.calls?.length > 0) {
        lines.push(`  CALLS→${cls.calls.slice(0, 8).join(',')}`);
      }
      if (cls.dbReads?.length > 0) lines.push(`  R→${cls.dbReads.join(',')}`);
      if (cls.dbWrites?.length > 0) lines.push(`  W→${cls.dbWrites.join(',')}`);

    } else if (node.t === 'F') {
      const func = funcLookup[fullName] || {};
      const exported = node.e ? 'export ' : '';
      const paramStr = func.params?.length > 0 ? func.params.join(',') : '';
      const returnType = func.returns ? `→${func.returns}` : '';
      const calls = func.calls?.slice(0, 6) || [];
      const callStr = calls.length > 0 ? `→${calls.join(',')}` : '';
      const funcDesc = desc.get(fullName) || '{DESCRIBE}';
      lines.push(`${exported}${fullName}(${paramStr})${returnType}${callStr}|${funcDesc}`);

      if (func.dbReads?.length > 0) lines.push(`  R→${func.dbReads.join(',')}`);
      if (func.dbWrites?.length > 0) lines.push(`  W→${func.dbWrites.join(',')}`);
    }
  }

  const patternsDesc = desc.get('PATTERNS') || '{DESCRIBE}';
  const edgeCasesDesc = desc.get('EDGE_CASES') || '{DESCRIBE}';
  lines.push(`PATTERNS: ${patternsDesc}`);
  lines.push(`EDGE_CASES: ${edgeCasesDesc}`);

  const body = lines.join('\n');

  // Self-enriching: embed instructions only when {DESCRIBE} markers remain
  if (body.includes('{DESCRIBE}')) {
    lines.splice(2, 0,
      `@enrich: Replace each {DESCRIBE} below. Read ${file} for context.`,
      `  Rules: max 80ch, pipe|separated, abbrev (fn/ret/cfg/init/auth/db/msg).`,
      `  Save this file after filling all markers. Remove @enrich lines when done.`
    );
  }

  return lines.join('\n');
}

/**
 * Generate .context/ files from project graph + ParseResult.
 * Creates templates with {DESCRIBE} markers for agents to fill.
 * Use agent-pool with doc-enricher skill to auto-fill descriptions.
 *
 * @param {import('./graph-builder.js').Graph} graph
 * @param {string} projectPath
 * @param {Object} parsed - ParseResult from parseProject()
 * @param {Object} [options]
 * @param {boolean} [options.overwrite=false]
 * @param {string|string[]} [options.scope='all'] - 'all', 'focus' (git diff), or array of file paths
 * @returns {Promise<{ created: string[], skipped: string[], templates?: Object }>}
 */
export async function generateContextFiles(graph, projectPath, parsed, options = {}) {
  const { overwrite = false, scope = 'all' } = options;
  const contextDir = join(projectPath, '.context');
  const created = [];
  const skipped = [];
  const templates = {};

  // Ensure .context/ exists
  if (!existsSync(contextDir)) {
    mkdirSync(contextDir, { recursive: true });
  }

  // Generate project.ctx
  const projectCtxPath = join(contextDir, 'project.ctx');
  if (!existsSync(projectCtxPath) || overwrite) {
    const projectName = basename(projectPath);
    const { stats } = graph;
    const statParts = [];
    if (stats.files > 0) statParts.push(`${stats.files} files`);
    if (stats.classes > 0) statParts.push(`${stats.classes} classes`);
    if (stats.functions > 0) statParts.push(`${stats.functions} functions`);

    let projectContent = [
      `=== PROJECT: ${projectName} ===`,
      `ARCH: {DESCRIBE}`,
      `FLOW: {DESCRIBE}`,
      `STATS: ${statParts.join('|')}`,
    ].join('\n') + '\n';


    writeFileSync(projectCtxPath, projectContent, 'utf-8');
    created.push('project.ctx');
    templates['project.ctx'] = projectContent;
  } else {
    skipped.push('project.ctx');
  }

  // Group graph nodes by file
  const fileNodes = {};
  for (const [shortName, node] of Object.entries(graph.nodes)) {
    const file = node.f;
    if (!file) continue;
    if (!fileNodes[file]) fileNodes[file] = [];
    fileNodes[file].push({ shortName, ...node });
  }

  // Resolve scope filter
  let scopeFilter = null;
  if (scope === 'focus') {
    // Git diff: recently changed files
    try {
      const diff = execSync('git diff --name-only HEAD~5', {
        cwd: projectPath,
        encoding: 'utf-8',
      });
      scopeFilter = new Set(
        diff.split('\n')
          .filter(f => f.endsWith('.js') || f.endsWith('.mjs') || f.endsWith('.ts'))
          .map(f => f.trim())
          .filter(Boolean)
      );
    } catch {
      // Git not available — fall back to all
      scopeFilter = null;
    }
  } else if (Array.isArray(scope)) {
    scopeFilter = new Set(scope);
  }
  // scope === 'all' → scopeFilter stays null → process everything

  // Generate per-file .ctx in mirror structure (.context/src/parser.ctx)
  const BATCH_SIZE = 5;
  const fileEntries = Object.entries(fileNodes).filter(([file]) => {
    // Apply scope filter
    return !scopeFilter || scopeFilter.has(file);
  });

  // Process files in batches of BATCH_SIZE for concurrency
  for (let i = 0; i < fileEntries.length; i += BATCH_SIZE) {
    const batch = fileEntries.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map(([file, nodes]) =>
        processFileCtx(file, nodes, graph, parsed, contextDir, projectPath, overwrite)
      )
    );

    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        const { action, path, template } = result.value;
        if (action === 'created') {
          created.push(path);
          templates[path] = template;
        } else {
          skipped.push(path);
        }
      }
    }
  }

  const result = { created, skipped };

  // Include templates so agent can enrich via delegation
  if (created.length > 0) {
    result.templates = templates;
  }

  return result;
}

/**
 * Process a single file: generate .ctx, warm cache, create .ctx.md stub
 * @param {string} file - Relative file path
 * @param {Array} nodes - Graph nodes for this file
 * @param {Object} graph - Project graph
 * @param {Object} parsed - Parsed project data
 * @param {string} contextDir - .context/ directory path
 * @param {string} projectPath - Project root
 * @param {boolean} overwrite - Whether to overwrite existing
 * @returns {Promise<{action: string, path: string, template?: string}>}
 */
async function processFileCtx(file, nodes, graph, parsed, contextDir, projectPath, overwrite) {
  const ctxName = basename(file, extname(file)) + '.ctx';
  const fileDir = dirname(file);
  const ctxDir = join(contextDir, fileDir);
  const ctxPath = join(ctxDir, ctxName);
  const ctxRelPath = join(fileDir, ctxName);

  // Check colocated override — skip if exists and not overwriting
  const colocatedPath = join(projectPath, fileDir, ctxName);
  if ((existsSync(ctxPath) || existsSync(colocatedPath)) && !overwrite) {
    return { action: 'skipped', path: ctxRelPath };
  }

  // Ensure mirror subdirectory exists
  if (!existsSync(ctxDir)) {
    mkdirSync(ctxDir, { recursive: true });
  }

  // Merge strategy: preserve existing descriptions
  let existingDescriptions;
  const existingCtxPath = existsSync(colocatedPath) ? colocatedPath : (existsSync(ctxPath) ? ctxPath : null);
  if (existingCtxPath && overwrite) {
    try {
      const oldContent = readFileSync(existingCtxPath, 'utf-8');
      existingDescriptions = parseCtxDescriptions(oldContent);
    } catch { /* ignore */ }
  }

  let content = buildFileTemplate(file, nodes, graph, parsed, existingDescriptions);

  writeFileSync(ctxPath, content + '\n', 'utf-8');

  // Cache warm-up: pre-compute per-file analysis during AST pass
  try {
    const srcPath = join(projectPath, file);
    if (existsSync(srcPath) && file.endsWith('.js')) {
      const srcCode = readFileSync(srcPath, 'utf-8');
      const contentHash = computeContentHash(srcCode);
      const complexity = analyzeComplexityFile(srcCode, file);
      const undocumented = checkUndocumentedFile(srcCode, file, 'tests');
      const jsdocIssues = checkJSDocFile(srcCode, file);

      writeCache(contextDir, file, {
        sig: contentHash,
        contentHash,
        complexity,
        undocumented,
        jsdocIssues,
      });
    }
  } catch { /* warm-up failure is non-fatal */ }

  // Two-tier: create companion .ctx.md for agent notes (never overwrite)
  const ctxMdName = basename(file, extname(file)) + '.ctx.md';
  const ctxMdPath = join(ctxDir, ctxMdName);
  if (!existsSync(ctxMdPath)) {
    const mdStub = `# ${basename(file)}\n\n## Notes\n\n## TODO\n\n## Decisions\n`;
    writeFileSync(ctxMdPath, mdStub, 'utf-8');
  }

  return { action: 'created', path: ctxRelPath, template: content };
}
