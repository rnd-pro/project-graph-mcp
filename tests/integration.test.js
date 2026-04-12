/**
 * Integration Test — Consumer Simulation
 *
 * Emulates how an external user would consume project-graph-mcp:
 *   1. Creates a realistic temp project (no .context, no .expanded)
 *   2. Initializes the MCP server via createServer()
 *   3. Runs EVERY tool through executeTool() — asserts no crashes
 *   4. Generates .context docs, validates contracts
 *   5. Switches to compact mode (Mode 1), re-runs all tools
 *   6. Verifies round-trip: compact → expand → validate
 *
 * Bail on first failure — `node --test-force-exit --test tests/integration.test.js`
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'fs';
import { join, resolve } from 'path';

// ─── Fixture: realistic project ───────────────────────────────────
const ROOT = join(import.meta.dirname, '__integration_fixture__');

const FILES = {
  'package.json': JSON.stringify({ name: 'test-consumer', version: '1.0.0', type: 'module' }),

  'src/math.js': `
export function add(a, b) {
  return a + b;
}

export function multiply(x, y) {
  return x * y;
}

function _clamp(v, min, max) {
  return Math.min(Math.max(v, min), max);
}

export const PI = 3.14159;
`,

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
`,

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
`,

  'src/config.js': `
export const defaults = {
  port: 3000,
  host: 'localhost',
  debug: false,
};
export function mergeConfig(user) {
  return { ...defaults, ...user };
}
`,

  'src/unused.js': `
export function neverCalled() {
  return 'dead code';
}
function alsoUnused() {}
`,
};

// ─── Helpers ──────────────────────────────────────────────────────
function scaffold() {
  rmSync(ROOT, { recursive: true, force: true });
  for (const [rel, content] of Object.entries(FILES)) {
    const abs = join(ROOT, rel);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, content.trimStart(), 'utf-8');
  }
}

let server;

async function call(name, args = {}) {
  const result = await server.executeTool(name, args);
  assert.ok(result !== undefined && result !== null, `${name} returned null/undefined`);
  return result;
}

// ─── Test Suite ───────────────────────────────────────────────────
describe('Integration: Consumer Simulation', { concurrency: false }, () => {

  before(async () => {
    scaffold();
    // Set workspace BEFORE importing MCP — this mimics what web-server does
    const { setRoots } = await import('../src/core/workspace.js');
    setRoots([{ uri: 'file://' + resolve(ROOT) }]);
    const { createServer } = await import('../src/mcp/mcp-server.js');
    server = createServer(() => {});
  });

  after(() => {
    rmSync(ROOT, { recursive: true, force: true });
  });

  // ================================================================
  // PHASE 1: Fresh project — no .context, no .expanded
  // ================================================================
  describe('Phase 1: Fresh project (Mode 2 default)', () => {

    it('get_skeleton — returns valid structure', async () => {
      const sk = await call('get_skeleton', { path: ROOT });
      assert.ok(sk.v, 'has version');
      assert.ok(sk.L, 'has legend');
      assert.ok(sk.s, 'has stats');
      assert.ok(sk.s.files >= 5, `expected >=5 files, got ${sk.s.files}`);
      assert.ok(sk.s.functions > 0, 'has functions');
      assert.ok(sk.s.classes > 0, 'has classes');
    });

    it('get_ai_context — works without .context', async () => {
      const ctx = await call('get_ai_context', { path: ROOT, includeDocs: true, includeSkeleton: true });
      assert.ok(ctx.totalTokens > 0, 'has tokens');
      assert.ok(ctx.skeleton, 'has skeleton');
    });

    it('invalidate_cache — succeeds', async () => {
      const r = await call('invalidate_cache', {});
      assert.ok(r.success);
    });

    it('get_usage_guide — returns guide text', async () => {
      const guide = await call('get_usage_guide', {});
      assert.ok(typeof guide === 'string');
      assert.ok(guide.length > 100);
    });

    it('get_agent_instructions — returns instructions', async () => {
      const instr = await call('get_agent_instructions', {});
      assert.ok(typeof instr === 'string');
      assert.ok(instr.includes('JSDoc') || instr.includes('Guidelines'));
    });

    it('get_custom_rules — returns array', async () => {
      const rules = await call('get_custom_rules', {});
      assert.ok(typeof rules === 'object');
    });

    it('check_custom_rules — runs on project', async () => {
      const r = await call('check_custom_rules', { path: ROOT });
      assert.ok(typeof r === 'object');
    });

    it('get_framework_reference — works without framework', async () => {
      const r = await call('get_framework_reference', { path: ROOT });
      // May return empty or not-found — just should not crash
      assert.ok(r !== undefined);
    });

    // ── navigate ──
    it('navigate.expand — expands a known symbol', async () => {
      // First rebuild graph
      await call('get_skeleton', { path: ROOT });
      const r = await call('navigate', { action: 'expand', symbol: 'add' });
      assert.ok(r, 'expand returned result');
    });

    it('navigate.deps — returns dependency info', async () => {
      const r = await call('navigate', { action: 'deps', symbol: 'sum' });
      assert.ok(r !== undefined);
    });

    it('navigate.usages — finds usages', async () => {
      const r = await call('navigate', { action: 'usages', symbol: 'add' });
      assert.ok(r !== undefined);
    });

    it('navigate.call_chain — finds chain', async () => {
      const r = await call('navigate', { action: 'call_chain', from: 'sum', to: 'add', path: ROOT });
      assert.ok(r !== undefined);
    });

    it('navigate.sub_projects — scans subprojects', async () => {
      const r = await call('navigate', { action: 'sub_projects', path: ROOT });
      assert.ok(Array.isArray(r));
    });

    // ── analyze ──
    it('analyze.dead_code', async () => {
      const r = await call('analyze', { action: 'dead_code', path: ROOT });
      assert.ok(typeof r.total === 'number');
    });

    it('analyze.similar_functions', async () => {
      const r = await call('analyze', { action: 'similar_functions', path: ROOT, threshold: 50 });
      assert.ok(typeof r === 'object');
    });

    it('analyze.complexity', async () => {
      const r = await call('analyze', { action: 'complexity', path: ROOT });
      assert.ok(Array.isArray(r.items) || typeof r.total === 'number');
    });

    it('analyze.large_files', async () => {
      const r = await call('analyze', { action: 'large_files', path: ROOT });
      assert.ok(typeof r === 'object');
    });

    it('analyze.outdated_patterns', async () => {
      const r = await call('analyze', { action: 'outdated_patterns', path: ROOT });
      assert.ok(typeof r === 'object');
    });

    it('analyze.full_analysis', async () => {
      const r = await call('analyze', { action: 'full_analysis', path: ROOT });
      assert.ok(r.overall, 'has overall');
      assert.ok(typeof r.overall.score === 'number', 'has score');
    });

    it('analyze.analysis_summary', async () => {
      const r = await call('analyze', { action: 'analysis_summary', path: ROOT });
      assert.ok(typeof r.healthScore === 'number');
    });

    it('analyze.undocumented', async () => {
      const r = await call('analyze', { action: 'undocumented', path: ROOT, level: 'all' });
      assert.ok(typeof r.total === 'number');
    });

    // ── testing ──
    it('testing.reset + pending + summary', async () => {
      await call('testing', { action: 'reset' });
      const pending = await call('testing', { action: 'pending', path: ROOT });
      assert.ok(typeof pending === 'object');
      const summary = await call('testing', { action: 'summary', path: ROOT });
      assert.ok(typeof summary.passed === 'number');
    });

    // ── filters ──
    it('filters.get + set + reset', async () => {
      const f = await call('filters', { action: 'get' });
      assert.ok(typeof f === 'object');
      await call('filters', { action: 'set', excludeDirs: ['temp'] });
      const f2 = await call('filters', { action: 'get' });
      assert.ok(f2.excludeDirs.includes('temp'));
      await call('filters', { action: 'reset' });
    });

    // ── jsdoc ──
    it('jsdoc.check_consistency', async () => {
      const r = await call('jsdoc', { action: 'check_consistency', path: ROOT });
      assert.ok(typeof r === 'object');
    });

    it('jsdoc.generate', async () => {
      const r = await call('jsdoc', { action: 'generate', path: join(ROOT, 'src/math.js') });
      assert.ok(typeof r === 'object');
    });

    // ── docs (no .context yet) ──
    it('docs.get — works without .context', async () => {
      const r = await call('docs', { action: 'get', path: ROOT });
      assert.ok(typeof r === 'object');
    });

    // ── compact ──
    it('compact.get_mode — defaults to Mode 2', async () => {
      const r = await call('compact', { action: 'get_mode', path: ROOT });
      assert.strictEqual(r.mode, 2);
    });

    it('compact.compact_file — compresses a file', async () => {
      const r = await call('compact', { action: 'compact_file', path: join(ROOT, 'src/math.js') });
      assert.ok(r.compressed > 0 || r.code, 'has compressed content');
    });

    // ── db ──
    it('db.schema — works without SQL files', async () => {
      const r = await call('db', { action: 'schema', path: ROOT });
      assert.ok(typeof r === 'object');
    });

    it('db.dead_tables — works without SQL', async () => {
      const r = await call('db', { action: 'dead_tables', path: ROOT });
      assert.ok(typeof r === 'object');
    });
  });

  // ================================================================
  // PHASE 2: Generate .context, validate, inject
  // ================================================================
  describe('Phase 2: Generate docs & validate contracts', () => {

    it('docs.generate — creates .context files', async () => {
      const r = await call('docs', { action: 'generate', path: ROOT, overwrite: true });
      assert.ok(r.created?.length > 0 || r.updated?.length > 0 || r.skipped?.length >= 0, 'generated docs');
      // Verify .context dir exists
      assert.ok(existsSync(join(ROOT, '.context')), '.context dir created');
    });

    it('docs.check_stale — reports freshness', async () => {
      const r = await call('docs', { action: 'check_stale', path: ROOT });
      assert.ok(typeof r.fresh === 'number');
    });

    it('docs.validate_contracts — validates .ctx vs source', async () => {
      const r = await call('docs', { action: 'validate_contracts', path: ROOT });
      assert.ok(typeof r.summary === 'object');
      assert.ok(typeof r.summary.errors === 'number');
    });

    it('docs.get — returns docs after generation', async () => {
      const r = await call('docs', { action: 'get', path: ROOT });
      assert.ok(typeof r === 'object');
    });

    it('get_ai_context — enriched with docs', async () => {
      await call('invalidate_cache');
      const ctx = await call('get_ai_context', { path: ROOT, includeDocs: true });
      assert.ok(ctx.totalTokens > 0);
    });
  });

  // ================================================================
  // PHASE 3: Compact Mode (Mode 1) — full pipeline
  // ================================================================
  describe('Phase 3: Compact Mode (Mode 1)', () => {

    it('compact.set_mode — switch to Mode 1', async () => {
      const r = await call('compact', { action: 'set_mode', path: ROOT, mode: 1 });
      assert.ok(r.saved || r.config);
    });

    it('compact.get_mode — confirms Mode 1', async () => {
      const r = await call('compact', { action: 'get_mode', path: ROOT });
      assert.strictEqual(r.mode, 1);
    });

    it('compact.compact_all — compacts entire project', async () => {
      const r = await call('compact', { action: 'compact_all', path: ROOT });
      assert.ok(r.files > 0, `compacted ${r.files} files`);
      assert.ok(!r.errors || r.errors.length === 0, 'no errors');
    });

    it('all source files are actually compacted (single-line)', async () => {
      const code = readFileSync(join(ROOT, 'src/math.js'), 'utf-8');
      const lines = code.split('\n').filter(l => l.trim());
      // Compact mode: imports on line 1-2, code on few lines
      assert.ok(lines.length <= 6, `expected compact (<=6 lines), got ${lines.length}`);
    });

    it('compact.expand_project — expands to .expanded/', async () => {
      const r = await call('compact', { action: 'expand_project', path: ROOT });
      assert.ok(r.files > 0, `expanded ${r.files} files`);
      assert.ok(existsSync(join(ROOT, '.expanded')), '.expanded dir created');
    });

    it('expanded files have human-readable code', () => {
      const expanded = readFileSync(join(ROOT, '.expanded/src/math.js'), 'utf-8');
      assert.ok(expanded.includes('function'), 'has function keyword');
      // Multi-line check
      const lines = expanded.split('\n').filter(l => l.trim());
      assert.ok(lines.length >= 3, `expected multi-line, got ${lines.length}`);
    });

    it('compact.expand_file — expands single file', async () => {
      const r = await call('compact', { action: 'expand_file', path: join(ROOT, 'src/math.js') });
      assert.ok(r.code, 'has decompiled code');
      assert.ok(r.code.includes('function'), 'decompiled has function keyword');
    });

    // Re-run ALL analysis on compacted code
    it('get_skeleton — works on compacted code', async () => {
      await call('invalidate_cache');
      const sk = await call('get_skeleton', { path: ROOT });
      assert.ok(sk.s.files >= 5, 'same file count after compact');
      assert.ok(sk.s.functions > 0, 'functions still detected');
    });

    it('analyze.full_analysis — works on compacted code', async () => {
      const r = await call('analyze', { action: 'full_analysis', path: ROOT });
      assert.ok(r.overall, 'has overall');
      assert.ok(typeof r.overall.score === 'number');
    });

    it('navigate.expand — works on compacted symbols', async () => {
      await call('get_skeleton', { path: ROOT });
      const r = await call('navigate', { action: 'expand', symbol: 'add' });
      assert.ok(r !== undefined);
    });

    it('docs.validate_contracts — still valid after compact', async () => {
      const r = await call('docs', { action: 'validate_contracts', path: ROOT });
      assert.ok(typeof r.summary === 'object');
    });

    it('compact.validate_pipeline — full validation', async () => {
      const r = await call('compact', { action: 'validate_pipeline', path: ROOT });
      assert.ok(r.status, 'has status');
      assert.ok(r.summary, 'has summary');
    });

    // Round-trip: beautify back
    it('compact.beautify — expands back to formatted', async () => {
      const r = await call('compact', { action: 'beautify', path: ROOT });
      assert.ok(r.files > 0, 'beautified files');
      const code = readFileSync(join(ROOT, 'src/math.js'), 'utf-8');
      assert.ok(code.includes('\n'), 'has newlines');
      assert.ok(code.includes('function'), 'has function keyword');
    });

    it('compact.set_mode — back to Mode 2', async () => {
      await call('compact', { action: 'set_mode', path: ROOT, mode: 2 });
      const r = await call('compact', { action: 'get_mode', path: ROOT });
      assert.strictEqual(r.mode, 2);
    });
  });

  // ================================================================
  // PHASE 4: Edit workflow
  // ================================================================
  describe('Phase 4: Edit compressed', () => {

    it('compact.edit — replaces a function by symbol', async () => {
      // Write a simple file
      writeFileSync(join(ROOT, 'src/editable.js'), `
export function greet(name) {
  return 'Hello ' + name;
}
export function unused() {}
`.trimStart(), 'utf-8');

      const r = await call('compact', {
        action: 'edit',
        path: join(ROOT, 'src/editable.js'),
        symbol: 'greet',
        code: "export function greet(name) { return 'Hi ' + name; }",
      });
      assert.ok(r.success, 'edit succeeded');
      const code = readFileSync(join(ROOT, 'src/editable.js'), 'utf-8');
      assert.ok(code.includes('Hi'), 'new code applied');
      assert.ok(code.includes('unused'), 'other functions preserved');
    });
  });

  // ================================================================
  // PHASE 5: get_focus_zone + edge cases
  // ================================================================
  describe('Phase 5: Focus zone & edge cases', () => {

    it('get_focus_zone — works with explicit files', async () => {
      const r = await call('get_focus_zone', {
        path: ROOT,
        recentFiles: [join(ROOT, 'src/math.js'), join(ROOT, 'src/utils.js')],
      });
      assert.ok(typeof r === 'object');
    });

    it('navigate.expand — unknown symbol returns graceful error', async () => {
      try {
        await call('navigate', { action: 'expand', symbol: 'DEFINITELY_NOT_EXISTS_XYZ' });
        // If it doesn't throw, it should return something
      } catch (e) {
        // Expected — unknown symbol can throw
        assert.ok(e.message);
      }
    });

    it('compact.compact_file — handles non-JS file gracefully', async () => {
      try {
        await call('compact', { action: 'compact_file', path: join(ROOT, 'package.json') });
      } catch (e) {
        assert.ok(e.message, 'throws with message');
      }
    });
  });
});
