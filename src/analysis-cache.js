import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { createHash } from 'crypto';


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
