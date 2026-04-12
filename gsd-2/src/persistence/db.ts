import Database from 'better-sqlite3';
import { type BetterSQLite3Database, drizzle } from 'drizzle-orm/better-sqlite3';
import { integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const sessions = sqliteTable('sessions', {
  mcpSessionId: text('mcp_session_id').primaryKey(),
  agentId: text('agent_id').notNull().unique(),
  label: text('label'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  lastPingAt: integer('last_ping_at', { mode: 'timestamp_ms' }),
});

export const messages = sqliteTable('messages', {
  id: text('id').primaryKey(),
  agentId: text('agent_id').notNull(),
  payload: text('payload').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  consumedAt: integer('consumed_at', { mode: 'timestamp_ms' }),
});

/** Monotonic broadcast/event log (Phase 2). */
export const events = sqliteTable('events', {
  sequenceNumber: integer('sequence_number').primaryKey({ autoIncrement: true }),
  id: text('id').notNull().unique(),
  sourceAgentId: text('source_agent_id').notNull(),
  topic: text('topic').notNull(),
  payload: text('payload').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

export const eventCursors = sqliteTable('event_cursors', {
  agentId: text('agent_id').primaryKey(),
  lastSeenSequence: integer('last_seen_sequence').notNull().default(0),
});

export const planningDocuments = sqliteTable('planning_documents', {
  path: text('path').primaryKey(),
  content: text('content').notNull(),
  version: integer('version').notNull(),
  updatedBy: text('updated_by').notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

export const idempotencyKeys = sqliteTable('idempotency_keys', {
  key: text('key').primaryKey(),
  result: text('result').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
});

export const tasks = sqliteTable('tasks', {
  id: text('id').primaryKey(),
  status: text('status').notNull(),
  ownerAgentId: text('owner_agent_id'),
  parentTaskId: text('parent_task_id'),
  workflowStage: text('workflow_stage').notNull(),
  priority: integer('priority').notNull(),
  title: text('title').notNull(),
  description: text('description').notNull().default(''),
  module: text('module'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  leaseExpiresAt: integer('lease_expires_at', { mode: 'timestamp_ms' }),
});

export const taskDependencies = sqliteTable(
  'task_dependencies',
  {
    taskId: text('task_id').notNull(),
    dependsOnTaskId: text('depends_on_task_id').notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.taskId, t.dependsOnTaskId] }),
  }),
);

export const pathLeases = sqliteTable('path_leases', {
  leaseId: text('lease_id').primaryKey(),
  path: text('path').notNull().unique(),
  agentId: text('agent_id').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
});

export const agentCapabilities = sqliteTable('agent_capabilities', {
  agentId: text('agent_id').primaryKey(),
  rolesJson: text('roles').notNull(),
  skillsJson: text('skills').notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

export const auditLog = sqliteTable('audit_log', {
  id: text('id').primaryKey(),
  agentId: text('agent_id').notNull(),
  taskId: text('task_id'),
  action: text('action').notNull(),
  details: text('details').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  correlationId: text('correlation_id'),
});

export const agentSafetyLimits = sqliteTable('agent_safety_limits', {
  agentId: text('agent_id').primaryKey(),
  maxToolCalls: integer('max_tool_calls').notNull(),
  maxTokens: integer('max_tokens').notNull(),
  maxWallTimeMs: integer('max_wall_time_ms').notNull(),
  version: integer('version').notNull().default(0),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

export const moduleAffinity = sqliteTable(
  'module_affinity',
  {
    agentId: text('agent_id').notNull(),
    module: text('module').notNull(),
    source: text('source').notNull(),
    completedCount: integer('completed_count').notNull().default(0),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.agentId, t.module] }),
  }),
);

export const agentRoles = sqliteTable('agent_roles', {
  agentId: text('agent_id').primaryKey(),
  role: text('role').notNull(),
  status: text('status').notNull().default('active'),
  tmuxSession: text('tmux_session'),
  assignedAt: integer('assigned_at', { mode: 'timestamp_ms' }).notNull(),
  lastHeartbeat: integer('last_heartbeat', { mode: 'timestamp_ms' }),
  stateSnapshot: text('state_snapshot'),
  predecessorId: text('predecessor_id'),
});

export const reservePool = sqliteTable('reserve_pool', {
  agentId: text('agent_id').primaryKey(),
  tmuxSession: text('tmux_session').notNull(),
  status: text('status').notNull().default('standby'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  assignedAt: integer('assigned_at', { mode: 'timestamp_ms' }),
});

export const clkState = sqliteTable('clk_state', {
  id: integer('id').primaryKey().default(1),
  tickNumber: integer('tick_number').notNull().default(0),
  lastTickAt: integer('last_tick_at', { mode: 'timestamp_ms' }),
  tickIntervalMs: integer('tick_interval_ms').notNull().default(30000),
});

const hubSchema = {
  sessions,
  messages,
  events,
  eventCursors,
  planningDocuments,
  idempotencyKeys,
  tasks,
  taskDependencies,
  pathLeases,
  agentCapabilities,
  auditLog,
  agentSafetyLimits,
  moduleAffinity,
  agentRoles,
  reservePool,
  clkState,
};

export type HubDb = BetterSQLite3Database<typeof hubSchema>;
export type HubSqlite = Database.Database;

/** Open SQLite with WAL + crash-safety-oriented pragmas, apply schema if missing. */
export function createHubDatabase(dbPath: string): { sqlite: HubSqlite; db: HubDb } {
  const sqlite = new Database(dbPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('synchronous = FULL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      mcp_session_id text PRIMARY KEY NOT NULL,
      agent_id text NOT NULL UNIQUE,
      label text,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      last_ping_at integer
    );
    CREATE TABLE IF NOT EXISTS messages (
      id text PRIMARY KEY NOT NULL,
      agent_id text NOT NULL,
      payload text NOT NULL,
      created_at integer NOT NULL,
      consumed_at integer
    );
    CREATE INDEX IF NOT EXISTS idx_messages_agent_pending ON messages (agent_id) WHERE consumed_at IS NULL;
    CREATE TABLE IF NOT EXISTS events (
      sequence_number integer PRIMARY KEY AUTOINCREMENT,
      id text NOT NULL UNIQUE,
      source_agent_id text NOT NULL,
      topic text NOT NULL,
      payload text NOT NULL,
      created_at integer NOT NULL
    );
    CREATE TABLE IF NOT EXISTS event_cursors (
      agent_id text PRIMARY KEY NOT NULL,
      last_seen_sequence integer NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS planning_documents (
      path text PRIMARY KEY NOT NULL,
      content text NOT NULL,
      version integer NOT NULL,
      updated_by text NOT NULL,
      updated_at integer NOT NULL
    );
    CREATE TABLE IF NOT EXISTS idempotency_keys (
      key text PRIMARY KEY NOT NULL,
      result text NOT NULL,
      created_at integer NOT NULL,
      expires_at integer NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_idempotency_expires ON idempotency_keys (expires_at);
    CREATE TABLE IF NOT EXISTS tasks (
      id text PRIMARY KEY NOT NULL,
      status text NOT NULL,
      owner_agent_id text,
      parent_task_id text,
      workflow_stage text NOT NULL,
      priority integer NOT NULL,
      title text NOT NULL,
      description text NOT NULL DEFAULT '',
      module text,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      lease_expires_at integer
    );
    CREATE INDEX IF NOT EXISTS idx_tasks_open_claim ON tasks (status, priority, created_at);
    CREATE TABLE IF NOT EXISTS task_dependencies (
      task_id text NOT NULL,
      depends_on_task_id text NOT NULL,
      PRIMARY KEY (task_id, depends_on_task_id)
    );
    CREATE TABLE IF NOT EXISTS path_leases (
      lease_id text PRIMARY KEY NOT NULL,
      path text NOT NULL UNIQUE,
      agent_id text NOT NULL,
      created_at integer NOT NULL,
      expires_at integer NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_path_leases_expires ON path_leases (expires_at);
    CREATE TABLE IF NOT EXISTS agent_capabilities (
      agent_id text PRIMARY KEY NOT NULL,
      roles text NOT NULL,
      skills text NOT NULL,
      updated_at integer NOT NULL
    );
    CREATE TABLE IF NOT EXISTS audit_log (
      id text PRIMARY KEY NOT NULL,
      agent_id text NOT NULL,
      task_id text,
      action text NOT NULL,
      details text NOT NULL,
      created_at integer NOT NULL,
      correlation_id text
    );
    CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log (created_at);
    CREATE TABLE IF NOT EXISTS agent_safety_limits (
      agent_id text PRIMARY KEY NOT NULL,
      max_tool_calls integer NOT NULL,
      max_tokens integer NOT NULL,
      max_wall_time_ms integer NOT NULL,
      version integer NOT NULL DEFAULT 0,
      updated_at integer NOT NULL
    );
    CREATE TABLE IF NOT EXISTS module_affinity (
      agent_id text NOT NULL,
      module text NOT NULL,
      source text NOT NULL,
      completed_count integer NOT NULL DEFAULT 0,
      updated_at integer NOT NULL,
      PRIMARY KEY (agent_id, module)
    );
    CREATE INDEX IF NOT EXISTS idx_module_affinity_module ON module_affinity (module);
    CREATE TABLE IF NOT EXISTS agent_roles (
      agent_id text PRIMARY KEY NOT NULL,
      role text NOT NULL,
      status text NOT NULL DEFAULT 'active',
      tmux_session text,
      assigned_at integer NOT NULL,
      last_heartbeat integer,
      state_snapshot text,
      predecessor_id text
    );
    CREATE INDEX IF NOT EXISTS idx_agent_roles_role ON agent_roles (role);
    CREATE TABLE IF NOT EXISTS reserve_pool (
      agent_id text PRIMARY KEY NOT NULL,
      tmux_session text NOT NULL,
      status text NOT NULL DEFAULT 'standby',
      created_at integer NOT NULL,
      assigned_at integer
    );
    CREATE INDEX IF NOT EXISTS idx_reserve_pool_status ON reserve_pool (status);
    CREATE TABLE IF NOT EXISTS clk_state (
      id integer PRIMARY KEY DEFAULT 1,
      tick_number integer NOT NULL DEFAULT 0,
      last_tick_at integer,
      tick_interval_ms integer NOT NULL DEFAULT 30000
    );
    INSERT OR IGNORE INTO clk_state (id, tick_number, tick_interval_ms) VALUES (1, 0, 30000);
  `);
  const db = drizzle(sqlite, { schema: hubSchema });
  return { sqlite, db };
}
