import { describe, expect, it } from 'vitest';
import { defaultAlwaysOnConfig } from '../src/always-on/config/defaults.js';
import { evaluateAlwaysOnDiscoveryGates } from '../src/always-on/runtime/DiscoveryGates.js';
import type { AlwaysOnDiscoveryState } from '../src/always-on/protocol/types.js';

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

describe('evaluateAlwaysOnDiscoveryGates', () => {
  it('blocks when globally disabled', () => {
    const config = defaultAlwaysOnConfig();
    const result = evaluateAlwaysOnDiscoveryGates({
      projectKey: PROJECT,
      config,
      state: baseState(),
      leases: [],
      now: new Date(),
      projectExists: true,
      lockHeld: false,
    });
    expect(result).toEqual({ ok: false, reason: 'disabled' });
  });

  it('blocks when daily budget exceeded', () => {
    const config = defaultAlwaysOnConfig();
    config.enabled = true;
    config.trigger.enabled = true;
    config.projects[PROJECT] = { enabled: true };
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

  it('allows fire when enabled and gates pass', () => {
    const config = defaultAlwaysOnConfig();
    config.enabled = true;
    config.trigger.enabled = true;
    config.projects[PROJECT] = { enabled: true };
    const result = evaluateAlwaysOnDiscoveryGates({
      projectKey: PROJECT,
      config,
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
    const config = defaultAlwaysOnConfig();
    config.enabled = true;
    config.trigger.enabled = true;
    config.projects[PROJECT] = { enabled: true };
    const result = evaluateAlwaysOnDiscoveryGates({
      projectKey: PROJECT,
      config,
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
