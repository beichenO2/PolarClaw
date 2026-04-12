/**
 * MyClaw Web Dashboard API Client — REQ-E05, REQ-H02~H05
 * Fetches real data from the MyClaw agent status API.
 * Falls back to mock data when API is unavailable.
 */

import type { BoardTask, EvolutionItem, OutcomeHighlight, ResearchSection } from '../types';
import { mockBoard, mockEvolution, mockOutcomes, mockResearch } from './mock';

const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://127.0.0.1:18789';
const FETCH_TIMEOUT = 5000;

type AgentStatus = {
  started: boolean;
  uptimeMs: number | null;
  projectRoot: string;
  llm: { models: Record<string, string> };
  memory: { ready: boolean; path: string };
  skills: { count: number; names: string[] };
  scheduler: { running: boolean; jobs: string[] };
  channels: { telegram: boolean; feishu: boolean };
  yolo: unknown | null;
  evolution: { lastNote: string | null };
  knownUsers: number;
};

async function fetchWithTimeout(url: string, ms = FETCH_TIMEOUT): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

let cachedStatus: AgentStatus | null = null;
let lastFetch = 0;
const CACHE_TTL = 10_000;

export async function fetchAgentStatus(): Promise<AgentStatus | null> {
  const now = Date.now();
  if (cachedStatus && now - lastFetch < CACHE_TTL) return cachedStatus;

  try {
    const res = await fetchWithTimeout(`${API_BASE}/api/status`);
    if (!res.ok) return null;
    cachedStatus = await res.json();
    lastFetch = now;
    return cachedStatus;
  } catch {
    return null;
  }
}

export async function fetchOutcomes(): Promise<OutcomeHighlight[]> {
  const status = await fetchAgentStatus();
  if (!status) return mockOutcomes;

  const outcomes: OutcomeHighlight[] = [];

  if (status.started) {
    outcomes.push({
      id: 'status',
      title: '系统状态',
      summary: `运行中 · ${status.skills.count} 个技能 · ${status.knownUsers} 个已知用户`,
      metric: status.uptimeMs ? `${Math.round(status.uptimeMs / 60000)}m` : '—',
    });
  }

  if (status.memory.ready) {
    outcomes.push({
      id: 'memory',
      title: '记忆系统',
      summary: '长期记忆 + FTS5 搜索就绪',
      metric: 'active',
    });
  }

  if (status.channels.telegram || status.channels.feishu) {
    const channels = [];
    if (status.channels.telegram) channels.push('Telegram');
    if (status.channels.feishu) channels.push('飞书');
    outcomes.push({
      id: 'channels',
      title: '消息通道',
      summary: `${channels.join(' + ')} 已连接`,
      metric: `${channels.length} active`,
    });
  }

  return outcomes.length > 0 ? outcomes : mockOutcomes;
}

export async function fetchEvolution(): Promise<EvolutionItem[]> {
  const status = await fetchAgentStatus();
  if (!status) return mockEvolution;

  const items: EvolutionItem[] = [];

  if (status.skills.names.length > 0) {
    items.push({
      id: 'skills',
      direction: 'Skills 加载',
      lastWin: `${status.skills.count} 个技能已加载`,
      status: 'done',
    });
  }

  const models = Object.entries(status.llm.models);
  for (const [intent, model] of models) {
    items.push({
      id: `model-${intent}`,
      direction: `${intent} 模型路由`,
      lastWin: model,
      status: 'done',
    });
  }

  if (status.evolution.lastNote) {
    items.push({
      id: 'evolution-check',
      direction: '模型进化检查',
      lastWin: status.evolution.lastNote,
      status: 'active',
    });
  }

  return items.length > 0 ? items : mockEvolution;
}

export async function fetchBoard(): Promise<BoardTask[]> {
  try {
    const res = await fetchWithTimeout(`${API_BASE}/api/tasks`);
    if (!res.ok) return mockBoard;
    const data = await res.json();
    return (data.tasks ?? []).map((t: Record<string, unknown>) => ({
      id: String(t.id),
      title: String(t.title ?? t.id),
      column: t.status === 'done' ? 'done' : t.status === 'in_progress' ? 'doing' : 'backlog',
      module: String(t.module ?? ''),
    }));
  } catch {
    return mockBoard;
  }
}

export async function fetchResearch(): Promise<ResearchSection[]> {
  try {
    const res = await fetchWithTimeout(`${API_BASE}/api/research/latest`);
    if (!res.ok) return mockResearch;
    const data = await res.json();
    return (data.sections ?? []).map((s: Record<string, unknown>) => ({
      heading: String(s.heading),
      bullets: Array.isArray(s.bullets) ? s.bullets.map(String) : [String(s.body ?? '')],
      confidence: 'medium' as const,
    }));
  } catch {
    return mockResearch;
  }
}

export const api = {
  fetchAgentStatus,
  fetchOutcomes,
  fetchEvolution,
  fetchBoard,
  fetchResearch,
};
