/**
 * Test Checklists — .ctx.md based
 * Reads/writes test checklists from ## Tests sections in .ctx.md files
 */

import { readFileSync, readdirSync, statSync, writeFileSync } from 'fs';
import { join, basename, relative, resolve } from 'path';

/**
 * @typedef {Object} TestStep
 * @property {string} id - Unique ID (e.g., "togglePin.0")
 * @property {string} action - What to do
 * @property {string} [expected] - Expected result (after →)
 * @property {string} status - 'pending' | 'passed' | 'failed'
 * @property {string} [failReason] - Why it failed
 */

/**
 * @typedef {Object} Feature
 * @property {string} name - Function/method name
 * @property {TestStep[]} tests - Test steps
 * @property {string} file - Source .ctx.md file path
 */

/**
 * Find all .ctx.md files in .context/ directory
 * @param {string} dir - Context directory path
 * @returns {string[]}
 */
function findCtxMdFiles(dir) {
  const files = [];
  try {
    for (const entry of readdirSync(dir)) {
      const fullPath = join(dir, entry);
      const stat = statSync(fullPath);
      if (stat.isDirectory() && !entry.startsWith('.')) {
        files.push(...findCtxMdFiles(fullPath));
      } else if (entry.endsWith('.ctx.md')) {
        files.push(fullPath);
      }
    }
  } catch (e) {
    // Directory not found
  }
  return files;
}

/**
 * Parse ## Tests section from a .ctx.md file
 * @param {string} content - File content
 * @param {string} filePath - Path to .ctx.md file
 * @returns {Feature[]}
 */
export function parseAnnotations(content, filePath) {
  const lines = content.split('\n');
  const features = [];

  // Find ## Tests section
  let inTests = false;
  let currentTests = [];

  for (const line of lines) {
    // Detect section headers
    if (line.startsWith('## ')) {
      if (inTests && currentTests.length) {
        // End of Tests section — flush
        features.push(...groupByName(currentTests, filePath));
        currentTests = [];
      }
      inTests = line.startsWith('## Tests');
      continue;
    }

    if (!inTests) continue;

    // Parse checklist lines: - [ ] name: action → expected
    // States: [ ] = pending, [x] = passed, [!] = failed
    const match = line.match(/^- \[([ x!])\] (\w+):\s*(.+)$/);
    if (!match) continue;

    const [, state, name, rest] = match;
    const parts = rest.split('→').map(s => s.trim());
    const action = parts[0];
    const expected = parts[1] || null;

    // Extract fail reason from: (FAILED: reason)
    let failReason = null;
    let status = 'pending';
    if (state === 'x') status = 'passed';
    if (state === '!') {
      status = 'failed';
      const failMatch = action.match(/\(FAILED:\s*(.+)\)$/);
      if (failMatch) failReason = failMatch[1].trim();
    }

    currentTests.push({ name, action, expected, status, failReason });
  }

  // Flush remaining
  if (inTests && currentTests.length) {
    features.push(...groupByName(currentTests, filePath));
  }

  return features;
}

/**
 * Group test steps by function name into Feature objects
 * @param {Array} tests - Raw test entries
 * @param {string} filePath - Source file
 * @returns {Feature[]}
 */
function groupByName(tests, filePath) {
  const map = {};
  let indexMap = {};

  for (const t of tests) {
    if (!map[t.name]) {
      map[t.name] = [];
      indexMap[t.name] = 0;
    }
    map[t.name].push({
      id: `${t.name}.${indexMap[t.name]++}`,
      action: t.action,
      expected: t.expected,
      status: t.status,
      failReason: t.failReason,
    });
  }

  return Object.entries(map).map(([name, tests]) => ({
    name,
    tests,
    file: filePath,
  }));
}

/**
 * Get all features from a project directory
 * @param {string} dir - Project root
 * @returns {Feature[]}
 */
export function getAllFeatures(dir) {
  const contextDir = join(resolve(dir), '.context');
  const files = findCtxMdFiles(contextDir);
  const features = [];

  for (const file of files) {
    try {
      const content = readFileSync(file, 'utf-8');
      const parsed = parseAnnotations(content, file);
      features.push(...parsed);
    } catch (e) {
      // Skip unreadable files
    }
  }

  return features;
}

/**
 * Get pending (uncompleted) tests
 * @param {string} dir - Project root
 * @returns {TestStep[]}
 */
