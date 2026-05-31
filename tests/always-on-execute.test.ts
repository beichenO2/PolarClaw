import { describe, expect, it } from 'vitest';
import { buildExecutePrompt } from '../src/always-on/runtime/execute-runner.js';
import { AlwaysOnWorktreeError } from '../src/always-on/workspace/GitWorktreeProvider.js';

describe('execute-runner', () => {
  it('buildExecutePrompt includes worktree path and rules', () => {
    const prompt = buildExecutePrompt({
      projectRoot: '/repo',
      worktreePath: '/wt/run-1',
      runId: 'run-1',
      planPath: '/missing/plan.md',
      language: 'zh-CN',
    });
    expect(prompt).toContain('/wt/run-1');
    expect(prompt).toContain('禁止 git push');
  });
});

describe('GitWorktreeProvider errors', () => {
  it('AlwaysOnWorktreeError preserves name', () => {
    const err = new AlwaysOnWorktreeError('test');
    expect(err.name).toBe('AlwaysOnWorktreeError');
    expect(err.message).toBe('test');
  });
});
