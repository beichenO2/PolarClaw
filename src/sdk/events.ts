/**
 * SDK events module — emit and query lobster events
 *
 * Dual-channel strategy:
 *   1. Primary: POST to SOTAgent /api/lobster/events (when available)
 *   2. Fallback: append to local lobster-events.jsonl (transition period)
 *
 * The local file is the canonical shared path that PolarClaw's daemon watches.
 * Once SOTAgent_LobsterEvents is deployed, the local fallback becomes
 * read-only and will be deprecated.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { LobsterEvent, EmitEventResult, LobsterEventType, EventSeverity } from './types.js';
import { SDKError } from './types.js';

const VALID_TYPES: Set<string> = new Set<string>([
  'bug', 'digist_report', 'contract_red', 'git_push_main',
  'scheduled_health_scan', 'build_failure', 'api_5xx',
  'cli_nonzero_exit', 'custom',
]);

export interface EventsModuleConfig {
  /** SOTAgent base URL (e.g. http://127.0.0.1:12700) */
  sotAgentUrl?: string;
  /** Fallback jsonl file path (transition period) */
  localEventsPath: string;
  /** Dedup window in ms (default 600_000 = 10 min) */
  dedupWindowMs?: number;
  /** HTTP request timeout in ms */
  timeoutMs?: number;
}

interface DedupEntry {
  key: string;
  ts: number;
}

export function createEventsModule(config: EventsModuleConfig) {
  const {
    sotAgentUrl,
    localEventsPath,
    dedupWindowMs = 600_000,
    timeoutMs = 5_000,
  } = config;

  const recentEvents: DedupEntry[] = [];

  function isDuplicate(dedupKey: string): boolean {
    const now = Date.now();
    // Prune expired entries
    while (recentEvents.length > 0 && now - recentEvents[0]!.ts > dedupWindowMs) {
      recentEvents.shift();
    }
    return recentEvents.some(e => e.key === dedupKey);
  }

  function recordDedup(dedupKey: string): void {
    recentEvents.push({ key: dedupKey, ts: Date.now() });
  }

  function validateEvent(event: LobsterEvent): void {
    if (!event.type || !VALID_TYPES.has(event.type)) {
      throw new SDKError('invalid_event', `Unknown event type: ${event.type}`, {
        valid_types: Array.from(VALID_TYPES),
      });
    }
    if (!event.source_project) {
      throw new SDKError('validation_error', 'source_project is required');
    }
    if (!event.dedup_key) {
      throw new SDKError('validation_error', 'dedup_key is required');
    }
    if (!event.severity) {
      throw new SDKError('validation_error', 'severity is required');
    }
  }

  async function emitToSOTAgent(event: LobsterEvent): Promise<{ accepted: boolean; event_id: string }> {
    if (!sotAgentUrl) {
      throw new SDKError('sotagent_unreachable', 'SOTAgent URL not configured');
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(`${sotAgentUrl}/api/lobster/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(event),
        signal: controller.signal,
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new SDKError('sotagent_unreachable', `SOTAgent returned ${res.status}: ${body}`);
      }

      const data = await res.json() as { event_id?: string };
      return { accepted: true, event_id: data.event_id ?? randomUUID() };
    } catch (err) {
      if (err instanceof SDKError) throw err;
      throw new SDKError('sotagent_unreachable', `SOTAgent request failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      clearTimeout(timer);
    }
  }

  function emitToLocalFile(event: LobsterEvent): string {
    const dir = dirname(localEventsPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const eventId = randomUUID();
    const record = { ...event, _event_id: eventId };
    appendFileSync(localEventsPath, JSON.stringify(record) + '\n');
    return eventId;
  }

  return {
    async emit(event: LobsterEvent): Promise<EmitEventResult> {
      const fullEvent: LobsterEvent = {
        ...event,
        ts: event.ts || new Date().toISOString(),
      };

      validateEvent(fullEvent);

      if (isDuplicate(fullEvent.dedup_key)) {
        return {
          accepted: false,
          event_id: '',
          dedup_skipped: true,
        };
      }

      let eventId: string;
      try {
        const result = await emitToSOTAgent(fullEvent);
        eventId = result.event_id;
      } catch {
        eventId = emitToLocalFile(fullEvent);
      }

      recordDedup(fullEvent.dedup_key);

      return {
        accepted: true,
        event_id: eventId,
        dedup_skipped: false,
      };
    },

    queryLocal(opts: { project?: string; since?: string; limit?: number }): LobsterEvent[] {
      if (!existsSync(localEventsPath)) return [];

      const lines = readFileSync(localEventsPath, 'utf8')
        .split('\n')
        .filter(l => l.trim());

      let events: LobsterEvent[] = lines
        .map(line => {
          try { return JSON.parse(line) as LobsterEvent; }
          catch { return null; }
        })
        .filter((e): e is LobsterEvent => e !== null);

      if (opts.project) {
        events = events.filter(e => e.source_project === opts.project || e.target_project === opts.project);
      }
      if (opts.since) {
        events = events.filter(e => e.ts >= opts.since!);
      }

      events.sort((a, b) => b.ts.localeCompare(a.ts));

      return events.slice(0, opts.limit ?? 100);
    },

    /** Create a well-formed event for convenience */
    createEvent(
      type: LobsterEventType,
      sourceProject: string,
      severity: EventSeverity,
      dedupKey: string,
      payload: Record<string, unknown>,
      targetProject?: string,
    ): LobsterEvent {
      return {
        ts: new Date().toISOString(),
        type,
        source_project: sourceProject,
        target_project: targetProject,
        severity,
        dedup_key: dedupKey,
        payload,
      };
    },
  };
}

export type EventsModule = ReturnType<typeof createEventsModule>;
