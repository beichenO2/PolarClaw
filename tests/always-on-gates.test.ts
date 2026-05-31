import { describe, expect, it } from 'vitest';
import { defaultAlwaysOnConfig } from '../src/always-on/config/defaults.js';
import { evaluateAlwaysOnDiscoveryGates } from '../src/always-on/runtime/DiscoveryGates.js';
import type { AlwaysOnChannelLease, AlwaysOnDiscoveryState } from '../src/always-on/protocol/types.js';

const PROJECT = '/tmp/polarclaw-test-project';

function baseState(overrides: Partial<AlwaysOnDiscoveryState> = {}): AlwaysOnDiscoveryState {
  return {
    schemaVersion: 1,
    todayKey: '2026-05-31',
    todayRunCount: 0,
    consecutiveFailures: 0,
    ...overrides,
  };
}

function enabledConfig() {
  const config = defaultAlwaysOnConfig();
  config.enabled = true;
  config.trigger.enabled = true;
  config.projects[PROJECT] = { enabled: true };
  return config;
}

describe('evaluateAlwaysOnDiscoveryGates', () => {
  it('blocks when globally disabled', () => {
    const result = evaluateAlwaysOnDiscoveryGates({
      projectKey: PROJECT,
      config: defaultAlwaysOnConfig(),
      state: baseState(),
      leases: [],
      now: new Date(),
      projectExists: true,
      lockHeld: false,
    });
    expect(result).toEqual({ ok: false, reason: 'disabled' });
  });

  it('blocks when project disabled', () => {
    const config = enabledConfig();
    config.projects[PROJECT] = { enabled: false };
    const result = evaluateAlwaysOnDiscoveryGates({
      projectKey: PROJECT,
      config,
      state: baseState(),
      leases: [],
      now: new Date(),
      projectExists: true,
      lockHeld: false,
    });
    expect(result).toEqual({ ok: false, reason: 'project_disabled' });
  });

  it('blocks when project missing', () => {
    const result = evaluateAlwaysOnDiscoveryGates({
      projectKey: PROJECT,
      config: enabledConfig(),
      state: baseState(),
      leases: [],
      now: new Date(),
      projectExists: false,
      lockHeld: false,
    });
    expect(result).toEqual({ ok: false, reason: 'project_missing' });
  });

  it('blocks when dormant', () => {
    const result = evaluateAlwaysOnDiscoveryGates({
      projectKey: PROJECT,
      config: enabledConfig(),
      state: baseState({
        dormant: { since: '2026-05-31T00:00:00Z', lastBaselineAt: '2026-05-31T00:00:00Z' },
      }),
      leases: [],
      now: new Date(),
      projectExists: true,
      lockHeld: false,
    });
    expect(result).toEqual({ ok: false, reason: 'dormant_no_signal' });
  });

  it('blocks when agent busy via lease', () => {
    const leases: AlwaysOnChannelLease[] = [{
      schemaVersion: 1,
      channelKey: 'web',
      writerId: 'w1',
      projectKey: PROJECT,
      sessionKey: 'web:u1',
      writtenAt: new Date().toISOString(),
      agentBusy: true,
    }];
    const result = evaluateAlwaysOnDiscoveryGates({
      projectKey: PROJECT,
      config: enabledConfig(),
      state: baseState(),
      leases,
      now: new Date(),
      projectExists: true,
      lockHeld: false,
    });
    expect(result).toEqual({ ok: false, reason: 'agent_busy' });
  });

  it('blocks on recent user message', () => {
    const now = new Date('2026-05-31T12:00:00Z');
    const leases: AlwaysOnChannelLease[] = [{
      schemaVersion: 1,
      channelKey: 'web',
      writerId: 'w1',
      projectKey: PROJECT,
      sessionKey: 'web:u1',
      writtenAt: now.toISOString(),
      agentBusy: false,
      lastUserMsgAt: new Date(now.getTime() - 60_000).toISOString(),
    }];
    const result = evaluateAlwaysOnDiscoveryGates({
      projectKey: PROJECT,
      config: enabledConfig(),
      state: baseState(),
      leases,
      now,
      projectExists: true,
      lockHeld: false,
    });
    expect(result).toEqual({ ok: false, reason: 'recent_user_msg' });
  });

  it('blocks on cooldown', () => {
    const now = new Date('2026-05-31T12:00:00Z');
    const result = evaluateAlwaysOnDiscoveryGates({
      projectKey: PROJECT,
      config: enabledConfig(),
      state: baseState({ lastFireCompletedAt: new Date(now.getTime() - 30 * 60_000).toISOString() }),
      leases: [],
      now,
      projectExists: true,
      lockHeld: false,
    });
    expect(result).toEqual({ ok: false, reason: 'cooldown' });
  });

  it('blocks when daily budget exceeded', () => {
    const config = enabledConfig();
    const result = evaluateAlwaysOnDiscoveryGates({
      projectKey: PROJECT,
      config,
      state: baseState({ todayRunCount: config.trigger.dailyBudget }),
      leases: [],
      now: new Date(),
      projectExists: true,
      lockHeld: false,
    });
    expect(result).toEqual({ ok: false, reason: 'daily_budget' });
  });

  it('blocks when lock held', () => {
    const result = evaluateAlwaysOnDiscoveryGates({
      projectKey: PROJECT,
      config: enabledConfig(),
      state: baseState(),
      leases: [],
      now: new Date(),
      projectExists: true,
      lockHeld: true,
    });
    expect(result).toEqual({ ok: false, reason: 'lock_busy' });
  });

  it('allows fire when enabled and gates pass', () => {
    const result = evaluateAlwaysOnDiscoveryGates({
      projectKey: PROJECT,
      config: enabledConfig(),
      state: baseState(),
      leases: [],
      now: new Date(),
      projectExists: true,
      lockHeld: false,
      sessionInFlight: false,
    });
    expect(result).toEqual({ ok: true, lease: undefined });
  });

  it('blocks when agent session in flight', () => {
    const result = evaluateAlwaysOnDiscoveryGates({
      projectKey: PROJECT,
      config: enabledConfig(),
      state: baseState(),
      leases: [],
      now: new Date(),
      projectExists: true,
      lockHeld: false,
      sessionInFlight: true,
    });
    expect(result).toEqual({ ok: false, reason: 'agent_busy' });
  });
});
