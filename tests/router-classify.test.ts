import { describe, expect, it } from 'vitest';
import { classifyAndRoute } from '../src/router/classifyAndRoute.js';

describe('classifyAndRoute', () => {
  it('routes always-on channels to light tier', () => {
    const decision = classifyAndRoute(
      [{ role: 'user', content: 'find a task' }],
      { channel: 'always-on/discovery' },
    );
    expect(decision.tier).toBe('light');
    expect(decision.capability).toBe('0011');
  });

  it('routes short messages to light tier', () => {
    const decision = classifyAndRoute([{ role: 'user', content: 'hi' }]);
    expect(decision.tier).toBe('light');
  });

  it('routes coding messages to standard tier', () => {
    const decision = classifyAndRoute([
      { role: 'user', content: 'fix the bug in src/agent.ts and add a test' },
    ]);
    expect(decision.tier).toBe('standard');
    expect(decision.capability).toBe('1001');
  });

  it('routes research to heavy tier', () => {
    const decision = classifyAndRoute([
      { role: 'user', content: '写一篇关于多 Agent 架构的调研综述' },
    ]);
    expect(decision.tier).toBe('heavy');
    expect(decision.capability).toBe('1110');
  });
});
