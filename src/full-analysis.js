/**
 * Full Analysis - Comprehensive Code Health Report
 * Runs all analysis tools and generates a health score
 * 
 * Uses incremental caching for per-file metrics (complexity, undocumented, jsdocConsistency).
 * Cross-file metrics (dead code, similarity) always run dynamically.
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative, resolve } from 'path';
import { getDeadCode } from './dead-code.js';
import { checkUndocumentedFile } from './undocumented.js';
import { getSimilarFunctions } from './similar-functions.js';
import { analyzeComplexityFile } from './complexity.js';
import { getLargeFiles } from './large-files.js';
import { getOutdatedPatterns } from './outdated-patterns.js';
import { getTableUsage } from './db-analysis.js';
import { checkJSDocFile } from './jsdoc-checker.js';
import { readCache, writeCache, computeContentHash, isCacheValid } from './analysis-cache.js';
import { shouldExcludeDir, shouldExcludeFile, parseGitignore } from './filters.js';
import { getWorkspaceRoot } from './workspace.js';

/**
 * @typedef {Object} AnalysisResult
 * @property {Object} deadCode
 * @property {Object} undocumented
 * @property {Object} similar
 * @property {Object} complexity
 * @property {Object} largeFiles
 * @property {Object} outdated
 * @property {Object} overall
 */

/**
 * Calculate health score from analysis results
 * @param {Object} results 
 * @returns {{score: number, rating: string, topIssues: string[]}}
 */
function calculateHealthScore(results) {
  let score = 100;
  const topIssues = [];

  // Dead code penalty: -2 per item (max -20)
  const deadPenalty = Math.min(results.deadCode.total * 2, 20);
  score -= deadPenalty;
  if (results.deadCode.total > 0) {
    topIssues.push(`${results.deadCode.total} unused functions/classes`);
  }

  // Undocumented penalty: -0.5 per item (max -15)
  const undocPenalty = Math.min(results.undocumented.total * 0.5, 15);
  score -= undocPenalty;
  if (results.undocumented.total > 10) {
    topIssues.push(`${results.undocumented.total} undocumented items`);
  }

  // Similar functions penalty: -3 per pair (max -15)
  const similarPenalty = Math.min(results.similar.total * 3, 15);
  score -= similarPenalty;
  if (results.similar.total > 0) {
    topIssues.push(`${results.similar.total} similar function pairs`);
  }

  // Complexity penalty: -5 per critical, -2 per high (max -20)
  const criticalCount = results.complexity.stats?.critical || 0;
  const highCount = results.complexity.stats?.high || 0;
  const complexityPenalty = Math.min(criticalCount * 5 + highCount * 2, 20);
  score -= complexityPenalty;
  if (criticalCount > 0) {
    topIssues.push(`${criticalCount} critical complexity functions`);
  }

  // Large files penalty: -4 per critical, -1 per warning (max -10)
  const largeCritical = results.largeFiles.stats?.critical || 0;
  const largeWarning = results.largeFiles.stats?.warning || 0;
  const largePenalty = Math.min(largeCritical * 4 + largeWarning * 1, 10);
  score -= largePenalty;
  if (largeCritical > 0) {
    topIssues.push(`${largeCritical} files need splitting`);
  }

  // Outdated patterns penalty: -3 per error, -1 per warning (max -10)
  const errorPatterns = results.outdated.stats?.bySeverity?.error || 0;
  const warningPatterns = results.outdated.stats?.bySeverity?.warning || 0;
  const outdatedPenalty = Math.min(errorPatterns * 3 + warningPatterns * 1, 10);
  score -= outdatedPenalty;
  if (results.outdated.redundantDeps.length > 0) {
    topIssues.push(`${results.outdated.redundantDeps.length} redundant npm dependencies`);
  }

  // JSDoc consistency penalty: -2 per error, -1 per warning (max -15)
  if (results.jsdocConsistency) {
    const jsdocErrors = results.jsdocConsistency.errors || 0;
    const jsdocWarnings = results.jsdocConsistency.warnings || 0;
    const jsdocPenalty = Math.min(jsdocErrors * 2 + jsdocWarnings * 1, 15);
    score -= jsdocPenalty;
    if (jsdocErrors > 0) {
      topIssues.push(`${jsdocErrors} JSDoc consistency errors`);
    }
  }

  // Clamp score
  score = Math.max(0, Math.min(100, Math.round(score)));

  // Determine rating
  let rating;
  if (score >= 90) rating = 'excellent';
  else if (score >= 70) rating = 'good';
  else if (score >= 50) rating = 'warning';
  else rating = 'critical';

  return { score, rating, topIssues: topIssues.slice(0, 5) };
}

