/**
 * Compact/Beautify — Project-wide code compression and expansion
 * 
 * Converts JS files between compact (minified, no comments) and 
 * beautified (formatted, readable) forms. Both preserve all names
 * (mangle: false) — only whitespace and comments are affected.
 * 
 * Types and documentation live in .ctx files, not in source code.
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join, extname, relative } from 'path';
import { minify } from '../vendor/terser.mjs';

const SUPPORTED = new Set(['.js', '.mjs']);
const SKIP_DIRS = new Set(['node_modules', '.git', 'vendor', '.context', 'dev-docs', '.agent', '.agents']);

/**
 * Walk directory for JS files
 * @param {string} dir
 * @param {string} rootDir
 * @returns {string[]} Absolute paths
 */
function walkJSFiles(dir, rootDir = dir) {
  const results = [];
  try {
    for (const entry of readdirSync(dir)) {
      if (entry.startsWith('.') && entry !== '.') continue;
      const full = join(dir, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        if (!SKIP_DIRS.has(entry)) {
          results.push(...walkJSFiles(full, rootDir));
        }
      } else if (SUPPORTED.has(extname(entry).toLowerCase())) {
        results.push(full);
      }
    }
  } catch { /* skip unreadable */ }
  return results;
}

/**
 * Compact a single file — minify with preserved names
 * @param {string} filePath
 * @returns {Promise<{original: number, compacted: number}>}
 */
async function compactFile(filePath) {
  const source = readFileSync(filePath, 'utf-8');
  const original = source.length;

  if (!source.trim()) return { original: 0, compacted: 0 };

  const result = await minify(source, {
    compress: {
      dead_code: true,
      drop_console: false,
      passes: 2,
    },
    mangle: false,
    module: true,
    output: {
      beautify: false,
      comments: false,
      semicolons: true,
    },
  });

  if (result.error) throw result.error;
  
  writeFileSync(filePath, result.code, 'utf-8');
  return { original, compacted: result.code.length };
}

/**
 * Beautify a single file — format with readable output
 * @param {string} filePath
 * @returns {Promise<{original: number, beautified: number}>}
 */
async function beautifyFile(filePath) {
  const source = readFileSync(filePath, 'utf-8');
  const original = source.length;

  if (!source.trim()) return { original: 0, beautified: 0 };

  const result = await minify(source, {
    compress: false,
    mangle: false,
    module: true,
    output: {
      beautify: true,
      comments: false,
      indent_level: 2,
      semicolons: true,
    },
  });

  if (result.error) throw result.error;

  writeFileSync(filePath, result.code + '\n', 'utf-8');
  return { original, beautified: result.code.length };
}

/**
 * Compact all JS files in a directory
 * @param {string} dir - Directory to compact
 * @param {Object} [options]
 * @param {boolean} [options.dryRun=false] - Preview without writing
 * @returns {Promise<{files: number, originalBytes: number, compactedBytes: number, savings: string}>}
 */
export async function compactProject(dir, options = {}) {
  const { dryRun = false } = options;
  const files = walkJSFiles(dir);
  let totalOriginal = 0;
  let totalCompacted = 0;
  const processed = [];
  const errors = [];

  for (const filePath of files) {
    const rel = relative(dir, filePath);
    try {
      const source = readFileSync(filePath, 'utf-8');
      totalOriginal += source.length;

      if (!dryRun) {
        const { compacted } = await compactFile(filePath);
        totalCompacted += compacted;
      } else {
        const result = await minify(source, {
          compress: { dead_code: true, drop_console: false, passes: 2 },
          mangle: false,
          module: true,
          output: { beautify: false, comments: false },
        });
        totalCompacted += result.code?.length || source.length;
      }

      processed.push(rel);
    } catch (e) {
      errors.push({ file: rel, error: e.message });
    }
  }

  const savings = totalOriginal > 0
    ? Math.round((1 - totalCompacted / totalOriginal) * 100)
    : 0;

  return {
    files: processed.length,
    fileList: processed,
    originalBytes: totalOriginal,
    compactedBytes: totalCompacted,
    savings: `${savings}%`,
    errors: errors.length > 0 ? errors : undefined,
    dryRun,
  };
}

/**
 * Beautify all JS files in a directory
 * @param {string} dir - Directory to beautify
 * @param {Object} [options]
 * @param {boolean} [options.dryRun=false] - Preview without writing
 * @returns {Promise<{files: number, originalBytes: number, beautifiedBytes: number}>}
 */
export async function expandProject(dir, options = {}) {
  const { dryRun = false } = options;
  const files = walkJSFiles(dir);
  let totalOriginal = 0;
  let totalBeautified = 0;
  const processed = [];
  const errors = [];

  for (const filePath of files) {
    const rel = relative(dir, filePath);
    try {
      const source = readFileSync(filePath, 'utf-8');
      totalOriginal += source.length;

      if (!dryRun) {
        const { beautified } = await beautifyFile(filePath);
        totalBeautified += beautified;
      } else {
        const result = await minify(source, {
          compress: false,
          mangle: false,
          module: true,
          output: { beautify: true, comments: false, indent_level: 2 },
        });
        totalBeautified += result.code?.length || source.length;
      }

      processed.push(rel);
    } catch (e) {
      errors.push({ file: rel, error: e.message });
    }
  }

  return {
    files: processed.length,
    fileList: processed,
    originalBytes: totalOriginal,
    beautifiedBytes: totalBeautified,
    errors: errors.length > 0 ? errors : undefined,
    dryRun,
  };
}
