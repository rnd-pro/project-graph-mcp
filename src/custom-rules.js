/**
 * Custom Rules System
 * Configurable code analysis rules with JSON storage
 */

import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'fs';
import { join, relative, dirname } from 'path';
import { fileURLToPath } from 'url';
import { shouldExcludeDir, shouldExcludeFile, parseGitignore } from './filters.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RULES_DIR = join(__dirname, '..', 'rules');

/**
 * @typedef {Object} Rule
 * @property {string} id
 * @property {string} name
 * @property {string} description
 * @property {string} pattern - String or regex pattern to search
 * @property {string} patternType - 'string' | 'regex'
 * @property {string} replacement - Suggested fix
 * @property {string} severity - 'error' | 'warning' | 'info'
 * @property {string} filePattern - Glob pattern for files
 * @property {string[]} [exclude] - Patterns to exclude
 */

/**
 * @typedef {Object} RuleSet
 * @property {string} name
 * @property {string} description
 * @property {Rule[]} rules
 */

/**
 * @typedef {Object} Violation
 * @property {string} ruleId
 * @property {string} ruleName
 * @property {string} severity
 * @property {string} file
 * @property {number} line
 * @property {string} match
 * @property {string} replacement
 */

/**
 * Load rule sets from rules directory
 * @returns {Object<string, RuleSet>}
 */
function loadRuleSets() {
  const ruleSets = {};

  if (!existsSync(RULES_DIR)) return ruleSets;

  for (const file of readdirSync(RULES_DIR)) {
    if (!file.endsWith('.json')) continue;
    try {
      const content = readFileSync(join(RULES_DIR, file), 'utf-8');
      const ruleSet = JSON.parse(content);
      ruleSets[ruleSet.name] = ruleSet;
    } catch (e) { }
  }

  return ruleSets;
}

/**
 * Save rule set to file
 * @param {RuleSet} ruleSet 
 */
function saveRuleSet(ruleSet) {
  const filePath = join(RULES_DIR, `${ruleSet.name}.json`);
  writeFileSync(filePath, JSON.stringify(ruleSet, null, 2));
}

/**
 * Find all files matching pattern
 * @param {string} dir 
 * @param {string} filePattern 
 * @param {string} rootDir 
 * @returns {string[]}
 */
function findFiles(dir, filePattern, rootDir = dir) {
  if (dir === rootDir) parseGitignore(rootDir);
  const files = [];
  const ext = filePattern.replace('*', '');

  try {
    for (const entry of readdirSync(dir)) {
      const fullPath = join(dir, entry);
      const relativePath = relative(rootDir, fullPath);
      const stat = statSync(fullPath);

      if (stat.isDirectory()) {
        if (!shouldExcludeDir(entry, relativePath)) {
          files.push(...findFiles(fullPath, filePattern, rootDir));
        }
      } else if (entry.endsWith(ext)) {
        if (!shouldExcludeFile(entry, relativePath)) {
          files.push(fullPath);
        }
      }
    }
  } catch (e) { }

  return files;
}

/**
 * Check if file matches exclude patterns
 * @param {string} filePath 
 * @param {string[]} excludePatterns 
 * @returns {boolean}
 */
function isExcluded(filePath, excludePatterns = []) {
  for (const pattern of excludePatterns) {
    const ext = pattern.replace('*', '');
    if (filePath.endsWith(ext)) return true;
  }
  return false;
}

/**
 * Check file against rule
 * @param {string} filePath 
 * @param {Rule} rule 
 * @returns {Violation[]}
 */
function checkFileAgainstRule(filePath, rule) {
  if (isExcluded(filePath, rule.exclude)) return [];

  const violations = [];
  const content = readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const relPath = relative(process.cwd(), filePath);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let matches = false;
    let matchText = '';

    if (rule.patternType === 'regex') {
      try {
        const regex = new RegExp(rule.pattern);
        const match = line.match(regex);
        if (match) {
          matches = true;
          matchText = match[0];
        }
      } catch (e) { }
    } else {
      if (line.includes(rule.pattern)) {
        matches = true;
        matchText = rule.pattern;
      }
    }

    if (matches) {
      violations.push({
        ruleId: rule.id,
        ruleName: rule.name,
        severity: rule.severity,
        file: relPath,
        line: i + 1,
        match: matchText,
        replacement: rule.replacement,
      });
    }
  }

  return violations;
}

