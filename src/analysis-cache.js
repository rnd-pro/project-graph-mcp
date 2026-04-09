import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { createHash } from 'crypto';

export function computeSig(fileData) {
  const parts = [];

  // Function signatures
  if (fileData.functions) {
    for (const fn of fileData.functions) {
      parts.push(`fn:${fn.name}:${fn.params?.length || 0}`);
    }
  }

  // Class signatures
  if (fileData.classes) {
    for (const cls of fileData.classes) {
      parts.push(`cls:${cls.name}`);
      if (cls.methods) {
        for (const m of cls.methods) {
          parts.push(`m:${cls.name}.${m}`);
        }
      }
    }
  }

  // Exports
  if (fileData.exports) {
    for (const exp of fileData.exports) {
      parts.push(`exp:${exp}`);
    }
  }

  const hash = createHash('md5').update(parts.sort().join('|')).digest('hex');
  return hash.slice(0, 8);
}

export function computeContentHash(code) {
  return createHash('md5').update(code).digest('hex').slice(0, 8);
}

export function getCachePath(contextDir, relPath) {
  // src/parser.js → .context/.cache/src/parser.json
  const cacheName = relPath.replace(/\.[^.]+$/, '.json');
  return join(contextDir, '.cache', cacheName);
}

export function readCache(contextDir, relPath) {
  const cachePath = getCachePath(contextDir, relPath);
  try {
    if (!existsSync(cachePath)) return null;
    return JSON.parse(readFileSync(cachePath, 'utf-8'));
  } catch (e) {
    return null;
  }
}

export function writeCache(contextDir, relPath, data) {
  const cachePath = getCachePath(contextDir, relPath);
  try {
    mkdirSync(dirname(cachePath), { recursive: true });
    writeFileSync(cachePath, JSON.stringify({
      ...data,
      cachedAt: new Date().toISOString(),
    }, null, 2));
  } catch (e) {
    // Cache write failure is non-fatal
  }
}

export function isCacheValid(cached, currentSig, currentContentHash, level = 'content') {
  if (!cached) return false;
  if (!cached.sig || !cached.contentHash) return false;

  if (level === 'sig') {
    return cached.sig === currentSig;
  }

  // For body-dependent metrics, both hashes must match
  return cached.sig === currentSig && cached.contentHash === currentContentHash;
}

export function invalidateAllCaches(contextDir) {
  const cacheDir = join(contextDir, '.cache');
  try {
    if (existsSync(cacheDir)) {
      rmSync(cacheDir, { recursive: true, force: true });
    }
  } catch (e) {
    // Non-fatal
  }
}
