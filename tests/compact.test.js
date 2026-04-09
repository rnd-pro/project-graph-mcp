import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { compactProject, expandProject } from '../src/compact.js';
import { editCompressed } from '../src/compress.js';
import { parseCtxFile, injectJSDoc, stripJSDoc, validateCtxContracts } from '../src/ctx-to-jsdoc.js';
import { parseFile } from '../src/parser.js';
import { getConfig, setConfig, getModeWorkflow } from '../src/mode-config.js';

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

    it('should extract JSDoc types into params', async () => {
      const code = `/**
 * @param {string} name
 * @param {Object} [options]
 */
function greet(name, options = {}) {}`;
      const result = await parseFile(code, 'test.js');
      assert.deepStrictEqual(result.functions[0].params, ['name:string', 'options:Object=']);
    });

    it('should extract @returns type', async () => {
      const code = `/**
 * @param {string} x
 * @returns {Promise<string>}
 */
function fetch(x) {}`;
      const result = await parseFile(code, 'test.js');
      assert.strictEqual(result.functions[0].returns, 'Promise<string>');
    });

    it('should handle rest param with JSDoc type', async () => {
      const code = `/**
 * @param {...number} args
 */
function sum(...args) {}`;
      const result = await parseFile(code, 'test.js');
      assert.deepStrictEqual(result.functions[0].params, ['...args:number']);
    });

    it('should leave params untyped when no JSDoc exists', async () => {
      const code = 'function plain(a, b) {}';
      const result = await parseFile(code, 'test.js');
      assert.deepStrictEqual(result.functions[0].params, ['a', 'b']);
      assert.strictEqual(result.functions[0].returns, null);
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

    it('should parse return type from ctx signature', () => {
      const ctx = 'export compressFile(path:string)→Promise<CompressResult>→readFileSync,minify|compress file';
      const result = parseCtxFile(ctx);
      assert.strictEqual(result.functions[0].name, 'compressFile');
      assert.strictEqual(result.functions[0].returns, 'Promise<CompressResult>');
      assert.strictEqual(result.functions[0].description, 'compress file');
    });

    it('should handle functions without return type', () => {
      const ctx = 'processItem(item)→validate,save|process a single item';
      const result = parseCtxFile(ctx);
      assert.strictEqual(result.functions[0].returns, '');
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

  // ============================
  // CTX Contract Validator
  // ============================

  describe('validateCtxContracts()', () => {

    it('should validate matching contracts', () => {
      const dir = join(TEST_DIR, 'validate1');
      mkdirSync(join(dir, 'src'), { recursive: true });
      mkdirSync(join(dir, '.context', 'src'), { recursive: true });

      writeFileSync(join(dir, 'src', 'math.js'), `export function add(a, b) { return a + b; }
`, 'utf-8');
      writeFileSync(join(dir, '.context', 'src', 'math.ctx'), `--- src/math.js ---
@sig abc123
export add(a:number,b:number)→number|addition
`, 'utf-8');

      const result = validateCtxContracts(dir);
      assert.strictEqual(result.summary.errors, 0);
      assert.strictEqual(result.summary.warnings, 0);
    });

    it('should detect param count mismatch', () => {
      const dir = join(TEST_DIR, 'validate2');
      mkdirSync(join(dir, 'src'), { recursive: true });
      mkdirSync(join(dir, '.context', 'src'), { recursive: true });

      writeFileSync(join(dir, 'src', 'util.js'), `function process(a, b, c) {}
`, 'utf-8');
      writeFileSync(join(dir, '.context', 'src', 'util.ctx'), `--- src/util.js ---
process(a,b)|process items
`, 'utf-8');

      const result = validateCtxContracts(dir);
      assert.ok(result.summary.errors > 0);
      const error = result.violations.find(v => v.message.includes('2 params'));
      assert.ok(error, 'Should report param count mismatch');
    });

    it('should detect function missing from source', () => {
      const dir = join(TEST_DIR, 'validate3');
      mkdirSync(join(dir, 'src'), { recursive: true });
      mkdirSync(join(dir, '.context', 'src'), { recursive: true });

      writeFileSync(join(dir, 'src', 'api.js'), `function existing() {}
`, 'utf-8');
      writeFileSync(join(dir, '.context', 'src', 'api.ctx'), `--- src/api.js ---
existing()|exists
removed()|was deleted
`, 'utf-8');

      const result = validateCtxContracts(dir);
      const error = result.violations.find(v => v.message.includes('removed'));
      assert.ok(error, 'Should report missing function');
      assert.strictEqual(error.severity, 'error');
    });
  });

  // ============================
  // Edit Compressed (Mode 2)
  // ============================

  describe('editCompressed()', () => {

    it('should replace a function by symbol name', async () => {
      const dir = join(TEST_DIR, 'edit1');
      mkdirSync(dir, { recursive: true });
      const file = join(dir, 'math.js');
      writeFileSync(file, `function add(a, b) {
  return a + b;
}

function mul(x, y) {
  return x * y;
}
`, 'utf-8');

      await editCompressed(file, 'add', 'function add(a, b) { return a + b + 1; }');

      const result = readFileSync(file, 'utf-8');
      assert.ok(result.includes('a + b + 1'), 'Function body replaced');
      assert.ok(result.includes('mul'), 'Other functions preserved');
    });

    it('should replace an exported function', async () => {
      const dir = join(TEST_DIR, 'edit2');
      mkdirSync(dir, { recursive: true });
      const file = join(dir, 'api.js');
      writeFileSync(file, `export function greet(name) {
  return "Hello " + name;
}
`, 'utf-8');

      await editCompressed(file, 'greet', 'export function greet(name) { return "Hi " + name; }');

      const result = readFileSync(file, 'utf-8');
      assert.ok(result.includes('Hi'), 'Exported function replaced');
      assert.ok(result.includes('export'), 'Export keyword preserved');
    });

    it('should support dry run', async () => {
      const dir = join(TEST_DIR, 'edit3');
      mkdirSync(dir, { recursive: true });
      const file = join(dir, 'dry.js');
      const original = 'function test() { return 1; }\n';
      writeFileSync(file, original, 'utf-8');

      const result = await editCompressed(file, 'test', 'function test() { return 2; }', { dryRun: true });

      assert.strictEqual(result.dryRun, true);
      assert.strictEqual(readFileSync(file, 'utf-8'), original, 'File unchanged');
    });

    it('should throw on unknown symbol', async () => {
      const dir = join(TEST_DIR, 'edit4');
      mkdirSync(dir, { recursive: true });
      const file = join(dir, 'miss.js');
      writeFileSync(file, 'function existing() {}\n', 'utf-8');

      await assert.rejects(
        () => editCompressed(file, 'nonExistent', 'function nonExistent() {}'),
        /not found/
      );
    });
  });

  // ============================
  // Mode Configuration
  // ============================

  describe('Mode Config', () => {

    it('should return defaults when no config exists', () => {
      const dir = join(TEST_DIR, 'mode1');
      mkdirSync(dir, { recursive: true });

      const config = getConfig(dir);
      assert.strictEqual(config.mode, 2);
      assert.strictEqual(config.beautify, true);
      assert.strictEqual(config.autoValidate, false);
    });

    it('should write and read config', () => {
      const dir = join(TEST_DIR, 'mode2');
      mkdirSync(dir, { recursive: true });

      setConfig(dir, { mode: 1 });
      const config = getConfig(dir);
      assert.strictEqual(config.mode, 1);
    });

    it('should reject invalid mode', () => {
      const dir = join(TEST_DIR, 'mode3');
      mkdirSync(dir, { recursive: true });

      assert.throws(
        () => setConfig(dir, { mode: 5 }),
        /Invalid mode/
      );
    });

    it('should merge with existing config', () => {
      const dir = join(TEST_DIR, 'mode4');
      mkdirSync(dir, { recursive: true });

      setConfig(dir, { mode: 2, beautify: false });
      setConfig(dir, { autoValidate: true });

      const config = getConfig(dir);
      assert.strictEqual(config.mode, 2);
      assert.strictEqual(config.beautify, false);
      assert.strictEqual(config.autoValidate, true);
    });

    it('should return workflow recommendations', () => {
      const workflow1 = getModeWorkflow(1);
      assert.ok(workflow1.read.includes('directly'));

      const workflow2 = getModeWorkflow(2);
      assert.ok(workflow2.read.includes('get_compressed_file'));
      assert.ok(workflow2.edit.includes('edit_compressed'));
    });
  });

});
