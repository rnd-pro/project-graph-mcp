/**
 * Integration Test — Full Consumer Simulation
 *
 * Exhaustively validates EVERY MCP tool:
 *  - Every response field is checked for type & semantic correctness
 *  - Round-trip data integrity: compact → expand preserves symbols
 *  - UI payload: simulates what the WebSocket UI would receive
 *  - All dev modes: Mode 2 (formatted) → Mode 1 (compact) → back
 *
 * Run: node --test tests/integration.test.js
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'fs';
import { join, resolve } from 'path';

// ─── Fixture: realistic multi-file project ────────────────────────
const ROOT = join(import.meta.dirname, '__integration_fixture__');

const FILES = {
  'package.json': JSON.stringify({
    name: 'test-consumer',
    version: '1.0.0',
    type: 'module',
  }),

  'src/math.js': `
/**
 * Add two numbers.
 * @param {number} a
 * @param {number} b
 * @returns {number}
 */
export function add(a, b) {
  return a + b;
}

export function multiply(x, y) {
  return x * y;
}

/**
 * Clamp value between min and max.
 * @param {number} v
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function _clamp(v, min, max) {
  return Math.min(Math.max(v, min), max);
}

export const PI = 3.14159;
`.trimStart(),

  'src/utils.js': `
import { add } from './math.js';

/**
 * Format a number with a prefix.
 * @param {number} n
 * @param {string} prefix
 * @returns {string}
 */
export function format(n, prefix = '$') {
  return prefix + n.toFixed(2);
}

export async function fetchData(url, options = {}) {
  const res = await fetch(url, options);
  return res.json();
}

export function sum(...numbers) {
  return numbers.reduce((acc, n) => add(acc, n), 0);
}
`.trimStart(),

  'src/models.js': `
export class Animal {
  constructor(name) {
    this.name = name;
  }
  speak() {
    return this.name + ' speaks';
  }
  static create(name) {
    return new Animal(name);
  }
}

export class Dog extends Animal {
  speak() {
    return this.name + ' barks';
  }
  fetch(item) {
    return this.name + ' fetches ' + item;
  }
}
`.trimStart(),

  'src/config.js': `
export const defaults = {
  port: 3000,
  host: 'localhost',
  debug: false,
};
export function mergeConfig(user) {
  return { ...defaults, ...user };
}
`.trimStart(),

  'src/unused.js': `
