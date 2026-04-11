import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';

const CONFIG_FILE = '.context/config.json';

const DEFAULTS = {
  mode: 2,
  beautify: true,
  autoValidate: false,
  stripJSDoc: false,
};

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
  if (![1, 2, 3, 4].includes(merged.mode)) {
    throw new Error(`Invalid mode: ${merged.mode}. Valid: 1 (compact), 2 (full), 3 (IDE), 4 (compact+cache)`);
  }

  writeFileSync(configPath, JSON.stringify(merged, null, 2) + '\n', 'utf-8');

  return {
    saved: true,
    path: configPath,
    config: merged,
  };
}

export function getModeDescription(mode) {
  switch (mode) {
    case 1: return 'Native Compact — code stored minified, agent edits directly';
    case 2: return 'Full Storage — code stored formatted, agent uses get_compressed_file + edit_compressed';
    case 3: return 'IDE Virtual — compact storage with IDE virtual display (future)';
    case 4: return 'Compact + Cache — code stored minified, .full/ cache for tooling (ESLint/tsc)';
    default: return `Unknown mode: ${mode}`;
  }
}

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
    case 4:
      return {
        read: 'Read .js files directly (compact) for token efficiency',
        edit: 'Use edit_compressed(path, symbol, code) → auto-regenerate .full/',
        docs: 'Read .ctx files; JSDoc auto-injected into .full/ via decompile',
        validate: 'Run validate_pipeline → contracts + decompile + AST verify',
        decompile: 'Run decompile_project to regenerate .full/ from compact + .ctx',
      };
    default:
      return { read: 'N/A', edit: 'N/A', docs: 'N/A', validate: 'N/A' };
  }
}
