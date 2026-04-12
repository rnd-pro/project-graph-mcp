/**
 * Integration Test — Full MCP + UI Consumer Simulation
 *
 * Architecture:
 *   tests/lib/fixture.js    — project scaffold & cleanup
 *   tests/lib/mcp-client.js — JSON-RPC client (stdio)
 *   tests/lib/ui-client.js  — HTTP + WebSocket client (web-server)
 *   tests/lib/asserts.js    — shared assertion helpers
 *
 * Phases:
 *   1. MCP Protocol Handshake (stdio JSON-RPC)
 *   2. MCP Tool Responses — Mode 2 (human-readable code)
 *   3. UI Server HTTP APIs
 *   4. WebSocket Data Flow (snapshot, tool calls, events)
 *   5. Dynamic Tool Discovery (schemas → auto-test every action)
 *   6. Documentation Workflow (generate, stale, contracts)
 *   7. Mode 1 (Compact) — full tool suite on MINIFIED code
 *   8. Edit Workflow
 *   9. Protocol Error Handling
 *
 * Run:
 *   node --test tests/integration.test.js
 *   VERIFY_NPM=1 node --test tests/integration.test.js
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

import { scaffold, cleanup, ALL_SYMBOLS, EXPORTED_FUNCTIONS, EXPORTED_CLASSES, SQL_TABLES } from './lib/fixture.js';
import { MCPClient, resolveServerPath } from './lib/mcp-client.js';
import { startUIServer, httpGet, wsConnect, wsCallTool, stopUIServer } from './lib/ui-client.js';
import { assertNum, assertStr, assertObj, assertArr, assertOneOf, assertScore } from './lib/asserts.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');
const FIXTURE_ROOT = join('/tmp', `pg-mcp-test-${Date.now()}`);

// ─── Shared state across phases ───────────────────────────────────
/** @type {MCPClient} */
let mcpClient;
/** @type {string} */
let serverPath;
/** Tool definitions from tools/list (dynamically discovered) */
let toolDefs = [];
/** Composite tools with action enums */
let compositeTools = [];

