/**
 * Clock Integration — 工具实现
 *
 * 通过 REST 调用 PolarClock API（端口 15550）。
 * 由 Skill 加载器在启动时注册到 Agent 的工具系统。
 */

import type { IToolHandler } from '../../src/ports/tools.js';

const CLOCK_BASE = process.env.CLOCK_API_URL ?? 'http://127.0.0.1:15550';

async function clockFetch<T>(path: string, username: string): Promise<T | null> {
  try {
    const res = await fetch(`${CLOCK_BASE}${path}`, {
      headers: { 'X-Username': username, Accept: 'application/json' },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    return await res.json() as T;
  } catch {
    return null;
  }
}

/** 聚合查询：一次拿到用户的完整时间管理上下文 */
export const clockGetUserContext: IToolHandler = {
  name: 'clock_get_user_context',
  description: '一次性获取用户的完整时间管理上下文：任务、番茄状态、日程、统计。推荐首次交互时调用。',
  parameters: {
    type: 'object',
    properties: {
      username: { type: 'string', description: 'Clock 用户名' },
    },
    required: ['username'],
  },
  async handler(args) {
    const username = String(args.username ?? '');
    if (!username) throw new Error('username 必填');

    const [tasks, timer, schedule, stats] = await Promise.all([
      clockFetch<Array<Record<string, unknown>>>('/api/tasks?status=active', username),
      clockFetch<Record<string, unknown>>('/api/timer/status', username),
      clockFetch<Record<string, unknown>>('/api/schedule/today', username),
      clockFetch<Record<string, unknown>>('/api/stats/today', username),
    ]);

    return {
      timer: timer ? {
        state: timer.state ?? 'idle',
        remaining_minutes: timer.remaining ? Math.ceil(Number(timer.remaining) / 60) : null,
        current_task: timer.current_task_title ?? null,
      } : { state: 'unknown', remaining_minutes: null, current_task: null },

      tasks: {
        active_count: tasks?.length ?? 0,
        top_priority: (tasks ?? []).slice(0, 3).map(t => ({
          title: t.title,
          priority: t.priority,
          due: t.due_date,
          pomodoros: `${t.completed_pomodoros ?? 0}/${t.estimated_pomodoros ?? '?'}`,
        })),
      },

      schedule: schedule ? {
        current_block: schedule.current_block ?? '无当前 Block',
        next_event: schedule.next_event ?? null,
        meals: schedule.meals ?? [],
      } : null,

      stats: stats ? {
        pomodoros_today: stats.completed_pomodoros ?? 0,
        focus_minutes: stats.focus_minutes ?? 0,
        peak_hours: stats.peak_hours ?? [],
      } : null,
    };
  },
};

export const clockGetTasks: IToolHandler = {
  name: 'clock_get_tasks',
  description: '获取用户的任务列表。',
  parameters: {
    type: 'object',
    properties: {
      username: { type: 'string', description: 'Clock 用户名' },
      status: { type: 'string', enum: ['active', 'completed', 'all'], description: '任务状态筛选' },
    },
    required: ['username'],
  },
  async handler(args) {
    const username = String(args.username ?? '');
    const status = String(args.status ?? 'active');
    return await clockFetch(`/api/tasks?status=${status}`, username) ?? [];
  },
};

export const clockCreateTask: IToolHandler = {
  name: 'clock_create_task',
  description: '在 Clock 中创建新任务。',
  parameters: {
    type: 'object',
    properties: {
      username: { type: 'string', description: 'Clock 用户名' },
      title: { type: 'string', description: '任务标题' },
      priority: { type: 'string', enum: ['urgent', 'high', 'medium', 'low'] },
      estimated_pomodoros: { type: 'number', description: '预计番茄钟数' },
    },
    required: ['username', 'title'],
  },
  async handler(args) {
    const username = String(args.username ?? '');
    try {
      const res = await fetch(`${CLOCK_BASE}/api/tasks`, {
        method: 'POST',
        headers: {
          'X-Username': username,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: args.title,
          priority: args.priority ?? 'medium',
          estimated_pomodoros: args.estimated_pomodoros ?? 1,
        }),
        signal: AbortSignal.timeout(5000),
      });
      return await res.json();
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  },
};

/** 所有 Clock 工具列表，供 Skill 加载器批量注册 */
export const clockTools: IToolHandler[] = [
  clockGetUserContext,
  clockGetTasks,
  clockCreateTask,
];
