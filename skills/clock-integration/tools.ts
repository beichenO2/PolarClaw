/**
 * Clock Integration — 工具实现
 *
 * 通过 REST 调用 PolarClock API（端口 15550）。
 * 由 Skill 加载器在启动时注册到 Agent 的工具系统。
 *
 * 认证策略：
 *   - 读操作：走 /api/sync/* 端点，用 X-Sync-Key（服务级），不需要用户 session
 *   - 写操作：走 /api/tasks/* 等端点，用 X-Token（用户级 session token）
 *
 * Clock API 字段映射（与 Clock backend v1.1.0 对齐）：
 *   - 任务标题字段: name（非 title）
 *   - 番茄数字段: pomodor_total / pomodor_completed（非 estimated_pomodoros）
 *   - 计时器状态: sync snapshot 的 user_status（working/resting/idle 等）
 *   - 任务列表: GET /api/tasks?include_archived=bool
 *   - 完成任务: PUT /api/tasks/:id body { status: "completed" }
 */

import type { IToolHandler } from '../../src/ports/tools.js';
import { getServiceUrl, SERVICES } from '../_shared/port-discovery.js';

// ── Clock API response types (sync snapshot v1.1.0) ─────────────────────────

interface ClockTimerSnapshot {
  mode?: string;
  status?: string;
  remaining_seconds?: number;
  elapsed_overtime_seconds?: number;
  current_session?: number;
  total_sessions?: number;
  break_type?: string;
  exercise_reminder_due?: boolean;
  bath_reminder_due?: boolean;
  current_task_id?: string | null;
}

interface ClockScheduleEvent {
  id?: string;
  name: string;
  start: string;
  end: string;
  type: 'class' | 'meal' | string;
}

interface ClockScheduleSnapshot {
  date: string;
  day_of_week: number;
  events: ClockScheduleEvent[];
}

interface ClockTodaySession {
  type?: string;
  duration_minutes?: number;
  completed_at?: string;
  task_id?: string | null;
}

interface ClockTodaySummary {
  pomodoros_completed: number;
  work_minutes: number;
  sessions: ClockTodaySession[];
}

interface ClockSnapshot {
  clock_username: string;
  clock_user_id: string;
  generated_at: string;
  user_status: string;
  timer: ClockTimerSnapshot;
  schedule: ClockScheduleSnapshot;
  today_summary: ClockTodaySummary;
}

interface ClockSyncUser {
  username: string;
  user_id: string;
  created_at: string;
}

interface ClockTask {
  id: string;
  name: string;
  status?: string;
  deadline?: string | null;
  tags?: string[];
  pomodor_completed?: number;
  pomodor_total?: number;
  importance_axis_position?: number;
  desire_axis_position?: number;
  archived?: boolean;
}

interface ClockErrorResponse {
  error?: boolean;
  message?: string;
  code?: string;
}

async function getClockBase(): Promise<string> {
  if (process.env.CLOCK_API_URL) return process.env.CLOCK_API_URL;
  return getServiceUrl(SERVICES.CLOCK.name, SERVICES.CLOCK.gateway);
}

let CLOCK_BASE = process.env.CLOCK_API_URL ?? 'http://127.0.0.1:15550';

(async () => {
  try { CLOCK_BASE = await getClockBase(); } catch { /* keep fallback */ }
})();
const CLOCK_SYNC_KEY = process.env.CLOCK_SYNC_KEY ?? '';

function syncHeaders(): Record<string, string> {
  const h: Record<string, string> = { Accept: 'application/json' };
  if (CLOCK_SYNC_KEY) h['X-Sync-Key'] = CLOCK_SYNC_KEY;
  return h;
}

