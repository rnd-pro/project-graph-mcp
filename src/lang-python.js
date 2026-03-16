import { stripStringsAndComments } from './lang-utils.js';

/**
 * Parse Python file using regex-based structural extraction.
 * @param {string} code - Python source code
 * @param {string} filename - File path
 * @returns {ParseResult}
 */
export function parsePython(code = '', filename = '') {
  const result = {
    file: filename,
    classes: [],
    functions: [],
    imports: [],
    exports: []
  };

  // Pre-process: remove docstrings, triple-quoted strings, and line comments
  const cleanCode = stripStringsAndComments(code, {
    singleQuote: true,
    hashComment: true,
    tripleQuote: true
  });

  const lines = cleanCode.split('\n');
  
  let currentClass = null;
  let currentFunc = null;
  let classIndent = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;

    const indentMatch = line.match(/^([ \t]*)/);
    const indent = indentMatch ? indentMatch[1].length : 0;

    // Check if we exited a class scope
    if (currentClass && indent <= classIndent) {
      currentClass = null;
      classIndent = -1;
    }

    // Check if we exited a function scope
    if (currentFunc && indent === 0) {
      currentFunc = null;
    }

    // Match Class (top-level)
    const classMatch = line.match(/^class\s+([a-zA-Z_]\w*)(?:\s*\((.*?)\))?\s*:/);
    if (classMatch) {
      currentClass = {
        name: classMatch[1],
        extends: classMatch[2] ? classMatch[2].trim() : null,
        methods: [],
        properties: [],
        calls: [],
        file: filename,
        line: i + 1
      };
      result.classes.push(currentClass);
      classIndent = indent;
      currentFunc = null;
      continue;
    }

    // Match top-level function
    const funcMatch = line.match(/^(?:async\s+)?def\s+([a-zA-Z_]\w*)\s*\(([^)]*)\)?/);
    if (funcMatch) {
      const paramsStr = funcMatch[2] || '';
      const params = paramsStr.split(',')
        .map(p => p.split(/[:=]/)[0].trim())
        .filter(p => p && p !== 'self' && p !== 'cls');

      currentFunc = {
        name: funcMatch[1],
        exported: true, // we'll adjust later if __all__ is present
        calls: [],
        params: params,
        file: filename,
        line: i + 1
      };
      result.functions.push(currentFunc);
      currentClass = null;
      continue;
    }

    // Match Method (inside class)
    const methodMatch = line.match(/^[ \t]+(?:async\s+)?def\s+([a-zA-Z_]\w*)\s*\(/);
    if (methodMatch && currentClass && indent > classIndent) {
      const methodName = methodMatch[1];
      if (methodName !== '__init__') {
        currentClass.methods.push(methodName);
      }
      currentFunc = null; // not a top-level function
      continue;
    }

    // Match Imports
    const importMatch = line.match(/^\s*import\s+(.+)/);
    if (importMatch) {
      const parts = importMatch[1].split(',');
      for (const part of parts) {
        const p = part.trim();
        const asMatch = p.match(/(?:.+)\s+as\s+([a-zA-Z_]\w*)/);
        if (asMatch) {
          result.imports.push(asMatch[1]);
        } else {
          result.imports.push(p.split('.')[0]); // take root module
        }
      }
      continue;
    }

    const fromImportMatch = line.match(/^\s*from\s+([.\w]+)\s+import\s*(.*)/);
    if (fromImportMatch) {
      let imported = fromImportMatch[2];
      if (imported.includes('(') && !imported.includes(')')) {
        let j = i + 1;
        while (j < lines.length) {
          imported += ' ' + lines[j];
          if (lines[j].includes(')')) {
            i = j;
            break;
          }
          j++;
        }
      }
      imported = imported.replace(/[()]/g, '');
      const parts = imported.split(',');
      for (const part of parts) {
        const p = part.trim();
        if (!p) continue;
        const asMatch = p.match(/(?:.+)\s+as\s+([a-zA-Z_]\w*)/);
        if (asMatch) {
          result.imports.push(asMatch[1]);
        } else {
          result.imports.push(p);
        }
      }
      continue;
    }

    // Extract calls: look for func(...)
    const callRegex = /([a-zA-Z_][\w.]*)\s*\(/g;
    let match;
    const keywords = new Set(['if', 'while', 'for', 'elif', 'return', 'yield', 'def', 'class', 'and', 'or', 'not', 'in', 'is', 'print']);
    while ((match = callRegex.exec(line)) !== null) {
      const callName = match[1];
      if (keywords.has(callName)) continue;
      
      let cleanCallName = callName;
      if (cleanCallName.startsWith('self.')) {
        cleanCallName = cleanCallName.substring(5);
      }
      
      if (currentFunc) {
        if (!currentFunc.calls.includes(cleanCallName)) {
          currentFunc.calls.push(cleanCallName);
        }
      } else if (currentClass) {
        if (!currentClass.calls.includes(cleanCallName)) {
          currentClass.calls.push(cleanCallName);
        }
      }
    }
  }

  // Handle Exports (__all__)
  const allMatch = code.match(/__all__\s*=\s*\[(.*?)\]/s);
  if (allMatch) {
    const exportsRaw = allMatch[1];
    const exportRegex = /['"]([^'"]+)['"]/g;
    let exMatch;
    while ((exMatch = exportRegex.exec(exportsRaw)) !== null) {
      result.exports.push(exMatch[1]);
    }
    // Update exported flags for functions
    for (const fn of result.functions) {
      fn.exported = result.exports.includes(fn.name);
    }
  } else {
    // Implicit exports: all top-level functions and classes are exported
    for (const cls of result.classes) {
      result.exports.push(cls.name);
    }
    for (const fn of result.functions) {
      result.exports.push(fn.name);
      fn.exported = true;
    }
  }
  
  // Deduplicate imports
  result.imports = [...new Set(result.imports)];

  return result;
}
