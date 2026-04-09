import { stripStringsAndComments } from './lang-utils.js';

export function parseGo(code, filename) {
  const result = {
    file: filename,
    classes: [],
    functions: [],
    imports: [],
    exports: []
  };

  const { imports, packageNames } = extractImports(code);
  result.imports = imports;

  const cleanCode = stripStringsAndComments(code, {
    singleQuote: false,
    backtick: true,
    templateInterpolation: false
  });

  const classesMap = new Map();

  // Extract Structs (mapped to classes)
  const structRegex = /^\s*type\s+([a-zA-Z_]\w*)\s+struct\s*\{/gm;
  let match;
  while ((match = structRegex.exec(cleanCode)) !== null) {
    const name = match[1];
    const start = match.index + match[0].length;
    const body = getBody(cleanCode, start);
    const line = code.substring(0, match.index).split('\n').length;

    let extendsName = null;
    const properties = [];

    const lines = body.split('\n').map(l => l.trim()).filter(l => l);
    for (const lineStr of lines) {
      const parts = lineStr.split(/\s+/);
      if (parts.length === 1) {
        extendsName = parts[0].replace(/^\*/, ''); // Remove pointer if embedded
      } else if (parts.length >= 2) {
        const propName = parts[0].replace(/,$/, '');
        properties.push(propName);
      }
    }

    classesMap.set(name, {
      name,
      extends: extendsName,
      methods: [],
      properties,
      calls: [],
      file: filename,
      line
    });
  }

  // Extract Interfaces (mapped to classes)
  const interfaceRegex = /^\s*type\s+([a-zA-Z_]\w*)\s+interface\s*\{/gm;
  while ((match = interfaceRegex.exec(cleanCode)) !== null) {
    const name = match[1];
    const start = match.index + match[0].length;
    const body = getBody(cleanCode, start);
    const line = code.substring(0, match.index).split('\n').length;

    let extendsName = null;
    const methods = [];

    const lines = body.split('\n').map(l => l.trim()).filter(l => l);
    for (const lineStr of lines) {
      const parenIndex = lineStr.indexOf('(');
      if (parenIndex !== -1) {
        const beforeParen = lineStr.substring(0, parenIndex).trim();
        const parts = beforeParen.split(/\s+/);
        const methodName = parts[parts.length - 1];
        if (methodName) {
          methods.push(methodName);
        }
      } else {
        const parts = lineStr.split(/\s+/);
        if (parts.length === 1) {
          extendsName = parts[0];
        }
      }
    }

    classesMap.set(name, {
      name,
      extends: extendsName,
      methods,
      properties: [],
      calls: [],
      file: filename,
      line
    });
  }

  // Extract Methods
  const methodRegex = /^\s*func\s+\(\s*[a-zA-Z_]\w*\s+\*?([a-zA-Z_]\w*)\s*\)\s+([a-zA-Z_]\w*)[^{]*\{/gm;
  while ((match = methodRegex.exec(cleanCode)) !== null) {
    const className = match[1];
    const methodName = match[2];
    const start = match.index + match[0].length;
    const body = getBody(cleanCode, start);
    const line = code.substring(0, match.index).split('\n').length;

    const methodCalls = extractCalls(body, packageNames);

    if (!classesMap.has(className)) {
      classesMap.set(className, {
        name: className,
        extends: null,
        methods: [],
        properties: [],
        calls: [],
        file: filename,
        line
      });
    }

    const classInfo = classesMap.get(className);
    classInfo.methods.push(methodName);
    
    for (const call of methodCalls) {
      if (!classInfo.calls.includes(call)) {
        classInfo.calls.push(call);
      }
    }
  }

  // Extract Functions (top-level)
  const funcRegex = /^\s*func\s+([a-zA-Z_]\w*)\s*\(([^)]*)\)[^{]*\{/gm;
  while ((match = funcRegex.exec(cleanCode)) !== null) {
    const name = match[1];
    const paramsStr = match[2];
    const params = paramsStr.split(',')
      .map(p => p.trim().split(/\s+/)[0])
      .filter(p => p);

    const exported = /^[A-Z]/.test(name);
    const start = match.index + match[0].length;
    const body = getBody(cleanCode, start);
    const line = code.substring(0, match.index).split('\n').length;

    const calls = extractCalls(body, packageNames);

    result.functions.push({
      name,
      exported,
      calls,
      params,
      file: filename,
      line
    });
  }

  result.classes = Array.from(classesMap.values());

  // Extract Exports
  for (const cls of result.classes) {
    if (/^[A-Z]/.test(cls.name)) {
      result.exports.push(cls.name);
    }
  }
  for (const fn of result.functions) {
    if (fn.exported) {
      result.exports.push(fn.name);
    }
  }

  return result;
}

function extractImports(text) {
  const imports = [];
  const packageNames = new Set();
  
  // Strip comments to avoid commented out imports
  const noComments = text.replace(/\/\/.*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  
  const importBlockRegex = /import\s*\(([\s\S]*?)\)/g;
  let match;
  while ((match = importBlockRegex.exec(noComments)) !== null) {
    const block = match[1];
    const lines = block.split('\n');
    for (const line of lines) {
      const lineMatch = line.match(/(?:([a-zA-Z_]\w*)\s+)?"([^"]+)"/);
      if (lineMatch) {
        const alias = lineMatch[1];
        const pkgPath = lineMatch[2];
        if (alias) {
          if (!imports.includes(alias)) {
            imports.push(alias);
            packageNames.add(alias);
          }
        } else {
          if (!imports.includes(pkgPath)) {
            imports.push(pkgPath);
            const parts = pkgPath.split('/');
            packageNames.add(parts[parts.length - 1]);
          }
        }
      }
    }
  }
  
  const singleImportRegex = /import\s+(?:([a-zA-Z_]\w*)\s+)?"([^"]+)"/g;
  while ((match = singleImportRegex.exec(noComments)) !== null) {
    const alias = match[1];
    const pkgPath = match[2];
    if (alias) {
      if (!imports.includes(alias)) {
        imports.push(alias);
        packageNames.add(alias);
      }
    } else {
      if (!imports.includes(pkgPath)) {
        imports.push(pkgPath);
        const parts = pkgPath.split('/');
        packageNames.add(parts[parts.length - 1]);
      }
    }
  }
  
  return { imports, packageNames };
}

function getBody(code, startIndex) {
  let braces = 1;
  let end = startIndex;
  while (end < code.length && braces > 0) {
    if (code[end] === '{') braces++;
    else if (code[end] === '}') braces--;
    end++;
  }
  return code.substring(startIndex, end - 1);
}

function extractCalls(body, packageNames) {
  const calls = [];
  const callRegex = /([a-zA-Z_]\w*(?:\.[a-zA-Z_]\w*)?)\s*\(/g;
  let match;
  while ((match = callRegex.exec(body)) !== null) {
    let callName = match[1];
    
    const keywords = [
      'if', 'for', 'switch', 'func', 'panic', 'recover', 'len', 'cap', 
      'make', 'new', 'append', 'copy', 'delete', 'close',
      'int', 'string', 'bool', 'byte', 'rune', 'float32', 'float64', 
      'int32', 'int64', 'uint32', 'uint64', 'complex64', 'complex128'
    ];
    if (keywords.includes(callName)) continue;

    if (callName.includes('.')) {
      const parts = callName.split('.');
      // If the first part is a known package name, keep it (e.g., fmt.Println)
      // Otherwise, assume it's a method call on a variable and strip it (e.g., s.Handle -> Handle)
      if (!packageNames.has(parts[0])) {
        callName = parts[1];
      }
    }

    if (!calls.includes(callName)) {
      calls.push(callName);
    }
  }
  return calls;
}
