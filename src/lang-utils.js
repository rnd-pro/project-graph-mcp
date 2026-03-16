/**
 * Strip strings, template literals, and comments from source code.
 * Preserves line structure (newlines are kept) and character positions.
 * @param {string} code
 * @param {Object} [options]
 * @param {boolean} [options.singleQuote=true] - Handle single-quoted strings
 * @param {boolean} [options.backtick=true] - Handle backtick strings/templates
 * @param {boolean} [options.hashComment=false] - Handle # comments (Python)
 * @param {boolean} [options.tripleQuote=false] - Handle ''' and """ (Python)
 * @param {boolean} [options.templateInterpolation=true] - Handle ${} in backticks
 * @returns {string}
 */
export function stripStringsAndComments(code, options = {}) {
  const {
    singleQuote = true,
    backtick = true,
    hashComment = false,
    tripleQuote = false,
    templateInterpolation = true
  } = options;

  let result = '';
  let i = 0;

  while (i < code.length) {
    // Hash comment
    if (hashComment && code[i] === '#') {
      while (i < code.length && code[i] !== '\n') {
        result += ' ';
        i++;
      }
      continue;
    }

    // Triple quotes
    if (tripleQuote && (
      (code[i] === "'" && code[i+1] === "'" && code[i+2] === "'") ||
      (code[i] === '"' && code[i+1] === '"' && code[i+2] === '"')
    )) {
      const quote = code[i];
      result += '   ';
      i += 3;
      while (i < code.length) {
        if (code[i] === '\\') {
          result += '  ';
          i += 2;
          continue;
        }
        if (code[i] === quote && code[i+1] === quote && code[i+2] === quote) {
          result += '   ';
          i += 3;
          break;
        }
        result += code[i] === '\n' ? '\n' : ' ';
        i++;
      }
      continue;
    }

    // Single-line comment //
    if (!hashComment && code[i] === '/' && code[i + 1] === '/') {
      while (i < code.length && code[i] !== '\n') {
        result += ' ';
        i++;
      }
      continue;
    }

    // Multi-line comment /* ... */
    if (!hashComment && code[i] === '/' && code[i + 1] === '*') {
      i += 2;
      result += '  ';
      while (i < code.length && !(code[i] === '*' && code[i + 1] === '/')) {
        result += code[i] === '\n' ? '\n' : ' ';
        i++;
      }
      if (i < code.length) { result += '  '; i += 2; }
      continue;
    }

    // String literals
    if (code[i] === '"' || (singleQuote && code[i] === "'") || (backtick && code[i] === '`')) {
      const quote = code[i];
      result += ' ';
      i++;
      while (i < code.length) {
        if (code[i] === '\\') {
          result += '  ';
          i += 2;
          continue;
        }
        if (code[i] === quote) {
          result += ' ';
          i++;
          break;
        }
        // Template literal: ${...} — keep the expression
        if (templateInterpolation && quote === '`' && code[i] === '$' && code[i + 1] === '{') {
          result += '${';
          i += 2;
          let depth = 1;
          while (i < code.length && depth > 0) {
            if (code[i] === '{') depth++;
            if (code[i] === '}') depth--;
            if (depth > 0) {
              result += code[i] === '\n' ? '\n' : code[i];
            } else {
              result += '}';
            }
            i++;
          }
          continue;
        }
        result += code[i] === '\n' ? '\n' : ' ';
        i++;
      }
      continue;
    }
    result += code[i];
    i++;
  }

  return result;
}
