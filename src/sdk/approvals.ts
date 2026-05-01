/**
 * SDK approvals module — request and manage approvals for gated actions
 *
 * Approval flow:
 *   1. Project SDK calls `request()` to create a pending approval
 *   2. Human user reviews in Hub / CLI / notification
 *   3. Human calls `callback()` to approve or reject
 *   4. Project SDK polls `get()` or receives webhook notification
 *
 * Storage: SQLite alongside pilot.db for consistency.
 */

import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { ApprovalRequest, ApprovalCallbackPayload, ApprovalStatus } from './types.js';
import { SDKError } from './types.js';

export interface ApprovalsModuleConfig {
  db: Database.Database;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sdk_approvals (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  requester TEXT NOT NULL,
  action TEXT NOT NULL,
  description TEXT DEFAULT '',
  status TEXT DEFAULT 'pending',
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  resolved_by TEXT,
  comment TEXT
)`;

function parseRow(row: Record<string, unknown>): ApprovalRequest {
  return {
    id: row.id as string,
    project_id: row.project_id as string,
    requester: row.requester as string,
    action: row.action as string,
    description: (row.description as string) || '',
    status: (row.status as string) as ApprovalStatus,
    created_at: row.created_at as string,
    resolved_at: (row.resolved_at as string) || undefined,
    resolved_by: (row.resolved_by as string) || undefined,
  };
}

export function createApprovalsModule(config: ApprovalsModuleConfig) {
  const { db } = config;
  db.exec(SCHEMA);

  const insertStmt = db.prepare(`
    INSERT INTO sdk_approvals (id, project_id, requester, action, description, status, created_at)
    VALUES (@id, @project_id, @requester, @action, @description, 'pending', @created_at)
  `);

  const getStmt = db.prepare('SELECT * FROM sdk_approvals WHERE id = ?');

  const listByProjectStmt = db.prepare(
    'SELECT * FROM sdk_approvals WHERE project_id = ? ORDER BY created_at DESC LIMIT ?',
  );

  const listPendingStmt = db.prepare(
    'SELECT * FROM sdk_approvals WHERE status = \'pending\' ORDER BY created_at ASC',
  );

  const resolveStmt = db.prepare(`
    UPDATE sdk_approvals
    SET status = @status, resolved_at = @resolved_at, resolved_by = @resolved_by, comment = @comment
    WHERE id = @id AND status = 'pending'
  `);

  const expireStmt = db.prepare(`
    UPDATE sdk_approvals
    SET status = 'expired', resolved_at = @now
    WHERE status = 'pending'
      AND datetime(created_at, '+24 hours') < datetime(@now)
  `);

  return {
    request(input: {
      project_id: string;
      requester: string;
      action: string;
      description?: string;
    }): ApprovalRequest {
      if (!input.project_id || !input.requester || !input.action) {
        throw new SDKError('validation_error', 'project_id, requester, and action are required');
      }

      const id = randomUUID();
      const now = new Date().toISOString();

      insertStmt.run({
        id,
        project_id: input.project_id,
        requester: input.requester,
        action: input.action,
        description: input.description ?? '',
        created_at: now,
      });

      return this.get(id);
    },

    get(approvalId: string): ApprovalRequest {
      const row = getStmt.get(approvalId) as Record<string, unknown> | undefined;
      if (!row) {
        throw new SDKError('approval_not_found', `Approval ${approvalId} not found`);
      }
      return parseRow(row);
    },

    listByProject(projectId: string, limit = 50): ApprovalRequest[] {
      return (listByProjectStmt.all(projectId, limit) as Record<string, unknown>[]).map(parseRow);
    },

    listPending(): ApprovalRequest[] {
      return (listPendingStmt.all() as Record<string, unknown>[]).map(parseRow);
    },

    callback(payload: ApprovalCallbackPayload, resolvedBy: string): ApprovalRequest {
      if (!['approved', 'rejected'].includes(payload.status)) {
        throw new SDKError('validation_error', `Invalid approval status: ${payload.status}`);
      }

      const existing = this.get(payload.approval_id);
      if (existing.status !== 'pending') {
        throw new SDKError('validation_error', `Approval ${payload.approval_id} is already ${existing.status}`);
      }

      const now = new Date().toISOString();
      const changes = resolveStmt.run({
        id: payload.approval_id,
        status: payload.status,
        resolved_at: now,
        resolved_by: resolvedBy,
        comment: payload.comment ?? null,
      });

      if (changes.changes === 0) {
        throw new SDKError('internal_error', 'Failed to update approval — may have been resolved concurrently');
      }

      return this.get(payload.approval_id);
    },

    expireStale(): number {
      const now = new Date().toISOString();
      const result = expireStmt.run({ now });
      return result.changes;
    },
  };
}

export type ApprovalsModule = ReturnType<typeof createApprovalsModule>;
