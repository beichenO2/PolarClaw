import { eq } from 'drizzle-orm';
import { agentRoles, reservePool, type HubDb } from '../persistence/db.js';

export type SystemRole = 'proxy' | 'controller' | 'supervisor' | 'clk' | 'worker';
export type RoleStatus = 'active' | 'dead' | 'retiring';
export type ReserveStatus = 'standby' | 'assigned' | 'dead';

export type RoleAssignment = {
  agentId: string;
  role: SystemRole;
  status: RoleStatus;
  tmuxSession: string | null;
  assignedAt: Date;
  lastHeartbeat: Date | null;
  stateSnapshot: unknown;
  predecessorId: string | null;
};

export type ReserveAgent = {
  agentId: string;
  tmuxSession: string;
  status: ReserveStatus;
  createdAt: Date;
};

/**
 * Manages role assignments, the reserve pool, and succession.
 *
 * - Roles are unique by agent_id
 * - There can be multiple workers but only one of each management role
 * - Reserve agents are promoted to fill dead roles
 */
export class RoleManager {
  constructor(private readonly db: HubDb) {}

  assignRole(
    agentId: string,
    role: SystemRole,
    tmuxSession: string | null,
    predecessorId?: string,
  ): RoleAssignment {
    const now = new Date();
    this.db
      .insert(agentRoles)
      .values({
        agentId,
        role,
        status: 'active',
        tmuxSession: tmuxSession ?? null,
        assignedAt: now,
        lastHeartbeat: now,
        stateSnapshot: null,
        predecessorId: predecessorId ?? null,
      })
      .onConflictDoUpdate({
        target: agentRoles.agentId,
        set: {
          role,
          status: 'active',
          tmuxSession: tmuxSession ?? null,
          assignedAt: now,
          lastHeartbeat: now,
          predecessorId: predecessorId ?? null,
        },
      })
      .run();

    // Remove from reserve pool if was there
    this.db.delete(reservePool).where(eq(reservePool.agentId, agentId)).run();

    return this.getRole(agentId)!;
  }

  getRole(agentId: string): RoleAssignment | null {
    const row = this.db.select().from(agentRoles).where(eq(agentRoles.agentId, agentId)).get();
    if (!row) return null;
    return this.mapRole(row);
  }

  getRoleByType(role: SystemRole): RoleAssignment | null {
    const rows = this.db
      .select()
      .from(agentRoles)
      .where(eq(agentRoles.role, role))
      .all();
    const active = rows.find((r) => r.status === 'active');
    return active ? this.mapRole(active) : null;
  }

  getAllByRole(role: SystemRole): RoleAssignment[] {
    return this.db
      .select()
      .from(agentRoles)
      .where(eq(agentRoles.role, role))
      .all()
      .filter((r) => r.status === 'active')
      .map((r) => this.mapRole(r));
  }

  getAllActive(): RoleAssignment[] {
    return this.db
      .select()
      .from(agentRoles)
      .all()
      .filter((r) => r.status === 'active')
      .map((r) => this.mapRole(r));
  }

  recordHeartbeat(agentId: string): void {
    this.db
      .update(agentRoles)
      .set({ lastHeartbeat: new Date() })
      .where(eq(agentRoles.agentId, agentId))
      .run();
  }

  saveStateSnapshot(agentId: string, snapshot: unknown): void {
    this.db
      .update(agentRoles)
      .set({ stateSnapshot: JSON.stringify(snapshot) })
      .where(eq(agentRoles.agentId, agentId))
      .run();
  }

  markDead(agentId: string): void {
    this.db
      .update(agentRoles)
      .set({ status: 'dead' })
      .where(eq(agentRoles.agentId, agentId))
      .run();
  }

  /**
   * Find agents that haven't sent a heartbeat within the threshold.
   * Used by CLK to detect dead roles.
   */
  findStale(thresholdMs: number): RoleAssignment[] {
    const cutoff = new Date(Date.now() - thresholdMs);
    return this.db
      .select()
      .from(agentRoles)
      .all()
      .filter((r) => r.status === 'active')
      .filter((r) => {
        if (!r.lastHeartbeat) return true;
        return r.lastHeartbeat < cutoff;
      })
      .map((r) => this.mapRole(r));
  }

  // --- Reserve pool ---

  addToReserve(agentId: string, tmuxSession: string): void {
    this.db
      .insert(reservePool)
      .values({
        agentId,
        tmuxSession,
        status: 'standby',
        createdAt: new Date(),
      })
      .onConflictDoUpdate({
        target: reservePool.agentId,
        set: { tmuxSession, status: 'standby' },
      })
      .run();
  }

  /**
   * Take one agent from the reserve pool and return it.
   * Returns null if pool is empty.
   */
  takeFromReserve(): ReserveAgent | null {
    const row = this.db
      .select()
      .from(reservePool)
      .where(eq(reservePool.status, 'standby'))
      .limit(1)
      .get();
    if (!row) return null;

    this.db
      .update(reservePool)
      .set({ status: 'assigned', assignedAt: new Date() })
      .where(eq(reservePool.agentId, row.agentId))
      .run();

    return {
      agentId: row.agentId,
      tmuxSession: row.tmuxSession,
      status: 'assigned',
      createdAt: row.createdAt,
    };
  }

  reserveCount(): number {
    return this.db
      .select()
      .from(reservePool)
      .where(eq(reservePool.status, 'standby'))
      .all().length;
  }

  markReserveDead(agentId: string): void {
    this.db
      .update(reservePool)
      .set({ status: 'dead' })
      .where(eq(reservePool.agentId, agentId))
      .run();
  }

  /**
   * Succession: replace a dead role with a reserve agent.
   * Returns the new assignment, or null if no reserves available.
   */
  succeedRole(deadAgentId: string): RoleAssignment | null {
    const deadRole = this.getRole(deadAgentId);
    if (!deadRole) return null;

    this.markDead(deadAgentId);

    const replacement = this.takeFromReserve();
    if (!replacement) return null;

    return this.assignRole(
      replacement.agentId,
      deadRole.role,
      replacement.tmuxSession,
      deadAgentId,
    );
  }

  private mapRole(row: typeof agentRoles.$inferSelect): RoleAssignment {
    let snapshot: unknown = null;
    if (row.stateSnapshot) {
      try {
        snapshot = JSON.parse(row.stateSnapshot);
      } catch {
        snapshot = row.stateSnapshot;
      }
    }
    return {
      agentId: row.agentId,
      role: row.role as SystemRole,
      status: row.status as RoleStatus,
      tmuxSession: row.tmuxSession ?? null,
      assignedAt: row.assignedAt,
      lastHeartbeat: row.lastHeartbeat ?? null,
      stateSnapshot: snapshot,
      predecessorId: row.predecessorId ?? null,
    };
  }
}
