import { readFileSync } from 'fs';
import { basename, extname } from 'path';
import { minify } from '../vendor/terser.mjs';
import { parse } from '../vendor/acorn.mjs';
import { simple as walk } from '../vendor/walk.mjs';

const SUPPORTED_EXTENSIONS = new Set(['.js', '.mjs', '.ts', '.tsx']);

function estimateTokens(text) {
  return Math.ceil(text.length / 4);
}

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

export async function editCompressed(filePath, symbol, newCode, options = {}) {
  const { beautify: shouldBeautify = true, dryRun = false } = options;

  const source = readFileSync(filePath, 'utf-8');

  // Parse AST to find the symbol
  let ast;
  try {
    ast = parse(source, {
      ecmaVersion: 'latest',
      sourceType: 'module',
      locations: true,
    });
  } catch (e) {
    throw new Error(`Failed to parse ${filePath}: ${e.message}`);
  }

  // Find the symbol (function or class) and its range
  const match = findSymbolRange(ast, source, symbol);
  if (!match) {
    throw new Error(`Symbol "${symbol}" not found in ${filePath}`);
  }

  // Build new source: before + newCode + after
  const before = source.slice(0, match.start);
  const after = source.slice(match.end);
  let newSource = before + newCode + after;

  // Optionally beautify the result
  if (shouldBeautify) {
    try {
      const result = await minify(newSource, {
        compress: false,
        mangle: false,
        module: true,
        output: { beautify: true, comments: true, semicolons: false },
      });
      if (result.code) {
        newSource = result.code;
      }
    } catch {
      // If beautify fails, use raw replacement
    }
  }

  // Validate the new source parses correctly
  try {
    parse(newSource, { ecmaVersion: 'latest', sourceType: 'module' });
  } catch (e) {
    throw new Error(`Edit would create invalid syntax: ${e.message}`);
  }

  if (!dryRun) {
    const { writeFileSync } = await import('fs');
    writeFileSync(filePath, newSource, 'utf-8');
  }

  return {
    success: true,
    file: filePath,
    symbol,
    oldRange: { start: match.start, end: match.end },
    newLength: newCode.length,
    ...(dryRun ? { dryRun: true } : {}),
  };
}

function findSymbolRange(ast, source, symbol) {
  let match = null;

  walk(ast, {
    FunctionDeclaration(node) {
      if (node.id?.name === symbol) {
        match = { start: node.start, end: node.end, type: 'FunctionDeclaration' };
      }
    },
    ClassDeclaration(node) {
      if (node.id?.name === symbol) {
        match = { start: node.start, end: node.end, type: 'ClassDeclaration' };
      }
    },
    VariableDeclaration(node) {
      for (const decl of node.declarations) {
        if (decl.id?.name === symbol) {
          match = { start: node.start, end: node.end, type: 'VariableDeclaration' };
        }
      }
    },
    ExportNamedDeclaration(node) {
      if (node.declaration) {
        const decl = node.declaration;
        const name = decl.id?.name || decl.declarations?.[0]?.id?.name;
        if (name === symbol) {
          match = { start: node.start, end: node.end, type: 'ExportNamedDeclaration' };
        }
      }
    },
    ExportDefaultDeclaration(node) {
      if (node.declaration?.id?.name === symbol) {
        match = { start: node.start, end: node.end, type: 'ExportDefaultDeclaration' };
      }
    },
  });

  return match;
}
