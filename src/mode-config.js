/**
 * Compact Code Mode Configuration
 *
 * Manages project-level mode selection for the compact code architecture.
 * Reads/writes `.context/config.json` to configure how agents interact with code.
 *
 * Modes:
 *   1 = Native Compact: code stored minified, agent edits directly
 *   2 = Full Storage:   code stored formatted, agent reads compressed view, edits via edit_compressed
 *   3 = Future (IDE):   compact storage with IDE virtual display (reserved)
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';

const CONFIG_FILE = '.context/config.json';

/** Default configuration */
const DEFAULTS = {
  mode: 2,
  beautify: true,
  autoValidate: false,
  stripJSDoc: false,
};

/**
 * Read project mode configuration from .context/config.json
 * Returns defaults if file doesn't exist.
 *
 * @param {string} projectDir - Project root directory
 * @returns {{ mode: number, beautify: boolean, autoValidate: boolean, stripJSDoc: boolean }}
 */
export function getConfig(projectDir) {
  const configPath = join(projectDir, CONFIG_FILE);

  if (!existsSync(configPath)) {
    return { ...DEFAULTS };
  }

  try {
    const raw = readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(raw);
    return { ...DEFAULTS, ...parsed };
  } catch {
    return { ...DEFAULTS };
  }
}

/**
 * Write project mode configuration to .context/config.json
 *
 * @param {string} projectDir - Project root directory
 * @param {Object} config - Configuration to save (merged with existing)
 * @returns {{ saved: boolean, path: string, config: Object }}
 */
export function setConfig(projectDir, config) {
  const configPath = join(projectDir, CONFIG_FILE);
  const dir = dirname(configPath);

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  // Merge with existing
  const existing = getConfig(projectDir);
  const merged = { ...existing, ...config };

  // Validate mode
  if (![1, 2, 3].includes(merged.mode)) {
    throw new Error(`Invalid mode: ${merged.mode}. Valid: 1 (compact), 2 (full), 3 (IDE)`);
  }

  writeFileSync(configPath, JSON.stringify(merged, null, 2) + '\n', 'utf-8');

  return {
    saved: true,
    path: configPath,
    config: merged,
  };
}

/**
 * Get human-readable description of current mode
 * @param {number} mode
 * @returns {string}
 */
export function getModeDescription(mode) {
  switch (mode) {
    case 1: return 'Native Compact — code stored minified, agent edits directly';
    case 2: return 'Full Storage — code stored formatted, agent uses get_compressed_file + edit_compressed';
    case 3: return 'IDE Virtual — compact storage with IDE virtual display (future)';
    default: return `Unknown mode: ${mode}`;
  }
}

/**
 * Get recommended workflow for current mode
 * @param {number} mode
 * @returns {{ read: string, edit: string, docs: string, validate: string }}
 */
export function getModeWorkflow(mode) {
  switch (mode) {
    case 1:
      return {
        read: 'Read .js files directly (already compact)',
        edit: 'Edit .js files directly',
        docs: 'Read .ctx files for types and descriptions',
        validate: 'Run validate-ctx to check .ctx ↔ AST consistency',
      };
    case 2:
      return {
        read: 'Use get_compressed_file for token-efficient reading',
        edit: 'Use edit_compressed(path, symbol, code) for AST-safe editing',
        docs: 'Read .ctx files for types and descriptions',
        validate: 'Run validate-ctx to check .ctx ↔ AST consistency',
      };
    case 3:
      return {
        read: 'IDE renders full view from compact storage',
        edit: 'IDE handles bidirectional mapping',
        docs: 'Managed by IDE plugin',
        validate: 'Automatic via IDE integration',
      };
    default:
      return { read: 'N/A', edit: 'N/A', docs: 'N/A', validate: 'N/A' };
  }
}
