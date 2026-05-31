import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';

export type AlwaysOnEventPhase =
  | 'tick'
  | 'gate_blocked'
  | 'discovery_started'
  | 'discovery_completed'
  | 'execute_started'
  | 'execute_completed'
  | 'report_started'
  | 'report_completed'
  | 'no_actionable_task'
  | 'error';

export type AlwaysOnEvent = {
  ts: string;
  projectKey: string;
  runId?: string;
  phase: AlwaysOnEventPhase;
  detail?: string;
  gateReason?: string;
  outcome?: string;
};

export class AlwaysOnEventStore {
  constructor(private readonly eventsPath: string) {}

  append(event: AlwaysOnEvent): void {
    const dir = dirname(this.eventsPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    appendFileSync(this.eventsPath, JSON.stringify(event) + '\n', 'utf-8');
  }

  readRecent(limit = 50): AlwaysOnEvent[] {
    if (!existsSync(this.eventsPath)) return [];
    const lines = readFileSync(this.eventsPath, 'utf-8').trim().split('\n').filter(Boolean);
    return lines.slice(-limit).map((line) => JSON.parse(line) as AlwaysOnEvent);
  }
}