/**
 * Get all available custom rules
 * @returns {Promise<{ruleSets: Object, totalRules: number}>}
 */
export async function getCustomRules() {
  const ruleSets = loadRuleSets();
  let totalRules = 0;

  const summary = {};
  for (const [name, ruleSet] of Object.entries(ruleSets)) {
    summary[name] = {
      description: ruleSet.description,
      ruleCount: ruleSet.rules.length,
      rules: ruleSet.rules.map(r => ({
        id: r.id,
        name: r.name,
        severity: r.severity,
      })),
    };
    totalRules += ruleSet.rules.length;
  }

  return { ruleSets: summary, totalRules };
}

/**
 * Add or update a custom rule
 * @param {string} ruleSetName 
 * @param {Rule} rule 
 * @returns {Promise<{success: boolean, message: string}>}
 */
export async function setCustomRule(ruleSetName, rule) {
  const ruleSets = loadRuleSets();

  // Create new ruleset if doesn't exist
  if (!ruleSets[ruleSetName]) {
    ruleSets[ruleSetName] = {
      name: ruleSetName,
      description: `Custom rules for ${ruleSetName}`,
      rules: [],
    };
  }

  const ruleSet = ruleSets[ruleSetName];
  const existingIndex = ruleSet.rules.findIndex(r => r.id === rule.id);

  if (existingIndex >= 0) {
    ruleSet.rules[existingIndex] = rule;
  } else {
    ruleSet.rules.push(rule);
  }

  saveRuleSet(ruleSet);

  return {
    success: true,
    message: existingIndex >= 0
      ? `Updated rule "${rule.id}" in ${ruleSetName}`
      : `Added rule "${rule.id}" to ${ruleSetName}`,
  };
}

/**
 * Delete a custom rule
 * @param {string} ruleSetName 
 * @param {string} ruleId 
 * @returns {Promise<{success: boolean, message: string}>}
 */
export async function deleteCustomRule(ruleSetName, ruleId) {
  const ruleSets = loadRuleSets();

  if (!ruleSets[ruleSetName]) {
    return { success: false, message: `Ruleset "${ruleSetName}" not found` };
  }

  const ruleSet = ruleSets[ruleSetName];
  const index = ruleSet.rules.findIndex(r => r.id === ruleId);

  if (index < 0) {
    return { success: false, message: `Rule "${ruleId}" not found` };
  }

  ruleSet.rules.splice(index, 1);
  saveRuleSet(ruleSet);

  return { success: true, message: `Deleted rule "${ruleId}" from ${ruleSetName}` };
}

/**
 * Detect which rulesets apply to a project
 * @param {string} dir 
 * @returns {{detected: string[], reasons: Object<string, string>}}
 */
