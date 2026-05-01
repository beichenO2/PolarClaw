import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { existsSync, readFileSync } from 'node:fs';
import { createTargetStore } from '../pilot/targets.js';
import { validateTarget } from '../pilot/target-validator.js';

describe('TargetStore', () => {
  let dir: string;
  let store: ReturnType<typeof createTargetStore>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pilot-test-'));
    store = createTargetStore({ targetsDir: dir });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('creates a root target with JSON + MD files', () => {
    const target = store.create({
      id: 'test-root-001',
      type: 'root_target',
      title: 'Test root target',
      description: 'Root level objective',
    });

    expect(target.id).toBe('test-root-001');
    expect(target.type).toBe('root_target');
    expect(target.status).toBe('active');
    expect(target.children_ids).toEqual([]);
    expect(target.arrow_logs).toEqual([]);
    expect(target.parent_id).toBeNull();

    expect(existsSync(join(dir, 'test-root-001.json'))).toBe(true);
    expect(existsSync(join(dir, 'test-root-001.md'))).toBe(true);

    const md = readFileSync(join(dir, 'test-root-001.md'), 'utf8');
    expect(md).toContain('# Test root target');
  });

  it('creates child target and links to parent', () => {
    store.create({
      id: 'parent-001',
      type: 'root_target',
      title: 'Parent',
      description: 'Parent target',
    });

    const child = store.create({
      id: 'child-001',
      type: 'test_target',
      title: 'Child test',
      description: 'A test target',
      parent_id: 'parent-001',
      leaf_test: 'pnpm test contracts/test.ts',
    });

    expect(child.parent_id).toBe('parent-001');
    expect(child.stop_conditions.completed.leaf_test).toBe('pnpm test contracts/test.ts');

    const parent = store.get('parent-001')!;
    expect(parent.children_ids).toContain('child-001');
  });

  it('rejects duplicate ID', () => {
    store.create({ id: 'dup-001', type: 'root_target', title: 'First', description: '' });
    expect(() => store.create({ id: 'dup-001', type: 'root_target', title: 'Second', description: '' }))
      .toThrow('already exists');
  });

  it('lists targets with filter', () => {
    store.create({ id: 'r1', type: 'root_target', title: 'Root 1', description: '' });
    store.create({ id: 't1', type: 'test_target', title: 'Test 1', description: '' });
    store.create({ id: 't2', type: 'test_target', title: 'Test 2', description: '' });

    expect(store.list().length).toBe(3);
    expect(store.list({ type: 'root_target' }).length).toBe(1);
    expect(store.list({ type: 'test_target' }).length).toBe(2);
  });

  it('updates target status', () => {
    store.create({ id: 'st-001', type: 'test_target', title: 'Status test', description: '' });
    const updated = store.updateStatus('st-001', 'completed');
    expect(updated.status).toBe('completed');
    expect(store.get('st-001')!.status).toBe('completed');
  });

  it('appends arrow log and increments counters on miss', () => {
    store.create({ id: 'arrow-001', type: 'test_target', title: 'Arrow test', description: '' });
    const updated = store.appendArrowLog('arrow-001', {
      ts: new Date().toISOString(),
      outcome: 'miss',
      delta: 'Off by 20%',
      next_action: 'shoot',
    });

    expect(updated.arrow_logs.length).toBe(1);
    expect(updated.stop_conditions.route_broken.current).toBe(1);
    expect(updated.stop_conditions.unreachable.current).toBe(1);
  });

  it('resets route_broken counter on hit', () => {
    store.create({ id: 'reset-001', type: 'test_target', title: 'Reset test', description: '' });
    store.appendArrowLog('reset-001', { ts: new Date().toISOString(), outcome: 'miss', delta: '', next_action: 'shoot' });
    store.appendArrowLog('reset-001', { ts: new Date().toISOString(), outcome: 'miss', delta: '', next_action: 'shoot' });

    const after2miss = store.get('reset-001')!;
    expect(after2miss.stop_conditions.route_broken.current).toBe(2);

    store.appendArrowLog('reset-001', { ts: new Date().toISOString(), outcome: 'hit', delta: 'bullseye', next_action: 'shoot' });
    const afterHit = store.get('reset-001')!;
    expect(afterHit.stop_conditions.route_broken.current).toBe(0);
  });

  it('moveBoard updates title/description and increments moveboard_count', () => {
    store.create({ id: 'move-001', type: 'test_target', title: 'Original', description: 'Original desc' });
    const moved = store.moveBoard('move-001', 'New title', 'New desc');
    expect(moved.title).toBe('New title');
    expect(moved.description).toBe('New desc');
    expect(moved.stop_conditions.unreachable.moveboard_count).toBe(1);
    expect(moved.stop_conditions.route_broken.current).toBe(0);
  });

  it('propagates completion from leaf to parent', () => {
    store.create({ id: 'pp-root', type: 'root_target', title: 'Root', description: '' });
    store.create({ id: 'pp-c1', type: 'test_target', title: 'C1', description: '', parent_id: 'pp-root' });
    store.create({ id: 'pp-c2', type: 'test_target', title: 'C2', description: '', parent_id: 'pp-root' });

    store.updateStatus('pp-c1', 'completed');
    store.propagateCompletion('pp-c1');
    expect(store.get('pp-root')!.status).toBe('active');

    store.updateStatus('pp-c2', 'completed');
    store.propagateCompletion('pp-c2');
    expect(store.get('pp-root')!.status).toBe('completed');
  });

  it('deletes target and unlinks from parent', () => {
    store.create({ id: 'del-root', type: 'root_target', title: 'Root', description: '' });
    store.create({ id: 'del-child', type: 'test_target', title: 'Child', description: '', parent_id: 'del-root' });

    expect(store.get('del-root')!.children_ids).toContain('del-child');
    store.delete('del-child');
    expect(store.get('del-child')).toBeUndefined();
    expect(store.get('del-root')!.children_ids).not.toContain('del-child');
  });
});

describe('validateTarget', () => {
  it('accepts a valid target', () => {
    const target = {
      id: 'valid-001',
      type: 'test_target',
      title: 'Valid target',
      description: 'A valid target',
      parent_id: null,
      children_ids: [],
      status: 'active',
      stop_conditions: {
        route_broken: { n_failed_shots: 3, current: 0 },
        data_missing: { depends_on: [] },
        human_intervention: { irreversible_actions: [], auth_needed: [] },
        unreachable: { m_total_shots: 5, current: 0, moveboard_count: 0 },
        completed: {},
      },
      arrow_logs: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    expect(validateTarget(target)).toEqual([]);
  });

  it('rejects invalid ID format', () => {
    const errors = validateTarget({
      id: 'INVALID ID',
      type: 'root_target',
      title: 'x',
      description: '',
      parent_id: null,
      children_ids: [],
      status: 'active',
      stop_conditions: {
        route_broken: { n_failed_shots: 3, current: 0 },
        data_missing: { depends_on: [] },
        human_intervention: { irreversible_actions: [], auth_needed: [] },
        unreachable: { m_total_shots: 5, current: 0, moveboard_count: 0 },
        completed: {},
      },
      arrow_logs: [],
      created_at: '',
      updated_at: '',
    });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain('id');
  });

  it('rejects non-object input', () => {
    expect(validateTarget(null)).toEqual(['Target must be a non-null object']);
    expect(validateTarget('string')).toEqual(['Target must be a non-null object']);
  });
});
