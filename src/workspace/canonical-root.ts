import { resolve } from 'node:path';
import { findGitRoot, __clearFindGitRootCacheForTesting } from './findGitRoot.js';
import {
  resolveCanonicalRoot,
  __clearResolveCanonicalRootCacheForTesting,
} from './resolveCanonicalRoot.js';

export async function findCanonicalProjectRoot(cwd: string): Promise<string> {
  const root = await findGitRoot(cwd);
  if (!root) return resolve(cwd);
  return resolveCanonicalRoot(root);
}

export function __clearWorktreeCachesForTesting(): void {
  __clearFindGitRootCacheForTesting();
  __clearResolveCanonicalRootCacheForTesting();
}
