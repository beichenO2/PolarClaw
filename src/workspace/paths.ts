import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

export const POLARCLAW_HOME = process.env.POLARCLAW_HOME ?? resolve(homedir(), '.polarclaw');
export const PROJECT_META_DIR = '.polarclaw';

export interface WorkSpacePaths {
  projectRoot: string;
  canonicalRoot: string;
  projectId: string;
  memoryHash: string;
  chatDir: string;
  memoryDataDir: string;
  skillsDir: string;
  alwaysOnDir: string;
  projectConfigPath: string;
}

export function hashProjectPath(absPath: string): string {
  return createHash('sha256').update(resolve(absPath)).digest('hex').slice(0, 16);
}

export function createProjectId(canonicalRoot: string): string {
  const base = canonicalRoot.split('/').filter(Boolean).pop() ?? 'project';
  const digest = createHash('sha1').update(resolve(canonicalRoot)).digest('hex').slice(0, 10);
  return `${base}--${digest}`;
}

export function resolveWorkSpacePaths(
  projectRoot: string,
  canonicalRoot: string,
): WorkSpacePaths {
  const resolvedRoot = resolve(projectRoot);
  const resolvedCanonical = resolve(canonicalRoot);
  const projectId = createProjectId(resolvedCanonical);
  const memoryHash = hashProjectPath(resolvedCanonical);

  return {
    projectRoot: resolvedRoot,
    canonicalRoot: resolvedCanonical,
    projectId,
    memoryHash,
    chatDir: resolve(POLARCLAW_HOME, 'projects', projectId, 'chats'),
    memoryDataDir: resolve(POLARCLAW_HOME, 'memory', 'workspaces', memoryHash),
    skillsDir: resolve(resolvedCanonical, PROJECT_META_DIR, 'skills'),
    alwaysOnDir: resolve(resolvedCanonical, PROJECT_META_DIR, 'always-on'),
    projectConfigPath: resolve(resolvedCanonical, PROJECT_META_DIR, 'polarclaw.yaml'),
  };
}
