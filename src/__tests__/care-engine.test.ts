import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createCareEngine, createCarePolicy } from '../adapters/proactive/care-engine.js';
import type { IProactiveTrigger } from '../ports/proactive.js';

function makeMemory(profiles: Record<string, string> = {}) {
  return {
    getProfile: vi.fn((userId: string, key: string) => profiles[`${userId}:${key}`] ?? null),
    getAllProfiles: vi.fn((userId: string) => {
      return Object.entries(profiles)
        .filter(([k]) => k.startsWith(`${userId}:`))
        .map(([k, v]) => ({ userId, key: k.split(':')[1], value: v }));
    }),
    saveProfile: vi.fn(),
    save: vi.fn(),
    search: vi.fn().mockReturnValue({ entries: [], total: 0 }),
    close: vi.fn(),
  } as any;
}

function makeTools(has = false) {
  return {
    has: vi.fn().mockReturnValue(has),
    execute: vi.fn().mockResolvedValue({ running: false }),
    list: vi.fn().mockReturnValue([]),
    register: vi.fn(),
    unregister: vi.fn(),
  } as any;
}

describe('createCarePolicy', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: new Date('2026-04-15T14:00:00Z') });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('generates inactivity message when user inactive long enough', async () => {
    const fiveHoursAgo = new Date(Date.now() - 5 * 3600000).toISOString();
    const memory = makeMemory({ 'u1:lastActiveAt': fiveHoursAgo });
    const policy = createCarePolicy(
      { memory, tools: makeTools() },
      { inactivityThresholdMs: 4 * 3600000 },
    );

    const trigger: IProactiveTrigger = {
      type: 'cron',
      userId: 'u1',
      reason: 'inactivity',
    };

    const msg = await policy.evaluate(trigger);
    expect(msg).not.toBeNull();
    expect(msg!.tag).toBe('inactivity-care');
    expect(msg!.prompt).toContain('系统提示');
  });

  it('returns null when user recently active', async () => {
    const tenMinAgo = new Date(Date.now() - 10 * 60000).toISOString();
    const memory = makeMemory({ 'u1:lastActiveAt': tenMinAgo });
    const policy = createCarePolicy(
      { memory, tools: makeTools() },
      { inactivityThresholdMs: 4 * 3600000 },
    );

    const msg = await policy.evaluate({
      type: 'cron', userId: 'u1', reason: 'inactivity',
    });
    expect(msg).toBeNull();
  });

  it('returns null when no lastActiveAt profile', async () => {
    const policy = createCarePolicy(
      { memory: makeMemory(), tools: makeTools() },
      { inactivityThresholdMs: 4 * 3600000 },
    );

    const msg = await policy.evaluate({
      type: 'cron', userId: 'u1', reason: 'inactivity',
    });
    expect(msg).toBeNull();
  });

  it('handles timer-complete with Clock tools', async () => {
    const policy = createCarePolicy(
      { memory: makeMemory(), tools: makeTools(true) },
      { inactivityThresholdMs: 4 * 3600000 },
    );

    const msg = await policy.evaluate({
      type: 'event', userId: 'u1', reason: 'timer-complete',
    });
    expect(msg).not.toBeNull();
    expect(msg!.tag).toBe('timer-care');
  });

  it('returns null for timer-complete without Clock tools', async () => {
    const policy = createCarePolicy(
      { memory: makeMemory(), tools: makeTools(false) },
      { inactivityThresholdMs: 4 * 3600000 },
    );

    const msg = await policy.evaluate({
      type: 'event', userId: 'u1', reason: 'timer-complete',
    });
    expect(msg).toBeNull();
  });

  it('handles scheduled care', async () => {
    const policy = createCarePolicy(
      { memory: makeMemory(), tools: makeTools() },
      { inactivityThresholdMs: 4 * 3600000 },
    );

    const msg = await policy.evaluate({
      type: 'cron', userId: 'u1', reason: 'scheduled',
      context: { prompt: '定制关怀消息' },
    });
    expect(msg).not.toBeNull();
    expect(msg!.prompt).toBe('定制关怀消息');
  });
});

describe('createCareEngine', () => {
  beforeEach(() => {
    // Pin time to 14:00 so inactivity policy's hour-of-day guard (8-22) always passes
    vi.useFakeTimers({ now: new Date('2026-04-15T14:00:00Z') });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('adds and lists rules', () => {
    const onCareMessage = vi.fn();
    const engine = createCareEngine(
      { pollIntervalMs: 999999 },
      { memory: makeMemory(), tools: makeTools(), onCareMessage },
    );
    engine.addRule({
      id: 'r1', userId: 'u1', schedule: '2h', reason: 'inactivity', enabled: true,
    });
    expect(engine.listRules()).toHaveLength(1);
    expect(engine.listRules()[0].id).toBe('r1');
  });

  it('removes rules', () => {
    const onCareMessage = vi.fn();
    const engine = createCareEngine(
      { pollIntervalMs: 999999 },
      { memory: makeMemory(), tools: makeTools(), onCareMessage },
    );
    engine.addRule({ id: 'r1', userId: 'u1', schedule: '2h', reason: 'inactivity', enabled: true });
    expect(engine.removeRule('r1')).toBe(true);
    expect(engine.listRules()).toHaveLength(0);
  });

  it('manual trigger sends care message via callback', async () => {
    const fiveHoursAgo = new Date(Date.now() - 5 * 3600000).toISOString();
    const onCareMessage = vi.fn();
    const engine = createCareEngine(
      { pollIntervalMs: 999999, minCareIntervalMs: 0, inactivityThresholdMs: 4 * 3600000 },
      {
        memory: makeMemory({ 'u1:lastActiveAt': fiveHoursAgo }),
        tools: makeTools(),
        onCareMessage,
      },
    );

    const msg = await engine.trigger({
      type: 'condition', userId: 'u1', reason: 'inactivity',
    });
    expect(msg).not.toBeNull();
    expect(onCareMessage).toHaveBeenCalledOnce();
  });

  it('respects minCareInterval throttle', async () => {
    const fiveHoursAgo = new Date(Date.now() - 5 * 3600000).toISOString();
    const onCareMessage = vi.fn();
    const engine = createCareEngine(
      { pollIntervalMs: 999999, minCareIntervalMs: 9999999, inactivityThresholdMs: 1 },
      {
        memory: makeMemory({ 'u1:lastActiveAt': fiveHoursAgo }),
        tools: makeTools(),
        onCareMessage,
      },
    );

    await engine.trigger({ type: 'condition', userId: 'u1', reason: 'inactivity' });
    const second = await engine.trigger({ type: 'condition', userId: 'u1', reason: 'inactivity' });
    expect(second).toBeNull();
    expect(onCareMessage).toHaveBeenCalledOnce();
  });

  it('start and stop do not throw', () => {
    const engine = createCareEngine(
      { pollIntervalMs: 999999 },
      { memory: makeMemory(), tools: makeTools(), onCareMessage: vi.fn() },
    );
    engine.start();
    engine.stop();
  });
});