function detectProjectRuleSets(dir) {
  const ruleSets = loadRuleSets();
  const detected = [];
  const reasons = {};

  // Check package.json
  let packageDeps = [];
  try {
    const pkgPath = join(dir, 'package.json');
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      packageDeps = [
        ...Object.keys(pkg.dependencies || {}),
        ...Object.keys(pkg.devDependencies || {}),
      ];
    }
  } catch (e) { }

  for (const [name, ruleSet] of Object.entries(ruleSets)) {
    if (!ruleSet.detect) continue;
    const detect = ruleSet.detect;

    // Check packageJson deps
    if (detect.packageJson) {
      for (const dep of detect.packageJson) {
        if (packageDeps.includes(dep)) {
          detected.push(name);
          reasons[name] = `Found "${dep}" in package.json`;
          break;
        }
      }
    }

    // Skip further checks if already detected
    if (detected.includes(name)) continue;

    // Check for import patterns in source files
    if (detect.imports || detect.patterns) {
      const jsFiles = findFiles(dir, '*.js');

      fileLoop:
      for (const file of jsFiles.slice(0, 50)) { // Limit for performance
        try {
          const content = readFileSync(file, 'utf-8');

          if (detect.imports) {
            for (const pattern of detect.imports) {
              if (content.includes(pattern)) {
                detected.push(name);
                reasons[name] = `Found "${pattern}" in ${relative(dir, file)}`;
                break fileLoop;
              }
            }
          }

          if (detect.patterns) {
            for (const pattern of detect.patterns) {
              if (content.includes(pattern)) {
                detected.push(name);
                reasons[name] = `Found "${pattern}" in ${relative(dir, file)}`;
                break fileLoop;
              }
            }
          }
        } catch (e) { }
      }
    }
  }

  return { detected, reasons };
}

/**
 * Check directory against custom rules
 * @param {string} dir 
 * @param {Object} [options]
 * @param {string} [options.ruleSet] - Specific ruleset to use
 * @param {string} [options.severity] - Filter by severity
 * @param {boolean} [options.autoDetect] - Auto-detect applicable rulesets
 * @returns {Promise<{total: number, bySeverity: Object, byRule: Object, violations: Violation[], detected?: Object}>}
 */
export async function checkCustomRules(dir, options = {}) {
  const ruleSets = loadRuleSets();
  let allRules = [];
  let detectionResult = null;

  // Collect rules
  if (options.ruleSet) {
    if (ruleSets[options.ruleSet]) {
      allRules = ruleSets[options.ruleSet].rules;
    }
  } else if (options.autoDetect !== false) {
    // Auto-detect by default
    detectionResult = detectProjectRuleSets(dir);

    if (detectionResult.detected.length > 0) {
      for (const name of detectionResult.detected) {
        if (ruleSets[name]) {
          allRules.push(...ruleSets[name].rules);
        }
      }
    } else {
      // No detection, use all rules
      for (const ruleSet of Object.values(ruleSets)) {
        allRules.push(...ruleSet.rules);
      }
    }
  } else {
    for (const ruleSet of Object.values(ruleSets)) {
      allRules.push(...ruleSet.rules);
    }
  }

  // Group rules by file pattern
  const rulesByPattern = {};
  for (const rule of allRules) {
    const pattern = rule.filePattern || '*.js';
    if (!rulesByPattern[pattern]) rulesByPattern[pattern] = [];
    rulesByPattern[pattern].push(rule);
  }

  // Find and check files
  const allViolations = [];

  for (const [pattern, rules] of Object.entries(rulesByPattern)) {
    const files = findFiles(dir, pattern);

    for (const file of files) {
      for (const rule of rules) {
        const violations = checkFileAgainstRule(file, rule);
        allViolations.push(...violations);
      }
    }
  }

  // Filter by severity if specified
  let filtered = allViolations;
  if (options.severity) {
    filtered = allViolations.filter(v => v.severity === options.severity);
  }

  // Sort by severity, then file
  const severityOrder = { error: 0, warning: 1, info: 2 };
  filtered.sort((a, b) => {
    const sevDiff = severityOrder[a.severity] - severityOrder[b.severity];
    if (sevDiff !== 0) return sevDiff;
    return a.file.localeCompare(b.file);
  });

  // Calculate stats
  const bySeverity = {
    error: filtered.filter(v => v.severity === 'error').length,
    warning: filtered.filter(v => v.severity === 'warning').length,
    info: filtered.filter(v => v.severity === 'info').length,
  };

  const byRule = {};
  for (const v of filtered) {
    byRule[v.ruleId] = (byRule[v.ruleId] || 0) + 1;
  }

  return {
    total: filtered.length,
    bySeverity,
    byRule,
    violations: filtered.slice(0, 50),
    ...(detectionResult && { detected: detectionResult }),
  };
}
