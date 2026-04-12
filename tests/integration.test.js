/**
 * Integration Test — Real MCP Protocol via stdio
 *
 * Spawns the actual server process, communicates via JSON-RPC over stdin/stdout.
 * Creates a realistic temp project, runs ALL tools, validates every field.
 * Cleans up after itself.
 *
 * Two modes:
 *   1. Local dev:  node --test tests/integration.test.js
 *   2. NPM verify: VERIFY_NPM=1 node --test tests/integration.test.js
 *      (installs published package in temp dir and tests the installed binary)
 *
 * Run: node --test tests/integration.test.js
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdirSync, writeFileSync, readFileSync, rmSync,
  existsSync, readdirSync,
} from 'fs';
import { join, resolve, dirname } from 'path';
import { spawn, execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');
const FIXTURE_ROOT = join('/tmp', `pg-mcp-test-${Date.now()}`);

// ─── Which binary to test? ────────────────────────────────────────
const VERIFY_NPM = process.env.VERIFY_NPM === '1';
let SERVER_PATH; // set in before()

// ─── Fixture: realistic multi-file project ────────────────────────
const FIXTURE_FILES = {
  'package.json': JSON.stringify({
    name: 'test-consumer', version: '1.0.0', type: 'module',
  }),

  'src/math.js': `\
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

function _clamp(v, min, max) {
  return Math.min(Math.max(v, min), max);
}

export const PI = 3.14159;
`,

  'src/utils.js': `\
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

  'src/models.js': `\
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

  'src/config.js': `\
export const defaults = {
  port: 3000,
  host: 'localhost',
  debug: false,
};
export function mergeConfig(user) {
  return { ...defaults, ...user };
}
`,

  'src/unused.js': `\
export function neverCalled() {
  return 'dead code';
}
function alsoUnused() {}
`,

  'schema.sql': `\
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
`,
};

const EXPORTED_FUNCTIONS = [
  'add', 'multiply', 'format', 'fetchData', 'sum',
  'mergeConfig', 'neverCalled',
];
const EXPORTED_CLASSES = ['Animal', 'Dog'];

// ─── MCP Client (JSON-RPC over stdio) ─────────────────────────────
class MCPClient {
  constructor(serverPath, projectDir) {
    this._serverPath = serverPath;
    this._projectDir = projectDir;
    this._nextId = 1;
    this._pending = new Map();
    this._buffer = '';
    this._child = null;
  }

  async start() {
    this._child = spawn('node', [this._serverPath], {
      env: { ...process.env, PROJECT_GRAPH_BACKEND: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: this._projectDir,
    });

    this._child.stdout.on('data', (chunk) => {
      this._buffer += chunk.toString();
      const lines = this._buffer.split('\n');
      this._buffer = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.id !== undefined && this._pending.has(msg.id)) {
            const { resolve, reject } = this._pending.get(msg.id);
            this._pending.delete(msg.id);
            if (msg.error) reject(new Error(msg.error.message));
            else resolve(msg);
          }
        } catch { /* ignore non-JSON lines */ }
      }
    });

    // Collect stderr for debugging but ignore in normal flow
    this._stderr = '';
    this._child.stderr.on('data', (d) => { this._stderr += d.toString(); });

    return this;
  }

  _send(msg) {
    this._child.stdin.write(JSON.stringify(msg) + '\n');
  }

  _request(method, params = {}) {
    const id = this._nextId++;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this._pending.delete(id);
        reject(new Error(`Timeout: ${method} (id=${id}). stderr: ${this._stderr}`));
      }, 15000);
      this._pending.set(id, {
        resolve: (msg) => { clearTimeout(timeout); resolve(msg); },
        reject: (err) => { clearTimeout(timeout); reject(err); },
      });
      this._send({ jsonrpc: '2.0', id, method, params });
    });
  }

  async initialize() {
    const resp = await this._request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'integration-test', version: '1.0.0' },
      roots: [{ uri: 'file://' + this._projectDir }],
    });
    // Send initialized notification (no response expected)
    this._send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    // Wait a bit for initialization to settle
    await new Promise(r => setTimeout(r, 100));
    return resp;
  }

  async listTools() {
    return this._request('tools/list');
  }

  async listResources() {
    return this._request('resources/list');
  }

  async readResource(uri) {
    return this._request('resources/read', { uri });
  }

  async callTool(name, args = {}) {
    const resp = await this._request('tools/call', { name, arguments: args });
    // Parse the result: content[0].text is JSON
    const content = resp.result.content;
    assert.ok(Array.isArray(content), `tools/call ${name}: content should be array`);
    assert.ok(content.length >= 1, `tools/call ${name}: content should have >= 1 item`);
    assert.strictEqual(content[0].type, 'text', `tools/call ${name}: content[0].type should be text`);
    const data = JSON.parse(content[0].text);
    // Check for hints (content[1])
    const hints = content.length > 1 ? content[1].text : null;
    return { data, hints, raw: resp };
  }

  stop() {
    if (this._child && !this._child.killed) {
      this._child.kill('SIGTERM');
    }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────
function scaffold() {
  rmSync(FIXTURE_ROOT, { recursive: true, force: true });
  for (const [rel, content] of Object.entries(FIXTURE_FILES)) {
    const abs = join(FIXTURE_ROOT, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content, 'utf-8');
  }
}

function assertNum(val, label) {
  assert.strictEqual(typeof val, 'number', `${label}: expected number, got ${typeof val}`);
  assert.ok(val >= 0, `${label}: expected >= 0, got ${val}`);
}

function assertStr(val, label) {
  assert.strictEqual(typeof val, 'string', `${label}: expected string`);
  assert.ok(val.length > 0, `${label}: expected non-empty string`);
}

// ─── Test Suite ───────────────────────────────────────────────────
describe('MCP Protocol Integration Test', { concurrency: false, timeout: 120000 }, () => {
  /** @type {MCPClient} */
  let client;

  before(async () => {
    scaffold();

    if (VERIFY_NPM) {
      // Install published package in temp dir
      const npmDir = join(FIXTURE_ROOT, '_npm_install');
      mkdirSync(npmDir, { recursive: true });
      writeFileSync(join(npmDir, 'package.json'), '{"name":"verifier","private":true}');
      execSync('npm install project-graph-mcp', { cwd: npmDir, stdio: 'pipe' });
      SERVER_PATH = join(npmDir, 'node_modules', '.bin', 'project-graph-mcp');
      // If .bin has a symlink, resolve it
      if (!existsSync(SERVER_PATH)) {
        SERVER_PATH = join(npmDir, 'node_modules', 'project-graph-mcp', 'src', 'network', 'server.js');
      }
    } else {
      SERVER_PATH = join(PROJECT_ROOT, 'src', 'network', 'server.js');
    }

    client = new MCPClient(SERVER_PATH, FIXTURE_ROOT);
    await client.start();
  });

  after(() => {
    client?.stop();
    rmSync(FIXTURE_ROOT, { recursive: true, force: true });
  });

  // ================================================================
  // PHASE 1: MCP Protocol Handshake
  // ================================================================
  describe('Phase 1: MCP Protocol Handshake', () => {

    it('initialize — returns valid MCP envelope', async () => {
      const resp = await client.initialize();
      // JSON-RPC envelope
      assert.strictEqual(resp.jsonrpc, '2.0');
      assert.ok(resp.id !== undefined, 'has id');
      assert.ok(resp.result, 'has result');

      // MCP initialize result
      const r = resp.result;
      assertStr(r.protocolVersion, 'protocolVersion');
      assert.ok(r.capabilities, 'has capabilities');
      assert.ok(r.capabilities.tools !== undefined, 'declares tools capability');
      assert.ok(r.serverInfo, 'has serverInfo');
      assertStr(r.serverInfo.name, 'serverInfo.name');
      assertStr(r.serverInfo.version, 'serverInfo.version');
    });

    it('tools/list — returns all 18 tools with schemas', async () => {
      const resp = await client.listTools();
      const tools = resp.result.tools;
      assert.ok(Array.isArray(tools), 'tools should be array');
      assert.strictEqual(tools.length, 18, `expected 18 tools, got ${tools.length}`);

      // Validate each tool definition
      const names = new Set();
      for (const tool of tools) {
        assertStr(tool.name, 'tool.name');
        assertStr(tool.description, 'tool.description');
        assert.ok(tool.inputSchema, `${tool.name}: missing inputSchema`);
        assert.strictEqual(tool.inputSchema.type, 'object', `${tool.name}: schema type`);
        assert.ok(!names.has(tool.name), `duplicate tool name: ${tool.name}`);
        names.add(tool.name);
      }

      // Composite tools have action enum
      for (const name of ['navigate', 'analyze', 'testing', 'filters', 'jsdoc', 'docs', 'compact', 'db']) {
        const t = tools.find(t => t.name === name);
        assert.ok(t, `${name} not found`);
        assert.ok(t.inputSchema.properties.action?.enum?.length > 0,
          `${name}: missing action enum`);
      }
    });

    it('resources/list — returns guide resource', async () => {
      const resp = await client.listResources();
      const resources = resp.result.resources;
      assert.ok(Array.isArray(resources));
      assert.ok(resources.length >= 1, 'at least 1 resource');
      const guide = resources.find(r => r.uri.includes('guide'));
      assert.ok(guide, 'guide resource missing');
      assertStr(guide.name, 'resource name');
    });

    it('resources/read — returns guide content', async () => {
      const resp = await client.readResource('project-graph://guide');
      const contents = resp.result.contents;
      assert.ok(Array.isArray(contents));
      assert.ok(contents.length >= 1);
      assert.strictEqual(contents[0].mimeType, 'text/markdown');
      assertStr(contents[0].text, 'guide text');
      assert.ok(contents[0].text.length > 200, 'guide should be substantial');
    });
  });

  // ================================================================
  // PHASE 2: All tools — every field validated
  // ================================================================
  describe('Phase 2: All tools on fresh project', () => {

    // ── get_skeleton ──────────────────────────────────────────────
    it('get_skeleton — full schema + data validation', async () => {
      const { data: sk, hints } = await client.callTool('get_skeleton', { path: '.' });

      assert.strictEqual(sk.v, 1, 'version should be 1');

      // Legend: short → long
      assert.strictEqual(typeof sk.L, 'object');
      const longNames = Object.values(sk.L);
      assert.ok(longNames.length >= 9, `legend should have >= 9 entries, got ${longNames.length}`);
      for (const [short, long] of Object.entries(sk.L)) {
        assertStr(short, 'legend key');
        assertStr(long, `legend value for ${short}`);
      }

      // All known symbols in legend
      for (const sym of [...EXPORTED_FUNCTIONS, ...EXPORTED_CLASSES]) {
        assert.ok(longNames.includes(sym), `"${sym}" not in legend: ${longNames}`);
      }

      // Stats
      assertNum(sk.s.files, 'files');
      assertNum(sk.s.classes, 'classes');
      assertNum(sk.s.functions, 'functions');
      assertNum(sk.s.tables, 'tables');
      assert.ok(sk.s.files >= 5, `expected >= 5 files, got ${sk.s.files}`);
      assert.ok(sk.s.functions >= 8, `expected >= 8 functions`);
      assert.ok(sk.s.classes >= 2, `expected >= 2 classes`);
      assert.ok(sk.s.tables >= 2, `expected >= 2 tables (schema.sql)`);

      // Exports map
      assert.strictEqual(typeof sk.X, 'object');
      for (const [file, exports] of Object.entries(sk.X)) {
        assert.ok(Array.isArray(exports));
        for (const sym of exports) {
          assert.ok(sym in sk.L, `export ${sym} not in legend L`);
        }
      }

      // Hints should exist
      assert.ok(hints, 'should have hints');
      assert.ok(hints.includes('expand'), 'hints should mention expand');
    });

    // ── get_ai_context ────────────────────────────────────────────
    it('get_ai_context — schema', async () => {
      const { data: ctx } = await client.callTool('get_ai_context', {
        path: '.', includeSkeleton: true, includeDocs: false,
      });
      assertNum(ctx.totalTokens, 'totalTokens');
      assert.ok(ctx.totalTokens > 0, 'totalTokens > 0');
      assert.ok(ctx.skeleton, 'skeleton included');
      assert.strictEqual(ctx.skeleton.v, 1);
    });

    // ── invalidate_cache ──────────────────────────────────────────
    it('invalidate_cache', async () => {
      const { data } = await client.callTool('invalidate_cache');
      assert.strictEqual(data.success, true);
    });

    // ── get_usage_guide ───────────────────────────────────────────
    it('get_usage_guide', async () => {
      const { data } = await client.callTool('get_usage_guide');
      assert.strictEqual(typeof data, 'string');
      assert.ok(data.length > 200);
    });

    // ── get_agent_instructions ────────────────────────────────────
    it('get_agent_instructions', async () => {
      const { data } = await client.callTool('get_agent_instructions');
      assert.strictEqual(typeof data, 'string');
      assert.ok(data.length > 20);
    });

    // ── navigate ──────────────────────────────────────────────────
    it('navigate.expand — known symbol', async () => {
      // Rebuild graph
      await client.callTool('get_skeleton', { path: '.' });
      const { data } = await client.callTool('navigate', { action: 'expand', symbol: 'add' });
      assert.ok(data);
      if (data.code) assert.ok(data.code.includes('add'));
    });

    it('navigate.expand — unknown symbol returns error', async () => {
      const { data } = await client.callTool('navigate', { action: 'expand', symbol: 'NONEXISTENT_99' });
      assert.ok(data.error, 'should return error for unknown');
    });

    it('navigate.deps', async () => {
      const { data } = await client.callTool('navigate', { action: 'deps', symbol: 'sum' });
      assert.ok(data !== undefined);
    });

    it('navigate.usages', async () => {
      const { data } = await client.callTool('navigate', { action: 'usages', symbol: 'add' });
      assert.ok(data !== undefined);
    });

    it('navigate.sub_projects', async () => {
      const { data } = await client.callTool('navigate', { action: 'sub_projects', path: '.' });
      assert.ok(Array.isArray(data));
    });

    // ── analyze.dead_code ─────────────────────────────────────────
    it('analyze.dead_code — schema + detects neverCalled', async () => {
      const { data: r } = await client.callTool('analyze', { action: 'dead_code', path: '.' });
      assertNum(r.total, 'total');
      assert.ok('byType' in r);
      assert.ok(Array.isArray(r.items));
      const names = r.items.map(i => i.name);
      assert.ok(names.includes('neverCalled'), `neverCalled not detected: ${names}`);
      for (const item of r.items) {
        assertStr(item.name, 'item.name');
        assertStr(item.type, 'item.type');
        assertStr(item.file, 'item.file');
        assertStr(item.reason, 'item.reason');
      }
    });

    // ── analyze.complexity ────────────────────────────────────────
    it('analyze.complexity — schema', async () => {
      const { data: r } = await client.callTool('analyze', { action: 'complexity', path: '.', minComplexity: 1 });
      assertNum(r.total, 'total');
      assert.ok(r.stats);
      assertNum(r.stats.low, 'low');
      assertNum(r.stats.moderate, 'moderate');
      assert.ok(Array.isArray(r.items));
      for (const item of r.items) {
        assertStr(item.name, 'name');
        assertStr(item.file, 'file');
        assertNum(item.complexity, 'complexity');
        assertStr(item.rating, 'rating');
        assert.ok(['low', 'moderate', 'high', 'critical'].includes(item.rating));
      }
    });

    // ── analyze.full_analysis ──────────────────────────────────────
    it('analyze.full_analysis — all sections', async () => {
      const { data: r } = await client.callTool('analyze', { action: 'full_analysis', path: '.' });
      for (const key of ['deadCode', 'undocumented', 'similar', 'complexity', 'largeFiles', 'outdated', 'overall']) {
        assert.ok(key in r, `missing ${key}`);
      }
      assertNum(r.overall.score, 'score');
      assert.ok(r.overall.score >= 0 && r.overall.score <= 100);
      assertStr(r.overall.rating, 'rating');
    });

    // ── analyze.analysis_summary ──────────────────────────────────
    it('analyze.analysis_summary — schema', async () => {
      const { data: r } = await client.callTool('analyze', { action: 'analysis_summary', path: '.' });
      assertNum(r.healthScore, 'healthScore');
      assertStr(r.grade, 'grade');
      assert.ok(['excellent', 'good', 'fair', 'critical'].includes(r.grade));
    });

    // ── analyze.large_files ───────────────────────────────────────
    it('analyze.large_files — schema', async () => {
      const { data: r } = await client.callTool('analyze', { action: 'large_files', path: '.' });
      assertNum(r.total, 'total');
      assert.ok(r.stats);
      assertNum(r.stats.totalFiles, 'totalFiles');
    });

    // ── analyze.outdated_patterns ──────────────────────────────────
    it('analyze.outdated_patterns — schema', async () => {
      const { data: r } = await client.callTool('analyze', { action: 'outdated_patterns', path: '.' });
      assert.ok(r.stats);
      assert.ok(Array.isArray(r.redundantDeps));
    });

    // ── analyze.undocumented ──────────────────────────────────────
    it('analyze.undocumented — schema', async () => {
      const { data: r } = await client.callTool('analyze', { action: 'undocumented', path: '.', level: 'all' });
      assertNum(r.total, 'total');
      assert.ok(r.byType);
    });

    // ── testing ───────────────────────────────────────────────────
    it('testing — full lifecycle', async () => {
      await client.callTool('testing', { action: 'reset' });
      const { data: summary } = await client.callTool('testing', { action: 'summary', path: '.' });
      assertNum(summary.total, 'total');
      assertNum(summary.passed, 'passed');
      assertNum(summary.failed, 'failed');
      assertNum(summary.pending, 'pending');
    });

    // ── filters ───────────────────────────────────────────────────
    it('filters — get/set/reset lifecycle', async () => {
      const { data: f } = await client.callTool('filters', { action: 'get' });
      assert.ok(Array.isArray(f.excludeDirs));
      assert.ok(Array.isArray(f.excludePatterns));
      assert.strictEqual(typeof f.includeHidden, 'boolean');
      assert.strictEqual(typeof f.useGitignore, 'boolean');

      await client.callTool('filters', { action: 'set', excludeDirs: ['vendor'] });
      const { data: f2 } = await client.callTool('filters', { action: 'get' });
      assert.ok(f2.excludeDirs.includes('vendor'));

      await client.callTool('filters', { action: 'reset' });
      const { data: f3 } = await client.callTool('filters', { action: 'get' });
      assert.ok(f3.excludeDirs.includes('node_modules'));
    });

    // ── jsdoc ─────────────────────────────────────────────────────
    it('jsdoc.check_consistency', async () => {
      const { data: r } = await client.callTool('jsdoc', { action: 'check_consistency', path: '.' });
      assert.ok(r.summary);
      assertNum(r.summary.total, 'total');
      assert.ok(Array.isArray(r.issues));
    });

    // ── docs ──────────────────────────────────────────────────────
    it('docs.get — works without .context', async () => {
      const { data } = await client.callTool('docs', { action: 'get', path: '.' });
      assert.strictEqual(typeof data, 'object');
    });

    // ── compact.get_mode ──────────────────────────────────────────
    it('compact.get_mode — defaults', async () => {
      const { data: r } = await client.callTool('compact', { action: 'get_mode', path: '.' });
      assert.strictEqual(r.mode, 2);
      assert.strictEqual(r.beautify, true);
      assert.strictEqual(r.autoValidate, false);
      assertStr(r.description, 'description');
      assert.ok(r.workflow);
      assertStr(r.workflow.read, 'read');
      assertStr(r.workflow.edit, 'edit');
    });

    // ── compact.compact_file ──────────────────────────────────────
    it('compact.compact_file — response', async () => {
      const { data: r } = await client.callTool('compact', { action: 'compact_file', path: 'src/math.js' });
      assertStr(r.code, 'code');
      assertNum(r.original, 'original');
      assertNum(r.compressed, 'compressed');
      assertStr(r.savings, 'savings');
      assert.ok(r.compressed <= r.original);
      assert.ok(r.code.includes('add'));
    });

    // ── db ─────────────────────────────────────────────────────────
    it('db.schema — detects SQL tables', async () => {
      const { data: r } = await client.callTool('db', { action: 'schema', path: '.' });
      assertNum(r.totalTables, 'totalTables');
      assert.ok(r.totalTables >= 2, `expected >= 2 tables, got ${r.totalTables}`);
      const names = r.tables.map(t => t.name || t.table);
      assert.ok(names.includes('users'), `users not found: ${names}`);
      assert.ok(names.includes('posts'), `posts not found: ${names}`);
    });

    it('db.dead_tables — schema', async () => {
      const { data: r } = await client.callTool('db', { action: 'dead_tables', path: '.' });
      assert.ok(Array.isArray(r.deadTables));
      assert.ok(r.stats);
      assertNum(r.stats.totalSchemaTables, 'totalSchemaTables');
    });

    // ── get_focus_zone ────────────────────────────────────────────
    it('get_focus_zone', async () => {
      const { data } = await client.callTool('get_focus_zone', {
        path: '.', recentFiles: ['src/math.js'],
      });
      assert.ok('focusFiles' in data);
      assert.ok(Array.isArray(data.focusFiles));
    });
  });

  // ================================================================
  // PHASE 3: Docs generation → validation
  // ================================================================
  describe('Phase 3: Docs & contracts', () => {

    it('docs.generate', async () => {
      const { data: r } = await client.callTool('docs', { action: 'generate', path: '.', overwrite: true });
      assert.ok(r.created || r.updated || r.skipped);
      assert.ok(existsSync(join(FIXTURE_ROOT, '.context')));
    });

    it('docs.check_stale', async () => {
      const { data: r } = await client.callTool('docs', { action: 'check_stale', path: '.' });
      assertNum(r.fresh, 'fresh');
      assert.ok(Array.isArray(r.stale));
    });

    it('docs.validate_contracts — per-violation schema', async () => {
      const { data: r } = await client.callTool('docs', { action: 'validate_contracts', path: '.' });
      assertNum(r.files, 'files');
      assert.ok(r.summary);
      assertNum(r.summary.errors, 'errors');
      assertNum(r.summary.warnings, 'warnings');
      assert.ok(Array.isArray(r.violations));
      for (const v of r.violations) {
        assertStr(v.file, 'violation.file');
        assertStr(v.severity, 'severity');
        assert.ok(['error', 'warning'].includes(v.severity));
        assertStr(v.message, 'message');
      }
    });

    it('docs.get — file-specific after generation', async () => {
      const { data: r } = await client.callTool('docs', { action: 'get', path: '.', file: 'src/math.js' });
      assert.ok(r.docs);
      assertStr(r.docs, 'docs content');
      assert.ok(r.docs.includes('add'), 'docs should mention add');
    });
  });

  // ================================================================
  // PHASE 4: Compact round-trip — data integrity
  // ================================================================
  describe('Phase 4: Compact round-trip', () => {

    it('compact.set_mode → Mode 1', async () => {
      await client.callTool('compact', { action: 'set_mode', path: '.', mode: 1 });
      const { data: r } = await client.callTool('compact', { action: 'get_mode', path: '.' });
      assert.strictEqual(r.mode, 1);
    });

    it('compact.compact_all — minifies', async () => {
      const { data: r } = await client.callTool('compact', { action: 'compact_all', path: '.' });
      assertNum(r.files, 'files');
      assert.ok(r.files >= 5);
      assertNum(r.originalBytes, 'originalBytes');
      assertNum(r.compactedBytes, 'compactedBytes');
      assert.ok(r.compactedBytes <= r.originalBytes);
      if (r.errors) assert.strictEqual(r.errors.length, 0, JSON.stringify(r.errors));
    });

    it('compacted files: names preserved, comments stripped', () => {
      for (const fn of EXPORTED_FUNCTIONS) {
        let found = false;
        for (const f of ['src/math.js', 'src/utils.js', 'src/config.js', 'src/unused.js']) {
          if (readFileSync(join(FIXTURE_ROOT, f), 'utf-8').includes(fn)) { found = true; break; }
        }
        assert.ok(found, `exported fn "${fn}" lost during compact`);
      }
      for (const cls of EXPORTED_CLASSES) {
        const code = readFileSync(join(FIXTURE_ROOT, 'src/models.js'), 'utf-8');
        assert.ok(code.includes(cls), `class "${cls}" lost during compact`);
      }
    });

    it('skeleton unchanged after compact', async () => {
      const { data: sk } = await client.callTool('invalidate_cache');
      const { data: sk2 } = await client.callTool('get_skeleton', { path: '.' });
      const names = Object.values(sk2.L);
      for (const sym of [...EXPORTED_FUNCTIONS, ...EXPORTED_CLASSES]) {
        assert.ok(names.includes(sym), `"${sym}" missing from skeleton after compact`);
      }
    });

    it('compact.expand_project — creates .expanded/', async () => {
      const { data: r } = await client.callTool('compact', { action: 'expand_project', path: '.' });
      assertNum(r.files, 'files');
      assert.ok(existsSync(join(FIXTURE_ROOT, '.expanded')));
    });

    it('expanded code is human-readable + names intact', () => {
      for (const f of ['src/math.js', 'src/utils.js', 'src/models.js']) {
        const code = readFileSync(join(FIXTURE_ROOT, '.expanded', f), 'utf-8');
        const lines = code.split('\n').filter(l => l.trim());
        assert.ok(lines.length >= 3, `${f}: expanded should be multi-line`);
      }
      for (const fn of EXPORTED_FUNCTIONS) {
        let found = false;
        for (const f of ['src/math.js', 'src/utils.js', 'src/config.js', 'src/unused.js']) {
          const fp = join(FIXTURE_ROOT, '.expanded', f);
          if (existsSync(fp) && readFileSync(fp, 'utf-8').includes(fn)) { found = true; break; }
        }
        assert.ok(found, `"${fn}" lost in .expanded`);
      }
    });

    it('expanded preserves class hierarchy', () => {
      const code = readFileSync(join(FIXTURE_ROOT, '.expanded/src/models.js'), 'utf-8');
      for (const kw of ['class Animal', 'class Dog', 'extends', 'constructor', 'speak', 'static']) {
        assert.ok(code.includes(kw), `"${kw}" lost in expanded models.js`);
      }
    });

    it('compact.expand_file — single file decompile', async () => {
      const { data: r } = await client.callTool('compact', { action: 'expand_file', path: 'src/math.js' });
      assertStr(r.code, 'decompiled code');
      assert.ok(r.code.includes('add'));
      assert.ok(r.code.includes('multiply'));
    });

    it('compact.beautify — restores readability', async () => {
      const { data: r } = await client.callTool('compact', { action: 'beautify', path: '.' });
      assertNum(r.files, 'files');
      assert.ok(r.beautifiedBytes >= r.originalBytes);
      const code = readFileSync(join(FIXTURE_ROOT, 'src/math.js'), 'utf-8');
      assert.ok(code.split('\n').filter(l => l.trim()).length >= 3);
    });

    it('compact.validate_pipeline — full schema', async () => {
      const { data: r } = await client.callTool('compact', { action: 'validate_pipeline', path: '.' });
      assertStr(r.status, 'status');
      assert.ok(['PASS', 'FAIL'].includes(r.status));
      assertStr(r.duration, 'duration');
      assert.ok(r.contracts);
      assert.ok(r.summary);
      assertNum(r.summary.totalErrors, 'totalErrors');
      assertNum(r.summary.contractErrors, 'contractErrors');
      assertNum(r.summary.astErrors, 'astErrors');
      assertNum(r.summary.styleErrors, 'styleErrors');
      assertNum(r.summary.filesProcessed, 'filesProcessed');
      assertNum(r.summary.jsdocInjected, 'jsdocInjected');
      assertStr(r.summary.tokenSavings, 'tokenSavings');
    });

    it('compact.set_mode — back to Mode 2', async () => {
      await client.callTool('compact', { action: 'set_mode', path: '.', mode: 2 });
    });
  });

  // ================================================================
  // PHASE 5: Edit workflow
  // ================================================================
  describe('Phase 5: Edit compressed', () => {

    before(() => {
      writeFileSync(join(FIXTURE_ROOT, 'src/editable.js'), `\
export function greet(name) {
  return 'Hello ' + name;
}
export function farewell(name) {
  return 'Bye ' + name;
}
`, 'utf-8');
    });

    it('compact.edit — replaces target, keeps neighbors', async () => {
      const { data: r } = await client.callTool('compact', {
        action: 'edit',
        path: 'src/editable.js',
        symbol: 'greet',
        code: "export function greet(name) { return 'Hi ' + name; }",
      });
      assert.ok(r.success);
      const code = readFileSync(join(FIXTURE_ROOT, 'src/editable.js'), 'utf-8');
      assert.ok(code.includes('Hi'), 'new code applied');
      assert.ok(!code.includes('Hello'), 'old code removed');
      assert.ok(code.includes('farewell'), 'neighbor preserved');
    });
  });

  // ================================================================
  // PHASE 6: Error handling — protocol-level
  // ================================================================
  describe('Phase 6: Protocol error handling', () => {

    it('unknown method returns error', async () => {
      try {
        await client._request('nonexistent/method');
        // If we get here, the server returned a response with error field
        assert.fail('should have thrown or returned error');
      } catch (e) {
        // JSON-RPC error message propagated
        assert.ok(e.message.includes('Method not found') || e.message.includes('not found'),
          `unexpected error: ${e.message}`);
      }
    });

    it('unknown tool returns error in content', async () => {
      try {
        await client._request('tools/call', { name: 'FAKE_TOOL', arguments: {} });
      } catch (e) {
        assert.ok(e.message.includes('Unknown tool'));
      }
    });
  });
});
