import type { AlwaysOnConfig } from '../config/defaults.js';
import type { WorkSpaceRegistry } from '../../workspace/index.js';
import { DiscoveryScheduler } from './DiscoveryScheduler.js';
import { AlwaysOnRuntime } from './AlwaysOnRuntime.js';
import type { DiscoveryAgent } from './discovery-runner.js';
import type { AlwaysOnEvent } from '../storage/AlwaysOnEventStore.js';

export type AlwaysOnManagerDeps = {
  config: AlwaysOnConfig;
  agent: DiscoveryAgent;
  workSpaceRegistry: WorkSpaceRegistry;
  setToolContext?: (userId: string, convId: string) => void;
  onTurnComplete?: (event: AlwaysOnEvent) => void;
};

export type AlwaysOnManager = {
  start: () => Promise<void>;
  stop: () => void;
  bindBusyCheck: (fn: () => boolean) => void;
  tickNow: () => Promise<void>;
  listRuntimes: () => string[];
};

export function createAlwaysOnManager(deps: AlwaysOnManagerDeps): AlwaysOnManager {
  const runtimes = new Map<string, AlwaysOnRuntime>();
  let busyCheck: (() => boolean) | undefined;
  let scheduler: DiscoveryScheduler | null = null;

  function ensureRuntimes(): void {
    runtimes.clear();
    for (const [projectKey, projectCfg] of Object.entries(deps.config.projects)) {
      if (!projectCfg.enabled) continue;
      const record = deps.workSpaceRegistry.getByProjectRoot(projectKey);
      const projectRoot = record?.projectRoot ?? projectKey;
      const alwaysOnDir = record?.alwaysOnDir ?? `${projectRoot}/.polarclaw/always-on`;

      runtimes.set(projectKey, new AlwaysOnRuntime({
        projectKey,
        projectRoot,
        alwaysOnDir,
        config: deps.config,
        agent: deps.agent,
        isSessionInFlight: () => busyCheck?.() ?? false,
        setToolContext: deps.setToolContext,
      }));
    }
  }

  async function onTick(): Promise<void> {
    for (const runtime of runtimes.values()) {
      await runtime.tick();
    }
  }

  return {
    async start() {
      if (!deps.config.enabled || !deps.config.trigger.enabled) return;
      ensureRuntimes();
      const tickMs = Math.max(1, deps.config.trigger.tickIntervalMinutes) * 60_000;
      scheduler = new DiscoveryScheduler({ tickIntervalMs: tickMs, onTick });
      scheduler.start();
    },

    stop() {
      scheduler?.stop();
      scheduler = null;
    },

    bindBusyCheck(fn: () => boolean) {
      busyCheck = fn;
    },

    async tickNow() {
      ensureRuntimes();
      await onTick();
    },

    listRuntimes() {
      return [...runtimes.keys()];
    },
  };
}
