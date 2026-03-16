import { stripStringsAndComments } from './lang-utils.js';

/**
 * TypeScript/TSX regex-based parser.
 * Extracts structural information (classes, functions, imports, exports, calls)
 * directly from TypeScript code without relying on Acorn.
 *
 * Strategy: Instead of stripping TS syntax to feed Acorn (which causes
 * catastrophic backtracking in regex), parse structural elements directly
 * — same approach as lang-python.js and lang-go.js.
 *
 * @param {string} code - TypeScript source code
 * @param {string} filename - File path for the result
 * @returns {ParseResult}
 */
export function parseTypeScript(code, filename) {
  const result = {
    file: filename,
    classes: [],
    functions: [],
    imports: [],
    exports: [],
  };

  // Strip strings, template literals, and comments to avoid false matches
  const cleaned = stripStringsAndComments(code);
  const lines = cleaned.split('\n');

  let currentClass = null;
  let currentFunc = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // --- Imports ---
    // import { A, B } from 'module'
    const importFromMatch = line.match(/^\s*import\s+(?:type\s+)?(?:\{([^}]+)\}|(\w+))\s+from\s/);
    if (importFromMatch) {
      if (importFromMatch[1]) {
        importFromMatch[1].split(',').forEach(s => {
          const name = s.trim().replace(/\s+as\s+\w+/, '').replace(/^type\s+/, '');
          if (name) result.imports.push(name);
        });
      } else if (importFromMatch[2]) {
        result.imports.push(importFromMatch[2]);
      }
      continue;
    }
    // import * as name from 'module'
    const importStarMatch = line.match(/^\s*import\s+\*\s+as\s+(\w+)\s+from\s/);
    if (importStarMatch) {
      result.imports.push(importStarMatch[1]);
      continue;
    }

    // --- Exports ---
    const exportMatch = line.match(/^\s*export\s+(?:default\s+)?(?:class|function|const|let|var|type|interface|enum|abstract)\s+(\w+)/);
    if (exportMatch) {
      result.exports.push(exportMatch[1]);
    }
    // export { A, B }
    const exportBraceMatch = line.match(/^\s*export\s+\{([^}]+)\}/);
    if (exportBraceMatch) {
      exportBraceMatch[1].split(',').forEach(s => {
        const name = s.trim().replace(/\s+as\s+\w+/, '');
        if (name) result.exports.push(name);
      });
    }

    // Skip type-only declarations (no runtime code)
    if (/^\s*(type|interface)\s+\w+/.test(line)) {
      continue;
    }

    // --- Classes ---
    const classMatch = line.match(/^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+(\w+)(?:\s+extends\s+(\w+))?/);
    if (classMatch) {
      currentClass = {
        name: classMatch[1],
        extends: classMatch[2] || null,
        methods: [],
        properties: [],
        calls: [],
        file: filename,
        line: lineNum,
      };
      result.classes.push(currentClass);
      currentFunc = null;
      continue;
    }

    // Detect end of class or function (closing brace at col 0)
    if (/^}/.test(line)) {
      currentClass = null;
      currentFunc = null;
      continue;
    }

    // --- Methods (inside class) ---
    if (currentClass) {
      // public/private/protected/static/async methodName(
      const methodMatch = line.match(/^\s+(?:(?:public|private|protected|static|readonly|abstract|override|async)\s+)*(\w+)\s*(?:<[^>]*>)?\s*\(/);
      if (methodMatch && methodMatch[1] !== 'if' && methodMatch[1] !== 'for' &&
          methodMatch[1] !== 'while' && methodMatch[1] !== 'switch' &&
          methodMatch[1] !== 'catch' && methodMatch[1] !== 'return' &&
          methodMatch[1] !== 'new' && methodMatch[1] !== 'constructor' &&
          methodMatch[1] !== 'super') {
        currentClass.methods.push(methodMatch[1]);
      }
      // constructor
      if (/^\s+constructor\s*\(/.test(line)) {
        currentClass.methods.push('constructor');
      }
      // Property: name: Type or name = value
      const propMatch = line.match(/^\s+(?:(?:public|private|protected|static|readonly|declare|override|abstract)\s+)*(\w+)\s*[?!]?\s*[:=]/);
      if (propMatch && !methodMatch && propMatch[1] !== 'if' && propMatch[1] !== 'const' &&
          propMatch[1] !== 'let' && propMatch[1] !== 'var' && propMatch[1] !== 'return') {
        currentClass.properties.push(propMatch[1]);
      }
    }

    // --- Functions (top-level) ---
    if (!currentClass) {
      // function name(, async function name(, export function, export default function
      const fnMatch = line.match(/^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+(\w+)/);
      if (fnMatch) {
        currentFunc = {
          name: fnMatch[1],
          exported: /^\s*export\s+/.test(line),
          calls: [],
          params: extractParams(line),
          file: filename,
          line: lineNum,
        };
        result.functions.push(currentFunc);
        continue;
      }
      // Arrow functions: const name = (...) => or export const name = (
      const arrowMatch = line.match(/^\s*(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:\([^)]*\)|[a-zA-Z_]\w*)\s*(?::\s*\w+(?:<[^>]*>)?)?\s*=>/);
      if (arrowMatch) {
        currentFunc = {
          name: arrowMatch[1],
          exported: /^\s*export\s+/.test(line),
          calls: [],
          params: extractParams(line),
          file: filename,
          line: lineNum,
        };
        result.functions.push(currentFunc);
        continue;
      }
    }

    // --- Calls ---
    const callRegex = /\b([a-zA-Z_$]\w*)\s*(?:<[^>]*>)?\s*\(/g;
    let callMatch;
    while ((callMatch = callRegex.exec(line)) !== null) {
      const name = callMatch[1];
      // Skip keywords and common built-ins
      if (['if', 'for', 'while', 'switch', 'catch', 'return', 'new', 'throw',
           'typeof', 'delete', 'void', 'import', 'export', 'class', 'function',
           'const', 'let', 'var', 'async', 'await', 'super', 'this',
           'interface', 'type', 'enum', 'declare', 'abstract'].includes(name)) {
        continue;
      }
      if (currentClass) {
        currentClass.calls.push(name);
      } else if (currentFunc) {
        currentFunc.calls.push(name);
      }
    }
  }

  return result;
}

/**
 * Extract parameter names from a function signature line.
 * @param {string} line
 * @returns {string[]}
 */
function extractParams(line) {
  const match = line.match(/\(([^)]*)\)/);
  if (!match) return [];
  return match[1]
    .split(',')
    .map(p => p.trim().replace(/[?!]?\s*:.*$/, '').replace(/\s*=.*$/, '').trim())
    .filter(p => p && !p.startsWith('...'));
}