/**
 * Find all JS files in directory
 * @param {string} dir
 * @param {string} rootDir
 * @returns {string[]}
 */
function findJSFiles(dir, rootDir = dir) {
  if (dir === rootDir) parseGitignore(rootDir);
  const files = [];
  try {
    for (const entry of readdirSync(dir)) {
      const fullPath = join(dir, entry);
      const relativePath = relative(rootDir, fullPath);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        if (!shouldExcludeDir(entry, relativePath)) {
          files.push(...findJSFiles(fullPath, rootDir));
        }
      } else if (entry.endsWith('.js') && !entry.endsWith('.css.js') && !entry.endsWith('.tpl.js')) {
        if (!shouldExcludeFile(entry, relativePath)) {
          files.push(fullPath);
        }
      }
    }
  } catch (e) { /* dir not found */ }
  return files;
}

/**
 * Run cacheable per-file analyses with cache support
 * Returns aggregated complexity, undocumented, and jsdoc results
 * @param {string} dir
 * @param {string} contextDir
 * @returns {{ complexity: Object[], undocumented: Object[], jsdocIssues: Object[], cacheStats: { hits: number, misses: number } }}
 */
function runCacheableAnalyses(dir, contextDir) {
  const resolvedDir = resolve(dir);
  const wsRoot = getWorkspaceRoot();
  const files = findJSFiles(dir);
  
  const allComplexity = [];
  const allUndocumented = [];
  const allJsdocIssues = [];
  let cacheHits = 0;
  let cacheMisses = 0;

  for (const file of files) {
    const relPath = relative(resolvedDir, file);
    // Cache key: workspace-relative (src/parser.js), matches graph paths
    const cacheKey = relative(wsRoot, file);
    let code;
    try {
      code = readFileSync(file, 'utf-8');
    } catch (e) {
      continue; // File deleted between findJSFiles and read
    }
    const contentHash = computeContentHash(code);
    
    // Check cache (key: workspace-relative)
    const cached = readCache(contextDir, cacheKey);
    
    if (cached && isCacheValid(cached, cached.sig, contentHash, 'content')) {
      // Cache hit — use cached results
      cacheHits++;
      if (cached.complexity) allComplexity.push(...cached.complexity);
      if (cached.undocumented) allUndocumented.push(...cached.undocumented);
      if (cached.jsdocIssues) allJsdocIssues.push(...cached.jsdocIssues);
    } else {
      // Cache miss — compute fresh
      cacheMisses++;
      const complexity = analyzeComplexityFile(code, relPath);
      const undocumented = checkUndocumentedFile(code, relPath, 'tests');
      const jsdocIssues = checkJSDocFile(code, relPath);

      allComplexity.push(...complexity);
      allUndocumented.push(...undocumented);
      allJsdocIssues.push(...jsdocIssues);

      // Save to cache (key: workspace-relative)
      writeCache(contextDir, cacheKey, {
        sig: cached?.sig || contentHash,
        contentHash,
        complexity,
        undocumented,
        jsdocIssues,
      });
    }
  }

  return {
    complexity: allComplexity,
    undocumented: allUndocumented,
    jsdocIssues: allJsdocIssues,
    cacheStats: { hits: cacheHits, misses: cacheMisses },
  };
}

/**
 * Aggregate complexity items into summary format
 * @param {Object[]} items
 * @param {number} minComplexity
 * @returns {Object}
 */
function aggregateComplexity(items, minComplexity = 5) {
  let filtered = items.filter(i => i.complexity >= minComplexity);
  filtered.sort((a, b) => b.complexity - a.complexity);

  const stats = {
    low: filtered.filter(i => i.rating === 'low').length,
    moderate: filtered.filter(i => i.rating === 'moderate').length,
    high: filtered.filter(i => i.rating === 'high').length,
    critical: filtered.filter(i => i.rating === 'critical').length,
    average: filtered.length > 0
      ? Math.round(filtered.reduce((s, i) => s + i.complexity, 0) / filtered.length * 10) / 10
      : 0,
  };

  return { total: filtered.length, stats, items: filtered.slice(0, 30) };
}

/**
 * Aggregate undocumented items into summary format
 * @param {Object[]} items
 * @returns {Object}
 */
