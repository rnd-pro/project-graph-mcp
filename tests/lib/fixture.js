/**
 * Test Fixture — project scaffold & cleanup
 *
 * Creates a realistic multi-file JS project in a temp directory.
 * Provides known symbols for validation.
 */
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join, dirname } from 'path';

export const FIXTURE_FILES = {
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

  'src/editable.js': `\
export function greet(name) {
  return 'Hello ' + name;
}
export function farewell(name) {
  return 'Bye ' + name;
}
`,
};

/** Exported function names that survive Terser minification */
export const EXPORTED_FUNCTIONS = [
  'add', 'multiply', 'format', 'fetchData', 'sum',
  'mergeConfig', 'neverCalled',
];

/** Exported class names */
export const EXPORTED_CLASSES = ['Animal', 'Dog'];

/** All known exported symbols */
export const ALL_SYMBOLS = [...EXPORTED_FUNCTIONS, ...EXPORTED_CLASSES];

/** SQL table names in schema.sql */
export const SQL_TABLES = ['users', 'posts'];

/**
 * Create the fixture project in the given root directory.
 * @param {string} root
 */
export function scaffold(root) {
  rmSync(root, { recursive: true, force: true });
  for (const [rel, content] of Object.entries(FIXTURE_FILES)) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content, 'utf-8');
  }
}

/**
 * Remove the fixture project.
 * @param {string} root
 */
export function cleanup(root) {
  rmSync(root, { recursive: true, force: true });
}
