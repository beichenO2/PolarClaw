import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { AlwaysOnDiscoveryOutcome, AlwaysOnDiscoveryState } from '../protocol/types.js';

function todayKey(now: Date): string {
  return now.toISOString().slice(0, 10);
}

function freshState(now: Date): AlwaysOnDiscoveryState {
  return {
    schemaVersion: 1,
    todayKey: todayKey(now),
    todayRunCount: 0,
    consecutiveFailures: 0,
  };
}

export class DiscoveryStateStore {
  constructor(private readonly statePath: string) {}

  load(now = new Date()): AlwaysOnDiscoveryState {
    if (!existsSync(this.statePath)) {
      return freshState(now);
    }
    try {
      const parsed = JSON.parse(readFileSync(this.statePath, 'utf-8')) as AlwaysOnDiscoveryState;
      if (parsed.schemaVersion !== 1) return freshState(now);
      if (parsed.todayKey !== todayKey(now)) {
        return { ...parsed, todayKey: todayKey(now), todayRunCount: 0 };
      }
      return parsed;
    } catch {
      return freshState(now);
    }
  }

  save(state: AlwaysOnDiscoveryState): void {
    const dir = dirname(this.statePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(this.statePath, JSON.stringify(state, null, 2), 'utf-8');
  }

  markFireStarted(state: AlwaysOnDiscoveryState, now: Date): AlwaysOnDiscoveryState {
    const next = { ...state, lastFireStartedAt: now.toISOString() };
    this.save(next);
    return next;
  }

  markFireCompleted(
    state: AlwaysOnDiscoveryState,
    outcome: AlwaysOnDiscoveryOutcome,
    now: Date,
    extras?: { planId?: string; runId?: string },
  ): AlwaysOnDiscoveryState {
    const next: AlwaysOnDiscoveryState = {
      ...state,
      lastFireCompletedAt: now.toISOString(),
      lastFireOutcome: outcome,
      todayRunCount: state.todayRunCount + 1,
      consecutiveFailures: outcome === 'failed' ? state.consecutiveFailures + 1 : 0,
      lastPlanId: extras?.planId ?? state.lastPlanId,
      lastRunId: extras?.runId ?? state.lastRunId,
    };
    this.save(next);
    return next;
  }

  clearDormant(state: AlwaysOnDiscoveryState): AlwaysOnDiscoveryState {
    if (!state.dormant) return state;
    const next = { ...state, dormant: undefined };
    this.save(next);
    return next;
  }

  enterDormant(state: AlwaysOnDiscoveryState, now: Date): AlwaysOnDiscoveryState {
    const next: AlwaysOnDiscoveryState = {
      ...state,
      dormant: {
        since: now.toISOString(),
        lastBaselineAt: now.toISOString(),
      },
    };
    this.save(next);
    return next;
  }
}