export function getPendingTests(dir) {
  const resolvedDir = resolve(dir);
  const features = getAllFeatures(dir);
  const pending = [];

  for (const feature of features) {
    for (const test of feature.tests) {
      if (test.status === 'pending') {
        pending.push({
          ...test,
          feature: feature.name,
          file: relative(resolvedDir, feature.file),
        });
      }
    }
  }

  return pending;
}

/**
 * Mark a test as passed — writes directly to .ctx.md file
 * @param {string} testId - e.g. "togglePin.0"
 * @returns {{success: boolean, testId: string}}
 */
export function markTestPassed(testId) {
  const name = testId.split('.')[0];
  return updateTestState(name, testId, 'x');
}

/**
 * Mark a test as failed — writes directly to .ctx.md file
 * @param {string} testId - e.g. "togglePin.0"
 * @param {string} reason - Why it failed
 * @returns {{success: boolean, testId: string, reason: string}}
 */
export function markTestFailed(testId, reason) {
  const name = testId.split('.')[0];
  return updateTestState(name, testId, '!', reason);
}

/**
 * Update test state in .ctx.md files
 * @param {string} name - Function name
 * @param {string} testId - Full test ID
 * @param {string} newState - 'x' | '!' | ' '
 * @param {string} [reason] - Failure reason
 * @returns {{success: boolean, testId: string, reason?: string}}
 */
function updateTestState(name, testId, newState, reason) {
  // Need to find which .ctx.md file contains this test
  // Walk all .ctx.md files in .context/
  const cwd = process.cwd();
  const contextDir = join(cwd, '.context');
  const files = findCtxMdFiles(contextDir);
  const testIndex = parseInt(testId.split('.')[1], 10);

  for (const file of files) {
    try {
      const content = readFileSync(file, 'utf-8');
      const lines = content.split('\n');
      let inTests = false;
      let nameIndex = 0;

      for (let i = 0; i < lines.length; i++) {
        if (lines[i].startsWith('## ')) {
          inTests = lines[i].startsWith('## Tests');
          continue;
        }
        if (!inTests) continue;

        const match = lines[i].match(/^- \[([ x!])\] (\w+):\s*(.+)$/);
        if (!match) continue;
        if (match[2] !== name) continue;

        if (nameIndex === testIndex) {
          // Found the line — update it
          const desc = match[3].replace(/\s*\(FAILED:.*\)$/, '');
          const suffix = reason ? ` (FAILED: ${reason})` : '';
          lines[i] = `- [${newState}] ${name}: ${desc}${suffix}`;
          writeFileSync(file, lines.join('\n'), 'utf-8');
          return { success: true, testId, ...(reason ? { reason } : {}) };
        }
        nameIndex++;
      }
    } catch (e) {
      // Skip
    }
  }

  return { success: false, testId, error: 'Test not found' };
}

/**
 * Get test summary across all .ctx.md files
 * @param {string} dir - Project root
 * @returns {Object}
 */
export function getTestSummary(dir) {
  const features = getAllFeatures(dir);

  let total = 0;
  let passed = 0;
  let failed = 0;
  let pending = 0;
  const failures = [];

  for (const feature of features) {
    for (const test of feature.tests) {
      total++;
      if (test.status === 'passed') {
        passed++;
      } else if (test.status === 'failed') {
        failed++;
        failures.push({ id: test.id, reason: test.failReason });
      } else {
        pending++;
      }
    }
  }

  return {
    total,
    passed,
    failed,
    pending,
    progress: total > 0 ? Math.round((passed + failed) / total * 100) : 0,
    failures,
  };
}

/**
 * Reset all test states — changes [x] and [!] back to [ ] in all .ctx.md files
 * @returns {{success: boolean}}
 */
export function resetTestState() {
  const cwd = process.cwd();
  const contextDir = join(cwd, '.context');
  const files = findCtxMdFiles(contextDir);

  for (const file of files) {
    try {
      let content = readFileSync(file, 'utf-8');
      // Replace [x] and [!] with [ ] in test lines, remove FAILED reasons
      const updated = content.replace(
        /^(- )\[([x!])\] (\w+:\s*.+?)(?:\s*\(FAILED:.*\))?$/gm,
        '$1[ ] $3'
      );
      if (updated !== content) {
        writeFileSync(file, updated, 'utf-8');
      }
    } catch (e) {
      // Skip
    }
  }

  return { success: true };
}
