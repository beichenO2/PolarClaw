import { execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Logger } from 'pino';
import type { RoleManager, SystemRole } from './manager.js';

export type LaunchConfig = {
  totalAgents: number;
  projectDir: string;
  hubUrl: string;
  logDir?: string;
};

export type LaunchResult = {
  launched: number;
  failed: number;
  agents: { agentId: string; tmuxSession: string }[];
};

/**
 * Batch-launches Cursor CLI agents in tmux sessions.
 * All agents are created at startup and placed in the reserve pool.
 */
export class AgentLauncher {
  constructor(
    private readonly roleManager: RoleManager,
    private readonly logger: Logger,
  ) {}

  /**
   * Launch N agents in tmux sessions.
   * Each agent starts in a polling loop waiting for role assignment.
   */
  launchBatch(config: LaunchConfig): LaunchResult {
    const logDir = config.logDir ?? join(config.projectDir, '.planning/logs');
    mkdirSync(logDir, { recursive: true });

    const result: LaunchResult = { launched: 0, failed: 0, agents: [] };

    for (let i = 0; i < config.totalAgents; i++) {
      const agentId = `agent-${String(i).padStart(3, '0')}`;
      const prefix = process.env.GSD_PROJECT_HASH ? `g-${process.env.GSD_PROJECT_HASH}` : 'gsd2';
      const tmuxSession = `${prefix}-${agentId}`;

      try {
        // Kill existing session if any
        try {
          execSync(`tmux kill-session -t "${tmuxSession}" 2>/dev/null`, { stdio: 'ignore' });
        } catch {
          // session didn't exist, fine
        }

        // Create tmux session
        execSync(`tmux new-session -d -s "${tmuxSession}" -x 200 -y 50`, { stdio: 'ignore' });

        // Start Cursor CLI agent in the session
        const logFile = join(logDir, `${agentId}.log`);
        const startupPrompt = this.buildStandbyPrompt(agentId, config.hubUrl);
        const cmd = [
          `cd '${config.projectDir}'`,
          `&&`,
          `cursor agent --print --yolo`,
          `'${startupPrompt.replace(/'/g, "'\\''")}'`,
          `2>&1 | tee '${logFile}'`,
        ].join(' ');

        execSync(`tmux send-keys -t "${tmuxSession}" "${cmd.replace(/"/g, '\\"')}" Enter`, {
          stdio: 'ignore',
        });

        // Register in reserve pool
        this.roleManager.addToReserve(agentId, tmuxSession);

        result.launched++;
        result.agents.push({ agentId, tmuxSession });

        if ((i + 1) % 10 === 0) {
          this.logger.info({ count: i + 1, total: config.totalAgents }, 'agents launched');
        }
      } catch (err) {
        result.failed++;
        this.logger.error({ agentId, err }, 'failed to launch agent');
      }
    }

    this.logger.info(
      { launched: result.launched, failed: result.failed, total: config.totalAgents },
      'batch launch complete',
    );
    return result;
  }

  /**
   * Assign management roles to agents from the reserve pool.
   * Returns the assignments made.
   */
  assignManagementRoles(): {
    proxy: string | null;
    controller: string | null;
    supervisor: string | null;
    clk: string | null;
  } {
    const assignments: Record<string, string | null> = {
      proxy: null,
      controller: null,
      supervisor: null,
      clk: null,
    };

    for (const role of ['proxy', 'controller', 'supervisor', 'clk'] as SystemRole[]) {
      const reserve = this.roleManager.takeFromReserve();
      if (reserve) {
        this.roleManager.assignRole(reserve.agentId, role, reserve.tmuxSession);
        assignments[role] = reserve.agentId;
        this.logger.info({ agentId: reserve.agentId, role }, 'management role assigned');
      } else {
        this.logger.error({ role }, 'no reserve available for management role');
      }
    }

    return assignments as {
      proxy: string | null;
      controller: string | null;
      supervisor: string | null;
      clk: string | null;
    };
  }

  /**
   * Assign N workers from the reserve pool with optional module tags.
   */
  assignWorkers(count: number, modules?: string[]): string[] {
    const assigned: string[] = [];
    for (let i = 0; i < count; i++) {
      const reserve = this.roleManager.takeFromReserve();
      if (!reserve) break;

      const mod = modules && modules[i % modules.length];
      this.roleManager.assignRole(reserve.agentId, 'worker', reserve.tmuxSession);
      assigned.push(reserve.agentId);
      this.logger.info(
        { agentId: reserve.agentId, role: 'worker', module: mod ?? null },
        'worker assigned',
      );
    }
    return assigned;
  }

  private buildStandbyPrompt(agentId: string, hubUrl: string): string {
    return [
      `You are ${agentId}, a standby agent in the gsd-2 multi-agent system.`,
      `The MCP Hub is at ${hubUrl}.`,
      `Your first step: call hub_register with agent_id="${agentId}".`,
      `Then poll the system.tick topic and your personal topic for role assignments.`,
      `Do NOT do any work until you receive a role_assign message.`,
      `When you receive a role_assign message, follow the instructions in it exactly.`,
    ].join(' ');
  }

  /**
   * Send a role prompt to a specific tmux session.
   * Used to re-prompt an agent with its actual role after assignment.
   */
  sendRolePrompt(tmuxSession: string, prompt: string): void {
    try {
      // tmux send-keys doesn't work well for multi-line prompts,
      // so we write to a file and have the agent read it
      const escaped = prompt.replace(/"/g, '\\"').replace(/\n/g, '\\n');
      execSync(`tmux send-keys -t "${tmuxSession}" "${escaped}" Enter`, {
        stdio: 'ignore',
      });
    } catch (err) {
      this.logger.error({ tmuxSession, err }, 'failed to send role prompt');
    }
  }
}
