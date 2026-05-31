// Pattern from PilotDeck src/always-on/storage/always-on-paths.js (AGPL, rewritten)
import { resolve } from 'node:path';

export interface AlwaysOnProjectPaths {
  alwaysOnDir: string;
  statePath: string;
  eventsPath: string;
  plansDir: string;
  runsDir: string;
  reportsDir: string;
}

export function resolveAlwaysOnPaths(projectRoot: string, alwaysOnDir: string): AlwaysOnProjectPaths {
  const base = resolve(alwaysOnDir);
  return {
    alwaysOnDir: base,
    statePath: resolve(base, 'discovery-state.json'),
    eventsPath: resolve(base, 'events.jsonl'),
    plansDir: resolve(base, 'plans'),
    runsDir: resolve(base, 'runs'),
    reportsDir: resolve(projectRoot, 'output', 'always-on'),
  };
}

export function deriveDiscoverySessionKey(projectKey: string, runId: string): string {
  return `always-on/discovery:project=${projectKey}:run=${runId}`;
}

export function deriveReportSessionKey(projectKey: string, runId: string): string {
  return `always-on/report:project=${projectKey}:run=${runId}`;
}