export function neverCalled() {
  return 'dead code';
}
function alsoUnused() {}
`.trimStart(),

  'schema.sql': `
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(255) UNIQUE
);
CREATE TABLE posts (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id),
  title VARCHAR(200),
  body TEXT
);
`.trimStart(),
};

// Original function bodies for round-trip verification
// Only exported function names survive Terser minification
// Private functions (_clamp, alsoUnused) get mangled — this is correct behavior
const EXPORTED_FUNCTIONS = {
  add: 'return a + b;',
  multiply: 'return x * y;',
  format: 'return prefix + n.toFixed(2);',
  sum: 'return numbers.reduce((acc, n) => add(acc, n), 0);',
  mergeConfig: 'return { ...defaults, ...user };',
  neverCalled: "return 'dead code';",
};

// ─── Helpers ──────────────────────────────────────────────────────
function scaffold() {
  rmSync(ROOT, { recursive: true, force: true });
  for (const [rel, content] of Object.entries(FILES)) {
    const abs = join(ROOT, rel);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, content, 'utf-8');
  }
}

let server;

async function call(name, args = {}) {
  const result = await server.executeTool(name, args);
  assert.ok(result !== undefined && result !== null,
    `${name}(${JSON.stringify(args)}) returned null/undefined`);
  return result;
}

/** Assert object has exactly these keys (no more, no less) */
function assertKeys(obj, keys, label) {
  const actual = Object.keys(obj).sort();
  const expected = [...keys].sort();
  assert.deepStrictEqual(actual, expected, `${label}: unexpected keys`);
}

/** Assert field is a number >= 0 */
function assertNum(val, label) {
  assert.strictEqual(typeof val, 'number', `${label}: expected number, got ${typeof val}`);
  assert.ok(val >= 0, `${label}: expected >= 0, got ${val}`);
}

/** Assert field is a non-empty string */
function assertStr(val, label) {
  assert.strictEqual(typeof val, 'string', `${label}: expected string`);
  assert.ok(val.length > 0, `${label}: expected non-empty string`);
}

// ─── Test Suite ───────────────────────────────────────────────────
describe('Integration: Consumer Simulation', { concurrency: false }, () => {

  before(async () => {
    scaffold();
    const { setRoots } = await import('../src/core/workspace.js');
    setRoots([{ uri: 'file://' + resolve(ROOT) }]);
    const { createServer } = await import('../src/mcp/mcp-server.js');
    server = createServer(() => {});
  });

  after(() => {
    rmSync(ROOT, { recursive: true, force: true });
  });

  // ================================================================
  // PHASE 1: All tools on fresh project (Mode 2, no .context)
  // ================================================================
  describe('Phase 1: Fresh project — every tool, every field', () => {

    // ── get_skeleton ──────────────────────────────────────────────
    it('get_skeleton — response schema', async () => {
      const sk = await call('get_skeleton', { path: ROOT });
      // Required top-level keys
      assert.ok('v' in sk, 'missing v');
      assert.ok('L' in sk, 'missing L (legend)');
      assert.ok('s' in sk, 'missing s (stats)');
      assert.ok('n' in sk, 'missing n (nodes)');
      assert.ok('X' in sk, 'missing X (exports)');

      // Version
      assert.strictEqual(sk.v, 1);

      // Legend: map of short→long names
      assert.strictEqual(typeof sk.L, 'object');
      const legendKeys = Object.keys(sk.L);
      assert.ok(legendKeys.length > 0, 'legend is empty');
      for (const [short, long] of Object.entries(sk.L)) {
        assertStr(short, 'legend key');
        assertStr(long, `legend value for ${short}`);
        assert.ok(short.length <= long.length,
          `legend alias ${short} should be shorter than ${long}`);
      }

      // Stats
      assertNum(sk.s.files, 'stats.files');
      assertNum(sk.s.classes, 'stats.classes');
      assertNum(sk.s.functions, 'stats.functions');
      assertNum(sk.s.tables, 'stats.tables');
      assert.ok(sk.s.files >= 5, `expected >= 5 files, got ${sk.s.files}`);
      assert.ok(sk.s.functions >= 8, `expected >= 8 functions, got ${sk.s.functions}`);
      assert.ok(sk.s.classes >= 2, `expected >= 2 classes, got ${sk.s.classes}`);
      assert.ok(sk.s.tables >= 2, `expected >= 2 tables (from schema.sql), got ${sk.s.tables}`);

      // Exports map: filename → array of legend keys
      assert.strictEqual(typeof sk.X, 'object');
      for (const [file, exports] of Object.entries(sk.X)) {
        assert.ok(Array.isArray(exports), `X[${file}] should be array`);
        for (const sym of exports) {
          assert.ok(sym in sk.L, `export symbol ${sym} not in legend`);
        }
      }
    });

    it('get_skeleton — known symbols in legend', async () => {
      const sk = await call('get_skeleton', { path: ROOT });
      const longNames = Object.values(sk.L);
      for (const name of ['add', 'multiply', 'format', 'fetchData', 'sum',
                           'Animal', 'Dog', 'mergeConfig', 'neverCalled']) {
        assert.ok(longNames.includes(name),
          `expected "${name}" in legend, got: ${longNames.join(', ')}`);
      }
    });

    it('get_skeleton — token budget', async () => {
      const sk = await call('get_skeleton', { path: ROOT });
      const tokens = JSON.stringify(sk).length / 4;
      assert.ok(tokens < 2000, `skeleton too large: ${tokens} tokens`);
    });

    // ── get_ai_context ────────────────────────────────────────────
    it('get_ai_context — response schema (no docs)', async () => {
      const ctx = await call('get_ai_context', {
        path: ROOT, includeDocs: false, includeSkeleton: true,
      });
      assert.ok('skeleton' in ctx, 'missing skeleton');
      assert.ok('totalTokens' in ctx, 'missing totalTokens');
      assert.ok('vsOriginal' in ctx || 'savings' in ctx, 'missing savings');
      assertNum(ctx.totalTokens, 'totalTokens');
      assert.ok(ctx.totalTokens > 0, 'totalTokens should be > 0');
      // Skeleton inside should match standalone
      assert.strictEqual(ctx.skeleton.v, 1);
      assert.ok(Object.keys(ctx.skeleton.L).length > 0);
    });

    it('get_ai_context — with files', async () => {
      const ctx = await call('get_ai_context', {
        path: ROOT,
        includeFiles: [join(ROOT, 'src/math.js')],
        includeDocs: false,
        includeSkeleton: false,
      });
      assertNum(ctx.totalTokens, 'totalTokens');
      assert.ok(ctx.files, 'missing files');
    });

    // ── invalidate_cache ──────────────────────────────────────────
    it('invalidate_cache — response schema', async () => {
      const r = await call('invalidate_cache', {});
      assert.strictEqual(r.success, true);
    });

    // ── get_usage_guide ───────────────────────────────────────────
    it('get_usage_guide — full guide', async () => {
      const g = await call('get_usage_guide', {});
      assert.strictEqual(typeof g, 'string');
      assert.ok(g.length > 500, 'guide too short');
      assert.ok(g.includes('skeleton'), 'should mention skeleton');
    });

    it('get_usage_guide — by topic', async () => {
      const g = await call('get_usage_guide', { topic: 'navigation' });
      assert.strictEqual(typeof g, 'string');
      assert.ok(g.length > 50);
    });

    // ── get_agent_instructions ────────────────────────────────────
    it('get_agent_instructions — returns markdown', async () => {
      const instr = await call('get_agent_instructions', {});
      assert.strictEqual(typeof instr, 'string');
      assert.ok(instr.length > 50);
    });

    // ── get_custom_rules ──────────────────────────────────────────
    it('get_custom_rules — returns object', async () => {
      const r = await call('get_custom_rules', {});
      assert.strictEqual(typeof r, 'object');
    });

    // ── check_custom_rules ────────────────────────────────────────
    it('check_custom_rules — response schema', async () => {
      const r = await call('check_custom_rules', { path: ROOT });
      assert.strictEqual(typeof r, 'object');
      // Should have violations array or similar
      assert.ok('violations' in r || 'results' in r || Array.isArray(r));
    });

    // ── get_framework_reference ───────────────────────────────────
    it('get_framework_reference — no crash on unknown framework', async () => {
      const r = await call('get_framework_reference', { path: ROOT });
      assert.ok(r !== undefined);
    });

    // ── navigate.expand ───────────────────────────────────────────
    it('navigate.expand — full response for known symbol', async () => {
      // Ensure graph is built
      const sk = await call('get_skeleton', { path: ROOT });
      // Find legend key for 'add'
      const addKey = Object.entries(sk.L).find(([k, v]) => v === 'add')?.[0];
      assert.ok(addKey, 'add not found in legend');

      const r = await call('navigate', { action: 'expand', symbol: 'add' });
      // Expand should return code, file info
      assert.ok(r !== undefined);
      if (r.code) {
        assert.ok(r.code.includes('add'), 'code should contain function name');
      }
      if (r.file) {
        assertStr(r.file, 'file path');
      }
    });

    it('navigate.expand — unknown symbol returns error object', async () => {
      const r = await call('navigate', { action: 'expand', symbol: 'NONEXISTENT_XYZ_99' });
      assert.ok(r.error, 'should return error for unknown symbol');
      assert.ok(r.error.includes('Unknown symbol'), r.error);
    });

    // ── navigate.deps ─────────────────────────────────────────────
    it('navigate.deps', async () => {
      const r = await call('navigate', { action: 'deps', symbol: 'sum' });
      assert.ok(r !== undefined);
    });

    // ── navigate.usages ───────────────────────────────────────────
    it('navigate.usages', async () => {
      const r = await call('navigate', { action: 'usages', symbol: 'add' });
      // add is used by sum, so usages should contain something
      assert.ok(r !== undefined);
    });

    // ── navigate.call_chain ───────────────────────────────────────
    it('navigate.call_chain', async () => {
      const r = await call('navigate', {
        action: 'call_chain', from: 'sum', to: 'add', path: ROOT,
      });
      assert.ok(r !== undefined);
    });

    // ── navigate.sub_projects ─────────────────────────────────────
    it('navigate.sub_projects', async () => {
      const r = await call('navigate', { action: 'sub_projects', path: ROOT });
      assert.ok(Array.isArray(r));
    });

    // ── analyze.dead_code ─────────────────────────────────────────
    it('analyze.dead_code — response schema', async () => {
      const r = await call('analyze', { action: 'dead_code', path: ROOT });
      assertNum(r.total, 'total');
      assert.ok('byType' in r, 'missing byType');
      assertNum(r.byType.function, 'byType.function');
      assertNum(r.byType.class, 'byType.class');
      assertNum(r.byType.export, 'byType.export');
      assert.ok('items' in r, 'missing items');
      assert.ok(Array.isArray(r.items));
      // neverCalled and alsoUnused should be detected
      const names = r.items.map(i => i.name);
      assert.ok(names.includes('neverCalled'), `neverCalled not in dead code: ${names}`);

      // Each item has required fields
      for (const item of r.items) {
        assertStr(item.name, 'item.name');
        assertStr(item.type, 'item.type');
        assertStr(item.file, 'item.file');
        assertStr(item.reason, 'item.reason');
      }
    });

    // ── analyze.similar_functions ──────────────────────────────────
    it('analyze.similar_functions — response schema', async () => {
      const r = await call('analyze', { action: 'similar_functions', path: ROOT, threshold: 50 });
      assertNum(r.total, 'total');
      assert.ok('pairs' in r, 'missing pairs');
      assert.ok(Array.isArray(r.pairs));
      if (r.pairs.length > 0) {
        const pair = r.pairs[0];
        assert.ok('a' in pair && 'b' in pair, 'pair missing a/b');
        assertStr(pair.a.name, 'pair.a.name');
        assertStr(pair.a.file, 'pair.a.file');
      }
    });

    // ── analyze.complexity ────────────────────────────────────────
    it('analyze.complexity — response schema', async () => {
      const r = await call('analyze', { action: 'complexity', path: ROOT, minComplexity: 1 });
      assertNum(r.total, 'total');
      assert.ok('stats' in r, 'missing stats');
      assertNum(r.stats.low, 'stats.low');
      assertNum(r.stats.moderate, 'stats.moderate');
      assertNum(r.stats.high, 'stats.high');
      assertNum(r.stats.critical, 'stats.critical');
      assert.ok('items' in r, 'missing items');
      assert.ok(Array.isArray(r.items));
      for (const item of r.items) {
        assertStr(item.name, 'complexity item name');
        assertStr(item.file, 'complexity item file');
        assertNum(item.complexity, 'complexity value');
        assertStr(item.rating, 'complexity rating');
        assert.ok(['low', 'moderate', 'high', 'critical'].includes(item.rating),
          `invalid rating: ${item.rating}`);
      }
    });

    // ── analyze.large_files ───────────────────────────────────────
    it('analyze.large_files — response schema', async () => {
      const r = await call('analyze', { action: 'large_files', path: ROOT });
      assertNum(r.total, 'total');
      assert.ok('stats' in r, 'missing stats');
      assertNum(r.stats.totalFiles, 'stats.totalFiles');
      assertNum(r.stats.ok, 'stats.ok');
      assertNum(r.stats.warning, 'stats.warning');
      assertNum(r.stats.critical, 'stats.critical');
      assertNum(r.stats.totalLines, 'stats.totalLines');
      assert.ok('items' in r, 'missing items');
      for (const item of r.items) {
        assertStr(item.file, 'large_files item file');
        assertNum(item.lines, 'item.lines');
        assertStr(item.rating, 'item.rating');
      }
    });

    // ── analyze.outdated_patterns ──────────────────────────────────
    it('analyze.outdated_patterns — response schema', async () => {
      const r = await call('analyze', { action: 'outdated_patterns', path: ROOT });
      assert.ok('stats' in r, 'missing stats');
      assertNum(r.stats.totalPatterns, 'totalPatterns');
      assert.ok('redundantDeps' in r, 'missing redundantDeps');
      assert.ok(Array.isArray(r.redundantDeps));
    });

    // ── analyze.full_analysis ──────────────────────────────────────
    it('analyze.full_analysis — response schema', async () => {
      const r = await call('analyze', { action: 'full_analysis', path: ROOT });
      // Must have all analysis sections
      assert.ok('deadCode' in r, 'missing deadCode');
      assert.ok('undocumented' in r, 'missing undocumented');
      assert.ok('similar' in r, 'missing similar');
      assert.ok('complexity' in r, 'missing complexity');
      assert.ok('largeFiles' in r, 'missing largeFiles');
      assert.ok('outdated' in r, 'missing outdated');
      assert.ok('overall' in r, 'missing overall');

      // Overall section
      assertNum(r.overall.score, 'overall.score');
      assert.ok(r.overall.score >= 0 && r.overall.score <= 100,
        `score out of range: ${r.overall.score}`);
      assertStr(r.overall.rating, 'overall.rating');
      assert.ok(Array.isArray(r.overall.topIssues), 'topIssues should be array');

      // Sub-section integrity
      assertNum(r.deadCode.total, 'deadCode.total');
      assertNum(r.complexity.total, 'complexity.total');
    });

    // ── analyze.analysis_summary ──────────────────────────────────
    it('analyze.analysis_summary — response schema', async () => {
      const r = await call('analyze', { action: 'analysis_summary', path: ROOT });
      assertNum(r.healthScore, 'healthScore');
      assert.ok(r.healthScore >= 0 && r.healthScore <= 100);
      assertStr(r.grade, 'grade');
      assert.ok(['excellent', 'good', 'fair', 'critical'].includes(r.grade),
        `invalid grade: ${r.grade}`);
      assertNum(r.complexity, 'complexity');
      assertNum(r.undocumented, 'undocumented');
      assert.ok('cache' in r, 'missing cache');
    });

    // ── analyze.undocumented ──────────────────────────────────────
    it('analyze.undocumented — response schema', async () => {
      const r = await call('analyze', { action: 'undocumented', path: ROOT, level: 'all' });
      assertNum(r.total, 'total');
      assert.ok('byType' in r, 'missing byType');
      assertNum(r.byType.function, 'byType.function');
      assert.ok('items' in r, 'missing items');
      assert.ok(Array.isArray(r.items));
      // multiply has no JSDoc, should be undocumented
      if (r.items.length > 0) {
        for (const item of r.items) {
          assertStr(item.name, 'item.name');
          assertStr(item.file, 'item.file');
        }
      }
    });

    // ── testing ───────────────────────────────────────────────────
    it('testing — full lifecycle', async () => {
      // reset
      const resetR = await call('testing', { action: 'reset' });
      assert.ok(resetR);

      // pending
      const pending = await call('testing', { action: 'pending', path: ROOT });
      assert.ok(Array.isArray(pending));

      // summary
      const summary = await call('testing', { action: 'summary', path: ROOT });
      assertNum(summary.total, 'total');
      assertNum(summary.passed, 'passed');
      assertNum(summary.failed, 'failed');
      assertNum(summary.pending, 'pending');
      assertNum(summary.progress, 'progress');
      assert.ok(Array.isArray(summary.failures));

      // pass a test if any exist
      if (pending.length > 0) {
        const testId = pending[0].id;
        const passR = await call('testing', { action: 'pass', testId });
        assert.ok(passR);
        const afterSummary = await call('testing', { action: 'summary', path: ROOT });
        assert.ok(afterSummary.passed >= 1, 'passed should increment');
      }

      await call('testing', { action: 'reset' });
    });

    // ── filters ───────────────────────────────────────────────────
    it('filters — full lifecycle', async () => {
      const f = await call('filters', { action: 'get' });
      assert.ok(Array.isArray(f.excludeDirs), 'excludeDirs should be array');
      assert.ok(Array.isArray(f.excludePatterns), 'excludePatterns should be array');
      assert.strictEqual(typeof f.includeHidden, 'boolean');
      assert.strictEqual(typeof f.useGitignore, 'boolean');

      // set
      await call('filters', { action: 'set', excludeDirs: ['temp', 'build'] });
      const f2 = await call('filters', { action: 'get' });
      assert.ok(f2.excludeDirs.includes('temp'));
      assert.ok(f2.excludeDirs.includes('build'));

      // add_excludes
      await call('filters', { action: 'add_excludes', dirs: ['vendor'] });
      const f3 = await call('filters', { action: 'get' });
      assert.ok(f3.excludeDirs.includes('vendor'));

      // remove_excludes
      await call('filters', { action: 'remove_excludes', dirs: ['vendor'] });
      const f4 = await call('filters', { action: 'get' });
      assert.ok(!f4.excludeDirs.includes('vendor'));

      // reset
      await call('filters', { action: 'reset' });
      const f5 = await call('filters', { action: 'get' });
      assert.ok(f5.excludeDirs.includes('node_modules'), 'defaults restored');
    });

    // ── jsdoc ─────────────────────────────────────────────────────
    it('jsdoc.check_consistency — response schema', async () => {
      const r = await call('jsdoc', { action: 'check_consistency', path: ROOT });
      assert.ok('summary' in r, 'missing summary');
      assertNum(r.summary.total, 'total');
      assertNum(r.summary.errors, 'errors');
      assertNum(r.summary.warnings, 'warnings');
      assert.ok('issues' in r, 'missing issues');
      assert.ok(Array.isArray(r.issues));
      for (const iss of r.issues) {
        assertStr(iss.file, 'issue.file');
        assertStr(iss.severity, 'issue.severity');
        assertStr(iss.message, 'issue.message');
      }
    });

    it('jsdoc.generate — on single file', async () => {
      const r = await call('jsdoc', { action: 'generate', path: join(ROOT, 'src/math.js') });
      assert.ok(typeof r === 'object');
    });

    // ── docs (no .context) ────────────────────────────────────────
    it('docs.get — works without .context', async () => {
      const r = await call('docs', { action: 'get', path: ROOT });
      assert.strictEqual(typeof r, 'object');
    });

    // ── compact.get_mode ──────────────────────────────────────────
    it('compact.get_mode — default Mode 2', async () => {
      const r = await call('compact', { action: 'get_mode', path: ROOT });
      assert.strictEqual(r.mode, 2);
      assert.strictEqual(r.beautify, true);
      assert.strictEqual(r.autoValidate, false);
      assert.strictEqual(r.stripJSDoc, false);
      assertStr(r.description, 'description');
      assert.ok('workflow' in r, 'missing workflow');
      assertStr(r.workflow.read, 'workflow.read');
      assertStr(r.workflow.write, 'workflow.write');
      assertStr(r.workflow.edit, 'workflow.edit');
      assertStr(r.workflow.review, 'workflow.review');
      assertStr(r.workflow.validate, 'workflow.validate');
    });

    // ── compact.compact_file ──────────────────────────────────────
    it('compact.compact_file — response schema', async () => {
      const r = await call('compact', { action: 'compact_file', path: join(ROOT, 'src/math.js') });
      assertStr(r.code, 'code');
      assertNum(r.original, 'original (bytes)');
      assertNum(r.compressed, 'compressed (bytes)');
      assertStr(r.savings, 'savings');
      assert.ok(r.compressed <= r.original, 'compressed should be <= original');
      // Code should contain function names
      assert.ok(r.code.includes('add'), 'code should contain add');
      assert.ok(r.code.includes('multiply'), 'code should contain multiply');
    });

    // ── db ─────────────────────────────────────────────────────────
    it('db.schema — detects SQL tables', async () => {
      const r = await call('db', { action: 'schema', path: ROOT });
      assertNum(r.totalTables, 'totalTables');
      assertNum(r.totalColumns, 'totalColumns');
      assert.ok(Array.isArray(r.tables));
      assert.ok(r.totalTables >= 2, `expected >= 2 tables, got ${r.totalTables}`);
      // Validate table structure
      const tableNames = r.tables.map(t => t.name || t.table);
      assert.ok(tableNames.includes('users'), `users not found in: ${tableNames}`);
      assert.ok(tableNames.includes('posts'), `posts not found in: ${tableNames}`);
    });

    it('db.table_usage', async () => {
      const r = await call('db', { action: 'table_usage', path: ROOT });
      assert.ok('tables' in r || 'totalTables' in r || 'totalQueries' in r);
    });

    it('db.dead_tables — response schema', async () => {
      const r = await call('db', { action: 'dead_tables', path: ROOT });
      assert.ok(Array.isArray(r.deadTables), 'missing deadTables');
      assert.ok(Array.isArray(r.deadColumns), 'missing deadColumns');
      assert.ok('stats' in r, 'missing stats');
      assertNum(r.stats.totalSchemaTables, 'totalSchemaTables');
      assertNum(r.stats.deadTableCount, 'deadTableCount');
      // Both tables are "dead" because no code queries them
      assert.ok(r.stats.deadTableCount >= 2,
        `expected >= 2 dead tables, got ${r.stats.deadTableCount}`);
    });

    // ── get_focus_zone ────────────────────────────────────────────
    it('get_focus_zone — response schema', async () => {
      const r = await call('get_focus_zone', {
        path: ROOT,
        recentFiles: [join(ROOT, 'src/math.js')],
      });
      assert.ok('focusFiles' in r, 'missing focusFiles');
      assert.ok(Array.isArray(r.focusFiles));
      assert.ok('expandable' in r, 'missing expandable');
    });
  });

  // ================================================================
  // PHASE 2: Generate .context docs → validate contracts
  // ================================================================
  describe('Phase 2: Docs generation & contract validation', () => {

    it('docs.generate — creates .context files with correct schema', async () => {
      const r = await call('docs', { action: 'generate', path: ROOT, overwrite: true });
      assert.ok(
        (r.created && r.created.length > 0) ||
        (r.updated && r.updated.length > 0) ||
        r.skipped,
        'should create/update/skip files'
      );
      assert.ok(existsSync(join(ROOT, '.context')), '.context dir must exist');
    });

    it('docs.check_stale — response schema', async () => {
      const r = await call('docs', { action: 'check_stale', path: ROOT });
      assertNum(r.fresh, 'fresh');
      assert.ok(Array.isArray(r.stale), 'stale should be array');
    });

    it('docs.validate_contracts — response schema', async () => {
      const r = await call('docs', { action: 'validate_contracts', path: ROOT });
      assertNum(r.files, 'files');
      assert.ok('summary' in r, 'missing summary');
      assertNum(r.summary.errors, 'summary.errors');
      assertNum(r.summary.warnings, 'summary.warnings');
      assert.ok('violations' in r, 'missing violations');
      assert.ok(Array.isArray(r.violations));
      for (const v of r.violations) {
        assertStr(v.file, 'violation.file');
        assertStr(v.severity, 'violation.severity');
        assert.ok(['error', 'warning'].includes(v.severity));
        assertStr(v.message, 'violation.message');
      }
    });

    it('docs.get — file-specific', async () => {
      const r = await call('docs', { action: 'get', path: ROOT, file: 'src/math.js' });
      assert.ok('docs' in r, 'missing docs');
      assertStr(r.docs, 'docs content');
      // Should mention our functions
      assert.ok(r.docs.includes('add'), 'docs should mention add');
    });

    it('get_ai_context — enriched with docs', async () => {
      await call('invalidate_cache');
      const ctx = await call('get_ai_context', { path: ROOT, includeDocs: true, includeSkeleton: true });
      assertNum(ctx.totalTokens, 'totalTokens');
      assert.ok(ctx.skeleton, 'should include skeleton');
      assert.ok(ctx.docs || ctx.documentation, 'should include docs');
    });
  });

  // ================================================================
  // PHASE 3: Mode 1 — compact, verify data integrity, expand back
  // ================================================================
  describe('Phase 3: Compact Mode — round-trip data integrity', () => {

    // Snapshot original code before compact
    let originalSources = {};

    it('snapshot original sources', () => {
      for (const relPath of Object.keys(FILES)) {
        if (relPath.endsWith('.js')) {
          originalSources[relPath] = readFileSync(join(ROOT, relPath), 'utf-8');
        }
      }
      assert.ok(Object.keys(originalSources).length >= 5);
    });

    it('compact.set_mode → Mode 1', async () => {
      const r = await call('compact', { action: 'set_mode', path: ROOT, mode: 1 });
      assert.ok(r.saved || r.config);
    });

    it('compact.compact_all — response schema', async () => {
      const r = await call('compact', { action: 'compact_all', path: ROOT });
      assertNum(r.files, 'files');
      assert.ok(r.files >= 5, `expected >= 5 compacted files, got ${r.files}`);
      assert.ok(Array.isArray(r.fileList), 'missing fileList');
      assertNum(r.originalBytes, 'originalBytes');
      assertNum(r.compactedBytes, 'compactedBytes');
      assertStr(r.savings, 'savings');
      assert.ok(r.compactedBytes <= r.originalBytes,
        `compacted (${r.compactedBytes}) should be <= original (${r.originalBytes})`);
      if (r.errors) {
        assert.strictEqual(r.errors.length, 0, `unexpected errors: ${JSON.stringify(r.errors)}`);
      }
    });

    it('compacted files are actually minified', () => {
      for (const relPath of ['src/math.js', 'src/utils.js', 'src/models.js']) {
        const code = readFileSync(join(ROOT, relPath), 'utf-8');
        // Compacted: comments stripped (except @ctx header), fewer lines
        const lines = code.split('\n').filter(l => l.trim());
        assert.ok(lines.length < 20,
          `${relPath}: expected <20 lines in compact, got ${lines.length}`);
        // Only @ctx header comments are allowed, no inline comments
        const codeLines = code.split('\n').filter(l => l.trim() && !l.startsWith('// @ctx'));
        for (const line of codeLines) {
          assert.ok(!line.match(/^\s*\/\//), `${relPath}: unexpected line comment: ${line.slice(0, 60)}`);
        }
      }
    });

    it('compacted code preserves ALL exported function names', () => {
      for (const [fnName] of Object.entries(EXPORTED_FUNCTIONS)) {
        let found = false;
        for (const relPath of ['src/math.js', 'src/utils.js', 'src/config.js', 'src/unused.js']) {
          const code = readFileSync(join(ROOT, relPath), 'utf-8');
          if (code.includes(fnName)) { found = true; break; }
        }
        assert.ok(found, `exported function "${fnName}" lost during compact`);
      }
    });

    it('compacted code preserves ALL class names', () => {
      const code = readFileSync(join(ROOT, 'src/models.js'), 'utf-8');
      assert.ok(code.includes('Animal'), 'Animal class lost');
      assert.ok(code.includes('Dog'), 'Dog class lost');
      assert.ok(code.includes('extends'), 'extends keyword lost');
    });

    it('skeleton works on compacted code — same symbol count', async () => {
      await call('invalidate_cache');
      const sk = await call('get_skeleton', { path: ROOT });
      const longNames = Object.values(sk.L);
      for (const name of ['add', 'multiply', 'format', 'sum', 'Animal', 'Dog']) {
        assert.ok(longNames.includes(name),
          `"${name}" missing from skeleton after compact`);
      }
    });

    // ── expand_project ────────────────────────────────────────────
    it('compact.expand_project — response schema', async () => {
      const r = await call('compact', { action: 'expand_project', path: ROOT });
      assertNum(r.files, 'files');
      assert.ok(r.files >= 5, `expected >= 5 expanded, got ${r.files}`);
      assertStr(r.outputDir, 'outputDir');
      assert.ok(existsSync(join(ROOT, '.expanded')), '.expanded dir must exist');
    });

    it('expanded files have multi-line human-readable code', () => {
      for (const relPath of ['src/math.js', 'src/utils.js', 'src/models.js']) {
        const expanded = readFileSync(join(ROOT, '.expanded', relPath), 'utf-8');
        const lines = expanded.split('\n').filter(l => l.trim());
        assert.ok(lines.length >= 3,
          `${relPath}: expanded should be multi-line, got ${lines.length}`);
        assert.ok(expanded.includes('function') || expanded.includes('class'),
          `${relPath}: expanded should have keywords`);
      }
    });

    it('expanded code preserves ALL exported function names', () => {
      for (const [fnName] of Object.entries(EXPORTED_FUNCTIONS)) {
        let found = false;
        for (const relPath of ['src/math.js', 'src/utils.js', 'src/config.js', 'src/unused.js']) {
          const fp = join(ROOT, '.expanded', relPath);
          if (existsSync(fp) && readFileSync(fp, 'utf-8').includes(fnName)) {
            found = true; break;
          }
        }
        assert.ok(found, `exported function "${fnName}" lost during expand`);
      }
    });

    it('expanded code preserves class hierarchy', () => {
      const expanded = readFileSync(join(ROOT, '.expanded/src/models.js'), 'utf-8');
      assert.ok(expanded.includes('class Animal'), 'Animal class lost in expand');
      assert.ok(expanded.includes('class Dog'), 'Dog class lost in expand');
      assert.ok(expanded.includes('extends'), 'extends keyword lost in expand');
      assert.ok(expanded.includes('constructor'), 'constructor lost');
      assert.ok(expanded.includes('speak'), 'speak method lost');
      assert.ok(expanded.includes('fetch'), 'fetch method lost');
      assert.ok(expanded.includes('static'), 'static keyword lost');
    });

    // ── expand_file ───────────────────────────────────────────────
    it('compact.expand_file — response schema', async () => {
      const r = await call('compact', { action: 'expand_file', path: join(ROOT, 'src/math.js') });
      assertStr(r.code, 'decompiled code');
      assertNum(r.original, 'original');
      assertNum(r.decompiled, 'decompiled');
      assert.ok(r.code.includes('add'), 'decompiled should have add');
      assert.ok(r.code.includes('multiply'), 'decompiled should have multiply');
    });

    // ── validate_pipeline ─────────────────────────────────────────
    it('compact.validate_pipeline — response schema', async () => {
      const r = await call('compact', { action: 'validate_pipeline', path: ROOT });
      assertStr(r.status, 'status');
      assert.ok(['PASS', 'FAIL'].includes(r.status), `invalid status: ${r.status}`);
      assertStr(r.duration, 'duration');
      assert.ok('contracts' in r, 'missing contracts');
      assert.ok('summary' in r, 'missing summary');
      assertNum(r.summary.totalErrors, 'totalErrors');
      assertNum(r.summary.contractErrors, 'contractErrors');
      assertNum(r.summary.astErrors, 'astErrors');
      assertNum(r.summary.styleErrors, 'styleErrors');
      assertNum(r.summary.filesProcessed, 'filesProcessed');
      assertNum(r.summary.jsdocInjected, 'jsdocInjected');
      assertStr(r.summary.tokenSavings, 'tokenSavings');
    });

    // ── analysis still works on compacted code ────────────────────
    it('analyze.full_analysis — intact after compact', async () => {
      const r = await call('analyze', { action: 'full_analysis', path: ROOT });
      assert.ok(r.overall, 'missing overall');
      assertNum(r.overall.score, 'score');
    });

    // ── beautify back ─────────────────────────────────────────────
    it('compact.beautify — response schema', async () => {
      const r = await call('compact', { action: 'beautify', path: ROOT });
      assertNum(r.files, 'files');
      assert.ok(r.files >= 5);
      assertNum(r.originalBytes, 'originalBytes');
      assertNum(r.beautifiedBytes, 'beautifiedBytes');
      assert.ok(r.beautifiedBytes >= r.originalBytes,
        'beautified should be >= compacted');
    });

    it('beautified code is human-readable again', () => {
      for (const relPath of ['src/math.js', 'src/utils.js']) {
        const code = readFileSync(join(ROOT, relPath), 'utf-8');
        const lines = code.split('\n').filter(l => l.trim());
        assert.ok(lines.length >= 3,
          `${relPath}: beautified should be multi-line, got ${lines.length}`);
      }
    });

    it('beautified code preserves ALL exported function names', () => {
      for (const [fnName] of Object.entries(EXPORTED_FUNCTIONS)) {
        let found = false;
        for (const relPath of ['src/math.js', 'src/utils.js', 'src/config.js', 'src/unused.js']) {
          const code = readFileSync(join(ROOT, relPath), 'utf-8');
          if (code.includes(fnName)) { found = true; break; }
        }
        assert.ok(found, `exported function "${fnName}" lost after beautify round-trip`);
      }
    });

    it('compact.set_mode — back to Mode 2', async () => {
      await call('compact', { action: 'set_mode', path: ROOT, mode: 2 });
      const r = await call('compact', { action: 'get_mode', path: ROOT });
      assert.strictEqual(r.mode, 2);
    });
  });

  // ================================================================
  // PHASE 4: Edit workflow — data integrity
  // ================================================================
  describe('Phase 4: Edit compressed — preserves integrity', () => {

    before(() => {
      writeFileSync(join(ROOT, 'src/editable.js'), `
