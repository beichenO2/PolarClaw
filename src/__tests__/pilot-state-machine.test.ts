import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createTargetStore } from '../pilot/targets.js';
import { createStateMachine } from '../pilot/state-machine.js';

describe('StateMachine', () => {
  let dir: string;
  let store: ReturnType<typeof createTargetStore>;
  let sm: ReturnType<typeof createStateMachine>;
  const statusChanges: Array<{ id: string; from: string; to: string }> = [];

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'sm-test-'));
    store = createTargetStore({ targetsDir: dir });
    statusChanges.length = 0;
    sm = createStateMachine({
      project: 'test-project',
      targetStore: store,
      onStatusChange(id, old, next) {
        statusChanges.push({ id, from: old, to: next });
      },
    });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('findTarget returns create_root when no targets exist', () => {
    const result = sm.findTarget();
    expect(result.suggestion).toBe('create_root');
    expect(result.roots).toEqual([]);
  });

  it('findTarget returns resume_active when active roots exist', () => {
    store.create({ id: 'root-1', type: 'root_target', title: 'Root', description: '' });
    const result = sm.findTarget();
    expect(result.suggestion).toBe('resume_active');
    expect(result.active_roots.length).toBe(1);
  });

  it('findTarget returns all_complete when all roots completed', () => {
    store.create({ id: 'root-done', type: 'root_target', title: 'Done root', description: '' });
    store.updateStatus('root-done', 'completed');
    const result = sm.findTarget();
    expect(result.suggestion).toBe('all_complete');
  });

  it('drawBoard returns target with children', () => {
    store.create({ id: 'db-root', type: 'root_target', title: 'Root', description: '' });
    store.create({ id: 'db-c1', type: 'test_target', title: 'C1', description: '', parent_id: 'db-root' });
    store.create({ id: 'db-c2', type: 'test_target', title: 'C2', description: '', parent_id: 'db-root' });

    const result = sm.drawBoard('db-root');
    expect(result.children.length).toBe(2);
    expect(result.leaf_candidates.length).toBe(2);
  });

  it('selectShootTarget picks least-attempted leaf', () => {
    store.create({ id: 'shoot-r', type: 'root_target', title: 'R', description: '' });
    store.create({ id: 'shoot-a', type: 'test_target', title: 'A', description: '', parent_id: 'shoot-r' });
    store.create({ id: 'shoot-b', type: 'test_target', title: 'B', description: '', parent_id: 'shoot-r' });

    store.appendArrowLog('shoot-a', { ts: new Date().toISOString(), outcome: 'miss', delta: '', next_action: 'shoot' });
    store.appendArrowLog('shoot-a', { ts: new Date().toISOString(), outcome: 'miss', delta: '', next_action: 'shoot' });

    const leaf = sm.selectShootTarget();
    expect(leaf).not.toBeNull();
    expect(leaf!.id).toBe('shoot-b');
  });

  it('processShot with hit marks completed and propagates', () => {
    store.create({ id: 'hit-root', type: 'root_target', title: 'Root', description: '' });
    store.create({ id: 'hit-leaf', type: 'test_target', title: 'Leaf', description: '', parent_id: 'hit-root' });

    const result = sm.processShot('hit-leaf', 'hit', 'Perfect hit');
    expect(result.flags).toContain('completed');
    expect(store.get('hit-leaf')!.status).toBe('completed');
    expect(store.get('hit-root')!.status).toBe('completed');
  });

  it('processShot triggers route_broken after N misses', () => {
    store.create({
      id: 'rb-leaf',
      type: 'test_target',
      title: 'Route broken test',
      description: '',
      stop_conditions: {
        route_broken: { n_failed_shots: 2, current: 0 },
        data_missing: { depends_on: [] },
        human_intervention: { irreversible_actions: [], auth_needed: [] },
        unreachable: { m_total_shots: 5, current: 0, moveboard_count: 0 },
        completed: {},
      },
    });

    sm.processShot('rb-leaf', 'miss', 'Off');
    const result = sm.processShot('rb-leaf', 'miss', 'Still off');
    expect(result.flags).toContain('route_broken');
    expect(store.get('rb-leaf')!.status).toBe('route_broken');
  });

  it('moveBoard updates title and resets counters', () => {
    store.create({ id: 'mb-leaf', type: 'test_target', title: 'Original', description: 'Orig' });
    store.appendArrowLog('mb-leaf', { ts: new Date().toISOString(), outcome: 'miss', delta: '', next_action: 'moveboard' });

    const result = sm.moveBoard('mb-leaf', 'Adjusted', 'New approach');
    expect(result.target.title).toBe('Adjusted');
    expect(result.target.stop_conditions.route_broken.current).toBe(0);
    expect(result.target.stop_conditions.unreachable.moveboard_count).toBe(1);
    expect(result.next_step).toBe('shoot');
  });

  it('state tracks current step and active target', () => {
    store.create({ id: 'track-root', type: 'root_target', title: 'Track', description: '' });

    sm.findTarget();
    expect(sm.getState().current_step).toBe('find_target');

    sm.drawBoard('track-root');
    expect(sm.getState().current_step).toBe('draw_board');
    expect(sm.getState().active_target_id).toBe('track-root');
  });
});
