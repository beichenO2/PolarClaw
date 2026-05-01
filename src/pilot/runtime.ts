/**
 * Pilot Runtime — orchestrates the full lifecycle of a project lobster:
 *
 *  1. lobster_start --project <name> → spawn
 *  2. Alignment 5-step
 *  3. State machine cycle (FindTarget → DrawBoard → Shoot → MoveBoard)
 *  4. Crystallize significant findings
 *  5. Sleep until next event or scheduled health scan
 *
 * Environment variables set by daemon on spawn:
 *   POLAR_USER_ID=project:<name>
 *   LOBSTER_PROJECT=<name>
 *   LOBSTER_EVENT_TS=<iso-ts>   (which event triggered this wake)
 */

import { join } from 'node:path';
import { existsSync, readFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { createTargetStore, type TargetStore } from './targets.js';
import { createDedup, type Dedup } from './dedup.js';
import { runAlignment, type AlignmentResult } from './align.js';
import { createStateMachine, type StateMachine } from './state-machine.js';
import type { PilotRuntimeConfig, LobsterEvent } from './types.js';

export interface PilotRuntimeDeps {
  config: PilotRuntimeConfig;
  onLog?: (level: string, msg: string) => void;
  onCrystallize?: (project: string, finding: string) => void;
  onNotifyUser?: (project: string, reason: string, details: string) => void;
}

export interface PilotRuntimeHandle {
  readonly project: string;
  readonly targetStore: TargetStore;
  readonly dedup: Dedup;
  readonly stateMachine: StateMachine;
  align(): AlignmentResult;
  getStatus(): PilotStatus;
  stop(): void;
}

export interface PilotStatus {
  project: string;
  state: string;
  active_target_id: string | null;
  target_counts: { active: number; completed: number; dead: number; paused: number; total: number };
  last_alignment_ts: string | null;
  dedup_tracked: number;
}

export function createPilotRuntime(deps: PilotRuntimeDeps): PilotRuntimeHandle {
  const { config, onLog, onCrystallize, onNotifyUser } = deps;
  const log = (level: string, msg: string) => {
    onLog?.(level, `[Pilot:${config.project}] ${msg}`);
    console.error(`[Pilot:${config.project}] ${msg}`);
  };

  const polarisorRoot = join(homedir(), 'Polarisor');
  const projectDir = join(polarisorRoot, config.project);

  if (!existsSync(config.targets_dir)) {
    mkdirSync(config.targets_dir, { recursive: true });
    log('info', `Created targets dir: ${config.targets_dir}`);
  }

  const targetStore = createTargetStore({ targetsDir: config.targets_dir });
  const dedup = createDedup({ windowMs: config.dedup_window_ms });

  let lastAlignmentTs: string | null = null;

  const stateMachine = createStateMachine({
    project: config.project,
    targetStore,
    onStatusChange(targetId, oldStatus, newStatus) {
      log('info', `Target ${targetId}: ${oldStatus} → ${newStatus}`);
      if (newStatus === 'paused_for_data' || newStatus === 'paused_for_human') {
        const target = targetStore.get(targetId);
        const reason = newStatus === 'paused_for_data' ? 'data_missing' : 'human_intervention';
        onNotifyUser?.(config.project, reason, `Target "${target?.title ?? targetId}" needs attention`);
        writeEvent({
          ts: new Date().toISOString(),
          type: 'bug',
          source_project: config.project,
          target_project: config.project,
          severity: 'medium',
          payload: { target_id: targetId, reason, old_status: oldStatus, new_status: newStatus },
          dedup_key: `${config.project}:status:${targetId}:${newStatus}`,
        });
      }
    },
    onEscalate(targetId, reason) {
      log('warn', `Escalation: ${targetId} — ${reason}`);
      onCrystallize?.(config.project, `Escalation on target ${targetId}: ${reason}`);
    },
  });

  function writeEvent(event: LobsterEvent): void {
    if (!config.events_path) return;
    try {
      const dir = join(config.events_path, '..');
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      appendFileSync(config.events_path, JSON.stringify(event) + '\n');
    } catch (err) {
      log('error', `Failed to write event: ${err}`);
    }
  }

  function align(): AlignmentResult {
    log('info', 'Running 5-step alignment...');
    const result = runAlignment({
      projectName: config.project,
      projectDir,
      eventsPath: config.events_path,
      targetStore,
    });
    lastAlignmentTs = result.ts;
    log('info', `Alignment done: ${result.active_targets.length} active targets, ${result.recent_events.length} recent events, branch=${result.git.current_branch}`);
    return result;
  }

  function getStatus(): PilotStatus {
    const all = targetStore.list();
    return {
      project: config.project,
      state: stateMachine.getState().current_step,
      active_target_id: stateMachine.getState().active_target_id,
      target_counts: {
        active: all.filter(t => t.status === 'active').length,
        completed: all.filter(t => t.status === 'completed').length,
        dead: all.filter(t => t.status === 'dead' || t.status === 'route_broken').length,
        paused: all.filter(t => t.status === 'paused_for_data' || t.status === 'paused_for_human').length,
        total: all.length,
      },
      last_alignment_ts: lastAlignmentTs,
      dedup_tracked: dedup.size(),
    };
  }

  function stop() {
    dedup.stop();
    log('info', 'Runtime stopped');
  }

  log('info', `Pilot Runtime initialized for project: ${config.project}`);
  return { project: config.project, targetStore, dedup, stateMachine, align, getStatus, stop };
}
