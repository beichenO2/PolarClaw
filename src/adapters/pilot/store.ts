/**
 * Pilot project persistence — SQLite storage for Pilot projects within PolarClaw.
 *
 * Pilot is PolarClaw's "打手系统": an autonomous project execution system
 * driven by LLM Proxy, with local memory management and full architectural autonomy.
 */

import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';

export interface PilotPhase {
  name: string;
  description: string;
  status: 'pending' | 'running' | 'completed' | 'blocked';
  agent_id?: string;
  deliverables?: string[];
}

export interface PilotProject {
  id: string;
  name: string;
  description: string;
  status: string;
  input_spec: string;
  output_spec: string;
  phases: PilotPhase[];
  assigned_agents: string[];
  created_by: string;
  created_at: string;
  updated_at: string;
  started_at?: string;
  completed_at?: string;
}

const PILOT_SCHEMA = `
CREATE TABLE IF NOT EXISTS pilot_projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  status TEXT DEFAULT 'draft',
  input_spec TEXT DEFAULT '',
  output_spec TEXT DEFAULT '',
  phases_json TEXT DEFAULT '[]',
  assigned_agents TEXT DEFAULT '[]',
  created_by TEXT DEFAULT 'user',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT
);
`;

function parseRow(row: Record<string, unknown>): PilotProject {
  return {
    id: row.id as string,
    name: row.name as string,
    description: (row.description as string) || '',
    status: (row.status as string) || 'draft',
    input_spec: (row.input_spec as string) || '',
    output_spec: (row.output_spec as string) || '',
    phases: JSON.parse((row.phases_json as string) || '[]'),
    assigned_agents: JSON.parse((row.assigned_agents as string) || '[]'),
    created_by: (row.created_by as string) || 'user',
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
    started_at: row.started_at as string | undefined,
    completed_at: row.completed_at as string | undefined,
  };
}

export function createPilotStore(db: Database.Database) {
  db.exec(PILOT_SCHEMA);

  const listStmt = db.prepare('SELECT * FROM pilot_projects ORDER BY created_at DESC');
  const getStmt = db.prepare('SELECT * FROM pilot_projects WHERE id = ?');
  const insertStmt = db.prepare(`
    INSERT INTO pilot_projects (id, name, description, status, input_spec, output_spec, created_by, created_at, updated_at)
    VALUES (@id, @name, @description, @status, @inputSpec, @outputSpec, @createdBy, @createdAt, @updatedAt)
  `);
  const updatePhasesStmt = db.prepare(`
    UPDATE pilot_projects SET phases_json = @phasesJson, assigned_agents = @agents, updated_at = @updatedAt WHERE id = @id
  `);
  const updateStatusStmt = db.prepare(`
    UPDATE pilot_projects SET status = @status, updated_at = @updatedAt,
      started_at = CASE WHEN @status = 'running' AND started_at IS NULL THEN @updatedAt ELSE started_at END,
      completed_at = CASE WHEN @status IN ('completed','cancelled') THEN @updatedAt ELSE completed_at END
    WHERE id = @id
  `);

  return {
    list(): PilotProject[] {
      return (listStmt.all() as Record<string, unknown>[]).map(parseRow);
    },

    get(id: string): PilotProject | undefined {
      const row = getStmt.get(id) as Record<string, unknown> | undefined;
      return row ? parseRow(row) : undefined;
    },

    create(data: { name: string; description?: string; input_spec: string; output_spec?: string; created_by?: string }): PilotProject {
      const id = randomUUID();
      const now = new Date().toISOString();
      insertStmt.run({
        id,
        name: data.name,
        description: data.description || '',
        status: 'draft',
        inputSpec: data.input_spec,
        outputSpec: data.output_spec || '',
        createdBy: data.created_by || 'user',
        createdAt: now,
        updatedAt: now,
      });
      return this.get(id)!;
    },

    updatePhases(id: string, phases: PilotPhase[], agentIds?: string[]) {
      const project = this.get(id);
      if (!project) throw new Error('project_not_found');
      const agents = agentIds ?? project.assigned_agents;
      updatePhasesStmt.run({
        id,
        phasesJson: JSON.stringify(phases),
        agents: JSON.stringify(agents),
        updatedAt: new Date().toISOString(),
      });
    },

    updateStatus(id: string, status: string) {
      updateStatusStmt.run({ id, status, updatedAt: new Date().toISOString() });
    },
  };
}

export type PilotStore = ReturnType<typeof createPilotStore>;