function tokenHeaders(token: string): Record<string, string> {
  return {
    'X-Token': token,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}

async function clockFetch<T>(path: string, headers: Record<string, string>): Promise<T | null> {
  try {
    const res = await fetch(`${CLOCK_BASE}${path}`, {
      headers,
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    return await res.json() as T;
  } catch {
    return null;
  }
}

function mapTimer(timer: ClockTimerSnapshot | undefined) {
  if (!timer) return null;
  return {
    mode: timer.mode,
    status: timer.status,
    remaining_minutes: timer.remaining_seconds != null
      ? Math.ceil(timer.remaining_seconds / 60)
      : null,
    elapsed_overtime_seconds: timer.elapsed_overtime_seconds ?? 0,
    current_session: timer.current_session,
    total_sessions: timer.total_sessions,
    break_type: timer.break_type,
    exercise_reminder: timer.exercise_reminder_due ?? false,
    bath_reminder: timer.bath_reminder_due ?? false,
    current_task_id: timer.current_task_id ?? null,
  };
}

function mapSchedule(schedule: ClockScheduleSnapshot | undefined) {
  if (!schedule) return null;
  return {
    date: schedule.date,
    day_of_week: schedule.day_of_week,
    events: schedule.events ?? [],
  };
}

function mapTodaySummary(today: ClockTodaySummary | undefined) {
  if (!today) return null;
  return {
    pomodoros_completed: today.pomodoros_completed ?? 0,
    work_minutes: today.work_minutes ?? 0,
    sessions: today.sessions ?? [],
  };
}

// ── Read-only tools (use sync API, no user token needed) ─────────────────────

/** 聚合查询：通过 sync snapshot 一次拿到用户完整上下文 */
export const clockGetUserContext: IToolHandler = {
  name: 'clock_get_user_context',
  description:
    '一次性获取用户的完整时间管理上下文：番茄状态、今日日程、工作记录。推荐首次交互时调用。' +
    '使用 /api/sync/snapshot，只需 Clock 用户名。',
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

    const snapshot = await clockFetch<ClockSnapshot>(
      `/api/sync/snapshot?username=${encodeURIComponent(username)}`,
      syncHeaders(),
    );

    if (!snapshot) {
      return { error: 'Clock 服务不可达或用户不存在', username };
    }

    return {
      clock_username: snapshot.clock_username,
      clock_user_id: snapshot.clock_user_id,
      generated_at: snapshot.generated_at,
      user_status: snapshot.user_status ?? 'unknown',
      timer: mapTimer(snapshot.timer),
      schedule: mapSchedule(snapshot.schedule),
      today_summary: mapTodaySummary(snapshot.today_summary),
    };
  },
};

export const clockGetTimerStatus: IToolHandler = {
  name: 'clock_get_timer_status',
  description: '获取用户的番茄钟当前状态（通过 sync snapshot）。',
  parameters: {
    type: 'object',
    properties: {
      username: { type: 'string', description: 'Clock 用户名' },
    },
    required: ['username'],
  },
  async handler(args) {
    const username = String(args.username ?? '');
    const snapshot = await clockFetch<ClockSnapshot>(
      `/api/sync/snapshot?username=${encodeURIComponent(username)}`,
      syncHeaders(),
    );
    if (!snapshot) return { error: 'Clock 服务不可达', user_status: 'unknown' };
    return {
      clock_username: snapshot.clock_username,
      user_status: snapshot.user_status,
      timer: mapTimer(snapshot.timer),
    };
  },
};

export const clockGetSchedule: IToolHandler = {
  name: 'clock_get_schedule',
  description: '获取用户今日日程安排（课程、三餐时间）。',
  parameters: {
    type: 'object',
    properties: {
      username: { type: 'string', description: 'Clock 用户名' },
    },
    required: ['username'],
  },
  async handler(args) {
    const username = String(args.username ?? '');
    const snapshot = await clockFetch<ClockSnapshot>(
      `/api/sync/snapshot?username=${encodeURIComponent(username)}`,
      syncHeaders(),
    );
    if (!snapshot) return { error: 'Clock 服务不可达' };
    return mapSchedule(snapshot.schedule) ?? { date: null, day_of_week: null, events: [] };
  },
};

export const clockListUsers: IToolHandler = {
  name: 'clock_list_users',
  description:
    '列出 Clock 中所有用户（用于用户名映射）。走 /api/sync/users，需要 X-Sync-Key。',
  parameters: {
    type: 'object',
    properties: {},
  },
  async handler() {
    const users = await clockFetch<ClockSyncUser[]>(
      '/api/sync/users',
      syncHeaders(),
    );
    if (!users) return { error: 'Clock 服务不可达或 sync key 无效', users: [] };
    return { users };
  },
};

// ── Write tools (need user session token) ────────────────────────────────────

export const clockGetTasks: IToolHandler = {
  name: 'clock_get_tasks',
  description: '获取用户的任务列表。需要用户 token（X-Token）。',
  parameters: {
    type: 'object',
    properties: {
      token: { type: 'string', description: 'Clock 用户 session token' },
      include_archived: { type: 'boolean', description: '是否包含已归档任务' },
    },
    required: ['token'],
  },
  async handler(args) {
    const token = String(args.token ?? '');
    const params = new URLSearchParams();
    if (args.include_archived) params.set('include_archived', 'true');
    const query = params.toString();
    const tasks = await clockFetch<ClockTask[]>(
      `/api/tasks${query ? `?${query}` : ''}`,
      tokenHeaders(token),
    );
    if (!tasks) return { error: '获取任务失败，token 可能无效' };

    const arr = Array.isArray(tasks) ? tasks : Object.values(tasks);
    const active = arr.filter((t) => !t.archived);
    return {
      total: arr.length,
      active_count: active.length,
      tasks: active.slice(0, 20).map((t) => ({
        id: t.id,
        name: t.name,
        status: t.status,
        deadline: t.deadline,
        tags: t.tags ?? [],
        pomodoros: `${t.pomodor_completed ?? 0}/${t.pomodor_total ?? '?'}`,
        importance: t.importance_axis_position,
        desire: t.desire_axis_position,
      })),
    };
  },
};

export const clockCreateTask: IToolHandler = {
  name: 'clock_create_task',
  description: '在 Clock 中创建新任务。需要用户 token。',
  parameters: {
    type: 'object',
    properties: {
      token: { type: 'string', description: 'Clock 用户 session token' },
      name: { type: 'string', description: '任务名称（1-500字）' },
      deadline: { type: 'string', description: '截止日期 ISO8601（可选）' },
      pomodor_total: { type: 'number', description: '预计番茄钟数（1-999）' },
      tags: {
        type: 'array',
        items: { type: 'string' },
        description: '标签列表（可选，最多 50 个）',
      },
      parent_id: { type: 'string', description: '父任务 ID（可选，创建子任务）' },
    },
    required: ['token', 'name'],
  },
  async handler(args) {
    const token = String(args.token ?? '');
    try {
      const body: Record<string, unknown> = { name: args.name };
      if (args.deadline) body.deadline = args.deadline;
      if (args.pomodor_total) body.pomodor_total = args.pomodor_total;
      if (args.tags) body.tags = args.tags;
      if (args.parent_id) body.parent_id = args.parent_id;

      const res = await fetch(`${CLOCK_BASE}/api/tasks`, {
        method: 'POST',
        headers: tokenHeaders(token),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(5000),
      });
      return await res.json();
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  },
};

export const clockCompleteTask: IToolHandler = {
  name: 'clock_complete_task',
  description: '标记 Clock 任务为完成（同时归档）。需要用户 token。',
  parameters: {
    type: 'object',
    properties: {
      token: { type: 'string', description: 'Clock 用户 session token' },
      task_id: { type: 'string', description: '任务 ID' },
    },
    required: ['token', 'task_id'],
  },
  async handler(args) {
    const token = String(args.token ?? '');
    const taskId = String(args.task_id ?? '');
    try {
      const res = await fetch(`${CLOCK_BASE}/api/tasks/${taskId}`, {
        method: 'PUT',
        headers: tokenHeaders(token),
        body: JSON.stringify({ status: 'completed' }),
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as ClockErrorResponse;
        return { error: err.message ?? `HTTP ${res.status}` };
      }
      return await res.json();
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  },
};

/** 所有 Clock 工具列表，供 Skill 加载器批量注册 */
export const clockTools: IToolHandler[] = [
  clockGetUserContext,
  clockGetTimerStatus,
  clockGetSchedule,
  clockListUsers,
  clockGetTasks,
  clockCreateTask,
  clockCompleteTask,
];
