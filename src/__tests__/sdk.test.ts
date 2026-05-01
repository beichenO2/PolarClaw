import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { createPolarUserRegistry } from '../core/polar-user.js';
import { createPilotStore } from '../adapters/pilot/store.js';
import { createPolarClawSDK, SDKError } from '../sdk/index.js';
import type { LobsterEvent } from '../sdk/types.js';

let tmpDir: string;
let sdk: ReturnType<typeof createPolarClawSDK>;
let db: Database.Database;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'polarclaw-sdk-test-'));

  mkdirSync(join(tmpDir, 'KnowLever'), { recursive: true });
  writeFileSync(join(tmpDir, 'KnowLever', 'package.json'), '{"name":"knowlever"}');

  db = new Database(':memory:');
  db.pragma('journal_mode = WAL');

  const userRegistry = createPolarUserRegistry();
  const pilotStore = createPilotStore(db);

  sdk = createPolarClawSDK({
    userRegistry,
    pilotStore,
    pilotDb: db,
    localEventsPath: join(tmpDir, 'lobster-events.jsonl'),
    polarisorRoot: tmpDir,
  });
});

afterEach(() => {
  db.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

// ── Users ────────────────────────────────────────────────

describe('sdk.users', () => {
  it('resolves admin as human', () => {
    const result = sdk.users.resolve('admin');
    expect(result.user.kind).toBe('human');
    expect(result.user.display_name).toBe('Admin');
    expect(result.source).toBe('registry');
  });

  it('resolves project:knowlever as project', () => {
    const result = sdk.users.resolve('project:knowlever');
    expect(result.user.kind).toBe('project');
    expect(result.user.id).toBe('project:knowlever');
    expect(result.source).toBe('registry');
  });

  it('sanitizes user — no persona path or memory_namespace leaked', () => {
    const result = sdk.users.resolve('admin');
    const keys = Object.keys(result.user);
    expect(keys).not.toContain('persona');
    expect(keys).not.toContain('memory_namespace');
    expect(keys).not.toContain('group');
    expect(keys).not.toContain('project_id');
  });

  it('lists projects and humans', () => {
    expect(sdk.users.listProjects().length).toBeGreaterThan(0);
    expect(sdk.users.listHumans().length).toBeGreaterThan(0);
  });
});

// ── Events ───────────────────────────────────────────────

describe('sdk.events', () => {
  const baseEvent: LobsterEvent = {
    ts: new Date().toISOString(),
    type: 'bug',
    source_project: 'KnowLever',
    severity: 'warning',
    dedup_key: 'test-dedup-1',
    payload: { message: 'unit test event' },
  };

  it('emits event to local file', async () => {
    const result = await sdk.events.emit(baseEvent);
    expect(result.accepted).toBe(true);
    expect(result.event_id).toBeTruthy();
    expect(result.dedup_skipped).toBe(false);

    const filePath = join(tmpDir, 'lobster-events.jsonl');
    expect(existsSync(filePath)).toBe(true);

    const lines = readFileSync(filePath, 'utf8').trim().split('\n');
    expect(lines.length).toBe(1);
    const parsed = JSON.parse(lines[0]!);
    expect(parsed.type).toBe('bug');
    expect(parsed.source_project).toBe('KnowLever');
  });

  it('deduplicates same dedup_key within window', async () => {
    await sdk.events.emit(baseEvent);
    const dup = await sdk.events.emit(baseEvent);
    expect(dup.accepted).toBe(false);
    expect(dup.dedup_skipped).toBe(true);
  });

  it('rejects invalid event type', async () => {
    await expect(sdk.events.emit({
      ...baseEvent,
      type: 'nonexistent_type' as any,
    })).rejects.toThrow(SDKError);
  });

  it('rejects event missing source_project', async () => {
    await expect(sdk.events.emit({
      ...baseEvent,
      source_project: '',
    })).rejects.toThrow(SDKError);
  });

  it('queries local events by project', async () => {
    await sdk.events.emit(baseEvent);
    await sdk.events.emit({
      ...baseEvent,
      dedup_key: 'test-dedup-2',
      source_project: 'AutoOffice',
    });

    const kl = sdk.events.queryLocal({ project: 'KnowLever' });
    expect(kl.length).toBe(1);
    expect(kl[0]!.source_project).toBe('KnowLever');
  });
});

// ── Lobsters ─────────────────────────────────────────────

describe('sdk.lobsters', () => {
  it('returns dormant status for project with no pilot projects', () => {
    const status = sdk.lobsters.status('knowlever');
    expect(status.project_id).toBe('knowlever');
    expect(status.state).toBe('dormant');
    expect(status.active_targets).toBe(0);
  });
});

// ── Targets ──────────────────────────────────────────────

describe('sdk.targets', () => {
  it('creates a target with JSON file and companion .md', () => {
    const target = sdk.targets.create('KnowLever', {
      name: 'Fix RAG latency',
      description: 'Reduce p95 below 200ms',
    });

    expect(target.id).toBeTruthy();
    expect(target.project_id).toBe('KnowLever');
    expect(target.status).toBe('active');
    expect(target.board).toBe('backlog');
    expect(target.arrow_log).toEqual([]);

    const jsonPath = join(tmpDir, 'KnowLever', 'lobster', 'targets', `${target.id}.json`);
    const mdPath = join(tmpDir, 'KnowLever', 'lobster', 'targets', `${target.id}.md`);
    expect(existsSync(jsonPath)).toBe(true);
    expect(existsSync(mdPath)).toBe(true);

    const jsonContent = JSON.parse(readFileSync(jsonPath, 'utf8'));
    expect(jsonContent.name).toBe('Fix RAG latency');

    const mdContent = readFileSync(mdPath, 'utf8');
    expect(mdContent).toContain('Fix RAG latency');
  });

  it('lists targets for a project', () => {
    sdk.targets.create('KnowLever', { name: 'T1', description: 'd1' });
    sdk.targets.create('KnowLever', { name: 'T2', description: 'd2' });
    expect(sdk.targets.list('KnowLever').length).toBe(2);
  });

  it('updates target status', () => {
    const t = sdk.targets.create('KnowLever', { name: 'T1', description: 'd1' });
    const updated = sdk.targets.update('KnowLever', t.id, { status: 'hit' });
    expect(updated.status).toBe('hit');
  });

  it('appends arrow log entry', () => {
    const t = sdk.targets.create('KnowLever', { name: 'T1', description: 'd1' });
    const logged = sdk.targets.appendArrowLog('KnowLever', t.id, {
      action: 'investigation',
      outcome: 'found bottleneck in vector search',
    });
    expect(logged.arrow_log.length).toBe(1);
    expect(logged.arrow_log[0]!.ts).toBeTruthy();
    expect(logged.arrow_log[0]!.action).toBe('investigation');
  });

  it('does not expose internal paths in target data', () => {
    const t = sdk.targets.create('KnowLever', { name: 'T1', description: 'd1' });
    const json = JSON.stringify(t);
    expect(json).not.toContain(tmpDir);
    expect(json).not.toContain('/Users/');
    expect(json).not.toContain('~');
  });

  it('throws for non-existent project', () => {
    expect(() => sdk.targets.create('NonExistent', { name: 'T', description: 'd' }))
      .toThrow(SDKError);
  });

  it('throws for non-existent target', () => {
    expect(() => sdk.targets.get('KnowLever', 'fake-id'))
      .toThrow(SDKError);
  });

  it('rejects invalid status', () => {
    const t = sdk.targets.create('KnowLever', { name: 'T1', description: 'd1' });
    expect(() => sdk.targets.update('KnowLever', t.id, { status: 'invalid' as any }))
      .toThrow(SDKError);
  });
});

// ── Approvals ────────────────────────────────────────────

describe('sdk.approvals', () => {
  it('creates a pending approval', () => {
    const approval = sdk.approvals.request({
      project_id: 'knowlever',
      requester: 'project:knowlever',
      action: 'deploy_v2',
      description: 'Deploy v2 to production',
    });

    expect(approval.id).toBeTruthy();
    expect(approval.status).toBe('pending');
    expect(approval.project_id).toBe('knowlever');
  });

  it('approves via callback', () => {
    const approval = sdk.approvals.request({
      project_id: 'knowlever',
      requester: 'project:knowlever',
      action: 'deploy_v2',
    });

    const resolved = sdk.approvals.callback(
      { approval_id: approval.id, status: 'approved', comment: 'LGTM' },
      'admin',
    );

    expect(resolved.status).toBe('approved');
    expect(resolved.resolved_by).toBe('admin');
  });

  it('rejects already-resolved approval', () => {
    const approval = sdk.approvals.request({
      project_id: 'knowlever',
      requester: 'project:knowlever',
      action: 'deploy_v2',
    });

    sdk.approvals.callback(
      { approval_id: approval.id, status: 'approved' },
      'admin',
    );

    expect(() => sdk.approvals.callback(
      { approval_id: approval.id, status: 'rejected' },
      'admin',
    )).toThrow(SDKError);
  });

  it('lists pending approvals', () => {
    sdk.approvals.request({
      project_id: 'knowlever',
      requester: 'project:knowlever',
      action: 'action1',
    });
    sdk.approvals.request({
      project_id: 'autooffice',
      requester: 'project:autooffice',
      action: 'action2',
    });

    const pending = sdk.approvals.listPending();
    expect(pending.length).toBe(2);
  });
});

// ── Contract: no internal path leaks ─────────────────────

describe('contract: no internal path leaks', () => {
  it('user resolution does not leak persona path', () => {
    const result = sdk.users.resolve('admin');
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('.md');
    expect(serialized).not.toContain('/personas/');
    expect(serialized).not.toContain('memory_namespace');
  });

  it('lobster status does not leak DB path', () => {
    const status = sdk.lobsters.status('knowlever');
    const serialized = JSON.stringify(status);
    expect(serialized).not.toContain('.db');
    expect(serialized).not.toContain('/data/');
    expect(serialized).not.toContain(tmpDir);
  });
});

// ── Deprecated entries ───────────────────────────────────

describe('deprecated entries', () => {
  it('createMyClawSDK alias exists', async () => {
    const { createMyClawSDK } = await import('../sdk/index.js');
    expect(createMyClawSDK).toBe(createPolarClawSDK);
  });
});
