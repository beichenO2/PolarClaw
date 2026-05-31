import { describe, expect, it } from 'vitest';
import {
  createProjectId,
  hashProjectPath,
  resolveWorkSpacePaths,
} from '../src/workspace/paths.js';

describe('workspace paths', () => {
  it('creates stable projectId and memory hash for same canonical root', () => {
    const main = resolveWorkSpacePaths('/repo', '/repo');
    const wt = resolveWorkSpacePaths('/repo/.polarclaw/worktrees/run-1', '/repo');
    expect(main.projectId).toBe(wt.projectId);
    expect(main.memoryHash).toBe(wt.memoryHash);
    expect(main.memoryDataDir).toBe(wt.memoryDataDir);
  });

  it('hashProjectPath is deterministic', () => {
    const a = hashProjectPath('/Users/mac/Polarisor/PolarUI');
    const b = hashProjectPath('/Users/mac/Polarisor/PolarUI');
    expect(a).toBe(b);
    expect(a).toHaveLength(16);
  });

  it('createProjectId includes basename and digest', () => {
    const id = createProjectId('/Users/mac/Polarisor/PolarClaw');
    expect(id.startsWith('PolarClaw--')).toBe(true);
  });
});
