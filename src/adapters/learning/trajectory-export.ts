/**
 * Trajectory Export — 执行轨迹导出
 *
 * 每次 Agent runLoop 结束后，导出执行轨迹用于离线进化分析。
 * 轨迹文件存在 logs/trajectories/ 目录，格式为 JSONL。
 *
 * 简化版 GEPA：不需要遗传算法，LLM 分析轨迹即可。
 * Curator 周期触发时读取轨迹做技能进化。
 */

import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export interface ITrajectoryEntry {
  timestamp: string;
  conversationId: string;
  userId: string;
  channel: string;
  toolsCalled: string[];
  toolResults: Array<{ tool: string; success: boolean; durationMs?: number }>;
  totalRounds: number;
  corrections: number;
  userSatisfied?: boolean;
  taskDescription?: string;
}

const TRAJECTORY_DIR = join(homedir(), '.polarcop', 'logs', 'trajectories');
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

let dirCreated = false;

function ensureDir(): void {
  if (dirCreated) return;
  if (!existsSync(TRAJECTORY_DIR)) mkdirSync(TRAJECTORY_DIR, { recursive: true });
  dirCreated = true;
}

function getCurrentFilePath(): string {
  const month = new Date().toISOString().slice(0, 7);
  return join(TRAJECTORY_DIR, `trajectory-${month}.jsonl`);
}

/**
 * 导出一次执行轨迹。在 runLoop 结束后调用。
 * Fire-and-forget，不阻塞 Agent 响应。
 */
export function exportTrajectory(entry: ITrajectoryEntry): void {
  try {
    ensureDir();
    const fp = getCurrentFilePath();
    const line = JSON.stringify(entry) + '\n';
    appendFileSync(fp, line);
  } catch {
    // non-fatal
  }
}

/**
 * 构建轨迹条目的辅助函数。
 * 从 runLoop 的执行过程中收集数据。
 */
export function buildTrajectoryEntry(
  convId: string,
  userId: string,
  channel: string,
  toolCallLog: Array<{ name: string; success: boolean; durationMs?: number }>,
  totalRounds: number,
  corrections: number,
): ITrajectoryEntry {
  return {
    timestamp: new Date().toISOString(),
    conversationId: convId,
    userId,
    channel,
    toolsCalled: toolCallLog.map(t => t.name),
    toolResults: toolCallLog.map(t => ({
      tool: t.name,
      success: t.success,
      durationMs: t.durationMs,
    })),
    totalRounds,
    corrections,
  };
}
