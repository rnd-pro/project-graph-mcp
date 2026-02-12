/**
 * Custom Rules System
 * Configurable code analysis rules with JSON storage
 */

import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'fs';
import { join, relative, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { shouldExcludeDir, shouldExcludeFile, parseGitignore } from './filters.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RULES_DIR = join(__dirname, '..', 'rules');

/** @type {string[]} Patterns from .graphignore */
let graphignorePatterns = [];

/**
 * Parse .graphignore file - searches current and parent directories
 * @param {string} startDir 
 */
function parseGraphignore(startDir) {
  graphignorePatterns = [];

  // Search up the directory tree for .graphignore
  let dir = startDir;
  while (dir !== dirname(dir)) {
    const ignorePath = join(dir, '.graphignore');
    if (existsSync(ignorePath)) {
      try {
        const content = readFileSync(ignorePath, 'utf-8');
        graphignorePatterns = content
          .split('\n')
          .map(line => line.trim())
          .filter(line => line && !line.startsWith('#'));
        return;
      } catch (e) { }
    }
    dir = dirname(dir);
  }
}

/**
 * Check if file matches .graphignore patterns
 * @param {string} relativePath 
 * @returns {boolean}
 */
function isGraphignored(relativePath) {
  const basename = relativePath.split('/').pop();

  for (const pattern of graphignorePatterns) {
    // Simple glob matching
    if (pattern.endsWith('*')) {
      const prefix = pattern.slice(0, -1);
      if (relativePath.startsWith(prefix) || basename.startsWith(prefix)) return true;
    } else if (pattern.startsWith('*')) {
      const suffix = pattern.slice(1);
      if (relativePath.endsWith(suffix) || basename.endsWith(suffix)) return true;
    } else {
      // Exact match on path or basename
      if (relativePath.includes(pattern) || basename === pattern) return true;
    }
  }
  return false;
}

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
 * @property {string} [contextRequired] - HTML tag context required (e.g. '<template>')
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
  if (dir === rootDir) {
    parseGitignore(rootDir);
    parseGraphignore(rootDir);
  }
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
        if (!shouldExcludeFile(entry, relativePath) && !isGraphignored(relativePath)) {
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
 * Check if a position in a line is inside a string or comment
 * @param {string} line - The line of code
 * @param {number} matchIndex - Position of the match
 * @returns {boolean}
 */
function isInStringOrComment(line, matchIndex) {
  // Check if in single-line comment
  const commentIndex = line.indexOf('//');
  if (commentIndex !== -1 && matchIndex > commentIndex) {
    return true;
  }

  // Check if in string literal (simplified - handles most cases)
  let inString = false;
  let stringChar = null;

  for (let i = 0; i < matchIndex; i++) {
    const char = line[i];
    const prevChar = i > 0 ? line[i - 1] : '';

    if (!inString && (char === '"' || char === "'" || char === '`')) {
      inString = true;
      stringChar = char;
    } else if (inString && char === stringChar && prevChar !== '\\') {
      inString = false;
      stringChar = null;
    }
  }

  return inString;
}

/**
 * Check if a line index is within an HTML context block (e.g. <template>...</template>)
 * @param {string[]} lines - All file lines
 * @param {number} lineIndex - Current line index
 * @param {string} contextTag - Tag to check (e.g. '<template>')
 * @returns {boolean}
 */
function isWithinContext(lines, lineIndex, contextTag) {
  const openTag = contextTag;
  const tagName = openTag.replace(/[<>]/g, '');
  const closeTag = `</${tagName}>`;
  let depth = 0;

  for (let i = 0; i <= lineIndex; i++) {
    const line = lines[i];
    // Count all opens/closes on this line
    let pos = 0;
    while (pos < line.length) {
      const openIdx = line.indexOf(openTag, pos);
      const closeIdx = line.indexOf(closeTag, pos);

      if (openIdx === -1 && closeIdx === -1) break;

      if (openIdx !== -1 && (closeIdx === -1 || openIdx < closeIdx)) {
        depth++;
        pos = openIdx + openTag.length;
      } else {
        depth--;
        pos = closeIdx + closeTag.length;
      }
    }
  }

  return depth > 0;
}

/**
 * Check file against rule
 * @param {string} filePath 
 * @param {Rule} rule 
 * @returns {Violation[]}
 */
function checkFileAgainstRule(filePath, rule, rootDir) {
  if (isExcluded(filePath, rule.exclude)) return [];

  const violations = [];
  const content = readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const relPath = relative(rootDir, filePath);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let matches = false;
    let matchText = '';

    if (rule.patternType === 'regex') {
      try {
        const regex = new RegExp(rule.pattern, 'g');
        let match;
        while ((match = regex.exec(line)) !== null) {
          if (!isInStringOrComment(line, match.index)) {
            matches = true;
            matchText = match[0];
            break;
          }
        }
      } catch (e) { }
    } else {
      const matchIndex = line.indexOf(rule.pattern);
      if (matchIndex !== -1 && !isInStringOrComment(line, matchIndex)) {
        matches = true;
        matchText = rule.pattern;
      }
    }

    // Skip if context required but not within that context
    if (matches && rule.contextRequired) {
      if (!isWithinContext(lines, i, rule.contextRequired)) {
        continue;
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
  const resolvedDir = resolve(dir);
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
    }

    // Always add universal rulesets (alwaysApply: true)
    for (const [name, rs] of Object.entries(ruleSets)) {
      if (rs.alwaysApply && !detectionResult.detected.includes(name)) {
        allRules.push(...rs.rules);
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
        const violations = checkFileAgainstRule(file, rule, resolvedDir);
        allViolations.push(...violations);
      }
    }
  }

  // Deduplicate violations across rulesets (same file:line:match)
  const seen = new Set();
  const deduped = allViolations.filter(v => {
    const key = `${v.file}:${v.line}:${v.match}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Filter by severity if specified
  let filtered = deduped;
  if (options.severity) {
    filtered = deduped.filter(v => v.severity === options.severity);
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
    basePath: dir,
    total: filtered.length,
    bySeverity,
    byRule,
    violations: filtered.slice(0, 50),
    ...(detectionResult && { detected: detectionResult }),
  };
}
