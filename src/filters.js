import { readFileSync, existsSync } from 'fs';
import { join, relative } from 'path';

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

const DEFAULT_EXCLUDE_PATTERNS = [
  '*.test.js',
  '*.spec.js',
  '*.min.js',
  '*.bundle.js',
  '*.d.ts',
  '.project-graph-cache.json',
];

// Current filter configuration (mutable via MCP)
let config = {
  excludeDirs: [...DEFAULT_EXCLUDES],
  excludePatterns: [...DEFAULT_EXCLUDE_PATTERNS],
  includeHidden: false,
  useGitignore: true,
  gitignorePatterns: [],
};

export function getFilters() {
  return { ...config };
}

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

export function addExcludes(dirs) {
  config.excludeDirs = [...new Set([...config.excludeDirs, ...dirs])];
  return getFilters();
}

export function removeExcludes(dirs) {
  config.excludeDirs = config.excludeDirs.filter(d => !dirs.includes(d));
  return getFilters();
}

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

function matchWildcard(pattern, str) {
  const regex = pattern
    .replace(/\./g, '\\.')
    .replace(/\*/g, '.*');
  return new RegExp(`^${regex}$`).test(str);
}

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
