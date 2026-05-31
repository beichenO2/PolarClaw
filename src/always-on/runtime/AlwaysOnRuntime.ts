import { existsSync } from 'node:fs';
import type { AlwaysOnConfig } from '../config/defaults.js';
import type { AlwaysOnChannelLease } from '../protocol/types.js';
import { evaluateAlwaysOnDiscoveryGates } from './DiscoveryGates.js';
import {
  createRunId,
  runDiscoveryTurn,
  runReportTurn,
  type DiscoveryAgent,
} from './discovery-runner.js';
import { runExecuteTurn, runReportTurnAfterExecute } from './execute-runner.js';
import { resolveAlwaysOnPaths } from '../storage/AlwaysOnPaths.js';
import { DiscoveryStateStore } from '../storage/DiscoveryStateStore.js';
import { AlwaysOnEventStore } from '../storage/AlwaysOnEventStore.js';
import { GitWorktreeProvider, isGitRepo } from '../workspace/GitWorktreeProvider.js';
import { findCanonicalProjectRoot } from '../../workspace/canonical-root.js';
import { join } from 'node:path';

export type AlwaysOnRuntimeDeps = {
  projectKey: string;
  projectRoot: string;
  alwaysOnDir: string;
  config: AlwaysOnConfig;
  agent: DiscoveryAgent;
  leases?: AlwaysOnChannelLease[];
  isSessionInFlight?: () => boolean;
  setToolContext?: (userId: string, convId: string) => void;
  chatDigest?: string;
};

export class AlwaysOnRuntime {
  private readonly paths;
  private readonly stateStore;
  private readonly events;
  private lockHeld = false;

  constructor(private readonly deps: AlwaysOnRuntimeDeps) {
    this.paths = resolveAlwaysOnPaths(this.deps.projectRoot, this.deps.alwaysOnDir);
    this.stateStore = new DiscoveryStateStore(this.paths.statePath);
    this.events = new AlwaysOnEventStore(this.paths.eventsPath);
  }

  async tick(now = new Date()): Promise<void> {
    this.events.append({
      ts: now.toISOString(),
      projectKey: this.deps.projectKey,
      phase: 'tick',
    });

    const state = this.stateStore.load(now);
    const gate = evaluateAlwaysOnDiscoveryGates({
      projectKey: this.deps.projectKey,
      config: this.deps.config,
      state,
      leases: this.deps.leases ?? [],
      now,
      projectExists: existsSync(this.deps.projectRoot),
      lockHeld: this.lockHeld,
      sessionInFlight: this.deps.isSessionInFlight?.() ?? false,
    });

    if (!gate.ok) {
      this.events.append({
        ts: now.toISOString(),
        projectKey: this.deps.projectKey,
        phase: 'gate_blocked',
        gateReason: gate.reason,
      });
      return;
    }

    await this.runDiscoveryCycle(now);
  }

  private async runDiscoveryCycle(now: Date): Promise<void> {
    const runId = createRunId(now);
    let state = this.stateStore.load(now);
    state = this.stateStore.markFireStarted(state, now);

    this.events.append({
      ts: now.toISOString(),
      projectKey: this.deps.projectKey,
      runId,
      phase: 'discovery_started',
    });

    this.lockHeld = true;
    try {
      const sessionKey = `always-on/discovery:project=${this.deps.projectKey}:run=${runId}`;
      this.deps.setToolContext?.('always-on', sessionKey);

      const discovery = await runDiscoveryTurn({
        agent: this.deps.agent,
        projectRoot: this.deps.projectRoot,
        runId,
        chatDigest: this.deps.chatDigest ?? '',
        plansDir: this.paths.plansDir,
        language: this.deps.config.language,
      });

      if (discovery.outcome === 'failed') {
        this.events.append({
          ts: now.toISOString(),
          projectKey: this.deps.projectKey,
          runId,
          phase: 'error',
          detail: discovery.text,
        });
        this.stateStore.markFireCompleted(state, 'failed', now, { runId });
        return;
      }

      if (discovery.outcome === 'no_plan') {
        this.events.append({
          ts: now.toISOString(),
          projectKey: this.deps.projectKey,
          runId,
          phase: 'no_actionable_task',
        });
        this.stateStore.markFireCompleted(state, 'no_plan', now, { runId });
        return;
      }

      this.events.append({
        ts: now.toISOString(),
        projectKey: this.deps.projectKey,
        runId,
        phase: 'discovery_completed',
        outcome: discovery.outcome,
      });

      const planPath = join(this.paths.plansDir, `${runId}.md`);
      const projectCfg = this.deps.config.projects[this.deps.projectKey];
      const executeEnabled =
        this.deps.config.execute.enabled || projectCfg?.execute === true;

      let executeText = '';
      if (executeEnabled && existsSync(planPath)) {
        const gitRoot = await findCanonicalProjectRoot(this.deps.projectRoot);
        if (await isGitRepo(gitRoot)) {
          const worktrees = new GitWorktreeProvider(gitRoot);
          let handle: Awaited<ReturnType<GitWorktreeProvider['create']>> | undefined;
          try {
            this.events.append({
              ts: now.toISOString(),
              projectKey: this.deps.projectKey,
              runId,
              phase: 'execute_started',
            });
            handle = await worktrees.create(runId);
            const execSessionKey = `always-on/execute:project=${this.deps.projectKey}:run=${runId}`;
            this.deps.setToolContext?.('always-on', execSessionKey);
            const executed = await runExecuteTurn({
              agent: this.deps.agent,
              projectRoot: this.deps.projectRoot,
              worktreePath: handle.worktreePath,
              runId,
              planPath,
              language: this.deps.config.language,
            });
            executeText = executed.text;
            this.events.append({
              ts: now.toISOString(),
              projectKey: this.deps.projectKey,
              runId,
              phase: 'execute_completed',
              detail: executeText.slice(0, 200),
            });
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            this.events.append({
              ts: now.toISOString(),
              projectKey: this.deps.projectKey,
              runId,
              phase: 'error',
              detail: `execute: ${msg}`,
            });
          } finally {
            if (handle) await worktrees.remove(handle);
          }
        }
      }

      this.events.append({
        ts: now.toISOString(),
        projectKey: this.deps.projectKey,
        runId,
        phase: 'report_started',
      });

      const reportSessionKey = `always-on/report:project=${this.deps.projectKey}:run=${runId}`;
      this.deps.setToolContext?.('always-on', reportSessionKey);

      if (executeText) {
        await runReportTurnAfterExecute({
          agent: this.deps.agent,
          projectRoot: this.deps.projectRoot,
          runId,
          reportsDir: this.paths.reportsDir,
          discoveryText: discovery.text,
          executeText,
          language: this.deps.config.language,
        });
      } else {
        await runReportTurn({
          agent: this.deps.agent,
          projectRoot: this.deps.projectRoot,
          runId,
          reportsDir: this.paths.reportsDir,
          discoveryText: discovery.text,
          language: this.deps.config.language,
        });
      }

      this.events.append({
        ts: now.toISOString(),
        projectKey: this.deps.projectKey,
        runId,
        phase: 'report_completed',
        outcome: 'executed',
      });

      this.stateStore.markFireCompleted(state, 'executed', now, {
        runId,
        planId: discovery.planId,
      });
    } finally {
      this.lockHeld = false;
    }
  }

  getRecentEvents(limit = 20) {
    return this.events.readRecent(limit);
  }
}