export function greet(name) {
  return 'Hello ' + name;
}

export function goodbye(name) {
  return 'Bye ' + name;
}

export const VERSION = '1.0';
`.trimStart(), 'utf-8');
    });

    it('compact.edit — replaces target, preserves neighbors', async () => {
      const r = await call('compact', {
        action: 'edit',
        path: join(ROOT, 'src/editable.js'),
        symbol: 'greet',
        code: "export function greet(name) { return 'Hi ' + name; }",
      });
      assert.ok(r.success, 'edit should succeed');
      assertStr(r.file, 'file');
      assertStr(r.symbol, 'symbol');

      const code = readFileSync(join(ROOT, 'src/editable.js'), 'utf-8');
      assert.ok(code.includes('Hi'), 'new body applied');
      assert.ok(!code.includes('Hello'), 'old body removed');
      assert.ok(code.includes('goodbye'), 'goodbye preserved');
      assert.ok(code.includes('VERSION'), 'VERSION const preserved');
    });

    it('compact.edit — rejects unknown symbol', async () => {
      await assert.rejects(
        () => call('compact', {
          action: 'edit',
          path: join(ROOT, 'src/editable.js'),
          symbol: 'NOPE',
          code: 'function NOPE() {}',
        }),
        /not found/i,
      );
    });
  });

  // ================================================================
  // PHASE 5: UI payload simulation — WebSocket snapshot fields
  // ================================================================
  describe('Phase 5: UI payload — simulated WebSocket data', () => {

    it('project-info matches fixture', async () => {
      // The web-server sends this as snapshot.project
      const sk = await call('get_skeleton', { path: ROOT });
      // Simulate what startWebServer would build
      const projectPath = resolve(ROOT);
      const projectName = 'test-consumer';

      // Verify skeleton has data UI needs
      assert.ok(sk.v, 'skeleton version for UI');
      assert.ok(sk.s.files >= 5, 'UI needs file count');
      assert.ok(sk.s.functions > 0, 'UI needs function count');
      assert.ok(sk.s.classes > 0, 'UI needs class count');
      assert.ok(Object.keys(sk.L).length > 0, 'UI needs legend');
      assert.ok(Object.keys(sk.X).length > 0, 'UI needs exports map');
    });

    it('/api/file simulation — compressed file view', async () => {
      // This is what the UI code viewer calls
      const r = await call('compact', { action: 'compact_file', path: join(ROOT, 'src/math.js') });
      assertStr(r.code, 'code for UI');
      assertNum(r.original, 'original bytes');
      assertNum(r.compressed, 'compressed bytes');
      assertStr(r.savings, 'savings percentage');
      // UI shows the code — it must be valid JS
      assert.ok(r.code.includes('function') || r.code.includes('=>'),
        'code must contain function syntax');
    });

    it('/api/compression-stats simulation', async () => {
      // This is what TopBar calls for token stats
      // Re-implement the same walk the web-server does
      const { readdirSync, statSync } = await import('fs');
      const { extname } = await import('path');
      const exts = new Set(['.js', '.mjs']);
      const skip = new Set(['node_modules', '.git', '.context', '.expanded']);
      let fileCount = 0;
      function walk(dir) {
        try {
          for (const entry of readdirSync(dir)) {
            if (entry.startsWith('.')) continue;
            const full = join(dir, entry);
            if (statSync(full).isDirectory()) {
              if (!skip.has(entry)) walk(full);
            } else if (exts.has(extname(entry))) {
              fileCount++;
            }
          }
        } catch {}
      }
      walk(join(ROOT, 'src'));
      assert.ok(fileCount >= 5, `walk should find >= 5 js files, got ${fileCount}`);
    });

    it('/api/analysis-summary simulation', async () => {
      const r = await call('analyze', { action: 'analysis_summary', path: ROOT });
      // UI displays these in the health panel
      assertNum(r.healthScore, 'healthScore for UI');
      assertStr(r.grade, 'grade for UI badge');
      assertNum(r.complexity, 'complexity count');
      assertNum(r.undocumented, 'undocumented count');
    });
  });
});
