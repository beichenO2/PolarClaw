/**
 * Pilot cycle state machine — FindTarget → DrawBoard → Shoot → MoveBoard.
 *
 * The cycle allows jumping from any step to any other; strict 1→2→3→4
 * ordering is NOT enforced. MoveBoard can loop back to Shoot, DrawBoard,
 * or even FindTarget if a root target branch is invalidated.
 *
 * Stop condition flags are checked after every arrow log append.
 */

import type { TargetStore } from './targets.js';
import type { Target, TargetStatus, CycleStep, CycleState, LobsterEvent } from './types.js';

export interface StateMachineConfig {
  project: string;
  targetStore: TargetStore;
  onStatusChange?: (targetId: string, oldStatus: TargetStatus, newStatus: TargetStatus) => void;
  onEscalate?: (targetId: string, reason: string) => void;
}

export function createStateMachine(config: StateMachineConfig) {
  const { project, targetStore, onStatusChange, onEscalate } = config;

  const state: CycleState = {
    project,
    current_step: 'find_target',
    active_target_id: null,
    wake_ts: new Date().toISOString(),
    last_event: null,
  };

  function transition(step: CycleStep, targetId?: string) {
    state.current_step = step;
    if (targetId !== undefined) state.active_target_id = targetId;
  }

  function checkStopFlags(target: Target): { triggered: string[]; actions: string[] } {
    const sc = target.stop_conditions;
    const triggered: string[] = [];
    const actions: string[] = [];

    if (sc.route_broken.current >= sc.route_broken.n_failed_shots) {
      triggered.push('route_broken');
      actions.push('escalate_to_parent_drawboard');
    }

    if (sc.unreachable.current >= sc.unreachable.m_total_shots
        && sc.unreachable.moveboard_count >= 1) {
      triggered.push('unreachable');
      actions.push('mark_dead_escalate_parent');
    }

    for (const dep of sc.data_missing.depends_on) {
      if (dep.startsWith('!')) {
        triggered.push('data_missing');
        actions.push('pause_for_data');
        break;
      }
    }

    if (sc.human_intervention.irreversible_actions.length > 0
        || sc.human_intervention.auth_needed.length > 0) {
      // Only triggered when actually about to perform the action — not checked here statically.
      // The lobster LLM decides when to pause for human intervention during Shoot.
    }

    return { triggered, actions };
  }

  return {
    getState(): Readonly<CycleState> { return { ...state }; },

    setEvent(event: LobsterEvent) {
      state.last_event = event;
      state.wake_ts = event.ts;
    },

    /**
     * FindTarget: analyze project status to derive or select a root target.
     * Returns all root targets and the recommended next action.
     */
    findTarget(): {
      roots: Target[];
      active_roots: Target[];
      suggestion: 'create_root' | 'resume_active' | 'all_complete';
    } {
      transition('find_target');
      const roots = targetStore.list({ type: 'root_target' });
      const active = roots.filter(r => r.status === 'active');
      const allComplete = roots.length > 0 && roots.every(r => r.status === 'completed');

      return {
        roots,
        active_roots: active,
        suggestion: allComplete ? 'all_complete' : active.length > 0 ? 'resume_active' : 'create_root',
      };
    },

    /**
     * DrawBoard: recursively decompose a root/test target into child test targets.
     * This returns the current children for LLM to decide what to create.
     */
    drawBoard(targetId: string): {
      target: Target;
      children: Target[];
      leaf_candidates: Target[];
    } {
      transition('draw_board', targetId);
      const target = targetStore.get(targetId);
      if (!target) throw new Error(`Target ${targetId} not found`);

      const children: Target[] = [];
      for (const cid of target.children_ids) {
        const child = targetStore.get(cid);
        if (child) children.push(child);
      }

      const leafCandidates = children.filter(c =>
        c.children_ids.length === 0 && c.status === 'active');

      return { target, children, leaf_candidates: leafCandidates };
    },

    /**
     * Shoot: execute against a leaf target. The caller (runtime) runs the
     * actual test and calls appendArrowLog. This method selects the next
     * leaf to shoot at.
     */
    selectShootTarget(): Target | null {
      const active = targetStore.list({ status: 'active' });
      const leaves = active.filter(t => t.children_ids.length === 0);
      if (leaves.length === 0) return null;

      // Prefer leaves with fewer arrow logs (least attempted first)
      leaves.sort((a, b) => a.arrow_logs.length - b.arrow_logs.length);
      const leaf = leaves[0]!;

      transition('shoot', leaf.id);
      return leaf;
    },

    /**
     * Process shot result and determine next action based on stop flags.
     */
    processShot(targetId: string, outcome: 'miss' | 'hit', delta: string): {
      next_step: CycleStep;
      target: Target;
      flags: string[];
    } {
      const log = {
        ts: new Date().toISOString(),
        outcome,
        delta,
        next_action: outcome === 'hit' ? 'shoot' as const : 'moveboard' as const,
      };
      const target = targetStore.appendArrowLog(targetId, log);

      if (outcome === 'hit') {
        const oldStatus = target.status;
        targetStore.updateStatus(targetId, 'completed');
        targetStore.propagateCompletion(targetId);
        onStatusChange?.(targetId, oldStatus, 'completed');

        return { next_step: 'draw_board', target, flags: ['completed'] };
      }

      const { triggered, actions } = checkStopFlags(target);

      if (triggered.includes('route_broken')) {
        const oldStatus = target.status;
        targetStore.updateStatus(targetId, 'route_broken');
        onStatusChange?.(targetId, oldStatus, 'route_broken');
        onEscalate?.(targetId, `Route broken: ${target.stop_conditions.route_broken.current} consecutive misses`);
        return { next_step: 'draw_board', target, flags: triggered };
      }

      if (triggered.includes('unreachable')) {
        const oldStatus = target.status;
        targetStore.updateStatus(targetId, 'dead');
        onStatusChange?.(targetId, oldStatus, 'dead');
        onEscalate?.(targetId, `Unreachable: ${target.stop_conditions.unreachable.current} total shots with ${target.stop_conditions.unreachable.moveboard_count} moveboards`);
        return { next_step: 'find_target', target, flags: triggered };
      }

      if (triggered.includes('data_missing')) {
        const oldStatus = target.status;
        targetStore.updateStatus(targetId, 'paused_for_data');
        onStatusChange?.(targetId, oldStatus, 'paused_for_data');
        return { next_step: 'find_target', target, flags: triggered };
      }

      return { next_step: 'move_board', target, flags: [] };
    },

    /**
     * MoveBoard: update target after analyzing shot delta.
     * Returns next suggested step.
     */
    moveBoard(targetId: string, newTitle: string, newDescription: string): {
      target: Target;
      next_step: CycleStep;
    } {
      transition('move_board', targetId);
      const target = targetStore.moveBoard(targetId, newTitle, newDescription);
      return { target, next_step: 'shoot' };
    },

    /** Pause a target for human intervention or data. */
    pauseTarget(targetId: string, reason: 'data_missing' | 'human_intervention'): Target {
      const status: TargetStatus = reason === 'data_missing' ? 'paused_for_data' : 'paused_for_human';
      const target = targetStore.updateStatus(targetId, status);
      onStatusChange?.(targetId, 'active', status);
      return target;
    },

    /** Resume a paused target. */
    resumeTarget(targetId: string): Target {
      const target = targetStore.get(targetId);
      if (!target) throw new Error(`Target ${targetId} not found`);
      const oldStatus = target.status;
      const updated = targetStore.updateStatus(targetId, 'active');
      onStatusChange?.(targetId, oldStatus, 'active');
      return updated;
    },
  };
}

export type StateMachine = ReturnType<typeof createStateMachine>;
