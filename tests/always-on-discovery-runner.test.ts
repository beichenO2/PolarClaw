import { describe, expect, it, vi } from 'vitest';
import { runDiscoveryTurn, runReportTurn } from '../src/always-on/runtime/discovery-runner.js';

describe('discovery-runner', () => {
  it('returns no_plan when agent replies NO_ACTIONABLE_TASK', async () => {
    const agent = {
      handleMessage: vi.fn().mockResolvedValue({ text: 'NO_ACTIONABLE_TASK' }),
    };

    const result = await runDiscoveryTurn({
      agent,
      projectRoot: '/tmp/proj',
      runId: 'run-1',
      chatDigest: '',
      plansDir: '/tmp/plans',
    });

    expect(result.outcome).toBe('no_plan');
    expect(agent.handleMessage).toHaveBeenCalledWith(
      'always-on/discovery',
      'always-on',
      expect.stringContaining('/tmp/proj'),
      expect.stringContaining('run-1'),
      undefined,
      undefined,
      '/tmp/proj',
    );
  });

  it('returns executed when agent proposes a task', async () => {
    const agent = {
      handleMessage: vi.fn().mockResolvedValue({ text: 'Found a task', usage: { totalTokens: 42 } }),
    };

    const result = await runDiscoveryTurn({
      agent,
      projectRoot: '/tmp/proj',
      runId: 'run-2',
      chatDigest: 'recent chats',
      plansDir: '/tmp/plans',
      language: 'zh-CN',
    });

    expect(result.outcome).toBe('executed');
    expect(result.planId).toBe('run-2');
  });

  it('runs report turn on separate channel', async () => {
    const agent = {
      handleMessage: vi.fn().mockResolvedValue({ text: 'report done' }),
    };

    const result = await runReportTurn({
      agent,
      projectRoot: '/tmp/proj',
      runId: 'run-3',
      reportsDir: '/tmp/reports',
      discoveryText: 'task found',
      planTitle: 'Fix lint',
    });

    expect(result.text).toBe('report done');
    expect(agent.handleMessage).toHaveBeenCalledWith(
      'always-on/report',
      'always-on',
      expect.stringContaining('Fix lint'),
      expect.stringContaining('run-3'),
      undefined,
      undefined,
      '/tmp/proj',
    );
  });
});
