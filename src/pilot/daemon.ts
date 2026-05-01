/**
 * Pilot Daemon — watches lobster-events.jsonl and spawns project lobster
 * instances on relevant events. Also handles scheduled health scans.
 *
 * Architecture:
 * - Primary: event-driven via fs.watch on lobster-events.jsonl
 * - Secondary: scheduled health scan (default 03:00 local time)
 * - Dedup: same event type+project in 10min → single activation
 *
 * Compatible with the "定时 + watch 文件" dual-track approach recommended
 * in the design when full event bus is not yet integrated.
 */

import { existsSync, readFileSync, watchFile, unwatchFile, mkdirSync, writeFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { createDedup } from './dedup.js';
import { createPilotRuntime, type PilotRuntimeHandle } from './runtime.js';
import type { LobsterEvent, PilotRuntimeConfig } from './types.js';

export interface DaemonConfig {
  eventsPath: string;
  polarisorRoot: string;
  dedupWindowMs: number;
  healthScanHour: number;
  managedProjects: string[];
}

export interface DaemonHandle {
  start(): void;
  stop(): void;
  getActiveRuntimes(): Map<string, PilotRuntimeHandle>;
  triggerHealthScan(): void;
  processEvent(event: LobsterEvent): void;
}

export function createDaemon(config: DaemonConfig): DaemonHandle {
  const { eventsPath, polarisorRoot, dedupWindowMs, healthScanHour, managedProjects } = config;

  const dedup = createDedup({ windowMs: dedupWindowMs });
  const runtimes = new Map<string, PilotRuntimeHandle>();

  let healthTimer: ReturnType<typeof setInterval> | null = null;
  let lastFileSize = 0;
  let watching = false;

  function log(msg: string) {
    console.error(`[PilotDaemon] ${msg}`);
  }

  function ensureEventsFile() {
    if (!existsSync(eventsPath)) {
      mkdirSync(dirname(eventsPath), { recursive: true });
      writeFileSync(eventsPath, '');
      log(`Created events file: ${eventsPath}`);
    }
  }

  function getOrCreateRuntime(project: string): PilotRuntimeHandle {
    let runtime = runtimes.get(project);
    if (runtime) return runtime;

    const projectDir = join(polarisorRoot, project);
    const targetsDir = join(projectDir, 'lobster', 'targets');

    const runtimeConfig: PilotRuntimeConfig = {
      project,
      events_path: eventsPath,
      targets_dir: targetsDir,
      dedup_window_ms: dedupWindowMs,
      health_scan_cron: `0 ${healthScanHour} * * *`,
      route_broken_n: 3,
      unreachable_m: 5,
    };

    runtime = createPilotRuntime({
      config: runtimeConfig,
      onCrystallize(proj, finding) {
        log(`[${proj}] Crystallize: ${finding}`);
      },
      onNotifyUser(proj, reason, details) {
        log(`[${proj}] Notify: ${reason} — ${details}`);
      },
    });

    runtimes.set(project, runtime);
    return runtime;
  }

  function processEvent(event: LobsterEvent): void {
    const targetProject = event.target_project || event.source_project;
    if (!targetProject) return;

    if (!managedProjects.includes(targetProject)) {
      log(`Ignoring event for unmanaged project: ${targetProject}`);
      return;
    }

    if (!dedup.shouldProcess(event.dedup_key)) {
      log(`Dedup: skipping ${event.dedup_key}`);
      return;
    }

    log(`Event → ${targetProject}: type=${event.type}, severity=${event.severity}`);

    const runtime = getOrCreateRuntime(targetProject);
    runtime.stateMachine.setEvent(event);

    try {
      runtime.align();
    } catch (err) {
      log(`Alignment failed for ${targetProject}: ${err}`);
    }
  }

  function readNewEvents(): LobsterEvent[] {
    if (!existsSync(eventsPath)) return [];

    try {
      const stat = statSync(eventsPath);
      if (stat.size <= lastFileSize) return [];

      const raw = readFileSync(eventsPath, 'utf8');
      const lines = raw.split('\n').filter(l => l.trim());

      const currentLines = lines.length;
      const prevLines = lastFileSize === 0 ? 0 : raw.slice(0, lastFileSize).split('\n').filter(l => l.trim()).length;
      lastFileSize = stat.size;

      const newLines = lines.slice(prevLines);
      const events: LobsterEvent[] = [];
      for (const line of newLines) {
        try { events.push(JSON.parse(line) as LobsterEvent); }
        catch { /* skip malformed */ }
      }
      return events;
    } catch { return []; }
  }

  function onFileChange() {
    const events = readNewEvents();
    for (const ev of events) {
      processEvent(ev);
    }
  }

  function scheduleHealthScan() {
    const checkInterval = 60_000;
    healthTimer = setInterval(() => {
      const now = new Date();
      if (now.getHours() === healthScanHour && now.getMinutes() === 0) {
        triggerHealthScan();
      }
    }, checkInterval);

    if (typeof healthTimer === 'object' && 'unref' in healthTimer) {
      healthTimer.unref();
    }
  }

  function triggerHealthScan() {
    log(`Health scan triggered for ${managedProjects.length} projects`);
    for (const project of managedProjects) {
      const event: LobsterEvent = {
        ts: new Date().toISOString(),
        type: 'scheduled_health_scan',
        source_project: 'PolarClaw',
        target_project: project,
        severity: 'low',
        payload: {},
        dedup_key: `health:${project}:${new Date().toISOString().slice(0, 10)}`,
      };
      processEvent(event);
    }
  }

  function start() {
    log(`Starting daemon, watching: ${eventsPath}`);
    log(`Managed projects: ${managedProjects.join(', ')}`);

    ensureEventsFile();

    try {
      const stat = statSync(eventsPath);
      lastFileSize = stat.size;
    } catch { lastFileSize = 0; }

    watchFile(eventsPath, { interval: 2000 }, onFileChange);
    watching = true;

    scheduleHealthScan();

    log('Daemon started (event watch + health scan timer)');
  }

  function stop() {
    if (watching) {
      unwatchFile(eventsPath, onFileChange);
      watching = false;
    }

    if (healthTimer) {
      clearInterval(healthTimer);
      healthTimer = null;
    }

    for (const [project, runtime] of runtimes) {
      runtime.stop();
      log(`Stopped runtime: ${project}`);
    }
    runtimes.clear();

    dedup.stop();
    log('Daemon stopped');
  }

  return {
    start,
    stop,
    getActiveRuntimes: () => runtimes,
    triggerHealthScan,
    processEvent,
  };
}
