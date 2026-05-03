import { mkdirSync, writeFileSync, rmSync } from "fs";

import { join, dirname } from "path";

export const FIXTURE_FILES = {
  "package.json": JSON.stringify({
    name: "test-consumer",
    version: "1.0.0",
    type: "module"
  }),
  "src/math.js": `/**\n * Add two numbers.\n * @param {number} a\n * @param {number} b\n * @returns {number}\n */\nexport function add(a, b) {\n  return a + b;\n}\n\nexport function multiply(x, y) {\n  return x * y;\n}\n\nfunction _clamp(v, min, max) {\n  return Math.min(Math.max(v, min), max);\n}\n\nexport const PI = 3.14159;\n`,
  "src/utils.js": `import { add } from './math.js';\n\n/**\n * Format a number with a prefix.\n * @param {number} n\n * @param {string} prefix\n * @returns {string}\n */\nexport function format(n, prefix = '$') {\n  return prefix + n.toFixed(2);\n}\n\nexport async function fetchData(url, options = {}) {\n  const res = await fetch(url, options);\n  return res.json();\n}\n\nexport function sum(...numbers) {\n  return numbers.reduce((acc, n) => add(acc, n), 0);\n}\n`,
  "src/models.js": `export class Animal {\n  constructor(name) {\n    this.name = name;\n  }\n  speak() {\n    return this.name + ' speaks';\n  }\n  static create(name) {\n    return new Animal(name);\n  }\n}\n\nexport class Dog extends Animal {\n  speak() {\n    return this.name + ' barks';\n  }\n  fetch(item) {\n    return this.name + ' fetches ' + item;\n  }\n}\n`,
  "src/config.js": `export const defaults = {\n  port: 3000,\n  host: 'localhost',\n  debug: false,\n};\nexport function mergeConfig(user) {\n  return { ...defaults, ...user };\n}\n`,
  "src/unused.js": `export function neverCalled() {\n  return 'dead code';\n}\nfunction alsoUnused() {}\n`,
  "schema.sql": `CREATE TABLE users (\n  id SERIAL PRIMARY KEY,\n  name VARCHAR(100) NOT NULL,\n  email VARCHAR(255) UNIQUE\n);\nCREATE TABLE posts (\n  id SERIAL PRIMARY KEY,\n  user_id INT REFERENCES users(id),\n  title VARCHAR(200),\n  body TEXT\n);\n`,
  "src/editable.js": `export function greet(name) {\n  return 'Hello ' + name;\n}\nexport function farewell(name) {\n  return 'Bye ' + name;\n}\n`
};

export const EXPORTED_FUNCTIONS = [ "add", "multiply", "format", "fetchData", "sum", "mergeConfig", "neverCalled" ];

export const EXPORTED_CLASSES = [ "Animal", "Dog" ];

export const ALL_SYMBOLS = [ ...EXPORTED_FUNCTIONS, ...EXPORTED_CLASSES ];

export const SQL_TABLES = [ "users", "posts" ];

export function scaffold(root) {
  rmSync(root, {
    recursive: true,
    force: true
  });
  for (const [rel, content] of Object.entries(FIXTURE_FILES)) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), {
      recursive: true
    });
    writeFileSync(abs, content, "utf-8");
  }
}

export function cleanup(root) {
  rmSync(root, {
    recursive: true,
    force: true
  });
}
