/**
 * Full Analysis - Comprehensive Code Health Report
 * Runs all analysis tools and generates a health score
 */

import { getDeadCode } from './dead-code.js';
import { getUndocumentedSummary } from './undocumented.js';
import { getSimilarFunctions } from './similar-functions.js';
import { getComplexity } from './complexity.js';
import { getLargeFiles } from './large-files.js';
import { getOutdatedPatterns } from './outdated-patterns.js';

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
 * Run full analysis on directory
 * @param {string} dir 
 * @param {Object} [options]
 * @param {boolean} [options.includeItems=false] - Include individual items
 * @returns {Promise<AnalysisResult>}
 */
export async function getFullAnalysis(dir, options = {}) {
  const includeItems = options.includeItems || false;

  // Run all analyses in parallel
  const [deadCode, undocumented, similar, complexity, largeFiles, outdated] = await Promise.all([
    getDeadCode(dir),
    getUndocumentedSummary(dir, 'tests'),
    getSimilarFunctions(dir, { threshold: 70 }),
    getComplexity(dir, { minComplexity: 5 }),
    getLargeFiles(dir),
    getOutdatedPatterns(dir),
  ]);

  // Calculate overall health
  const overall = calculateHealthScore({
    deadCode,
    undocumented,
    similar,
    complexity,
    largeFiles,
    outdated,
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
    overall,
  };

  return result;
}
