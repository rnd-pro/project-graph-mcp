/**
 * Test Annotations Parser
 * Extracts @test/@expect JSDoc annotations for browser testing
 */

import { readFileSync, readdirSync, statSync, writeFileSync } from 'fs';
import { join, basename, relative } from 'path';

/**
 * @typedef {Object} TestStep
 * @property {string} id - Unique ID (e.g., "togglePin.1")
 * @property {string} type - Action type (click, key, drag, etc.)
 * @property {string} description - What to do
 * @property {boolean} completed - Whether test passed
 * @property {string} [failReason] - Why it failed (if failed)
 */

/**
 * @typedef {Object} Feature
 * @property {string} name - Method name
 * @property {string} description - What the method does
 * @property {TestStep[]} tests - Test steps
 * @property {Array<{type: string, description: string}>} expects - Expected outcomes
 * @property {string} file - Source file
 * @property {number} line - Line number
 */

// In-memory state for test progress
const testState = new Map();

/**
 * Parse @test/@expect annotations from a file
 * @param {string} content 
 * @param {string} filePath 
 * @returns {Feature[]}
 */
export function parseAnnotations(content, filePath) {
  const results = [];
  const blockRegex = /\/\*\*([^]*?)\*\//g;

  let match;
  while ((match = blockRegex.exec(content)) !== null) {
    const block = match[1];

    // Check if block has @test or @expect
    if (!block.includes('@test') && !block.includes('@expect')) continue;

    // Find method name after the block
    const afterBlock = content.slice(match.index + match[0].length);
    const methodMatch = afterBlock.match(/^\s*(?:async\s+)?(\w+)\s*\(/);
    if (!methodMatch) continue;

    const methodName = methodMatch[1];

    // Extract description (first line)
    const descMatch = block.match(/^\s*\*\s*([^@\n][^\n]*)/m);
    const description = descMatch ? descMatch[1].trim() : methodName;

    // Extract @test annotations with unique IDs
    const tests = [];
    const testRegex = /@test\s+(\w+):\s*(.+)/g;
    let testMatch;
    let testIndex = 0;
    while ((testMatch = testRegex.exec(block)) !== null) {
      tests.push({
        id: `${methodName}.${testIndex++}`,
        type: testMatch[1],
        description: testMatch[2].trim(),
        completed: false,
        failReason: null,
      });
    }

    // Extract @expect annotations
    const expects = [];
    const expectRegex = /@expect\s+(\w+):\s*(.+)/g;
    let expectMatch;
    while ((expectMatch = expectRegex.exec(block)) !== null) {
      expects.push({
        type: expectMatch[1],
        description: expectMatch[2].trim(),
      });
    }

    if (tests.length || expects.length) {
      const lineNumber = content.slice(0, match.index).split('\n').length;

      results.push({
        name: methodName,
        description,
        tests,
        expects,
        file: filePath,
        line: lineNumber,
      });
    }
  }

  return results;
}

/**
 * Find all JS files in directory
 * @param {string} dir 
 * @returns {string[]}
 */
function findJSFiles(dir) {
  const files = [];

  try {
    for (const entry of readdirSync(dir)) {
      const fullPath = join(dir, entry);
      const stat = statSync(fullPath);

      if (stat.isDirectory() && !entry.startsWith('.') && entry !== 'node_modules') {
        files.push(...findJSFiles(fullPath));
      } else if (entry.endsWith('.js') && !entry.endsWith('.css.js') && !entry.endsWith('.tpl.js')) {
        files.push(fullPath);
      }
    }
  } catch (e) {
    // Directory not found
  }

  return files;
}

/**
 * Get all features from a directory
 * @param {string} dir 
 * @returns {Feature[]}
 */
export function getAllFeatures(dir) {
  const files = findJSFiles(dir);
  const features = [];

  for (const file of files) {
    const content = readFileSync(file, 'utf-8');
    const parsed = parseAnnotations(content, file);
    features.push(...parsed);
  }

  return features;
}

/**
 * Get pending (uncompleted) tests
 * @param {string} dir 
 * @returns {TestStep[]}
 */
export function getPendingTests(dir) {
  const features = getAllFeatures(dir);
  const pending = [];

  for (const feature of features) {
    for (const test of feature.tests) {
      const state = testState.get(test.id);
      if (!state || !state.completed) {
        pending.push({
          ...test,
          feature: feature.name,
          file: relative(process.cwd(), feature.file),
        });
      }
    }
  }

  return pending;
}

/**
 * Mark a test as passed
 * @param {string} testId 
 */
export function markTestPassed(testId) {
  testState.set(testId, { completed: true, passed: true });
  return { success: true, testId };
}

/**
 * Mark a test as failed
 * @param {string} testId 
 * @param {string} reason 
 */
export function markTestFailed(testId, reason) {
  testState.set(testId, { completed: true, passed: false, reason });
  return { success: true, testId, reason };
}

/**
 * Get test summary
 * @param {string} dir 
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
      const state = testState.get(test.id);

      if (!state || !state.completed) {
        pending++;
      } else if (state.passed) {
        passed++;
      } else {
        failed++;
        failures.push({
          id: test.id,
          reason: state.reason,
        });
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
 * Reset test state
 */
export function resetTestState() {
  testState.clear();
  return { success: true };
}

/**
 * Generate markdown checklist
 * @param {Feature[]} features 
 * @returns {string}
 */
export function generateMarkdown(features) {
  const lines = [
    '# Browser Test Checklist',
    '',
    `> Auto-generated from JSDoc @test/@expect annotations`,
    `> Generated: ${new Date().toISOString().split('T')[0]}`,
    '',
  ];

  // Group by file
  const byFile = {};
  for (const feature of features) {
    const key = feature.file;
    if (!byFile[key]) byFile[key] = [];
    byFile[key].push(feature);
  }

  for (const [file, fileFeatures] of Object.entries(byFile)) {
    lines.push(`## ${basename(file, '.js')}`);
    lines.push('');

    for (const feature of fileFeatures) {
      lines.push(`### ${feature.name}()`);
      lines.push(`${feature.description}`);
      lines.push('');

      if (feature.tests.length) {
        lines.push('**Steps:**');
        for (const test of feature.tests) {
          const state = testState.get(test.id);
          const check = state?.passed ? '[x]' : '[ ]';
          lines.push(`- ${check} \`${test.type}\`: ${test.description}`);
        }
        lines.push('');
      }

      if (feature.expects.length) {
        lines.push('**Expected:**');
        for (const expect of feature.expects) {
          lines.push(`- ✅ \`${expect.type}\`: ${expect.description}`);
        }
        lines.push('');
      }
    }
  }

  return lines.join('\n');
}
