import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative, resolve } from 'path';
import { parse } from '../vendor/acorn.mjs';
import * as walk from '../vendor/walk.mjs';
import { shouldExcludeDir, shouldExcludeFile, parseGitignore } from './filters.js';

function findJSFiles(dir, rootDir = dir) {
  if (dir === rootDir) {
    parseGitignore(rootDir);
  }

  const files = [];

  try {
    for (const entry of readdirSync(dir)) {
      const fullPath = join(dir, entry);
      const relativePath = relative(rootDir, fullPath);
      const stat = statSync(fullPath);

      if (stat.isDirectory()) {
        if (!shouldExcludeDir(entry, relativePath)) {
          files.push(...findJSFiles(fullPath, rootDir));
        }
      } else if (entry.endsWith('.js') && !entry.endsWith('.css.js') && !entry.endsWith('.tpl.js')) {
        if (!shouldExcludeFile(entry, relativePath)) {
          files.push(fullPath);
        }
      }
    }
  } catch (e) {
    // Directory not found
  }

  return files;
}

function extractComments(code) {
  const comments = [];
  const regex = /\/\*\*[\s\S]*?\*\//g;
  let match;

  while ((match = regex.exec(code)) !== null) {
    const endLine = code.slice(0, match.index + match[0].length).split('\n').length;
    comments.push({ text: match[0], endLine });
  }

  return comments;
}

function findJSDocBefore(comments, targetLine) {
  for (const comment of comments) {
    const gap = targetLine - comment.endLine;
    if (gap >= 0 && gap <= 2) {
      return comment.text;
    }
  }
  return null;
}

function checkMissing(jsdoc, level) {
  const missing = [];

  if (!jsdoc) {
    if (level === 'all') missing.push('description');
    if (level === 'params' || level === 'all') missing.push('@param', '@returns');
    return missing;
  }

  if (level === 'params' || level === 'all') {
    if (!jsdoc.includes('@param')) missing.push('@param');
    if (!jsdoc.includes('@returns') && !jsdoc.includes('@return')) missing.push('@returns');
  }

  return missing;
}

const SKIP_METHODS = [
  'constructor', 'connectedCallback', 'disconnectedCallback',
  'attributeChangedCallback', 'renderCallback',
];

export function checkUndocumentedFile(code, filePath, level) {
  const results = [];

  let ast;
  try {
    ast = parse(code, { ecmaVersion: 'latest', sourceType: 'module', locations: true });
  } catch (e) {
    return results;
  }

  const comments = extractComments(code);

  walk.simple(ast, {
    ClassDeclaration(node) {
      const className = node.id?.name || 'Anonymous';

      // Check class itself (only for 'all' level)
      if (level === 'all') {
        const classJsdoc = findJSDocBefore(comments, node.loc.start.line);
        if (!classJsdoc) {
          results.push({
            name: className,
            type: 'class',
            file: filePath,
            line: node.loc.start.line,
            reason: 'No JSDoc',
          });
        }
      }

      // Check methods
      for (const element of node.body.body) {
        if (element.type === 'MethodDefinition') {
          const methodName = element.key.name || element.key.value;

          // Skip: constructor, private, getters/setters, lifecycle
          if (element.kind === 'get' || element.kind === 'set') continue;
          if (methodName?.startsWith('_')) continue;
          if (SKIP_METHODS.includes(methodName)) continue;

          const jsdoc = findJSDocBefore(comments, element.loc.start.line);
          const missing = checkMissing(jsdoc, level);

          if (missing.length > 0) {
            results.push({
              name: `${className}.${methodName}`,
              type: 'method',
              file: filePath,
              line: element.loc.start.line,
              reason: missing.join(', '),
            });
          }
        }
      }
    },

    FunctionDeclaration(node) {
      if (!node.id) return;
      const funcName = node.id.name;

      // Skip private functions
      if (funcName.startsWith('_')) return;

      const jsdoc = findJSDocBefore(comments, node.loc.start.line);
      const missing = checkMissing(jsdoc, level);

      if (missing.length > 0) {
        results.push({
          name: funcName,
          type: 'function',
          file: filePath,
          line: node.loc.start.line,
          reason: missing.join(', '),
        });
      }
    },
  });

  return results;
}

export function getUndocumented(dir, level = 'tests') {
  const resolvedDir = resolve(dir);
  const files = findJSFiles(dir);
  const results = [];

  for (const file of files) {
    let content;
    try {
      content = readFileSync(file, 'utf-8');
    } catch (e) {
      continue; // File deleted between findJSFiles and read
    }
    const items = checkUndocumentedFile(content, relative(resolvedDir, file), level);
    results.push(...items);
  }

  return results;
}

export function getUndocumentedSummary(dir, level = 'tests') {
  const items = getUndocumented(dir, level);

  const byType = {
    class: items.filter(i => i.type === 'class').length,
    function: items.filter(i => i.type === 'function').length,
    method: items.filter(i => i.type === 'method').length,
  };

  const byReason = {};
  for (const item of items) {
    byReason[item.reason] = (byReason[item.reason] || 0) + 1;
  }

  return {
    total: items.length,
    byType,
    byReason,
    items: items.slice(0, 20),
  };
}
