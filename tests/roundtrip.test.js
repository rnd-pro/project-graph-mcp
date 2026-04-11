import { describe, it } from 'node:test';
import assert from 'node:assert';
import { minify } from '../vendor/terser.mjs';

/**
 * Round-trip test: original → compact → expand → verify
 * 
 * Uses the SAME Terser config as our compact pipeline (mangle: false).
 * All test functions use `export` to prevent dead-code elimination in module mode.
 */

async function compactCode(code) {
  const result = await minify(code, {
    compress: { dead_code: true, drop_console: false, passes: 1, reduce_funcs: false, inline: false },
    mangle: false,
    module: true,
    output: { beautify: false, comments: false, semicolons: true }
  });
  return result.code || '';
}

async function expandCode(code) {
  const result = await minify(code, {
    compress: false, mangle: false, module: true,
    output: { beautify: true, comments: false, indent_level: 2, semicolons: true }
  });
  return result.code || '';
}

async function roundTrip(code) {
  const compacted = await compactCode(code);
  const expanded = await expandCode(compacted);
  return { compacted, expanded };
}

/** Eval that strips ESM syntax for new Function */
function evalCode(code, expr) {
  let clean = code
    .replace(/^export\s+(default\s+)?/gm, '')
    .replace(/^import\s+.*$/gm, '');
  return new Function(`${clean}\nreturn ${expr};`)();
}