function aggregateUndocumented(items) {
  const byType = {
    class: items.filter(i => i.type === 'class').length,
    function: items.filter(i => i.type === 'function').length,
    method: items.filter(i => i.type === 'method').length,
  };
  return { total: items.length, byType, items: items.slice(0, 20) };
}

/**
 * Aggregate JSDoc issues into summary format
 * @param {Object[]} issues
 * @returns {{ issues: Object[], summary: Object }}
 */
function aggregateJSDoc(issues) {
  const errors = issues.filter(i => i.severity === 'error').length;
  const warnings = issues.filter(i => i.severity === 'warning').length;
  const byFile = {};
  for (const issue of issues) {
    byFile[issue.file] = (byFile[issue.file] || 0) + 1;
  }
  return { issues, summary: { total: issues.length, errors, warnings, byFile } };
}

/**
 * Run full analysis on directory
 * Uses incremental cache for per-file metrics; cross-file metrics always recompute.
 * @param {string} dir 
 * @param {Object} [options]
 * @param {boolean} [options.includeItems=false] - Include individual items
 * @returns {Promise<AnalysisResult>}
 */
export async function getFullAnalysis(dir, options = {}) {
  const includeItems = options.includeItems || false;
  const resolvedDir = resolve(dir);
  const contextDir = join(getWorkspaceRoot(), '.context');

  // Run cacheable per-file analyses (complexity, undocumented, jsdoc)
  const cached = runCacheableAnalyses(dir, contextDir);
  const complexity = aggregateComplexity(cached.complexity);
  const undocumented = aggregateUndocumented(cached.undocumented);
  const jsdocCheck = aggregateJSDoc(cached.jsdocIssues);

  // Run cross-file analyses (always dynamic — NOT cacheable per-file)
  const [deadCode, similar, largeFiles, outdated, dbUsage] = await Promise.all([
    getDeadCode(dir).catch(() => ({ total: 0, byType: {}, items: [] })),
    getSimilarFunctions(dir, { threshold: 70 }).catch(() => ({ total: 0, pairs: [] })),
    getLargeFiles(dir).catch(() => ({ total: 0, stats: {}, items: [] })),
    getOutdatedPatterns(dir).catch(() => ({ codePatterns: [], redundantDeps: [], stats: { totalPatterns: 0, bySeverity: {}, byPattern: {}, redundantDeps: 0 } })),
    getTableUsage(dir).catch(() => ({ tables: [], totalTables: 0, totalQueries: 0 })),
  ]);

  // Calculate overall health
  const overall = calculateHealthScore({
    deadCode,
    undocumented,
    similar,
    complexity,
    largeFiles,
    outdated,
    jsdocConsistency: jsdocCheck.summary,
  });

  // Build result
  const result = {
    deadCode: {
      total: deadCode.total,
      byType: deadCode.byType,
      ...(includeItems && { items: deadCode.items.slice(0, 10) }),
    },
    undocumented: {
      total: undocumented.total,
      byType: undocumented.byType,
      ...(includeItems && { items: undocumented.items.slice(0, 10) }),
    },
    similar: {
      total: similar.total,
      ...(includeItems && { pairs: similar.pairs.slice(0, 5) }),
    },
    complexity: {
      total: complexity.total,
      stats: complexity.stats,
      ...(includeItems && { items: complexity.items.slice(0, 10) }),
    },
    largeFiles: {
      total: largeFiles.total,
      stats: largeFiles.stats,
      ...(includeItems && { items: largeFiles.items.slice(0, 10) }),
    },
    outdated: {
      totalPatterns: outdated.stats.totalPatterns,
      redundantDeps: outdated.redundantDeps,
      ...(includeItems && { codePatterns: outdated.codePatterns.slice(0, 10) }),
    },
    jsdocConsistency: {
      total: jsdocCheck.summary.total,
      errors: jsdocCheck.summary.errors,
      warnings: jsdocCheck.summary.warnings,
      ...(includeItems && { issues: jsdocCheck.issues.slice(0, 10) }),
    },
    cache: cached.cacheStats,
    overall,
  };

  // Add DB metrics if any SQL interactions found (non-scoring)
  if (dbUsage.totalTables > 0) {
    result.database = {
      tablesUsed: dbUsage.totalTables,
      totalQueries: dbUsage.totalQueries,
      tables: dbUsage.tables.map(t => ({
        name: t.table,
        readers: t.totalReaders,
        writers: t.totalWriters,
      })),
    };
  }

  return result;
}