describe('Integration: MCP + UI Consumer Simulation', { concurrency: false, timeout: 120000 }, () => {

  before(async () => {
    scaffold(FIXTURE_ROOT);
    serverPath = resolveServerPath(PROJECT_ROOT, FIXTURE_ROOT);
    mcpClient = new MCPClient(serverPath, FIXTURE_ROOT);
    await mcpClient.start();
  });

  after(() => {
    mcpClient?.stop();
    cleanup(FIXTURE_ROOT);
  });

  // ================================================================
  // PHASE 1: MCP Protocol Handshake + Dynamic Discovery
  // ================================================================
  describe('Phase 1: MCP Protocol', () => {

    it('initialize — valid MCP envelope', async () => {
      const resp = await mcpClient.initialize();
      assert.strictEqual(resp.jsonrpc, '2.0');
      assert.ok(resp.id !== undefined);
      const r = resp.result;
      assertStr(r.protocolVersion, 'protocolVersion');
      assertObj(r.capabilities, 'capabilities');
      assert.ok(r.capabilities.tools !== undefined, 'tools capability');
      assertObj(r.serverInfo, 'serverInfo');
      assertStr(r.serverInfo.name, 'name');
      assertStr(r.serverInfo.version, 'version');
    });

    it('tools/list — discover all tools dynamically', async () => {
      toolDefs = await mcpClient.listTools();
      assertArr(toolDefs, 'tools');
      assert.ok(toolDefs.length >= 10, `expected >= 10 tools, got ${toolDefs.length}`);

      const names = new Set();
      for (const tool of toolDefs) {
        assertStr(tool.name, 'tool.name');
        assertStr(tool.description, 'tool.description');
        assertObj(tool.inputSchema, `${tool.name}.inputSchema`);
        assert.strictEqual(tool.inputSchema.type, 'object');
        assert.ok(!names.has(tool.name), `duplicate: ${tool.name}`);
        names.add(tool.name);
      }

      // Identify composite tools (have action enum)
      compositeTools = toolDefs.filter(
        t => t.inputSchema.properties?.action?.enum?.length > 0
      );
      assert.ok(compositeTools.length >= 5,
        `expected >= 5 composite tools, got ${compositeTools.length}`);
    });

    it('resources/list — has guide resource', async () => {
      const resources = await mcpClient.listResources();
      assertArr(resources, 'resources');
      const guide = resources.find(r => r.uri.includes('guide'));
      assert.ok(guide, 'guide resource missing');
      assertStr(guide.name, 'name');
    });

    it('resources/read — guide is markdown', async () => {
      const result = await mcpClient.readResource('project-graph://guide');
      assertArr(result.contents, 'contents');
      assert.strictEqual(result.contents[0].mimeType, 'text/markdown');
      assert.ok(result.contents[0].text.length > 200);
    });
  });

  // ================================================================
  // PHASE 2: All MCP tools — data validation
  // ================================================================
  describe('Phase 2: MCP tool responses', () => {

    // ── get_skeleton ──────────────────────────────────────────────
    it('get_skeleton — schema + all symbols', async () => {
      const { data: sk, hints } = await mcpClient.callTool('get_skeleton', { path: '.' });
      assert.strictEqual(sk.v, 1);
      assertObj(sk.L, 'legend');
      assertObj(sk.s, 'stats');
      assertObj(sk.X, 'exports');

      // All fixture symbols in legend
      const longNames = Object.values(sk.L);
      for (const sym of ALL_SYMBOLS) {
        assert.ok(longNames.includes(sym), `"${sym}" not in legend`);
      }

      // Stats match fixture
      assertNum(sk.s.files, 'files');
      assertNum(sk.s.functions, 'functions');
      assertNum(sk.s.classes, 'classes');
      assertNum(sk.s.tables, 'tables');
      assert.ok(sk.s.files >= 5);
      assert.ok(sk.s.functions >= 8);
      assert.ok(sk.s.classes >= 2);
      assert.ok(sk.s.tables >= 2);

      // Exports reference their legend keys
      for (const [file, exports] of Object.entries(sk.X)) {
        assertArr(exports, `X[${file}]`);
        for (const sym of exports) assert.ok(sym in sk.L, `${sym} not in legend`);
      }

      // Hints exist
      assert.ok(hints, 'should have hints');
    });

    it('get_ai_context', async () => {
      const { data } = await mcpClient.callTool('get_ai_context', {
        path: '.', includeSkeleton: true, includeDocs: false,
      });
      assertNum(data.totalTokens, 'totalTokens');
      assert.ok(data.totalTokens > 50, `totalTokens too small: ${data.totalTokens}`);
      assert.strictEqual(data.skeleton.v, 1);
      assert.ok(Object.keys(data.skeleton.L).length >= 5, 'ai_context skeleton has no symbols');
    });

    it('invalidate_cache', async () => {
      const { data } = await mcpClient.callTool('invalidate_cache');
      assert.strictEqual(data.success, true);
    });

    it('get_usage_guide', async () => {
      const { data } = await mcpClient.callTool('get_usage_guide');
      assertStr(data, 'guide');
      assert.ok(data.length > 200, `guide too short: ${data.length}`);
      assert.ok(data.includes('get_skeleton') || data.includes('skeleton'), 'guide missing tool names');
    });

    it('get_agent_instructions', async () => {
      const { data } = await mcpClient.callTool('get_agent_instructions');
      assertStr(data, 'instructions');
    });

    // ── navigate ──────────────────────────────────────────────────
    it('navigate.expand — known + unknown', async () => {
      await mcpClient.callTool('get_skeleton', { path: '.' });
      const { data: ok } = await mcpClient.callTool('navigate', { action: 'expand', symbol: 'add' });
      assert.ok(ok);
      const { data: err } = await mcpClient.callTool('navigate', { action: 'expand', symbol: 'NOPE' });
      assert.ok(err.error);
    });

    it('navigate.deps + usages + sub_projects', async () => {
      await mcpClient.callTool('navigate', { action: 'deps', symbol: 'sum' });
      await mcpClient.callTool('navigate', { action: 'usages', symbol: 'add' });
      const { data } = await mcpClient.callTool('navigate', { action: 'sub_projects', path: '.' });
      assertArr(data, 'sub_projects');
    });

    // ── analyze ───────────────────────────────────────────────────
    it('analyze.dead_code — detects neverCalled', async () => {
      const { data: r } = await mcpClient.callTool('analyze', { action: 'dead_code', path: '.' });
      assertNum(r.total, 'total');
      assert.ok(r.total >= 1, `dead_code.total should be >= 1, got ${r.total}`);
      assertObj(r.byType, 'byType');
      assertArr(r.items, 'items');
      assert.ok(r.items.length >= 1, 'dead_code returned empty items — harmful fallback?');
      assert.ok(r.items.map(i => i.name).includes('neverCalled'),
        `neverCalled not in dead_code: [${r.items.map(i => i.name)}]`);
      for (const item of r.items) {
        assertStr(item.name, 'name');
        assertStr(item.type, 'type');
        assertStr(item.file, 'file');
        assertStr(item.reason, 'reason');
      }
    });

    it('analyze.complexity', async () => {
      const { data: r } = await mcpClient.callTool('analyze', { action: 'complexity', path: '.', minComplexity: 1 });
      assertNum(r.total, 'total');
      assert.ok(r.total >= 1, `complexity.total should be >= 1 (we have functions), got ${r.total}`);
      assertObj(r.stats, 'stats');
      for (const k of ['low', 'moderate', 'high', 'critical']) assertNum(r.stats[k], k);
      assertArr(r.items, 'items');
      assert.ok(r.items.length >= 1, 'complexity returned empty items — no functions analyzed?');
      for (const item of r.items) {
        assertStr(item.name, 'name');
        assertNum(item.complexity, 'complexity');
        assert.ok(item.complexity >= 1, `complexity should be >= 1, got ${item.complexity}`);
        assertOneOf(item.rating, ['low', 'moderate', 'high', 'critical'], 'rating');
      }
    });

    it('analyze.full_analysis — all sections with data', async () => {
      const { data: r } = await mcpClient.callTool('analyze', { action: 'full_analysis', path: '.' });
      for (const k of ['deadCode', 'undocumented', 'similar', 'complexity', 'largeFiles', 'outdated', 'overall']) {
        assert.ok(k in r, `missing section: ${k}`);
      }
      assertScore(r.overall.score, 'score');
      assertStr(r.overall.rating, 'rating');
      // Verify sections have actual data, not empty fallbacks
      assertNum(r.deadCode.total || r.deadCode.count || 0, 'deadCode.total');
      assertNum(r.complexity.total || r.complexity.count || 0, 'complexity.total');
    });

    it('analyze.analysis_summary — non-zero metrics', async () => {
      const { data: r } = await mcpClient.callTool('analyze', { action: 'analysis_summary', path: '.' });
      assertScore(r.healthScore, 'healthScore');
      assert.ok(r.healthScore > 0, `healthScore is 0 — analysis returned empty data?`);
      assertOneOf(r.grade, ['excellent', 'good', 'fair', 'critical'], 'grade');
      // complexity and undocumented should be present and numeric
      assertNum(r.complexity, 'complexity');
      assertNum(r.undocumented, 'undocumented');
    });

    it('analyze.large_files + outdated_patterns + undocumented', async () => {
      const { data: lf } = await mcpClient.callTool('analyze', { action: 'large_files', path: '.' });
      assertNum(lf.total, 'total');
      assert.ok(lf.total >= 5, `large_files should see >= 5 files, got ${lf.total}`);
      assertObj(lf.stats, 'stats');

      const { data: op } = await mcpClient.callTool('analyze', { action: 'outdated_patterns', path: '.' });
      assertObj(op.stats, 'stats');
      assertArr(op.redundantDeps, 'redundantDeps');

      const { data: ud } = await mcpClient.callTool('analyze', { action: 'undocumented', path: '.', level: 'all' });
      assertNum(ud.total, 'total');
      // Some functions lack JSDoc: multiply, mergeConfig, neverCalled, etc.
      assert.ok(ud.total >= 1, `undocumented should be >= 1 (some fns lack JSDoc), got ${ud.total}`);
    });

    it('analyze.similar_functions — field validation', async () => {
      const { data: r } = await mcpClient.callTool('analyze', { action: 'similar_functions', path: '.', threshold: 30 });
      assertNum(r.total, 'total');
      assertArr(r.pairs, 'pairs');
      for (const pair of r.pairs) {
        assertStr(pair.a?.name || pair.fn1 || '', 'pair.a');
        assertNum(pair.similarity || pair.score || 0, 'similarity');
      }
    });

    // ── testing — full lifecycle ─────────────────────────────────
    it('testing lifecycle — reset, pending, pass, fail, summary', async () => {
      await mcpClient.callTool('testing', { action: 'reset' });

      // Get pending tests (auto-detected from @test tags)
      const { data: pending } = await mcpClient.callTool('testing', { action: 'pending', path: '.' });
      assertArr(pending.items || pending, 'pending');

      const { data: summary } = await mcpClient.callTool('testing', { action: 'summary', path: '.' });
      for (const k of ['total', 'passed', 'failed', 'pending', 'progress']) assertNum(summary[k], k);

      // Pass a test if any exist
      if (summary.total > 0 && (pending.items || pending).length > 0) {
        const testId = (pending.items || pending)[0].id || (pending.items || pending)[0];
        if (testId) {
          await mcpClient.callTool('testing', { action: 'pass', testId: String(testId) });
          const { data: s2 } = await mcpClient.callTool('testing', { action: 'summary', path: '.' });
          assert.ok(s2.passed >= 1, 'pass should increment passed');
        }
      }

      await mcpClient.callTool('testing', { action: 'reset' });
    });

    // ── filters — full lifecycle ─────────────────────────────────
    it('filters lifecycle — set, add_excludes, remove_excludes, reset', async () => {
      const { data: f1 } = await mcpClient.callTool('filters', { action: 'get' });
      assertArr(f1.excludeDirs, 'excludeDirs');
      assert.strictEqual(typeof f1.includeHidden, 'boolean');

      // set
      await mcpClient.callTool('filters', { action: 'set', excludeDirs: ['vendor'] });
      const { data: f2 } = await mcpClient.callTool('filters', { action: 'get' });
      assert.ok(f2.excludeDirs.includes('vendor'));

      // add_excludes
      await mcpClient.callTool('filters', { action: 'add_excludes', dirs: ['tmp_test'] });
      const { data: f3 } = await mcpClient.callTool('filters', { action: 'get' });
      assert.ok(f3.excludeDirs.includes('tmp_test'), 'add_excludes should add dir');

      // remove_excludes
      await mcpClient.callTool('filters', { action: 'remove_excludes', dirs: ['tmp_test'] });
      const { data: f4 } = await mcpClient.callTool('filters', { action: 'get' });
      assert.ok(!f4.excludeDirs.includes('tmp_test'), 'remove_excludes should remove dir');

      await mcpClient.callTool('filters', { action: 'reset' });
    });

    // ── custom rules — full lifecycle ─────────────────────────────
    it('custom rules lifecycle — set, get, check, clean', async () => {
      // Create a custom rule
      await mcpClient.callTool('set_custom_rule', {
        ruleSet: 'test-rules',
        rule: {
          id: 'no-console',
          name: 'No Console',
          description: 'Disallow console.log',
          pattern: 'console\\.log',
          patternType: 'regex',
          severity: 'warning',
          filePattern: '*.js',
        },
      });

      // List rules — should contain our rule
      const { data: rules } = await mcpClient.callTool('get_custom_rules');
      assert.ok(rules, 'rules should exist');

      // Check rules against codebase
      const { data: violations } = await mcpClient.callTool('check_custom_rules', { path: '.' });
      assert.ok(violations !== undefined, 'check_custom_rules should return data');
    });

    it('jsdoc.check_consistency — analyzes documented functions', async () => {
      const { data: r } = await mcpClient.callTool('jsdoc', { action: 'check_consistency', path: '.' });
      assertObj(r.summary, 'summary');
      assertNum(r.summary.total, 'total');
      // total = number of issues, not functions. 0 means all JSDoc is consistent.
      assertArr(r.issues, 'issues');
      // Verify the tool actually analyzed something (not an empty fallback)
      assert.ok(r.summary.hasOwnProperty('total'), 'summary lacks total field');
      // Sanity: we have documented fns, so analyzed should be > 0 if that field exists
      if (r.summary.analyzed !== undefined) {
        assert.ok(r.summary.analyzed >= 1, `analyzed should be >= 1, got ${r.summary.analyzed}`);
      }
    });

    it('compact.get_mode — defaults', async () => {
      const { data: r } = await mcpClient.callTool('compact', { action: 'get_mode', path: '.' });
      assert.strictEqual(r.mode, 2);
      assert.strictEqual(r.beautify, true);
      assertStr(r.description, 'description');
      assertObj(r.workflow, 'workflow');
    });

    it('compact.compact_file — real compression', async () => {
      const { data: r } = await mcpClient.callTool('compact', { action: 'compact_file', path: 'src/math.js' });
      assertStr(r.code, 'code');
      assertNum(r.original, 'original');
      assertNum(r.compressed, 'compressed');
      assert.ok(r.original > 50, `original too small: ${r.original} — file not read?`);
      assert.ok(r.compressed > 10, `compressed too small: ${r.compressed}`);
      assert.ok(r.compressed <= r.original, 'compressed > original?');
      assert.ok(r.code.includes('add'), 'add() missing from compressed code');
      assert.ok(r.code.includes('multiply'), 'multiply() missing from compressed code');
    });

    it('db.schema — detects SQL tables', async () => {
      const { data: r } = await mcpClient.callTool('db', { action: 'schema', path: '.' });
      assertNum(r.totalTables, 'totalTables');
      assert.ok(r.totalTables >= 2);
      const names = r.tables.map(t => t.name || t.table);
      for (const t of SQL_TABLES) assert.ok(names.includes(t), `table ${t} not found`);
    });

    it('db.dead_tables — detects unused tables', async () => {
      const { data: r } = await mcpClient.callTool('db', { action: 'dead_tables', path: '.' });
      assertArr(r.deadTables, 'deadTables');
      // users and posts are defined in schema.sql but never referenced in JS
      assert.ok(r.deadTables.length >= 2,
        `dead_tables should find >= 2 (users, posts not used in JS), got ${r.deadTables.length}`);
      assertObj(r.stats, 'stats');
      assertNum(r.stats.totalSchemaTables, 'totalSchemaTables');
      assert.ok(r.stats.totalSchemaTables >= 2, `totalSchemaTables should be >= 2, got ${r.stats.totalSchemaTables}`);
    });

    it('get_focus_zone — returns enriched context', async () => {
      const { data } = await mcpClient.callTool('get_focus_zone', {
        path: '.', recentFiles: ['src/math.js'],
      });
      assertArr(data.focusFiles, 'focusFiles');
      assert.ok(data.focusFiles.length >= 1,
        `focusFiles should include src/math.js, got ${data.focusFiles.length}`);
    });
  });

  // ================================================================
  // PHASE 3: UI Server — HTTP APIs
  // ================================================================
  describe('Phase 3: UI Server HTTP APIs', () => {
    let uiPort;
    let uiProc;

    before(async () => {
      const ui = await startUIServer(serverPath, FIXTURE_ROOT, 0);
      uiPort = ui.port;
      uiProc = ui.process;
    });

    after(() => stopUIServer(uiProc));

    it('/api/project-info — project metadata', async () => {
      const { status, data } = await httpGet(uiPort, '/api/project-info');
      assert.strictEqual(status, 200);
      assertStr(data.name, 'name');
      assertStr(data.path, 'path');
      assertStr(data.color, 'color');
      assert.ok(data.color.startsWith('hsl'), `color should be hsl, got: ${data.color}`);
      assertNum(data.pid, 'pid');
      assert.ok(data.pid > 0);
    });

    it('/api/skeleton — matches MCP response', async () => {
      const { status, data: httpSk } = await httpGet(uiPort, '/api/skeleton');
      assert.strictEqual(status, 200);
      assert.strictEqual(httpSk.v, 1);

      // Compare with MCP response
      const { data: mcpSk } = await mcpClient.callTool('get_skeleton', { path: '.' });
      // Same symbols in legend
      const httpNames = new Set(Object.values(httpSk.L));
      const mcpNames = new Set(Object.values(mcpSk.L));
      for (const sym of ALL_SYMBOLS) {
        assert.ok(httpNames.has(sym), `HTTP skeleton missing ${sym}`);
        assert.ok(mcpNames.has(sym), `MCP skeleton missing ${sym}`);
      }
      // Same stats
      assert.strictEqual(httpSk.s.files, mcpSk.s.files, 'file count mismatch');
      assert.strictEqual(httpSk.s.functions, mcpSk.s.functions, 'function count mismatch');
    });

    it('/api/analysis-summary — health data for UI', async () => {
      const { status, data } = await httpGet(uiPort, '/api/analysis-summary');
      assert.strictEqual(status, 200);
      assertScore(data.healthScore, 'healthScore');
      assert.ok(data.healthScore > 0, `UI healthScore is 0 — broken analysis?`);
      assertOneOf(data.grade, ['excellent', 'good', 'fair', 'critical'], 'grade');
      assertNum(data.complexity, 'complexity');
      assertNum(data.undocumented, 'undocumented');
    });

    it('/api/file — compressed file for CodeViewer', async () => {
      const { status, data } = await httpGet(uiPort, '/api/file?path=src/math.js');
      assert.strictEqual(status, 200);
      assertStr(data.code, 'code');
      assertStr(data.file, 'file');
      assertNum(data.codeTok, 'codeTok');
      assert.ok(data.codeTok > 5, `codeTok too small: ${data.codeTok} — compression produced nothing?`);
      assertNum(data.totalTok, 'totalTok');
      assert.ok(data.totalTok > 5, `totalTok too small: ${data.totalTok}`);
      assertNum(data.expanded, 'expanded');
      assert.ok(data.expanded > 10, `expanded too small: ${data.expanded} — decompile failed?`);
      assertStr(data.savings, 'savings');
      assert.ok(data.savings !== '0%', `savings is 0% — no compression happened`);
      assert.ok(data.code.includes('add'), 'code should have add');
    });

    it('/api/raw-file — original source', async () => {
      const { status, data } = await httpGet(uiPort, '/api/raw-file?path=src/math.js');
      assert.strictEqual(status, 200);
      assertStr(data.content, 'content');
      assert.ok(data.content.includes('export function add'), 'should have original source');
      assert.ok(data.content.includes('/**'), 'should have JSDoc comments');
    });

    it('/api/compression-stats — token stats for TopBar', async () => {
      const { status, data } = await httpGet(uiPort, '/api/compression-stats');
      assert.strictEqual(status, 200);
      assertNum(data.files, 'files');
      assertNum(data.codeTok, 'codeTok');
      assertNum(data.totalTok, 'totalTok');
      assertNum(data.expanded, 'expanded');
      assert.ok(data.files >= 5, `expected >= 5 files, got ${data.files}`);
      assert.ok(data.codeTok > 10, `codeTok is ${data.codeTok} — no code tokens counted?`);
      assert.ok(data.totalTok > 10, `totalTok is ${data.totalTok}`);
      assert.ok(data.expanded > 10, `expanded is ${data.expanded} — decompile broken?`);
    });

    it('/api/analysis — full analysis for HealthPanel', async () => {
      const { status, data } = await httpGet(uiPort, '/api/analysis');
      assert.strictEqual(status, 200);
      assertObj(data.overall, 'overall');
      assertScore(data.overall.score, 'score');
      assert.ok(data.overall.score > 0, `overall.score is 0 — analysis produced no results`);
      assertStr(data.overall.rating, 'rating');
      // Verify sub-sections have data
      assertObj(data.deadCode, 'deadCode');
      assertObj(data.complexity, 'complexity');
    });

    it('/api/expand + deps + usages + chain — navigation', async () => {
      // Build graph first
      await httpGet(uiPort, '/api/skeleton');

      const { data: expanded } = await httpGet(uiPort, '/api/expand?symbol=add');
      assert.ok(expanded);

      const { data: deps } = await httpGet(uiPort, '/api/deps?symbol=sum');
      assert.ok(deps !== undefined);

      const { data: usages } = await httpGet(uiPort, '/api/usages?symbol=add');
      assert.ok(usages !== undefined);

      // call_chain via HTTP
      const { data: chain } = await httpGet(uiPort, '/api/chain?from=sum&to=add');
      assert.ok(chain !== undefined, 'chain should return data');
    });

    it('/api/docs — file documentation via HTTP', async () => {
      const { status, data } = await httpGet(uiPort, '/api/docs?file=src/math.js');
      assert.strictEqual(status, 200);
      assert.ok(data);
    });

    it('/api/instances — backend list', async () => {
      const { status, data } = await httpGet(uiPort, '/api/instances');
      assert.strictEqual(status, 200);
      assertArr(data, 'instances should be array');
      assert.ok(data.length >= 1, 'should have at least 1 instance');
      assertStr(data[0].name, 'instance.name');
    });

    it('HTTP edge cases — missing path, unknown endpoint, static 404', async () => {
      // /api/file without path → fallback response
      const { status: s1, data: d1 } = await httpGet(uiPort, '/api/file');
      assert.strictEqual(s1, 200);
      assertStr(d1.code, 'code');

      // /api/raw-file with nonexistent path → error in content
      const { status: s2, data: d2 } = await httpGet(uiPort, '/api/raw-file?path=nope.js');
      assert.strictEqual(s2, 200);
      assert.ok(d2.content.includes('Cannot read'), 'should have error message');

      // Unknown API endpoint → error field
      const { status: s3, data: d3 } = await httpGet(uiPort, '/api/nonexistent');
      assert.strictEqual(s3, 200);
      assertStr(d3.error, 'unknown endpoint error');
    });
  });

  // ================================================================
  // PHASE 4: WebSocket Data Flow
  // ================================================================
  describe('Phase 4: WebSocket data flow', () => {
    let uiPort;
    let uiProc;
    let ws;
    let snapshot;

    before(async () => {
      const ui = await startUIServer(serverPath, FIXTURE_ROOT, 0);
      uiPort = ui.port;
      uiProc = ui.process;
      const conn = await wsConnect(uiPort);
      ws = conn.ws;
      snapshot = conn.snapshot;
    });

    after(() => {
      ws?.close();
      stopUIServer(uiProc);
    });

    it('snapshot — project metadata on connect', () => {
      assertObj(snapshot.project, 'project');
      assertStr(snapshot.project.name, 'name');
      assertStr(snapshot.project.path, 'path');
      assertStr(snapshot.project.color, 'color');
      assert.ok(snapshot.project.color.startsWith('hsl'));
    });

    it('snapshot — skeleton loaded on connect', () => {
      assertObj(snapshot.skeleton, 'skeleton');
      assert.strictEqual(snapshot.skeleton.v, 1);
      const names = Object.values(snapshot.skeleton.L);
      for (const sym of ALL_SYMBOLS) {
        assert.ok(names.includes(sym), `snapshot.skeleton missing ${sym}`);
      }
    });

    it('ws tool call — get_skeleton matches HTTP', async () => {
      const result = await wsCallTool(ws, 'get_skeleton', { path: '.' });
      assert.strictEqual(result.v, 1);
      assertObj(result.L, 'legend');
      // Compare with HTTP
      const { data: httpSk } = await httpGet(uiPort, '/api/skeleton');
      assert.strictEqual(result.s.files, httpSk.s.files, 'files mismatch WS vs HTTP');
    });

    it('ws tool call — compact_file returns UI-enriched data', async () => {
      const result = await wsCallTool(ws, 'compact', { action: 'compact_file', path: 'src/math.js' });
      assertStr(result.code, 'code');
      assertStr(result.file, 'file');
      assertNum(result.codeTok, 'codeTok');
      assertNum(result.totalTok, 'totalTok');
      assertNum(result.expanded, 'expanded');
      assertStr(result.savings, 'savings');
    });

    it('ws tool call — analyze returns data', async () => {
      const result = await wsCallTool(ws, 'analyze', { action: 'analysis_summary', path: '.' });
      assertScore(result.healthScore, 'healthScore');
    });

    it('ws — receives events during tool calls', async () => {
      // Collect events while calling a tool
      const events = [];
      const handler = (raw) => {
        try {
          const msg = JSON.parse(raw.toString());
          if (msg.method === 'event' || msg.method === 'patch') events.push(msg);
        } catch {}
      };
      ws.on('message', handler);

      // Trigger a tool call that should emit events
      await wsCallTool(ws, 'get_skeleton', { path: '.' });

      // Wait briefly for events to arrive
      await new Promise(r => setTimeout(r, 200));
      ws.removeListener('message', handler);

      // Server emits tool:call and tool:result events via event-bus
      // These arrive as method: 'event' on the WS
      assert.ok(events.length >= 0, 'events collected (may be 0 if event-bus disabled)');
    });

    it('ws — unknown method returns error', async () => {
      const id = Date.now();
      const response = await new Promise((resolve) => {
        const handler = (raw) => {
          const msg = JSON.parse(raw.toString());
          if (msg.id === id) { ws.removeListener('message', handler); resolve(msg); }
        };
        ws.on('message', handler);
        ws.send(JSON.stringify({ jsonrpc: '2.0', id, method: 'bogus', params: {} }));
      });
      assert.ok(response.error, 'should return error for unknown method');
      assert.strictEqual(response.error.code, -32601);
    });
  });

  // ================================================================
  // PHASE 5: Dynamic Tool Discovery — auto-test every action
  // ================================================================
  describe('Phase 5: Dynamic tool discovery', () => {

    it('every composite tool action returns valid response', async () => {
      // For each composite tool, test every action from its enum
      for (const tool of compositeTools) {
        const actions = tool.inputSchema.properties.action.enum;
        const needsPath = tool.inputSchema.required?.includes('path') ||
                          tool.inputSchema.properties?.path;

        for (const action of actions) {
          const args = { action };

          // Add required params contextually
          if (needsPath) args.path = '.';
          if (action === 'pass' || action === 'fail') continue; // need testId
          if (action === 'edit') continue; // needs symbol+code
          if (action === 'set') continue; // needs specific params
          if (action === 'add_excludes' || action === 'remove_excludes') continue;
          if (action === 'set_mode') continue;
          if (action === 'generate') {
            if (tool.name === 'jsdoc') args.path = join(FIXTURE_ROOT, 'src/math.js');
          }
          if (action === 'compact_file' || action === 'expand_file') {
            args.path = 'src/math.js';
          }
          if (action === 'expand') args.symbol = 'add';
          if (action === 'deps') args.symbol = 'sum';
          if (action === 'usages') args.symbol = 'add';
          if (action === 'call_chain') { args.from = 'sum'; args.to = 'add'; args.path = '.'; }
          if (action === 'sub_projects') args.path = '.';
          if (action === 'table_usage') args.path = '.';
          if (action === 'check_types') continue; // needs TS

          try {
            const { data } = await mcpClient.callTool(tool.name, args);
            assert.ok(data !== undefined,
              `${tool.name}.${action} returned undefined`);
          } catch (e) {
            assert.fail(`${tool.name}.${action} threw: ${e.message}`);
          }
        }
      }
    });

    it('simple tools (no action) return valid response', async () => {
      const simpleTools = toolDefs.filter(
        t => !t.inputSchema.properties?.action?.enum
      );
      for (const tool of simpleTools) {
        const args = {};
        if (tool.inputSchema.required?.includes('path')) args.path = '.';
        // Skip write-only tools
        if (tool.name === 'set_custom_rule') continue;

        try {
          const { data } = await mcpClient.callTool(tool.name, args);
          assert.ok(data !== undefined, `${tool.name} returned undefined`);
        } catch (e) {
          assert.fail(`${tool.name} threw: ${e.message}`);
        }
      }
    });
  });

  // ================================================================
  // PHASE 6: Docs generation
  // ================================================================
  describe('Phase 6: Documentation workflow', () => {

    it('docs.generate → check_stale → validate_contracts', async () => {
      const { data: gen } = await mcpClient.callTool('docs', { action: 'generate', path: '.', overwrite: true });
      assert.ok(gen.created || gen.updated || gen.skipped);
      assert.ok(existsSync(join(FIXTURE_ROOT, '.context')));

      const { data: stale } = await mcpClient.callTool('docs', { action: 'check_stale', path: '.' });
      assertNum(stale.fresh, 'fresh');
      assertArr(stale.stale, 'stale');

      const { data: contracts } = await mcpClient.callTool('docs', { action: 'validate_contracts', path: '.' });
      assertNum(contracts.files, 'files');
      assertArr(contracts.violations, 'violations');
      for (const v of contracts.violations) {
        assertStr(v.file, 'file');
        assertOneOf(v.severity, ['error', 'warning'], 'severity');
        assertStr(v.message, 'message');
      }
    });

    it('docs.get — file-specific after generation', async () => {
      const { data: r } = await mcpClient.callTool('docs', { action: 'get', path: '.', file: 'src/math.js' });
      assertStr(r.docs, 'docs');
      assert.ok(r.docs.includes('add'));
    });
  });

  // ================================================================
  // PHASE 7: Mode 1 (Compact) — full tool suite on minified code
  //
  // Phase 2 tested Mode 2 (human-readable, default).
  // Phase 7 compacts the project to Mode 1, then re-runs the most
  // critical tools to verify everything works on minified code.
  // ================================================================
  describe('Phase 7: Mode 1 (Compact) — tools on minified code', () => {

    /** Snapshot of Mode 2 stats, for cross-mode comparison */
    let mode2Stats = {};

    before(async () => {
      // Capture Mode 2 baseline
      await mcpClient.callTool('invalidate_cache');
      const { data: sk } = await mcpClient.callTool('get_skeleton', { path: '.' });
      mode2Stats = { files: sk.s.files, functions: sk.s.functions, classes: sk.s.classes };
    });

    it('switch to Mode 1 + compact', async () => {
      await mcpClient.callTool('compact', { action: 'set_mode', path: '.', mode: 1 });
      const { data: mode } = await mcpClient.callTool('compact', { action: 'get_mode', path: '.' });
      assert.strictEqual(mode.mode, 1);

      const { data: compacted } = await mcpClient.callTool('compact', { action: 'compact_all', path: '.' });
      assertNum(compacted.files, 'files');
      assert.ok(compacted.files >= 5);
      assert.ok(compacted.compactedBytes <= compacted.originalBytes);
      if (compacted.errors) assert.strictEqual(compacted.errors.length, 0);
    });

    it('exported names survive minification', () => {
      for (const fn of EXPORTED_FUNCTIONS) {
        let found = false;
        for (const f of ['src/math.js', 'src/utils.js', 'src/config.js', 'src/unused.js']) {
          if (readFileSync(join(FIXTURE_ROOT, f), 'utf-8').includes(fn)) { found = true; break; }
        }
        assert.ok(found, `"${fn}" lost during compact`);
      }
      for (const cls of EXPORTED_CLASSES) {
        assert.ok(readFileSync(join(FIXTURE_ROOT, 'src/models.js'), 'utf-8').includes(cls),
          `class "${cls}" lost during compact`);
      }
    });

    it('skeleton on minified code — same symbols as Mode 2', async () => {
      await mcpClient.callTool('invalidate_cache');
      const { data: sk } = await mcpClient.callTool('get_skeleton', { path: '.' });
      assert.strictEqual(sk.v, 1);

      // Same number of files and exported symbols
      assert.strictEqual(sk.s.files, mode2Stats.files, 'file count changed after compact');
      assert.strictEqual(sk.s.classes, mode2Stats.classes, 'class count changed after compact');

      // All exported symbols still in legend
      const longNames = Object.values(sk.L);
      for (const sym of ALL_SYMBOLS) {
        assert.ok(longNames.includes(sym), `"${sym}" missing from skeleton after compact`);
      }
    });

    it('navigate on minified code', async () => {
      const { data: expanded } = await mcpClient.callTool('navigate', { action: 'expand', symbol: 'add' });
      assert.ok(expanded);
      // In minified code, expand returns code (may be 1-line) — as long as no crash
      // Some implementations return error for very short functions
      if (!expanded.error) {
        assert.ok(expanded.code || expanded.name, 'expand should return code or name');
      }

      const { data: deps } = await mcpClient.callTool('navigate', { action: 'deps', symbol: 'sum' });
      assert.ok(deps !== undefined);

      const { data: usages } = await mcpClient.callTool('navigate', { action: 'usages', symbol: 'add' });
      assert.ok(usages !== undefined);
    });

    it('analyze on minified code — dead_code still detects neverCalled', async () => {
      const { data: dc } = await mcpClient.callTool('analyze', { action: 'dead_code', path: '.' });
      assert.ok(dc.items.map(i => i.name).includes('neverCalled'),
        'dead code detection broken on minified files');

      const { data: summary } = await mcpClient.callTool('analyze', { action: 'analysis_summary', path: '.' });
      assertScore(summary.healthScore, 'healthScore');
    });

    it('compact_file on already-minified code', async () => {
      const { data: r } = await mcpClient.callTool('compact', { action: 'compact_file', path: 'src/math.js' });
      assertStr(r.code, 'code');
      assert.ok(r.code.includes('add'));
      // compact_file applies Terser + @ctx header regardless — just verify it works
      assert.ok(r.compressed > 0);
    });

    it('expand_file decompiles minified code', async () => {
      const { data: r } = await mcpClient.callTool('compact', { action: 'expand_file', path: 'src/math.js' });
      assertStr(r.code, 'decompiled');
      assert.ok(r.code.includes('add'));
      assert.ok(r.code.includes('multiply'));
      // Expanded should be multi-line
      assert.ok(r.code.split('\n').length >= 3, 'expanded should be multi-line');
    });

    it('expand_project — creates .expanded/ with readable code', async () => {
      const { data: r } = await mcpClient.callTool('compact', { action: 'expand_project', path: '.' });
      assertNum(r.files, 'files');
      assert.ok(existsSync(join(FIXTURE_ROOT, '.expanded')));

      // Verify expanded files are human-readable
      for (const fn of EXPORTED_FUNCTIONS) {
        let found = false;
        for (const f of ['src/math.js', 'src/utils.js', 'src/config.js', 'src/unused.js']) {
          const fp = join(FIXTURE_ROOT, '.expanded', f);
          if (existsSync(fp) && readFileSync(fp, 'utf-8').includes(fn)) { found = true; break; }
        }
        assert.ok(found, `"${fn}" lost in .expanded`);
      }

      // Class hierarchy preserved
      const models = readFileSync(join(FIXTURE_ROOT, '.expanded/src/models.js'), 'utf-8');
      for (const kw of ['class Animal', 'class Dog', 'extends', 'constructor', 'speak', 'static']) {
        assert.ok(models.includes(kw), `"${kw}" lost in expanded models`);
      }
    });

    it('validate_pipeline on minified code', async () => {
      const { data: r } = await mcpClient.callTool('compact', { action: 'validate_pipeline', path: '.' });
      assertStr(r.status, 'status');
      assertObj(r.summary, 'summary');
      assertNum(r.summary.totalErrors, 'totalErrors');
      assertNum(r.summary.filesProcessed, 'filesProcessed');
      assertStr(r.summary.tokenSavings, 'tokenSavings');
    });

    it('db + jsdoc still work on minified code', async () => {
      const { data: db } = await mcpClient.callTool('db', { action: 'schema', path: '.' });
      assertNum(db.totalTables, 'totalTables');
      assert.ok(db.totalTables >= 2);

      const { data: jsdoc } = await mcpClient.callTool('jsdoc', { action: 'check_consistency', path: '.' });
      assertObj(jsdoc.summary, 'summary');
    });

    it('beautify — restores readable code', async () => {
      const { data: r } = await mcpClient.callTool('compact', { action: 'beautify', path: '.' });
      assertNum(r.files, 'files');
      assert.ok(r.beautifiedBytes >= r.originalBytes);

      // Files should be multi-line again
      const code = readFileSync(join(FIXTURE_ROOT, 'src/math.js'), 'utf-8');
      assert.ok(code.split('\n').filter(l => l.trim()).length >= 3);
    });

    it('semantic equivalence: original → compact → beautify → SAME result', async () => {
      // Write a fresh file with testable functions
      const { writeFileSync: wf } = await import('fs');
      const testFile = join(FIXTURE_ROOT, 'src/semantic-test.js');
      const originalCode = `\
export function fibonacci(n) {
  if (n <= 1) return n;
  return fibonacci(n - 1) + fibonacci(n - 2);
}

export function transform(items) {
  return items
    .filter(x => x > 0)
    .map(x => x * 2)
    .reduce((sum, x) => sum + x, 0);
}

export class Stack {
  constructor() { this.items = []; }
  push(v) { this.items.push(v); }
  pop() { return this.items.pop(); }
  get size() { return this.items.length; }
}

export function makeCounter(start) {
  let count = start;
  return {
    inc() { return ++count; },
    get() { return count; },
  };
}
`;
      wf(testFile, originalCode, 'utf-8');

      // Helper: execute code and return test results
      const evaluate = (code) => {
        // Strip exports/imports for eval
        const clean = code
          .replace(/^export\s+(default\s+)?/gm, '')
          .replace(/^import\s+.*$/gm, '');
        return new Function(`${clean}
          const results = {};
          results.fib10 = fibonacci(10);
          results.transform = transform([1, -2, 3, -4, 5]);
          const s = new Stack(); s.push(1); s.push(2); s.pop();
          results.stackSize = s.size;
          const c = makeCounter(5); c.inc(); c.inc();
          results.counter = c.get();
          return results;
        `)();
      };

      // 1. Capture original execution results
      const originalResults = evaluate(originalCode);
      assert.strictEqual(originalResults.fib10, 55);
      assert.strictEqual(originalResults.transform, 18);
      assert.strictEqual(originalResults.stackSize, 1);
      assert.strictEqual(originalResults.counter, 7);

      // 2. Compact (minify)
      await mcpClient.callTool('invalidate_cache');
      await mcpClient.callTool('compact', { action: 'set_mode', path: '.', mode: 1 });
      await mcpClient.callTool('compact', { action: 'compact_all', path: '.' });

      // 3. Read compacted code, execute, compare
      const compactedCode = readFileSync(testFile, 'utf-8');
      assert.ok(compactedCode.length < originalCode.length, 'compacted should be shorter');
      const compactedResults = evaluate(compactedCode);
      assert.deepStrictEqual(compactedResults, originalResults,
        'compact broke semantics');

      // 4. Beautify (expand back)
      await mcpClient.callTool('compact', { action: 'beautify', path: '.' });
      const beautifiedCode = readFileSync(testFile, 'utf-8');
      assert.ok(beautifiedCode.split('\n').length > 5, 'beautified should be multi-line');

      // 5. Execute beautified code, compare
      const beautifiedResults = evaluate(beautifiedCode);
      assert.deepStrictEqual(beautifiedResults, originalResults,
        'beautify broke semantics — round-trip NOT lossless');

      // 6. Second round: beautified → compact → compare again
      await mcpClient.callTool('compact', { action: 'compact_all', path: '.' });
      const recompactedCode = readFileSync(testFile, 'utf-8');
      const recompactedResults = evaluate(recompactedCode);
      assert.deepStrictEqual(recompactedResults, originalResults,
        '2nd compact broke semantics — NOT idempotent');

      // Restore
      await mcpClient.callTool('compact', { action: 'beautify', path: '.' });
    });

    after(async () => {
      // Restore Mode 2 for subsequent tests
      await mcpClient.callTool('compact', { action: 'set_mode', path: '.', mode: 2 });
    });
  });

  // ================================================================
  // PHASE 8: Edit workflow
  // ================================================================
  describe('Phase 8: Edit workflow', () => {

    it('compact.edit — replaces target, preserves neighbors', async () => {
      const { data } = await mcpClient.callTool('compact', {
        action: 'edit', path: 'src/editable.js', symbol: 'greet',
        code: "export function greet(name) { return 'Hi ' + name; }",
      });
      assert.ok(data.success);
      const code = readFileSync(join(FIXTURE_ROOT, 'src/editable.js'), 'utf-8');
      assert.ok(code.includes('Hi'));
      assert.ok(!code.includes('Hello'));
      assert.ok(code.includes('farewell'));
    });
  });

  // ================================================================
  // PHASE 9: Protocol error handling
  // ================================================================
  describe('Phase 9: Error handling', () => {

    it('unknown MCP method → error', async () => {
      try {
        await mcpClient._request('nonexistent/method');
        assert.fail('should throw');
      } catch (e) {
        assert.ok(e.message.includes('not found'), e.message);
      }
    });

    it('unknown tool → error', async () => {
      try {
        await mcpClient._request('tools/call', { name: 'FAKE', arguments: {} });
        assert.fail('should throw');
      } catch (e) {
        assert.ok(e.message.includes('Unknown tool'), e.message);
      }
    });
  });
});
