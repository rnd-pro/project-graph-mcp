/**
 * Framework Reference System
 * Loads framework-specific AI references for agent context
 */

import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, basename, dirname } from 'path';
import { fileURLToPath } from 'url';
import { detectProjectRuleSets } from './custom-rules.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REFERENCES_DIR = join(__dirname, '..', 'references');

/**
 * Reference metadata extracted from filename convention
 * @typedef {Object} ReferenceInfo
 * @property {string} name - Reference name (e.g., 'symbiote-3x')
 * @property {string} file - Full path to reference file
 * @property {number} lines - Number of lines
 */

/**
 * List available framework references
 * @returns {ReferenceInfo[]}
 */
function listReferences() {
  if (!existsSync(REFERENCES_DIR)) return [];

  return readdirSync(REFERENCES_DIR)
    .filter(f => f.endsWith('.md'))
    .map(f => {
      const filePath = join(REFERENCES_DIR, f);
      const content = readFileSync(filePath, 'utf-8');
      const lines = content.split('\n').length;
      return {
        name: basename(f, '.md'),
        file: filePath,
        lines,
      };
    });
}

/**
 * Map ruleset names to reference names
 * Allows auto-detection to find the right reference
 */
const RULESET_TO_REFERENCE = {
  'symbiote-3x': 'symbiote-3x',
  'symbiote-2x': 'symbiote-3x', // migration: suggest 3.x reference for 2.x projects too
};

/**
 * Get framework reference content
 * @param {Object} options
 * @param {string} [options.framework] - Explicit framework name (e.g., 'symbiote-3x')
 * @param {string} [options.path] - Project path for auto-detection
 * @returns {{content: string, framework: string, detected?: Object} | {error: string, available: string[]}}
 */
export function getFrameworkReference(options = {}) {
  const available = listReferences();
  const availableNames = available.map(r => r.name);

  // Explicit framework requested
  if (options.framework) {
    const ref = available.find(r => r.name === options.framework);
    if (!ref) {
      return {
        error: `Framework reference '${options.framework}' not found`,
        available: availableNames,
      };
    }
    return {
      framework: ref.name,
      lines: ref.lines,
      content: readFileSync(ref.file, 'utf-8'),
    };
  }

  // Auto-detect from project path
  if (options.path) {
    const { detected, reasons } = detectProjectRuleSets(options.path);

    // Find matching references
    const matchedRefs = [];
    for (const ruleset of detected) {
      const refName = RULESET_TO_REFERENCE[ruleset];
      if (refName && availableNames.includes(refName) && !matchedRefs.includes(refName)) {
        matchedRefs.push(refName);
      }
    }

    if (matchedRefs.length === 0) {
      return {
        error: 'No framework references found for this project',
        detected,
        reasons,
        available: availableNames,
      };
    }

    // Return all matched references concatenated
    const contents = matchedRefs.map(name => {
      const ref = available.find(r => r.name === name);
      return readFileSync(ref.file, 'utf-8');
    });

    return {
      frameworks: matchedRefs,
      detected: { rulesets: detected, reasons },
      lines: contents.reduce((sum, c) => sum + c.split('\n').length, 0),
      content: contents.join('\n\n---\n\n'),
    };
  }

  // No framework specified, no path — list available
  return {
    error: 'Specify framework name or path for auto-detection',
    available: available.map(r => ({ name: r.name, lines: r.lines })),
  };
}
