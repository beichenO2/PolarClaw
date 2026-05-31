import { readFile, realpath } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { LRUMap } from './LRUMap.js';

const cache = new LRUMap<string, string>(50);

export async function resolveCanonicalRoot(gitRoot: string): Promise<string> {
  const cached = cache.get(gitRoot);
  if (cached !== undefined) return cached;
  const result = await resolveImpl(gitRoot);
  cache.set(gitRoot, result);
  return result;
}

async function resolveImpl(gitRoot: string): Promise<string> {
  let gitContent: string;
  try {
    gitContent = (await readFile(join(gitRoot, '.git'), 'utf-8')).trim();
  } catch {
    return canonicalize(gitRoot);
  }
  if (!gitContent.startsWith('gitdir:')) return canonicalize(gitRoot);

  const worktreeGitDir = resolve(gitRoot, gitContent.slice('gitdir:'.length).trim());
  let commonDirRaw: string;
  try {
    commonDirRaw = (await readFile(join(worktreeGitDir, 'commondir'), 'utf-8')).trim();
  } catch {
    return canonicalize(gitRoot);
  }
  const commonDir = resolve(worktreeGitDir, commonDirRaw);

  if (resolve(dirname(worktreeGitDir)) !== join(commonDir, 'worktrees')) {
    return canonicalize(gitRoot);
  }

  let backlinkRaw: string;
  try {
    backlinkRaw = (await readFile(join(worktreeGitDir, 'gitdir'), 'utf-8')).trim();
  } catch {
    return canonicalize(gitRoot);
  }
  let backlinkResolved: string;
  let gitRootResolved: string;
  try {
    backlinkResolved = await realpath(backlinkRaw);
    gitRootResolved = await realpath(gitRoot);
  } catch {
    return canonicalize(gitRoot);
  }
  if (backlinkResolved !== join(gitRootResolved, '.git')) {
    return canonicalize(gitRoot);
  }

  if (basename(commonDir) !== '.git') return canonicalize(commonDir);
  return canonicalize(dirname(commonDir));
}

async function canonicalize(p: string): Promise<string> {
  try {
    return (await realpath(p)).normalize('NFC');
  } catch {
    return p.normalize('NFC');
  }
}

export function __clearResolveCanonicalRootCacheForTesting(): void {
  cache.clear();
}
