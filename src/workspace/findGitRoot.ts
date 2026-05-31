import { stat } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { LRUMap } from './LRUMap.js';

const NOT_FOUND = Symbol('findGitRoot.NOT_FOUND');
const cache = new LRUMap<string, string | typeof NOT_FOUND>(50);

export async function findGitRoot(startPath: string): Promise<string | null> {
  const cwd = resolve(startPath);
  const cached = cache.get(cwd);
  if (cached === NOT_FOUND) return null;
  if (typeof cached === 'string') return cached;

  let current = cwd;
  const root = current.substring(0, current.indexOf(sep) + 1) || sep;

  while (current !== root) {
    if (await hasGit(current)) {
      const resolved = current.normalize('NFC');
      cache.set(cwd, resolved);
      return resolved;
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }

  if (await hasGit(root)) {
    const resolved = root.normalize('NFC');
    cache.set(cwd, resolved);
    return resolved;
  }

  cache.set(cwd, NOT_FOUND);
  return null;
}

async function hasGit(dir: string): Promise<boolean> {
  try {
    const stats = await stat(join(dir, '.git'));
    return stats.isDirectory() || stats.isFile();
  } catch {
    return false;
  }
}

export function __clearFindGitRootCacheForTesting(): void {
  cache.clear();
}
