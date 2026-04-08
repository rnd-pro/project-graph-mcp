/**
 * Code Compression for AI Context
 * 
 * Terser-based minification of JS source files for token-efficient AI consumption.
 * Preserves exported names and structure while stripping comments, whitespace,
 * and redundant syntax. Optionally generates a JSDoc legend header.
 */

import { readFileSync } from 'fs';
import { basename, extname } from 'path';
import { minify } from '../vendor/terser.mjs';
import { parse } from '../vendor/acorn.mjs';
import { simple as walk } from '../vendor/walk.mjs';

/** Supported file extensions for compression */
const SUPPORTED_EXTENSIONS = new Set(['.js', '.mjs', '.ts', '.tsx']);

/**
 * Estimate token count (rough: ~4 chars per token for code)
 * @param {string} text
 * @returns {number}
 */
function estimateTokens(text) {
  return Math.ceil(text.length / 4);
}

/**
 * Extract JSDoc legend from source — exported symbols with their descriptions
 * @param {string} source - Original source code
 * @param {string} filePath
 * @returns {string} Compact legend string
 */
function extractLegend(source, filePath) {
  const lines = [];
  lines.push(`--- ${basename(filePath)} ---`);

  try {
    const ast = parse(source, { ecmaVersion: 2022, sourceType: 'module', locations: true });

    walk(ast, {
      ExportNamedDeclaration(node) {
        const decl = node.declaration;
        if (!decl) return;

        // Extract preceding JSDoc comment — first line description only
        let jsdoc = '';
        if (node.start > 0) {
          // Only look at the 500 chars immediately before node to avoid module-level JSDoc
          const searchStart = Math.max(0, node.start - 500);
          const beforeNode = source.slice(searchStart, node.start).trimEnd();
          const jsdocMatch = beforeNode.match(/\/\*\*[\s\S]*?\*\/\s*$/);
          if (jsdocMatch) {
            // Ensure the JSDoc block is close to the declaration (within 3 blank lines)
            const gap = source.slice(searchStart + jsdocMatch.index + jsdocMatch[0].length, node.start);
            if (gap.split('\n').length <= 3) {
              const desc = jsdocMatch[0]
                .replace(/\/\*\*\s*\n?/, '')
                .replace(/\s*\*\//, '')
                .split('\n')
                .map(l => l.replace(/^\s*\*\s?/, '').trim())
                .filter(l => l && !l.startsWith('@'))
                .join(' ')
                .trim();
              if (desc) jsdoc = desc.length > 80 ? desc.slice(0, 77) + '...' : desc;
            }
          }
        }

        if (decl.type === 'FunctionDeclaration') {
          const name = decl.id?.name || 'anonymous';
          const paramList = decl.params.map(p => {
            if (p.type === 'Identifier') return p.name;
            if (p.type === 'AssignmentPattern' && p.left.type === 'Identifier') return p.left.name + '=';
            return '...';
          }).join(',');
          const line = `${decl.async ? 'async ' : ''}${name}(${paramList})`;
          lines.push(jsdoc ? `${line}|${jsdoc}` : line);
        }

        if (decl.type === 'ClassDeclaration') {
          const name = decl.id?.name || 'AnonymousClass';
          const ext = decl.superClass ? ` extends ${decl.superClass.name || '?'}` : '';
          lines.push(`class ${name}${ext}${jsdoc ? '|' + jsdoc : ''}`);

          // List methods
          for (const method of decl.body.body) {
            if (method.type === 'MethodDefinition' && method.key?.name) {
              const mParams = method.value.params.map(p => {
                if (p.type === 'Identifier') return p.name;
                if (p.type === 'AssignmentPattern' && p.left.type === 'Identifier') return p.left.name + '=';
                return '...';
              }).join(',');
              lines.push(`  .${method.key.name}(${mParams})`);
            }
          }
        }

        if (decl.type === 'VariableDeclaration') {
          for (const declarator of decl.declarations) {
            if (declarator.id?.name) {
              lines.push(`${decl.kind} ${declarator.id.name}${jsdoc ? '|' + jsdoc : ''}`);
            }
          }
        }
      },
    });
  } catch (e) {
    lines.push(`PARSE_ERROR: ${e.message}`);
  }

  return lines.join('\n');
}

/**
 * Compress a source file for AI consumption
 * @param {string} filePath - Path to JS/MJS file
 * @param {Object} [options]
 * @param {boolean} [options.beautify=true] - Readable multi-line output
 * @param {boolean} [options.legend=true] - Add compact legend header
 * @returns {Promise<{code: string, legend: string, original: number, compressed: number, savings: string}>}
 */
export async function compressFile(filePath, options = {}) {
  const { beautify = true, legend: includeLegend = true } = options;

  // Validate file extension
  const ext = extname(filePath).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.has(ext)) {
    throw new Error(`Unsupported file type: ${ext}. Supported: ${[...SUPPORTED_EXTENSIONS].join(', ')}`);
  }

  const source = readFileSync(filePath, 'utf-8');
  const originalTokens = estimateTokens(source);

  // Handle empty files
  if (!source.trim()) {
    return {
      code: '',
      legend: '',
      original: 0,
      compressed: 0,
      savings: '0%',
    };
  }

  const terserOptions = {
    compress: {
      dead_code: true,
      drop_console: false,
      passes: 2,
    },
    mangle: false,  // Preserve all names for AI readability
    module: true,    // Support ES modules
    output: {
      beautify,
      comments: false,  // Strip all comments — legend replaces them
      semicolons: !beautify,
    },
  };

  let compressedSource;
  try {
    const result = await minify(source, terserOptions);
    if (result.error) {
      throw result.error;
    }
    compressedSource = result.code;
  } catch (e) {
    // Graceful fallback: return original code stripped of comments
    compressedSource = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '').replace(/\n{3,}/g, '\n\n').trim();
  }

  const legend = includeLegend ? extractLegend(source, filePath) : '';
  const compressedCode = legend
    ? `/*\n${legend}\n*/\n${compressedSource}`
    : compressedSource;

  const compressedTokens = estimateTokens(compressedCode);
  const savings = originalTokens > 0
    ? Math.round((1 - compressedTokens / originalTokens) * 100)
    : 0;

  return {
    code: compressedCode,
    legend,
    original: originalTokens,
    compressed: compressedTokens,
    savings: `${savings}%`,
  };
}
