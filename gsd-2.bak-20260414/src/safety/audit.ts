import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { auditLog, type HubDb } from '../persistence/db.js';
import type { AuditEntry } from '../types.js';

export class AuditJournal {
  constructor(private readonly db: HubDb) {}

  append(entry: {
    agentId: string;
    taskId: string | null;
    action: string;
    details: unknown;
    correlationId: string | null;
  }): AuditEntry {
    const id = nanoid();
    const now = new Date();
    this.db
      .insert(auditLog)
      .values({
        id,
        agentId: entry.agentId,
        taskId: entry.taskId,
        action: entry.action,
        details: JSON.stringify(entry.details),
        createdAt: now,
        correlationId: entry.correlationId,
      })
      .run();
    return {
      id,
      agent_id: entry.agentId,
      task_id: entry.taskId,
      action: entry.action,
      details: entry.details,
      timestamp: now,
      correlation_id: entry.correlationId,
    };
  }

  list(params: {
    afterId?: string;
    limit: number;
    agentId?: string;
    taskId?: string;
  }): { entries: AuditEntry[]; cursor?: string } {
    let gateMs = 0;
    if (params.afterId) {
      const gate = this.db.select().from(auditLog).where(eq(auditLog.id, params.afterId)).get();
      if (gate) gateMs = gate.createdAt.getTime();
    }

    const rows = this.db.select().from(auditLog).all();
    let filtered = rows.filter((r) => r.createdAt.getTime() > gateMs);
    if (params.agentId) {
      filtered = filtered.filter((r) => r.agentId === params.agentId);
    }
    if (params.taskId) {
      filtered = filtered.filter((r) => r.taskId === params.taskId);
    }
    filtered.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    const slice = filtered.slice(0, params.limit);
    const entries: AuditEntry[] = slice.map((r) => ({
      id: r.id,
      agent_id: r.agentId,
      task_id: r.taskId ?? null,
      action: r.action,
      details: JSON.parse(r.details) as unknown,
      timestamp: r.createdAt,
      correlation_id: r.correlationId ?? null,
    }));
    const cursor = slice.length > 0 ? slice[slice.length - 1].id : undefined;
    return { entries, cursor };
  }
}
