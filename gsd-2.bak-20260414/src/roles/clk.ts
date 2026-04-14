import { eq } from 'drizzle-orm';
import { clkState, type HubDb } from '../persistence/db.js';
import type { BroadcastPublisher } from '../broadcast/publisher.js';
import type { RoleManager } from './manager.js';
import type { Logger } from 'pino';

export type TickReport = {
  tick_number: number;
  timestamp: Date;
  stale_roles: { agentId: string; role: string; lastHeartbeat: Date | null }[];
  all_stale: boolean;
  successions: { deadAgentId: string; newAgentId: string; role: string }[];
  reserve_count: number;
};

const STALE_THRESHOLD_MS = 150_000; // 5 missed ticks at 30s = 2.5 min

/**
 * CLK — the system heartbeat driver.
 *
 * Periodically broadcasts a tick signal, detects dead roles,
 * triggers succession from the reserve pool, and generates
 * system status reports.
 */
export class ClkService {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly db: HubDb,
    private readonly publisher: BroadcastPublisher,
    private readonly roleManager: RoleManager,
    private readonly logger: Logger,
  ) {}

  /** Start the tick loop. Call once at hub startup. */
  start(): void {
    if (this.timer) return;
    const state = this.getState();
    this.logger.info({ interval_ms: state.tickIntervalMs }, 'CLK starting');
    this.timer = setInterval(() => this.tick(), state.tickIntervalMs);
    // Fire first tick immediately
    this.tick();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Execute one tick cycle. */
  tick(): TickReport {
    const now = new Date();
    const state = this.getState();
    const nextTick = state.tickNumber + 1;

    // Update tick counter
    this.db
      .update(clkState)
      .set({ tickNumber: nextTick, lastTickAt: now })
      .where(eq(clkState.id, 1))
      .run();

    // Detect stale roles
    const staleRoles = this.roleManager.findStale(STALE_THRESHOLD_MS);
    const allManagementStale = this.checkAllManagementStale(staleRoles);

    // Attempt successions for dead management roles
    const successions: { deadAgentId: string; newAgentId: string; role: string }[] = [];
    for (const stale of staleRoles) {
      if (['proxy', 'controller', 'supervisor', 'clk'].includes(stale.role)) {
        const newAssignment = this.roleManager.succeedRole(stale.agentId);
        if (newAssignment) {
          successions.push({
            deadAgentId: stale.agentId,
            newAgentId: newAssignment.agentId,
            role: newAssignment.role,
          });
          this.logger.warn(
            { dead: stale.agentId, replacement: newAssignment.agentId, role: stale.role },
            'CLK: role succession triggered',
          );
        } else {
          this.logger.error(
            { dead: stale.agentId, role: stale.role },
            'CLK: no reserves available for succession',
          );
        }
      }
    }

    // Broadcast tick signal
    const report: TickReport = {
      tick_number: nextTick,
      timestamp: now,
      stale_roles: staleRoles.map((r) => ({
        agentId: r.agentId,
        role: r.role,
        lastHeartbeat: r.lastHeartbeat,
      })),
      all_stale: allManagementStale,
      successions,
      reserve_count: this.roleManager.reserveCount(),
    };

    try {
      this.publisher.publish({
        sourceAgentId: 'clk',
        topic: 'system.tick',
        payload: report,
      });
    } catch (err) {
      this.logger.error({ err }, 'CLK: failed to publish tick');
    }

    // If all management roles are stale, send wake-up to controller
    if (allManagementStale) {
      this.logger.warn('CLK: all management roles stale — sending wake-up');
      try {
        this.publisher.publish({
          sourceAgentId: 'clk',
          topic: 'controller.inbox',
          payload: {
            type: 'wake_up',
            reason: 'all_management_stale',
            tick_number: nextTick,
          },
        });
      } catch {
        // best effort
      }
    }

    return report;
  }

  getState(): { tickNumber: number; lastTickAt: Date | null; tickIntervalMs: number } {
    const row = this.db.select().from(clkState).where(eq(clkState.id, 1)).get();
    if (!row) {
      return { tickNumber: 0, lastTickAt: null, tickIntervalMs: 30_000 };
    }
    return {
      tickNumber: row.tickNumber,
      lastTickAt: row.lastTickAt ?? null,
      tickIntervalMs: row.tickIntervalMs,
    };
  }

  setTickInterval(ms: number): void {
    this.db.update(clkState).set({ tickIntervalMs: ms }).where(eq(clkState.id, 1)).run();
    if (this.timer) {
      this.stop();
      this.start();
    }
  }

  private checkAllManagementStale(
    staleRoles: { role: string }[],
  ): boolean {
    const staleSet = new Set(staleRoles.map((r) => r.role));
    const mgmtRoles = ['proxy', 'controller', 'supervisor'];
    return mgmtRoles.every((r) => staleSet.has(r));
  }
}
