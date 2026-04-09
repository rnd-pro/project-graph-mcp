import { resolve, extname } from 'path';
import { getSkeleton, getGraph } from './tools.js';
import { getProjectDocs } from './doc-dialect.js';
import { compressFile } from './compress.js';
import { findJSFiles } from './parser.js';

const COMPRESSIBLE = new Set(['.js', '.mjs', '.ts', '.tsx']);

function estimateTokens(value) {
  const str = typeof value === 'string' ? value : JSON.stringify(value);
  return Math.ceil(str.length / 4);
}

export async function getAiContext(dirPath, options = {}) {
  const {
    includeFiles = [],
    includeDocs = true,
    includeSkeleton = true,
  } = options;

  const projectPath = resolve(dirPath);
  const result = {};
  let totalTokens = 0;

  // 1. Skeleton
  if (includeSkeleton) {
    result.skeleton = await getSkeleton(projectPath);
    totalTokens += estimateTokens(result.skeleton);
  }

  // 2. Doc Dialect
  if (includeDocs) {
    const graph = await getGraph(projectPath);
    result.docs = getProjectDocs(graph, projectPath);
    totalTokens += estimateTokens(result.docs);
  }

  // 3. Compressed files
  if (includeFiles.length > 0) {
    result.files = {};
    const allFiles = findJSFiles(projectPath);

    for (const requestedFile of includeFiles) {
      // Find matching file (by name or path)
      const match = allFiles.find(f =>
        f.endsWith(requestedFile) || f.endsWith('/' + requestedFile)
      );

      if (!match) {
        result.files[requestedFile] = { error: `File not found: ${requestedFile}` };
        continue;
      }

      const ext = extname(match).toLowerCase();
      if (!COMPRESSIBLE.has(ext)) {
        result.files[requestedFile] = { error: `Unsupported file type: ${ext}` };
        continue;
      }

      try {
        const compressed = await compressFile(match, { beautify: true, legend: true });
        result.files[requestedFile] = compressed.code;
        totalTokens += compressed.compressed;
      } catch (e) {
        result.files[requestedFile] = { error: e.message };
      }
    }
  }

  // Estimate original size for savings calculation
  const allFiles = findJSFiles(projectPath);
  let vsOriginal = 0;
  for (const file of allFiles) {
    try {
      const { readFileSync } = await import('fs');
      vsOriginal += estimateTokens(readFileSync(file, 'utf-8'));
    } catch {
      // skip unreadable
    }
  }

  const savings = vsOriginal > 0
    ? Math.round((1 - totalTokens / vsOriginal) * 100)
    : 0;

  result.totalTokens = totalTokens;
  result.vsOriginal = vsOriginal;
  result.savings = `${savings}%`;

  return result;
}
