import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, extname, relative } from 'path';
import { parse } from '../vendor/acorn.mjs';
import { validateCtxContracts } from './ctx-to-jsdoc.js';
import { decompileProject } from './decompile.js';

// ────────────────────────────────────────────────────────
// Mode 4 Validation Pipeline
// ────────────────────────────────────────────────────────
// Workflow: compact edit → validate .ctx contracts → decompile → AST verify .full/ → report
//
// This is the core assurance mechanism for Mode 4 projects:
// - Agent edits compact code
// - Pipeline validates the edit didn't break contracts
// - Pipeline regenerates .full/ with JSDoc
// - Pipeline verifies .full/ is valid JS
// - Returns combined report

const SUPPORTED = new Set(['.js', '.mjs']);
const SKIP_DIRS = new Set(['node_modules', '.git', 'vendor', '.context', 'dev-docs', '.agent', '.agents', '.full', 'web']);

function walkJSFiles(dir) {
  const results = [];
  try {
    for (const entry of readdirSync(dir)) {
      if (entry.startsWith('.') && entry !== '.') continue;
      const full = join(dir, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        if (!SKIP_DIRS.has(entry)) results.push(...walkJSFiles(full));
      } else if (SUPPORTED.has(extname(entry).toLowerCase())) {
        results.push(full);
      }
    }
  } catch { /* skip */ }
  return results;
}

function estimateTokens(text) {
  return Math.ceil(text.length / 4);
}

/**
 * Run the full Mode 4 validation pipeline on a project directory.
 *
 * Steps:
 * 1. Validate .ctx contracts against compact source (param counts, export status)
 * 2. Decompile compact → .full/ with JSDoc injection
 * 3. AST-verify every .full/ file parses successfully
 * 4. Compute token savings
 *
 * @param {string} projectPath - project root directory
 * @param {object} options
 * @param {boolean} options.strict - strict contract validation
 * @param {boolean} options.skipDecompile - skip decompilation step
 * @returns {{ contracts, decompile, astVerify, tokens, summary }}
 */
export async function validatePipeline(projectPath, options = {}) {
  const { strict = false, skipDecompile = false } = options;
  const startTime = Date.now();

  // ──── Step 1: Contract validation ────
  const contracts = validateCtxContracts(projectPath, { strict });

  // ──── Step 2: Decompile compact → .full/ ────
  let decompile = null;
  if (!skipDecompile) {
    decompile = await decompileProject(projectPath);
  }

  // ──── Step 3: AST verify .full/ ────
  const fullDir = join(projectPath, '.full');
  const astVerify = { passed: 0, failed: 0, errors: [] };

  if (existsSync(fullDir)) {
    const fullFiles = walkJSFiles(fullDir);
    for (const filePath of fullFiles) {
      const relPath = relative(fullDir, filePath);
      try {
        const code = readFileSync(filePath, 'utf-8');
        parse(code, { ecmaVersion: 'latest', sourceType: 'module' });
        astVerify.passed++;
      } catch (e) {
        astVerify.failed++;
        astVerify.errors.push({
          file: relPath,
          error: e.message,
          line: e.loc?.line,
        });
      }
    }
  }

  // ──── Step 4: Token savings ────
  const srcDir = join(projectPath, 'src');
  const tokens = { compact: 0, full: 0, savings: '0%' };

  if (existsSync(srcDir) && existsSync(fullDir)) {
    const srcFiles = walkJSFiles(srcDir);
    for (const filePath of srcFiles) {
      const relPath = relative(srcDir, filePath);
      const srcCode = readFileSync(filePath, 'utf-8');
      tokens.compact += estimateTokens(srcCode);

      const fullPath = join(fullDir, 'src', relPath);
      if (existsSync(fullPath)) {
        const fullCode = readFileSync(fullPath, 'utf-8');
        tokens.full += estimateTokens(fullCode);
      } else {
        tokens.full += estimateTokens(srcCode);
      }
    }

    if (tokens.full > 0) {
      tokens.savings = Math.round((1 - tokens.compact / tokens.full) * 100) + '%';
    }
  }

  // ──── Summary ────
  const duration = Date.now() - startTime;

  const contractErrors = contracts.summary?.errors || 0;
  const astErrors = astVerify.failed;
  const totalErrors = contractErrors + astErrors;

  const status = totalErrors === 0 ? 'PASS' : 'FAIL';

  return {
    status,
    duration: `${duration}ms`,
    contracts: {
      files: contracts.files,
      errors: contracts.summary?.errors || 0,
      warnings: contracts.summary?.warnings || 0,
      violations: contracts.violations?.slice(0, 20), // limit output
    },
    decompile: decompile ? {
      files: decompile.files,
      jsdocInjected: decompile.totalJSDocInjected,
      errors: decompile.errors,
    } : null,
    astVerify: {
      passed: astVerify.passed,
      failed: astVerify.failed,
      errors: astVerify.errors.slice(0, 10),
    },
    tokens,
    summary: {
      totalErrors,
      contractErrors,
      astErrors,
      filesProcessed: decompile?.files || 0,
      jsdocInjected: decompile?.totalJSDocInjected || 0,
      tokenSavings: tokens.savings,
    },
  };
}
