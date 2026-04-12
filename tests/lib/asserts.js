/**
 * Reusable assertion helpers for integration tests.
 */
import assert from 'node:assert/strict';

/** Assert value is a number >= 0 */
export function assertNum(val, label) {
  assert.strictEqual(typeof val, 'number', `${label}: expected number, got ${typeof val}`);
  assert.ok(val >= 0, `${label}: expected >= 0, got ${val}`);
}

/** Assert value is a non-empty string */
export function assertStr(val, label) {
  assert.strictEqual(typeof val, 'string', `${label}: expected string, got ${typeof val}`);
  assert.ok(val.length > 0, `${label}: expected non-empty string`);
}

/** Assert value is a plain object */
export function assertObj(val, label) {
  assert.strictEqual(typeof val, 'object', `${label}: expected object`);
  assert.ok(val !== null, `${label}: expected non-null object`);
}

/** Assert value is a non-empty array */
export function assertArr(val, label) {
  assert.ok(Array.isArray(val), `${label}: expected array, got ${typeof val}`);
}

/** Assert value is in a given set */
export function assertOneOf(val, options, label) {
  assert.ok(options.includes(val), `${label}: "${val}" not in [${options}]`);
}

/** Assert score is 0..100 */
export function assertScore(val, label) {
  assertNum(val, label);
  assert.ok(val >= 0 && val <= 100, `${label}: score ${val} out of [0,100]`);
}
