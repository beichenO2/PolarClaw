/**
 * SDK lobsters module — query project lobster status
 *
 * Returns sanitized status summaries (dormant/active/current node)
 * without exposing internal DB paths or memory implementation.
 * Sources: pilot store + local events + targets directory.
 */

import type { PilotStore } from '../adapters/pilot/store.js';
import type { LobsterStatus, LobsterState } from './types.js';
import type { EventsModule } from './events.js';
import type { TargetsModule } from './targets.js';
import { SDKError } from './types.js';

export interface LobstersModuleConfig {
  pilotStore: PilotStore;
  events: EventsModule;
  targets: TargetsModule;
}

export function createLobstersModule(config: LobstersModuleConfig) {
  const { pilotStore, events, targets } = config;

  function deriveState(projectId: string): { state: LobsterState; currentNode?: string; lastActiveAt?: string } {
    const projects = pilotStore.list();
    const matching = projects.filter(p =>
      p.name.toLowerCase() === projectId.toLowerCase() ||
      p.created_by === `project:${projectId}`,
    );

    if (matching.length === 0) {
      return { state: 'dormant' };
    }

    const running = matching.find(p => p.status === 'running');
    if (running) {
      const currentPhase = running.phases.find(ph => ph.status === 'running');
      return {
        state: 'active',
        currentNode: currentPhase?.name ?? 'initializing',
        lastActiveAt: running.updated_at,
      };
    }

    const latest = matching.sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0]!;
    if (latest.status === 'completed' || latest.status === 'draft' || latest.status === 'cancelled') {
      return {
        state: 'dormant',
        lastActiveAt: latest.updated_at,
      };
    }

    return {
      state: 'unknown',
      lastActiveAt: latest.updated_at,
    };
  }

  return {
    status(projectId: string): LobsterStatus {
      if (!projectId) {
        throw new SDKError('validation_error', 'project_id is required');
      }

      const { state, currentNode, lastActiveAt } = deriveState(projectId);

      const recentEvents = events.queryLocal({ project: projectId, limit: 100 });
      const pendingEvents = recentEvents.filter(e => {
        const age = Date.now() - new Date(e.ts).getTime();
        return age < 24 * 60 * 60 * 1000;
      }).length;

      const projectTargets = targets.list(projectId);
      const activeTargets = projectTargets.filter(t => t.status === 'active').length;
      const completedTargets = projectTargets.filter(t => t.status === 'hit').length;

      return {
        project_id: projectId,
        state,
        current_node: currentNode,
        last_active_at: lastActiveAt,
        active_targets: activeTargets,
        completed_targets: completedTargets,
        pending_events: pendingEvents,
      };
    },

    statusAll(): LobsterStatus[] {
      const projectIds = new Set<string>();

      for (const p of pilotStore.list()) {
        if (p.created_by.startsWith('project:')) {
          projectIds.add(p.created_by.slice('project:'.length));
        }
        projectIds.add(p.name.toLowerCase());
      }

      return Array.from(projectIds).map(pid => this.status(pid));
    },
  };
}

export type LobstersModule = ReturnType<typeof createLobstersModule>;
