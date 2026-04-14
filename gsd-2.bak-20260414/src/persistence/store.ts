import { mkdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { and, eq, gt, isNull, lte, ne, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { AtomicWriteResult, MessageRow, PlanningDocument } from '../types.js';
import {
  agentCapabilities,
  eventCursors,
  events,
  idempotencyKeys,
  messages,
  planningDocuments,
  sessions,
  type HubDb,
} from './db.js';

export class HubStore {
  constructor(private readonly db: HubDb) {}

  /**
   * Bind MCP transport session to an agent. Same agent reconnecting gets a new MCP session id
   * (updates row in place). Same MCP session cannot switch to a different agent_id.
   */
  upsertSession(params: {
    mcpSessionId: string;
    agentId: string;
    label?: string | null;
  }): { ok: true } | { ok: false; reason: string } {
    const now = Date.now();
    const ts = new Date(now);

    const bound = this.db.select().from(sessions).where(eq(sessions.mcpSessionId, params.mcpSessionId)).get();
    if (bound && bound.agentId !== params.agentId) {
      return { ok: false, reason: 'This MCP session is already bound to a different agent_id' };
    }

    const byAgent = this.db.select().from(sessions).where(eq(sessions.agentId, params.agentId)).get();
    if (byAgent) {
      this.db
        .update(sessions)
        .set({
          mcpSessionId: params.mcpSessionId,
          label: params.label ?? byAgent.label,
          updatedAt: ts,
          lastPingAt: ts,
        })
        .where(eq(sessions.agentId, params.agentId))
        .run();
    } else {
      this.db
        .insert(sessions)
        .values({
          mcpSessionId: params.mcpSessionId,
          agentId: params.agentId,
          label: params.label ?? null,
          createdAt: ts,
          updatedAt: ts,
          lastPingAt: ts,
        })
        .run();
    }

    // Remove stale session rows that still point at this MCP id but another agent (should not happen)
    this.db
      .delete(sessions)
      .where(and(eq(sessions.mcpSessionId, params.mcpSessionId), ne(sessions.agentId, params.agentId)))
      .run();

    return { ok: true };
  }

  getSessionByMcpId(mcpSessionId: string):
    | {
        mcpSessionId: string;
        agentId: string;
        label: string | null;
      }
    | undefined {
    const row = this.db.select().from(sessions).where(eq(sessions.mcpSessionId, mcpSessionId)).get();
    if (!row) return undefined;
    return { mcpSessionId: row.mcpSessionId, agentId: row.agentId, label: row.label };
  }

  recordPing(mcpSessionId: string): { ok: false } | { ok: true; agentId: string } {
    const row = this.db
      .select({ agentId: sessions.agentId })
      .from(sessions)
      .where(eq(sessions.mcpSessionId, mcpSessionId))
      .get();
    if (!row) return { ok: false };
    const now = new Date();
    this.db
      .update(sessions)
      .set({ lastPingAt: now, updatedAt: now })
      .where(eq(sessions.mcpSessionId, mcpSessionId))
      .run();
    return { ok: true, agentId: row.agentId };
  }

  countSessions(): number {
    const r = this.db.select({ c: sql<number>`count(*)`.mapWith(Number) }).from(sessions).get();
    return r?.c ?? 0;
  }

  /** Used by tests and future producers; durable queue per agent. */
  enqueueMessage(agentId: string, payload: unknown): string {
    const id = nanoid();
    this.db
      .insert(messages)
      .values({
        id,
        agentId,
        payload: JSON.stringify(payload),
        createdAt: new Date(),
        consumedAt: null,
      })
      .run();
    return id;
  }

  listPendingMessages(agentId: string): MessageRow[] {
    const rows = this.db
      .select()
      .from(messages)
      .where(and(eq(messages.agentId, agentId), isNull(messages.consumedAt)))
      .orderBy(messages.createdAt)
      .all();
    return rows.map((r) => ({
      id: r.id,
      agentId: r.agentId,
      payload: JSON.parse(r.payload) as unknown,
      createdAt: r.createdAt,
      consumedAt: r.consumedAt ?? null,
    }));
  }

  consumeMessages(agentId: string, ids: string[]): number {
    if (ids.length === 0) return 0;
    const now = new Date();
    let touched = 0;
    for (const id of ids) {
      const res = this.db
        .update(messages)
        .set({ consumedAt: now })
        .where(and(eq(messages.id, id), eq(messages.agentId, agentId), isNull(messages.consumedAt)))
        .run();
      touched += res.changes;
    }
    return touched;
  }

  /** Append a durable broadcast event; returns monotonic sequence number. */
  appendBroadcastEvent(params: {
    sourceAgentId: string;
    topic: string;
    payload: unknown;
  }): { id: string; sequenceNumber: number; createdAt: Date } {
    const id = nanoid();
    const createdAt = new Date();
    const inserted = this.db
      .insert(events)
      .values({
        id,
        sourceAgentId: params.sourceAgentId,
        topic: params.topic,
        payload: JSON.stringify(params.payload),
        createdAt,
      })
      .returning({
        sequenceNumber: events.sequenceNumber,
        id: events.id,
        createdAt: events.createdAt,
      })
      .get();
    if (!inserted) {
      throw new Error('failed to insert broadcast event');
    }
    return { id: inserted.id, sequenceNumber: inserted.sequenceNumber, createdAt: inserted.createdAt };
  }

  getBroadcastEventSequenceById(eventId: string): number | undefined {
    const row = this.db
      .select({ sequenceNumber: events.sequenceNumber })
      .from(events)
      .where(eq(events.id, eventId))
      .get();
    return row?.sequenceNumber;
  }

  listBroadcastEventsAfterSequence(
    exclusiveSeq: number,
    limit: number,
  ): { id: string; sourceAgentId: string; topic: string; payload: unknown; createdAt: Date; sequenceNumber: number }[] {
    const rows = this.db
      .select()
      .from(events)
      .where(gt(events.sequenceNumber, exclusiveSeq))
      .orderBy(events.sequenceNumber)
      .limit(limit)
      .all();
    return rows.map((r) => ({
      id: r.id,
      sourceAgentId: r.sourceAgentId,
      topic: r.topic,
      payload: JSON.parse(r.payload) as unknown,
      createdAt: r.createdAt,
      sequenceNumber: r.sequenceNumber,
    }));
  }

  getEventCursor(agentId: string): number {
    const row = this.db.select().from(eventCursors).where(eq(eventCursors.agentId, agentId)).get();
    return row?.lastSeenSequence ?? 0;
  }

  /** Advance cursor to at least `lastSeenSequence` (monotonic). */
  upsertEventCursor(agentId: string, lastSeenSequence: number): void {
    const existing = this.db.select().from(eventCursors).where(eq(eventCursors.agentId, agentId)).get();
    if (!existing) {
      this.db.insert(eventCursors).values({ agentId, lastSeenSequence }).run();
      return;
    }
    if (lastSeenSequence <= existing.lastSeenSequence) return;
    this.db
      .update(eventCursors)
      .set({ lastSeenSequence })
      .where(eq(eventCursors.agentId, agentId))
      .run();
  }

  getPlanningDocument(path: string): PlanningDocument | null {
    const row = this.db.select().from(planningDocuments).where(eq(planningDocuments.path, path)).get();
    if (!row) return null;
    return {
      path: row.path,
      content: row.content,
      version: row.version,
      updated_by: row.updatedBy,
      updated_at: row.updatedAt,
    };
  }

  writePlanningDocument(params: {
    path: string;
    content: string;
    expectedVersion: number;
    updatedBy: string;
    /** When set, successful writes mirror to this filesystem root (atomic rename). */
    mirrorRoot?: string;
  }): AtomicWriteResult {
    const now = new Date();
    const row = this.db.select().from(planningDocuments).where(eq(planningDocuments.path, params.path)).get();

    if (!row) {
      if (params.expectedVersion !== 0) {
        return { status: 'conflict', version: 0 };
      }
      this.db
        .insert(planningDocuments)
        .values({
          path: params.path,
          content: params.content,
          version: 1,
          updatedBy: params.updatedBy,
          updatedAt: now,
        })
        .run();
      if (params.mirrorRoot) this.mirrorPlanningFile(params.mirrorRoot, params.path, params.content);
      return { status: 'success', version: 1 };
    }

    if (row.version !== params.expectedVersion) {
      return { status: 'conflict', version: row.version };
    }

    const nextVersion = row.version + 1;
    const upd = this.db
      .update(planningDocuments)
      .set({
        content: params.content,
        version: nextVersion,
        updatedBy: params.updatedBy,
        updatedAt: now,
      })
      .where(and(eq(planningDocuments.path, params.path), eq(planningDocuments.version, row.version)))
      .run();

    if (upd.changes === 0) {
      const latest = this.db.select().from(planningDocuments).where(eq(planningDocuments.path, params.path)).get();
      return { status: 'conflict', version: latest?.version ?? row.version };
    }

    if (params.mirrorRoot) this.mirrorPlanningFile(params.mirrorRoot, params.path, params.content);
    return { status: 'success', version: nextVersion };
  }

  private mirrorPlanningFile(root: string, relPath: string, content: string): void {
    const abs = HubStore.safeResolveUnderRoot(root, relPath);
    if (!abs) return;
    const dir = dirname(abs);
    mkdirSync(dir, { recursive: true });
    const tmp = `${abs}.${process.pid}.${Date.now()}.tmp`;
    try {
      writeFileSync(tmp, content, 'utf8');
      renameSync(tmp, abs);
    } finally {
      try {
        unlinkSync(tmp);
      } catch {
        /* ignore missing tmp */
      }
    }
  }

  static safeResolveUnderRoot(root: string, relPath: string): string | null {
    const rootAbs = resolve(root);
    const fileAbs = resolve(root, relPath);
    const prefix = rootAbs.endsWith(sep) ? rootAbs : rootAbs + sep;
    if (fileAbs !== rootAbs && !fileAbs.startsWith(prefix)) return null;
    return fileAbs;
  }

  getIdempotencyResult(key: string): unknown | null {
    this.purgeExpiredIdempotencyKeys();
    const row = this.db.select().from(idempotencyKeys).where(eq(idempotencyKeys.key, key)).get();
    if (!row) return null;
    if (row.expiresAt.getTime() < Date.now()) return null;
    return JSON.parse(row.result) as unknown;
  }

  setIdempotencyResult(key: string, result: unknown, ttlMs: number): void {
    const now = Date.now();
    this.db
      .insert(idempotencyKeys)
      .values({
        key,
        result: JSON.stringify(result),
        createdAt: new Date(now),
        expiresAt: new Date(now + ttlMs),
      })
      .onConflictDoUpdate({
        target: idempotencyKeys.key,
        set: {
          result: sql`excluded.result`,
          createdAt: sql`excluded.created_at`,
          expiresAt: sql`excluded.expires_at`,
        },
      })
      .run();
  }

  private purgeExpiredIdempotencyKeys(): void {
    this.db.delete(idempotencyKeys).where(lte(idempotencyKeys.expiresAt, new Date())).run();
  }

  upsertAgentCapabilities(agentId: string, roles: string[], skills: string[]): void {
    const now = new Date();
    const row = {
      agentId,
      rolesJson: JSON.stringify(roles),
      skillsJson: JSON.stringify(skills),
      updatedAt: now,
    };
    this.db
      .insert(agentCapabilities)
      .values(row)
      .onConflictDoUpdate({
        target: agentCapabilities.agentId,
        set: {
          rolesJson: row.rolesJson,
          skillsJson: row.skillsJson,
          updatedAt: now,
        },
      })
      .run();
  }

  getAgentCapabilities(agentId: string): { roles: string[]; skills: string[] } | undefined {
    const r = this.db.select().from(agentCapabilities).where(eq(agentCapabilities.agentId, agentId)).get();
    if (!r) return undefined;
    return { roles: JSON.parse(r.rolesJson) as string[], skills: JSON.parse(r.skillsJson) as string[] };
  }

  listAgentIdsWithSkill(skill: string): string[] {
    const rows = this.db.select().from(agentCapabilities).all();
    const matches: string[] = [];
    for (const r of rows) {
      const skills = JSON.parse(r.skillsJson) as string[];
      if (skills.includes(skill)) matches.push(r.agentId);
    }
    return matches;
  }
}
