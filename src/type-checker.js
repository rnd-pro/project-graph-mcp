/**
 * Optional Type Checker (tsc wrapper)
 * Provides JSDoc type validation via TypeScript compiler
 * 
 * Requires `tsc` in PATH (npm i -g typescript)
 * Graceful fallback if not available
 */

import { execSync, spawn } from 'child_process';
import { existsSync } from 'fs';
import { resolve, join } from 'path';

/**
 * @typedef {Object} TypeDiagnostic
 * @property {string} file
 * @property {number} line
 * @property {number} column
 * @property {'error'|'warning'} severity
 * @property {string} message
 * @property {string} code - TS error code (e.g. "TS2345")
 */

/**
 * Check if tsc is available
 * @returns {{ available: boolean, version: string|null, path: string|null }}
 */
function detectTsc() {
  try {
    const version = execSync('tsc --version', { encoding: 'utf-8', timeout: 5000 }).trim();
    const tscPath = execSync('which tsc', { encoding: 'utf-8', timeout: 5000 }).trim();
    return { available: true, version, path: tscPath };
  } catch (e) {
    // Try npx
    try {
      const version = execSync('npx tsc --version', { encoding: 'utf-8', timeout: 15000 }).trim();
      return { available: true, version, path: 'npx tsc' };
    } catch (e2) {
      return { available: false, version: null, path: null };
    }
  }
}

/**
 * Parse tsc output line into structured diagnostic
 * @param {string} line
 * @param {string} baseDir
 * @returns {TypeDiagnostic|null}
 */
function parseDiagnosticLine(line, baseDir) {
  // Format: file.js(line,col): error TS1234: message
  const match = line.match(/^(.+?)\((\d+),(\d+)\):\s+(error|warning)\s+(TS\d+):\s+(.+)$/);
  if (!match) return null;

  return {
    file: match[1],
    line: parseInt(match[2]),
    column: parseInt(match[3]),
    severity: match[4],
    message: match[6],
    code: match[5],
  };
}

/**
 * Build tsc arguments
 * @param {string} dir
 * @param {Object} options
 * @returns {string[]}
 */
function buildArgs(dir, options = {}) {
  const args = ['--noEmit'];

  // Check for existing config
  const tsconfig = join(dir, 'tsconfig.json');
  const jsconfig = join(dir, 'jsconfig.json');

  if (existsSync(tsconfig)) {
    args.push('--project', tsconfig);
  } else if (existsSync(jsconfig)) {
    args.push('--project', jsconfig);
  } else {
    // No config — use sensible defaults for JS projects
    args.push('--allowJs', '--checkJs');
    args.push('--target', 'ESNext');
    args.push('--module', 'NodeNext');
    args.push('--moduleResolution', 'NodeNext');
    args.push('--skipLibCheck');

    // Include the directory
    if (options.files?.length) {
      args.push(...options.files);
    } else {
      args.push('--rootDir', dir);
    }
  }

  return args;
}

/**
 * Run type checking on a directory
 * @param {string} dir - Directory to check
 * @param {Object} [options]
 * @param {string[]} [options.files] - Specific files to check
 * @param {number} [options.maxDiagnostics=50] - Max diagnostics to return
 * @returns {Promise<{ available: boolean, version: string|null, diagnostics: TypeDiagnostic[], summary: Object, hint: string|null }>}
 */
export async function checkTypes(dir, options = {}) {
  const maxDiagnostics = options.maxDiagnostics || 50;
  const resolvedDir = resolve(dir);

  // Detect tsc
  const tsc = detectTsc();
  if (!tsc.available) {
    return {
      available: false,
      version: null,
      diagnostics: [],
      summary: { total: 0, errors: 0, warnings: 0 },
      hint: 'TypeScript not found. Install: npm i -g typescript',
    };
  }

  // Build and run command
  const args = buildArgs(resolvedDir, options);
  const cmd = tsc.path.includes('npx') ? 'npx' : 'tsc';
  const cmdArgs = tsc.path.includes('npx') ? ['tsc', ...args] : args;

  const result = await new Promise((res) => {
    const child = spawn(cmd, cmdArgs, {
      cwd: resolvedDir,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      res({ stdout, stderr, killed: true });
    }, 60000);

    child.on('close', () => {
      clearTimeout(timer);
      res({ stdout, stderr, killed: false });
    });

    child.on('error', (e) => {
      clearTimeout(timer);
      res({ stdout: '', stderr: e.message, killed: false });
    });
  });

  // Parse output (tsc exits with 1 on errors, stdout has diagnostics)
  const output = (result.stdout || '') + (result.stderr || '');
  const lines = output.split('\n').filter(l => l.trim());

  const diagnostics = [];
  for (const line of lines) {
    const diag = parseDiagnosticLine(line, resolvedDir);
    if (diag && diagnostics.length < maxDiagnostics) {
      diagnostics.push(diag);
    }
  }

  const errors = diagnostics.filter(d => d.severity === 'error').length;
  const warnings = diagnostics.filter(d => d.severity === 'warning').length;

  const byFile = {};
  for (const d of diagnostics) {
    byFile[d.file] = (byFile[d.file] || 0) + 1;
  }

  return {
    available: true,
    version: tsc.version,
    diagnostics,
    summary: {
      total: diagnostics.length,
      errors,
      warnings,
      byFile,
    },
    hint: null,
  };
}
