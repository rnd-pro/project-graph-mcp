/**
 * Analysis Cache Manager
 * Persistent file-based cache in .context/.cache/ with dual hashing
 * 
 * - sig: interface hash (function names, params, exports) → invalidates docs
 * - contentHash: full source hash → invalidates body-dependent metrics
 * 
 * Cacheable (per-file): complexity, undocumented, jsdocConsistency
 * NOT cacheable (cross-file): deadCode, similarity
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { createHash } from 'crypto';

/**
 * @typedef {Object} CacheEntry
 * @property {string} sig - Interface hash
 * @property {string} contentHash - Full content hash
 * @property {Object} [complexity] - Cached complexity results
 * @property {Array} [undocumented] - Cached undocumented items
 * @property {Array} [jsdocIssues] - Cached JSDoc consistency issues
 * @property {string} cachedAt - ISO timestamp
 */

/**
 * Compute interface signature hash
 * Matches @sig logic from doc-dialect.js
 * @param {Object} fileData - Parsed file data with functions, classes, exports
 * @returns {string} - 8-char hex hash
 */
export function computeSig(fileData) {
  const parts = [];

  // Function signatures
  if (fileData.functions) {
    for (const fn of fileData.functions) {
      parts.push(`fn:${fn.name}:${fn.params?.length || 0}`);
    }
  }

  // Class signatures
  if (fileData.classes) {
    for (const cls of fileData.classes) {
      parts.push(`cls:${cls.name}`);
      if (cls.methods) {
        for (const m of cls.methods) {
          parts.push(`m:${cls.name}.${m}`);
        }
      }
    }
  }

  // Exports
  if (fileData.exports) {
    for (const exp of fileData.exports) {
      parts.push(`exp:${exp}`);
    }
  }

  const hash = createHash('md5').update(parts.sort().join('|')).digest('hex');
  return hash.slice(0, 8);
}

/**
 * Compute full content hash (body-inclusive)
 * Used for complexity and other body-dependent metrics
 * @param {string} code - Source code
 * @returns {string} - 8-char hex hash 
 */
export function computeContentHash(code) {
  return createHash('md5').update(code).digest('hex').slice(0, 8);
}

/**
 * Get cache file path for a source file
 * @param {string} contextDir - .context directory path
 * @param {string} relPath - Relative path to source file (e.g., "src/parser.js")
 * @returns {string} - Cache file path
 */
export function getCachePath(contextDir, relPath) {
  // src/parser.js → .context/.cache/src/parser.json
  const cacheName = relPath.replace(/\.[^.]+$/, '.json');
  return join(contextDir, '.cache', cacheName);
}

/**
 * Read cached analysis for a file
 * @param {string} contextDir
 * @param {string} relPath
 * @returns {CacheEntry|null}
 */
export function readCache(contextDir, relPath) {
  const cachePath = getCachePath(contextDir, relPath);
  try {
    if (!existsSync(cachePath)) return null;
    return JSON.parse(readFileSync(cachePath, 'utf-8'));
  } catch (e) {
    return null;
  }
}

/**
 * Write cache entry for a file
 * @param {string} contextDir
 * @param {string} relPath
 * @param {CacheEntry} data
 */
export function writeCache(contextDir, relPath, data) {
  const cachePath = getCachePath(contextDir, relPath);
  try {
    mkdirSync(dirname(cachePath), { recursive: true });
    writeFileSync(cachePath, JSON.stringify({
      ...data,
      cachedAt: new Date().toISOString(),
    }, null, 2));
  } catch (e) {
    // Cache write failure is non-fatal
  }
}

/**
 * Check if cache is still valid
 * @param {CacheEntry|null} cached
 * @param {string} currentSig - Current interface hash
 * @param {string} currentContentHash - Current content hash
 * @param {'sig'|'content'} level - Which hash to check
 * @returns {boolean}
 */
export function isCacheValid(cached, currentSig, currentContentHash, level = 'content') {
  if (!cached) return false;
  if (!cached.sig || !cached.contentHash) return false;

  if (level === 'sig') {
    return cached.sig === currentSig;
  }

  // For body-dependent metrics, both hashes must match
  return cached.sig === currentSig && cached.contentHash === currentContentHash;
}

/**
 * Invalidate all caches (e.g., after structural changes)
 * @param {string} contextDir
 */
export function invalidateAllCaches(contextDir) {
  const cacheDir = join(contextDir, '.cache');
  try {
    if (existsSync(cacheDir)) {
      rmSync(cacheDir, { recursive: true, force: true });
    }
  } catch (e) {
    // Non-fatal
  }
}