describe('Round-trip: compact ↔ expand', () => {

  // ====== FUNCTION DECLARATIONS ======

  it('regular function', async () => {
    const code = 'export function greet(name) { return "Hello " + name; }\n';
    const { compacted, expanded } = await roundTrip(code);
    assert.ok(compacted.length < code.length, 'compact smaller');
    assert.ok(expanded.includes('function greet'), 'fn name preserved');
    assert.ok(expanded.includes('name'), 'param preserved');
  });

  it('arrow function in const', async () => {
    const code = 'export const add = (a, b) => a + b;\n';
    const { expanded } = await roundTrip(code);
    assert.ok(expanded.includes('=>'), 'arrow preserved');
    assert.ok(expanded.includes('add'), 'const name preserved');
  });

  it('async function', async () => {
    const code = 'export async function fetchData(url, options = {}) {\n  const res = await fetch(url, options);\n  return res.json();\n}\n';
    const { expanded } = await roundTrip(code);
    assert.ok(expanded.includes('async'), 'async preserved');
    assert.ok(expanded.includes('await'), 'await preserved');
    assert.ok(expanded.includes('fetchData'), 'name preserved');
  });

  it('generator function', async () => {
    const code = 'export function* range(start, end) {\n  for (let i = start; i < end; i++) yield i;\n}\n';
    const { expanded } = await roundTrip(code);
    assert.ok(expanded.includes('function*') || expanded.includes('function *'), 'generator preserved');
    assert.ok(expanded.includes('yield'), 'yield preserved');
  });

  it('default params', async () => {
    const code = 'export function create(name = "default", count = 0, opts = {}) { return { name, count, opts }; }\n';
    const { expanded } = await roundTrip(code);
    assert.ok(expanded.includes('"default"'), 'default string preserved');
    assert.ok(expanded.includes('count'), 'param name preserved');
  });

  it('rest params', async () => {
    const code = 'export function log(level, ...messages) { console.log(level, ...messages); }\n';
    const { expanded } = await roundTrip(code);
    assert.ok(expanded.includes('...messages'), 'rest param preserved');
  });

  it('destructured params', async () => {
    const code = 'export function init({ host, port = 3000 }, [first, ...rest]) { return { host, port, first, rest }; }\n';
    const { expanded } = await roundTrip(code);
    assert.ok(expanded.includes('host'), 'destructured key');
    assert.ok(expanded.includes('port'), 'destructured default');
    assert.ok(expanded.includes('first'), 'array destructured');
  });

  // ====== CLASS STYLES ======

  it('ES6 class with methods', async () => {
    const code = `export class Animal {
  constructor(name) { this.name = name; }
  speak() { return this.name + " speaks"; }
  static create(name) { return new Animal(name); }
  get info() { return this.name; }
  set info(v) { this.name = v; }
}
`;
    const { expanded } = await roundTrip(code);
    assert.ok(expanded.includes('class Animal'), 'class name');
    assert.ok(expanded.includes('constructor'), 'constructor');
    assert.ok(expanded.includes('speak'), 'method');
    assert.ok(expanded.includes('static'), 'static');
    assert.ok(expanded.includes('get info'), 'getter');
    assert.ok(expanded.includes('set info'), 'setter');
  });

  it('class extends + super', async () => {
    const code = `export class Base { run() { return 1; } }
export class Child extends Base { run() { return super.run() + 1; } }
`;
    const { expanded } = await roundTrip(code);
    assert.ok(expanded.includes('extends Base'), 'extends');
    assert.ok(expanded.includes('super.run'), 'super call');
  });

  it('private fields', async () => {
    const code = `export class Counter {
  #count = 0;
  increment() { this.#count++; }
  get value() { return this.#count; }
}
`;
    const { expanded } = await roundTrip(code);
    assert.ok(expanded.includes('#count'), 'private field');
  });

  // ====== MODULE SYNTAX ======

  it('named exports', async () => {
    const code = 'export const PI = 3.14;\nexport function area(r) { return PI * r * r; }\n';
    const { expanded } = await roundTrip(code);
    assert.ok(expanded.includes('export'), 'export keyword');
    assert.ok(expanded.includes('PI'), 'const name');
    assert.ok(expanded.includes('area'), 'fn name');
  });

  it('named imports', async () => {
    const code = 'import { readFileSync, writeFileSync } from "fs";\nexport const x = readFileSync;\n';
    const { expanded } = await roundTrip(code);
    assert.ok(expanded.includes('readFileSync'), 'import preserved');
  });

  it('namespace import', async () => {
    const code = 'import * as fs from "fs";\nexport const x = fs;\n';
    const { expanded } = await roundTrip(code);
    assert.ok(expanded.includes('* as fs') || expanded.includes('fs'), 'namespace preserved');
  });

  it('dynamic import()', async () => {
    const code = 'export async function load(mod) { const m = await import(mod); return m.default; }\n';
    const { expanded } = await roundTrip(code);
    assert.ok(expanded.includes('import('), 'dynamic import preserved');
  });

  it('re-exports', async () => {
    const code = 'export { join, resolve } from "path";\n';
    const { expanded } = await roundTrip(code);
    assert.ok(expanded.includes('join'), 're-exported name');
  });

  // ====== EXPRESSIONS ======

  it('template literals', async () => {
    const code = 'export function greet(name) { return `Hello ${name}!`; }\n';
    const { expanded } = await roundTrip(code);
    assert.ok(expanded.includes('name'), 'interpolation var');
  });

  it('regex patterns', async () => {
    const code = 'export const re = /^[a-zA-Z_$][\\w$]*$/;\nexport function isValid(s) { return re.test(s); }\n';
    const { expanded } = await roundTrip(code);
    assert.ok(expanded.includes('/^[a-zA-Z'), 'regex preserved');
    assert.ok(expanded.includes('test'), 'method preserved');
  });

  it('optional chaining + nullish', async () => {
    const code = 'export function get(obj, key) { return obj?.[key] ?? null; }\n';
    const { expanded } = await roundTrip(code);
    assert.ok(expanded.includes('null'), 'null fallback');
    assert.ok(expanded.includes('get'), 'fn name');
  });

  it('tagged template', async () => {
    const code = 'export function sql(strings, ...values) { return strings.join("?"); }\nexport const q = sql`SELECT * FROM users WHERE id = ${1}`;\n';
    const { expanded } = await roundTrip(code);
    assert.ok(expanded.includes('sql'), 'tag function');
  });

  // ====== CONTROL FLOW ======

  it('try/catch/finally', async () => {
    const code = 'export function safe(fn) { try { return fn(); } catch (err) { console.error(err); } finally { console.log("done"); } }\n';
    const { expanded } = await roundTrip(code);
    assert.ok(expanded.includes('try'), 'try');
    assert.ok(expanded.includes('catch'), 'catch');
    assert.ok(expanded.includes('finally'), 'finally');
  });

  it('for...of and for...in', async () => {
    const code = 'export function iter(arr, obj) {\n  for (const x of arr) console.log(x);\n  for (const k in obj) console.log(k);\n}\n';
    const { expanded } = await roundTrip(code);
    assert.ok(expanded.includes(' of '), 'for-of');
    assert.ok(expanded.includes(' in '), 'for-in');
  });

  it('switch/case', async () => {
    const code = `export function handle(type) {
  switch (type) {
    case "a": return 1;
    case "b": return 2;
    default: return 0;
  }
}
`;
    const { expanded } = await roundTrip(code);
    assert.ok(expanded.includes('switch'), 'switch');
    assert.ok(expanded.includes('case'), 'case');
    assert.ok(expanded.includes('default'), 'default');
  });

  // ====== DATA STRUCTURES ======

  it('nested objects + arrays', async () => {
    const code = 'export const config = { a: [1, 2, { deep: true }], b: { c: "str" } };\n';
    const { expanded } = await roundTrip(code);
    assert.ok(expanded.includes('deep'), 'nested key');
    assert.ok(expanded.includes('config'), 'const name');
  });

  it('computed properties', async () => {
    const code = 'const key = "dynamic";\nexport const obj = { [key]: 42, ["lit"]: 1 };\n';
    const { expanded } = await roundTrip(code);
    assert.ok(expanded.includes('key'), 'computed reference');
  });

  it('Map and Set', async () => {
    const code = 'export const m = new Map([["a", 1]]);\nexport const s = new Set([1, 2, 3]);\n';
    const { expanded } = await roundTrip(code);
    assert.ok(expanded.includes('Map'), 'Map');
    assert.ok(expanded.includes('Set'), 'Set');
  });

  // ====== EDGE CASES ======

  it('empty export function preserved', async () => {
    const code = 'export function noop() {}\n';
    const { compacted } = await roundTrip(code);
    assert.ok(compacted.includes('noop'), 'empty fn not stripped');
  });

  it('string with escapes', async () => {
    const code = 'export const s = "line1\\nline2\\ttab";\n';
    const { expanded } = await roundTrip(code);
    assert.ok(expanded.includes('line1'), 'string content');
  });

  it('shebang handling', async () => {
    // Terser with module:true strips shebang — this documents expected behavior
    const code = '#!/usr/bin/env node\nexport const x = 1;\n';
    const compacted = await compactCode(code);
    // Our compact.js re-adds shebang separately
    assert.ok(compacted.includes('x'), 'code preserved despite shebang');
  });

  it('unicode identifiers', async () => {
    const code = 'export const café = "coffee";\n';
    const { expanded } = await roundTrip(code);
    assert.ok(expanded.includes('café'), 'unicode identifier');
  });

  // ====== SIZE GUARANTEES ======

  it('compact always smaller than formatted', async () => {
    const samples = [
      'export function longFunctionName(parameterOne, parameterTwo) {\n  // comment\n  const result = parameterOne + parameterTwo;\n  return result;\n}\n',
      '/**\n * JSDoc\n * @param {string} name\n */\nexport function documented(name) {\n  return name;\n}\n',
      'export class MyClass {\n  constructor() {\n    this.value = 0;\n  }\n  increment() {\n    this.value++;\n  }\n}\n',
    ];
    for (const code of samples) {
      const compacted = await compactCode(code);
      assert.ok(compacted.length < code.length, `compact (${compacted.length}) < original (${code.length})`);
    }
  });

  it('expand always larger than compact', async () => {
    const code = 'export function test(a,b){const c=a+b;if(c>10){return c*2}else{return c}}';
    const expanded = await expandCode(code);
    assert.ok(expanded.length > code.length, `expand (${expanded.length}) > compact (${code.length})`);
  });

  // ====== SEMANTIC EQUIVALENCE ======

  it('fibonacci equivalence', async () => {
    const code = 'export function fibonacci(n) { if (n <= 1) return n; return fibonacci(n - 1) + fibonacci(n - 2); }';
    const { expanded } = await roundTrip(code);
    assert.strictEqual(evalCode(code, 'fibonacci(10)'), evalCode(expanded, 'fibonacci(10)'), 'fibonacci(10)');
  });

  it('array transform equivalence', async () => {
    const code = 'export function transform(items) { return items.filter(x => x > 0).map(x => x * 2).reduce((sum, x) => sum + x, 0); }';
    const { expanded } = await roundTrip(code);
    assert.strictEqual(
      evalCode(code, 'transform([1, -2, 3, -4, 5])'),
      evalCode(expanded, 'transform([1, -2, 3, -4, 5])'),
      'transform result'
    );
  });

  it('class instance equivalence', async () => {
    const code = `export class Stack {
  constructor() { this.items = []; }
  push(v) { this.items.push(v); }
  pop() { return this.items.pop(); }
  get size() { return this.items.length; }
}`;
    const { expanded } = await roundTrip(code);
    assert.strictEqual(
      evalCode(code, '(() => { const s = new Stack(); s.push(1); s.push(2); s.pop(); return s.size; })()'),
      evalCode(expanded, '(() => { const s = new Stack(); s.push(1); s.push(2); s.pop(); return s.size; })()'),
      'Stack ops'
    );
  });

  it('closure equivalence', async () => {
    const code = `export function makeCounter(start) {
  let count = start;
  return { inc() { return ++count; }, get() { return count; } };
}`;
    const { expanded } = await roundTrip(code);
    assert.strictEqual(
      evalCode(code, '(() => { const c = makeCounter(5); c.inc(); c.inc(); return c.get(); })()'),
      evalCode(expanded, '(() => { const c = makeCounter(5); c.inc(); c.inc(); return c.get(); })()'),
      'closure state'
    );
  });

  it('recursive tree equivalence', async () => {
    const code = `export function treeDepth(node) {
  if (!node) return 0;
  return 1 + Math.max(treeDepth(node.left), treeDepth(node.right));
}`;
    const { expanded } = await roundTrip(code);
    const tree = '{ left: { left: { left: null, right: null }, right: null }, right: { left: null, right: null } }';
    assert.strictEqual(
      evalCode(code, `treeDepth(${tree})`),
      evalCode(expanded, `treeDepth(${tree})`),
      'tree depth'
    );
  });
});
