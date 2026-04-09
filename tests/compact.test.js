import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { compactProject, expandProject } from '../src/compact.js';
import { parseCtxFile, injectJSDoc, stripJSDoc } from '../src/ctx-to-jsdoc.js';
import { parseFile } from '../src/parser.js';

const TEST_DIR = join(import.meta.dirname, '__compact_test__');

describe('Compact Code Mode', () => {

  before(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });

  after(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  // ============================
  // Parser: param extraction
  // ============================

  describe('Parser param extraction', () => {

    it('should extract simple params', async () => {
      const code = 'function foo(a, b) {}';
      const result = await parseFile(code, 'test.js');
      assert.deepStrictEqual(result.functions[0].params, ['a', 'b']);
    });

    it('should extract default params with = marker', async () => {
      const code = 'function foo(a, b = 42) {}';
      const result = await parseFile(code, 'test.js');
      assert.deepStrictEqual(result.functions[0].params, ['a', 'b=']);
    });

    it('should extract rest params', async () => {
      const code = 'function foo(a, ...rest) {}';
      const result = await parseFile(code, 'test.js');
      assert.deepStrictEqual(result.functions[0].params, ['a', '...rest']);
    });

    it('should extract destructured params as options', async () => {
      const code = 'function foo({ x, y }) {}';
      const result = await parseFile(code, 'test.js');
      assert.deepStrictEqual(result.functions[0].params, ['options']);
    });

    it('should detect async functions', async () => {
      const code = 'async function foo() {}';
      const result = await parseFile(code, 'test.js');
      assert.strictEqual(result.functions[0].async, true);
    });

    it('should detect non-async functions', async () => {
      const code = 'function foo() {}';
      const result = await parseFile(code, 'test.js');
      assert.strictEqual(result.functions[0].async, false);
    });
  });

  // ============================
  // Compact / Beautify
  // ============================

  describe('compactProject()', () => {

    it('should compact JS files and report savings', async () => {
      const dir = join(TEST_DIR, 'compact1');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'a.js'), `
// This is a comment
export function hello(name) {
  // inner comment
  return "Hello, " + name;
}
`, 'utf-8');

      const result = await compactProject(dir);

      assert.strictEqual(result.files, 1);
      assert.ok(result.compactedBytes < result.originalBytes, 'Should reduce size');
      assert.ok(!result.errors, 'No errors expected');

      const compacted = readFileSync(join(dir, 'a.js'), 'utf-8');
      assert.ok(!compacted.includes('// This is a comment'), 'Comments removed');
      assert.ok(compacted.includes('hello'), 'Function name preserved');
    });

    it('dry run should not modify files', async () => {
      const dir = join(TEST_DIR, 'compact2');
      mkdirSync(dir, { recursive: true });
      const original = 'export function test() { return 42; }\n';
      writeFileSync(join(dir, 'b.js'), original, 'utf-8');

      const result = await compactProject(dir, { dryRun: true });

      assert.strictEqual(result.dryRun, true);
      assert.strictEqual(readFileSync(join(dir, 'b.js'), 'utf-8'), original);
    });

    it('should handle empty files', async () => {
      const dir = join(TEST_DIR, 'compact3');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'empty.js'), '', 'utf-8');

      const result = await compactProject(dir);

      assert.strictEqual(result.files, 1);
      assert.ok(!result.errors);
    });

    it('should handle syntax errors gracefully', async () => {
      const dir = join(TEST_DIR, 'compact4');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'good.js'), 'export const x = 1;\n', 'utf-8');
      writeFileSync(join(dir, 'bad.js'), 'function { broken syntax }\n', 'utf-8');

      const result = await compactProject(dir);

      // good.js should process, bad.js should error but not crash
      assert.ok(result.errors, 'Should have errors');
      assert.strictEqual(result.errors.length, 1);
      assert.ok(result.errors[0].file.includes('bad.js'));
      assert.ok(result.files >= 1, 'Good file still processed');
    });

    it('should skip node_modules and vendor', async () => {
      const dir = join(TEST_DIR, 'compact5');
      mkdirSync(join(dir, 'node_modules'), { recursive: true });
      mkdirSync(join(dir, 'src'), { recursive: true });
      writeFileSync(join(dir, 'node_modules', 'lib.js'), 'const x = 1;\n', 'utf-8');
      writeFileSync(join(dir, 'src', 'app.js'), 'const y = 2;\n', 'utf-8');

      const result = await compactProject(dir);

      assert.strictEqual(result.files, 1);
      assert.ok(result.fileList[0].includes('app.js'));
    });
  });

  describe('expandProject()', () => {

    it('should beautify compacted code', async () => {
      const dir = join(TEST_DIR, 'beautify1');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'c.js'), 'export function foo(a,b){return a+b}', 'utf-8');

      const result = await expandProject(dir);

      assert.strictEqual(result.files, 1);
      const beautified = readFileSync(join(dir, 'c.js'), 'utf-8');
      assert.ok(beautified.includes('\n'), 'Should have newlines');
      assert.ok(beautified.includes('foo'), 'Function name preserved');
    });

    it('compact → beautify round-trip preserves semantics', async () => {
      const dir = join(TEST_DIR, 'roundtrip');
      mkdirSync(dir, { recursive: true });
      const source = `export function add(a, b) {
  return a + b;
}

export function mul(x, y) {
  return x * y;
}
`;
      writeFileSync(join(dir, 'math.js'), source, 'utf-8');

      await compactProject(dir);
      const compacted = readFileSync(join(dir, 'math.js'), 'utf-8');
      assert.ok(compacted.includes('add'));
      assert.ok(compacted.includes('mul'));

      await expandProject(dir);
      const beautified = readFileSync(join(dir, 'math.js'), 'utf-8');
      assert.ok(beautified.includes('function add'));
      assert.ok(beautified.includes('function mul'));
      assert.ok(beautified.includes('return a + b'));
    });
  });

  // ============================
  // CTX Parsing
  // ============================

  describe('parseCtxFile()', () => {

    it('should parse file header', () => {
      const ctx = '--- src/utils.js ---\n@sig abc123';
      const result = parseCtxFile(ctx);
      assert.strictEqual(result.file, 'src/utils.js');
    });

    it('should parse exported function signatures', () => {
      const ctx = 'export setRoots(roots)→console.error|set workspace root';
      const result = parseCtxFile(ctx);
      assert.strictEqual(result.functions.length, 1);
      assert.strictEqual(result.functions[0].name, 'setRoots');
      assert.strictEqual(result.functions[0].params, 'roots');
      assert.strictEqual(result.functions[0].exported, true);
      assert.strictEqual(result.functions[0].description, 'set workspace root');
    });

    it('should parse private functions', () => {
      const ctx = 'helperFn(a,b)→calc|internal helper';
      const result = parseCtxFile(ctx);
      assert.strictEqual(result.functions[0].exported, false);
    });

    it('should skip {DESCRIBE} markers', () => {
      const ctx = 'export foo()→bar|{DESCRIBE}';
      const result = parseCtxFile(ctx);
      assert.strictEqual(result.functions[0].description, '');
    });

    it('should parse typed params', () => {
      const ctx = 'export parse(filePath:string,options:Object=)→ast|parse source file';
      const result = parseCtxFile(ctx);
      assert.strictEqual(result.functions[0].params, 'filePath:string,options:Object=');
    });
  });

  // ============================
  // JSDoc Injection
  // ============================

  describe('injectJSDoc()', () => {

    it('should inject JSDoc from .ctx file', () => {
      const dir = join(TEST_DIR, 'inject1');
      mkdirSync(join(dir, 'src'), { recursive: true });
      mkdirSync(join(dir, '.context', 'src'), { recursive: true });

      writeFileSync(join(dir, 'src', 'util.js'), `export function greet(name) {
  return "Hello " + name;
}
`, 'utf-8');

      writeFileSync(join(dir, '.context', 'src', 'util.ctx'), `--- src/util.js ---
@sig abc123
export greet(name:string)→String.concat|generate greeting message
`, 'utf-8');

      const result = injectJSDoc(dir);

      assert.strictEqual(result.injected, 1);
      const source = readFileSync(join(dir, 'src', 'util.js'), 'utf-8');
      assert.ok(source.includes('/**'), 'JSDoc block injected');
      assert.ok(source.includes('generate greeting message'));
      assert.ok(source.includes('@param'));
    });

    it('should not duplicate JSDoc on re-run', () => {
      const dir = join(TEST_DIR, 'inject2');
      mkdirSync(join(dir, 'src'), { recursive: true });
      mkdirSync(join(dir, '.context', 'src'), { recursive: true });

      writeFileSync(join(dir, 'src', 'util.js'), `/**
 * already documented
 * @param {string} name
 */
export function greet(name) {
  return "Hello " + name;
}
`, 'utf-8');

      writeFileSync(join(dir, '.context', 'src', 'util.ctx'), `--- src/util.js ---
export greet(name:string)|generate greeting
`, 'utf-8');

      const result = injectJSDoc(dir);

      assert.strictEqual(result.injected, 0, 'Should not inject duplicates');
    });

    it('should skip when no .ctx file exists', () => {
      const dir = join(TEST_DIR, 'inject3');
      mkdirSync(join(dir, 'src'), { recursive: true });
      writeFileSync(join(dir, 'src', 'orphan.js'), 'function lonely() {}\n', 'utf-8');

      const result = injectJSDoc(dir);

      assert.strictEqual(result.skipped, 1);
      assert.strictEqual(result.injected, 0);
    });
  });

  // ============================
  // JSDoc Stripping
  // ============================

  describe('stripJSDoc()', () => {

    it('should remove JSDoc blocks', () => {
      const dir = join(TEST_DIR, 'strip1');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'doc.js'), `/**
 * JSDoc block
 * @param {string} name
 */
function foo(name) {}
`, 'utf-8');

      const result = stripJSDoc(dir);

      assert.strictEqual(result.stripped, 1);
      assert.ok(result.savedBytes > 0);
      const source = readFileSync(join(dir, 'doc.js'), 'utf-8');
      assert.ok(!source.includes('/**'), 'JSDoc removed');
      assert.ok(source.includes('function foo'), 'Code preserved');
    });

    it('should preserve JSDoc-like content inside strings', () => {
      const dir = join(TEST_DIR, 'strip2');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'safe.js'), `const msg = "/** this is not a comment */";
function bar() {}
`, 'utf-8');

      const result = stripJSDoc(dir);

      const source = readFileSync(join(dir, 'safe.js'), 'utf-8');
      assert.ok(source.includes('/** this is not a comment */'), 'String content preserved');
    });

    it('should not modify files without JSDoc', () => {
      const dir = join(TEST_DIR, 'strip3');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'clean.js'), 'function clean() {}\n', 'utf-8');

      const result = stripJSDoc(dir);

      assert.strictEqual(result.stripped, 0);
    });

    it('dry run should not modify files', () => {
      const dir = join(TEST_DIR, 'strip4');
      mkdirSync(dir, { recursive: true });
      const original = '/** JSDoc */ function foo() {}\n';
      writeFileSync(join(dir, 'dr.js'), original, 'utf-8');

      const result = stripJSDoc(dir, { dryRun: true });

      assert.strictEqual(result.dryRun, true);
      assert.strictEqual(readFileSync(join(dir, 'dr.js'), 'utf-8'), original);
    });
  });

});
