/**
 * Filter Configuration for Project Graph
 * Manages excludes, includes, and gitignore parsing
 */

import { readFileSync, existsSync } from 'fs';
import { join, relative } from 'path';

/**
 * Default directories to exclude
 */
const DEFAULT_EXCLUDES = [
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.next',
  '.nuxt',
  '.output',
  '__pycache__',
  '.cache',
  '.turbo',
  'out',
];

/**
 * Default file patterns to exclude
 */
const DEFAULT_EXCLUDE_PATTERNS = [
  '*.test.js',
  '*.spec.js',
  '*.min.js',
  '*.bundle.js',
  '*.d.ts',
];

// Current filter configuration (mutable via MCP)
let config = {
  excludeDirs: [...DEFAULT_EXCLUDES],
  excludePatterns: [...DEFAULT_EXCLUDE_PATTERNS],
  includeHidden: false,
  useGitignore: true,
  gitignorePatterns: [],
};

/**
 * Get current filter configuration
 * @returns {Object}
 */
export function getFilters() {
  return { ...config };
}

/**
 * Update filter configuration
 * @param {Object} updates
 * @returns {Object}
 */
export function setFilters(updates) {
  if (updates.excludeDirs !== undefined) {
    config.excludeDirs = updates.excludeDirs;
  }
  if (updates.excludePatterns !== undefined) {
    config.excludePatterns = updates.excludePatterns;
  }
  if (updates.includeHidden !== undefined) {
    config.includeHidden = updates.includeHidden;
  }
  if (updates.useGitignore !== undefined) {
    config.useGitignore = updates.useGitignore;
  }
  return getFilters();
}

/**
 * Add directories to exclude list
 * @param {string[]} dirs
 * @returns {Object}
 */
export function addExcludes(dirs) {
  config.excludeDirs = [...new Set([...config.excludeDirs, ...dirs])];
  return getFilters();
}

/**
 * Remove directories from exclude list
 * @param {string[]} dirs
 * @returns {Object}
 */
export function removeExcludes(dirs) {
  config.excludeDirs = config.excludeDirs.filter(d => !dirs.includes(d));
  return getFilters();
}

/**
 * Reset filters to defaults
 * @returns {Object}
 */
export function resetFilters() {
  config = {
    excludeDirs: [...DEFAULT_EXCLUDES],
    excludePatterns: [...DEFAULT_EXCLUDE_PATTERNS],
    includeHidden: false,
    useGitignore: true,
    gitignorePatterns: [],
  };
  return getFilters();
}

/**
 * Parse .gitignore file
 * @param {string} rootDir
 * @returns {string[]}
 */
export function parseGitignore(rootDir) {
  const gitignorePath = join(rootDir, '.gitignore');

  if (!existsSync(gitignorePath)) {
    return [];
  }

  try {
    const content = readFileSync(gitignorePath, 'utf-8');
    const patterns = content
      .split('\n')
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#'))
      .map(line => line.replace(/\/$/, '')); // Remove trailing slashes

    config.gitignorePatterns = patterns;
    return patterns;
  } catch (e) {
    return [];
  }
}

/**
 * Check if a directory should be excluded
 * @param {string} dirName - Directory name (not path)
 * @param {string} relativePath - Relative path from root
 * @returns {boolean}
 */
export function shouldExcludeDir(dirName, relativePath = '') {
  // Check hidden directories
  if (!config.includeHidden && dirName.startsWith('.')) {
    return true;
  }

  // Check default excludes
  if (config.excludeDirs.includes(dirName)) {
    return true;
  }

  // Check gitignore patterns
  if (config.useGitignore) {
    for (const pattern of config.gitignorePatterns) {
      if (matchGitignorePattern(pattern, dirName, relativePath)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Check if a file should be excluded
 * @param {string} fileName
 * @param {string} relativePath
 * @returns {boolean}
 */
export function shouldExcludeFile(fileName, relativePath = '') {
  // Check exclude patterns
  for (const pattern of config.excludePatterns) {
    if (matchWildcard(pattern, fileName)) {
      return true;
    }
  }

  // Check gitignore patterns
  if (config.useGitignore) {
    for (const pattern of config.gitignorePatterns) {
      if (matchGitignorePattern(pattern, fileName, relativePath)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Match simple wildcard pattern (*.js, *.test.js)
 * @param {string} pattern
 * @param {string} str
 * @returns {boolean}
 */
function matchWildcard(pattern, str) {
  const regex = pattern
    .replace(/\./g, '\\.')
    .replace(/\*/g, '.*');
  return new RegExp(`^${regex}$`).test(str);
}

/**
 * Match gitignore pattern
 * @param {string} pattern
 * @param {string} name
 * @param {string} relativePath
 * @returns {boolean}
 */
function matchGitignorePattern(pattern, name, relativePath) {
  // Simple matching: exact name or wildcard
  if (pattern === name) return true;

  // Pattern with wildcard
  if (pattern.includes('*')) {
    return matchWildcard(pattern, name);
  }

  // Pattern in path
  const fullPath = relativePath ? `${relativePath}/${name}` : name;
  if (fullPath.includes(pattern)) return true;

  return false;
}
