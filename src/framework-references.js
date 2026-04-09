import { readFileSync, readdirSync, existsSync, writeFileSync } from 'fs';
import { join, basename, dirname } from 'path';
import { fileURLToPath } from 'url';
import { detectProjectRuleSets } from './custom-rules.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REFERENCES_DIR = join(__dirname, '..', 'references');

const REMOTE_SOURCES = {
  'symbiote-3x': 'https://raw.githubusercontent.com/symbiotejs/symbiote.js/main/AI_REFERENCE.md',
};

const cache = new Map();

const CACHE_TTL = 60 * 60 * 1000;

async function fetchReference(name) {
  const url = REMOTE_SOURCES[name];
  const localPath = join(REFERENCES_DIR, `${name}.md`);

  // Check in-memory cache
  const cached = cache.get(name);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) {
    return { content: cached.content, source: 'cache' };
  }

  // Try fetching from GitHub
  if (url) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (response.ok) {
        const content = await response.text();
        cache.set(name, { content, fetchedAt: Date.now() });

        // Update local file as backup
        try {
          writeFileSync(localPath, content, 'utf-8');
        } catch (e) {
          // Write failure is non-critical
        }

        return { content, source: `github (${url})` };
      }
    } catch (e) {
      // Fetch failed — fall back to local
    }
  }

  // Fall back to local file
  if (existsSync(localPath)) {
    const content = readFileSync(localPath, 'utf-8');
    cache.set(name, { content, fetchedAt: Date.now() });
    return { content, source: 'local' };
  }

  return { content: '', source: 'not_found' };
}

const RULESET_TO_REFERENCE = {
  'symbiote-3x': 'symbiote-3x',
  'symbiote-2x': 'symbiote-3x',
};

function listAvailable() {
  const names = new Set(Object.keys(REMOTE_SOURCES));

  if (existsSync(REFERENCES_DIR)) {
    for (const f of readdirSync(REFERENCES_DIR)) {
      if (f.endsWith('.md')) {
        names.add(basename(f, '.md'));
      }
    }
  }

  return [...names];
}

export async function getFrameworkReference(options = {}) {
  const available = listAvailable();

  // Explicit framework requested
  if (options.framework) {
    if (!available.includes(options.framework)) {
      return {
        error: `Framework reference '${options.framework}' not found`,
        available,
      };
    }

    const { content, source } = await fetchReference(options.framework);
    if (!content) {
      return { error: `Failed to load reference '${options.framework}'`, available };
    }

    return {
      framework: options.framework,
      source,
      lines: content.split('\n').length,
      content,
    };
  }

  // Auto-detect from project path
  if (options.path) {
    const { detected, reasons } = detectProjectRuleSets(options.path);

    const matchedRefs = [];
    for (const ruleset of detected) {
      const refName = RULESET_TO_REFERENCE[ruleset];
      if (refName && available.includes(refName) && !matchedRefs.includes(refName)) {
        matchedRefs.push(refName);
      }
    }

    if (matchedRefs.length === 0) {
      return {
        error: 'No framework references found for this project',
        detected,
        reasons,
        available,
      };
    }

    const results = await Promise.all(matchedRefs.map(fetchReference));
    const contents = results.map(r => r.content).filter(Boolean);
    const sources = results.map(r => r.source);

    return {
      frameworks: matchedRefs,
      sources,
      detected: { rulesets: detected, reasons },
      lines: contents.reduce((sum, c) => sum + c.split('\n').length, 0),
      content: contents.join('\n\n---\n\n'),
    };
  }

  // No framework specified — list available
  return {
    error: 'Specify framework name or path for auto-detection',
    available: available.map(name => ({
      name,
      remote: !!REMOTE_SOURCES[name],
      url: REMOTE_SOURCES[name] ?? null,
    })),
  };
}
