/**
 * DiGist Integration — PolarClaw 技能工具
 *
 * 通过 SOTAgent 网关或 port-sdk 动态发现端口，调用 digist API。
 * 遵循 port-sdk-mandatory 规则，无硬编码端口。
 *
 * API 契约对齐 digist/src/api/server.ts（digist-api standalone HTTP）。
 */

import type { IToolHandler } from '../../src/ports/tools.js';
import { getServiceUrl, SERVICES } from '../_shared/port-discovery.js';

// ─── digist API response shapes ─────────────────────────────────────

interface ContentItemSummary {
  id?: string;
  title?: string;
  platform?: string;
  timestamp?: string;
  source_url?: string;
  body_markdown?: string;
  tags?: string[];
}

interface ContentItemsResponse {
  items?: ContentItemSummary[];
  total?: number;
}

interface InterestRecord {
  id: string;
  label: string;
  linked_topic?: string | null;
  platforms?: string[];
  query?: string | null;
}

interface InterestsResponse {
  interests?: InterestRecord[];
}

interface RecommendItem {
  title: string;
  platform: string;
  url: string;
  score: number;
  reason?: string;
  timestamp?: string;
}

interface CrawlTriggerResponse {
  scraped?: number;
  normalized?: number;
  inserted?: number;
  has_more?: boolean;
  next_cursor?: string | null;
}

interface SyncToKnowleverResponse {
  status?: string;
  interest_id?: string;
  topic?: string;
  knowlever_found?: boolean;
  message?: string;
  stdout?: string;
  stderr?: string;
  dry_run?: boolean;
}

const CRAWL_PLATFORMS = [
  'twitter', 'reddit', 'wechat', 'github', 'glass',
  'xiaohongshu', 'zhihu', 'arxiv', 'bilibili', 'hackernews', 'bloomberg', 'youtube',
] as const;

const NO_QUERY_PLATFORMS = new Set(['glass', 'hackernews', 'bloomberg']);

async function getDigistBase(): Promise<string> {
  return getServiceUrl(SERVICES.DIGIST.name, SERVICES.DIGIST.gateway);
}

async function digistGet(path: string, timeoutMs = 8000): Promise<unknown> {
  const base = await getDigistBase();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}${path}`, { signal: controller.signal });
    const text = await res.text();
    try { return JSON.parse(text); } catch { return text; }
  } finally {
    clearTimeout(timer);
  }
}

async function digistPost(
  path: string,
  body: Record<string, unknown>,
  timeoutMs = 30000,
): Promise<{ status: number; data: unknown }> {
  const base = await getDigistBase();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text();
    try { return { status: res.status, data: JSON.parse(text) }; } catch { return { status: res.status, data: text }; }
  } finally {
    clearTimeout(timer);
  }
}

function matchesQuery(item: ContentItemSummary, query: string): boolean {
  const q = query.toLowerCase();
  const haystack = [
    item.title,
    item.body_markdown,
    ...(item.tags ?? []),
    item.platform,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return haystack.includes(q);
}

// ─── Tool 1: Crawl ─────────────────────────────────────────────────

export const digistCrawl: IToolHandler = {
  name: 'digist_crawl',
  description:
    '触发 digist 爬取指定平台的最新内容。' +
    `支持平台：${CRAWL_PLATFORMS.join(', ')}。` +
    'glass/hackernews/bloomberg 不需要 query，其余平台 query 必填。',
  parameters: {
    type: 'object',
    properties: {
      platform: {
        type: 'string',
        description: `平台名称（${CRAWL_PLATFORMS.join(', ')}）`,
      },
      query: {
        type: 'string',
        description: '搜索关键词（glass/hackernews/bloomberg 可省略）',
      },
    },
    required: ['platform'],
  },
  async handler(args) {
    const platform = String(args.platform ?? '').trim().toLowerCase();
    if (!platform) throw new Error('platform 不能为空');
    if (!CRAWL_PLATFORMS.includes(platform as (typeof CRAWL_PLATFORMS)[number])) {
      throw new Error(`无效 platform。可选：${CRAWL_PLATFORMS.join(', ')}`);
    }

    const payload: Record<string, unknown> = { platform };
    if (args.query !== undefined && args.query !== null && String(args.query).trim() !== '') {
      payload.query = String(args.query);
    } else if (!NO_QUERY_PLATFORMS.has(platform)) {
      throw new Error(`platform ${platform} 需要 query 参数`);
    }

    try {
      const { status, data } = await digistPost('/api/crawl/trigger', payload, 60000);
      return { success: status < 400, platform, result: data as CrawlTriggerResponse };
    } catch (err) {
      return { success: false, platform, error: err instanceof Error ? err.message : String(err) };
    }
  },
};

// ─── Tool 2: Search ─────────────────────────────────────────────────

export const digistSearch: IToolHandler = {
  name: 'digist_search',
  description:
    '在 digist 已爬取内容库中检索。' +
    '通过 GET /api/content_items 拉取条目后在本地按关键词过滤（standalone API 暂无 FTS 端点）。',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: '搜索关键词（匹配标题/正文/标签）' },
      platform: { type: 'string', description: '限定平台（可选）' },
      limit: { type: 'number', description: '返回数量（默认 10，最大 50）' },
    },
    required: ['query'],
  },
  async handler(args) {
    const query = String(args.query ?? '').trim();
    if (!query) throw new Error('query 不能为空');
    const limit = Math.min(50, Math.max(1, Number(args.limit) || 10));

    const params = new URLSearchParams();
    params.set('limit', String(Math.min(500, limit * 10)));
    if (args.platform) params.set('platform', String(args.platform));

    try {
      const data = await digistGet(`/api/content_items?${params}`) as ContentItemsResponse;
      const items = (data.items ?? []).filter((item) => matchesQuery(item, query)).slice(0, limit);
      return {
        success: true,
        query,
        platform: args.platform ? String(args.platform) : undefined,
        count: items.length,
        results: items,
      };
    } catch (err) {
      return { success: false, query, error: err instanceof Error ? err.message : String(err) };
    }
  },
};

// ─── Tool 3: Recommend ──────────────────────────────────────────────

export const digistRecommend: IToolHandler = {
  name: 'digist_recommend',
  description:
    '获取 digist 的个性化内容推荐。基于用户兴趣和阅读历史推荐最相关的内容。',
  parameters: {
    type: 'object',
    properties: {
      platform: { type: 'string', description: '限定平台（可选）' },
      n: { type: 'number', description: '推荐数量（默认 20，对应 API 参数 n）' },
      topics: {
        type: 'string',
        description: '自定义关键词，逗号分隔（对应 API 参数 topics）',
      },
      user_id: { type: 'string', description: '用户 ID（可选）' },
    },
  },
  async handler(args) {
    const params = new URLSearchParams();
    if (args.platform) params.set('platform', String(args.platform));
    const n = Number(args.n);
    if (Number.isFinite(n) && n > 0) params.set('n', String(Math.min(100, Math.floor(n))));
    if (args.topics) params.set('topics', String(args.topics));
    if (args.user_id) params.set('user_id', String(args.user_id));
    const qs = params.toString() ? `?${params}` : '';

    try {
      const data = await digistGet(`/api/recommend${qs}`);
      const recommendations = Array.isArray(data) ? (data as RecommendItem[]) : [];
      return { success: true, count: recommendations.length, recommendations };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
};

// ─── Tool 4: Status ─────────────────────────────────────────────────

export const digistStatus: IToolHandler = {
  name: 'digist_status',
  description:
    '检查 digist 服务的健康状态和统计信息。包括数据库连接、内容数量、调度器状态、Lobster 适配器状态。',
  parameters: { type: 'object', properties: {} },
  async handler() {
    const result: Record<string, unknown> = {};

    try {
      result.health = await digistGet('/health?fast=1', 5000);
    } catch (err) {
      return { online: false, error: err instanceof Error ? err.message : String(err) };
    }

    try {
      result.items_count = await digistGet('/api/items/count', 3000);
    } catch { /* non-critical */ }

    try {
      result.scheduler = await digistGet('/api/scheduler/status', 3000);
    } catch { /* non-critical */ }

    try {
      result.lobster = await digistGet('/api/lobster/status', 3000);
    } catch { /* non-critical */ }

    return { online: true, ...result };
  },
};

// ─── Tool 5: Interests ──────────────────────────────────────────────

export const digistInterests: IToolHandler = {
  name: 'digist_interests',
  description: '查看 digist 中配置的用户兴趣领域列表（GET /api/interests）。',
  parameters: {
    type: 'object',
    properties: {
      user_id: { type: 'string', description: '按用户 ID 过滤（可选）' },
    },
  },
  async handler(args) {
    const qs = args.user_id ? `?user_id=${encodeURIComponent(String(args.user_id))}` : '';
    try {
      const data = await digistGet(`/api/interests${qs}`) as InterestsResponse | InterestRecord[];
      const interests = Array.isArray(data) ? data : (data.interests ?? []);
      return { success: true, count: interests.length, interests };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
};

// ─── Tool 6: Sync to KnowLever ─────────────────────────────────────

export const digistSyncToKnowlever: IToolHandler = {
  name: 'digist_sync_to_knowlever',
  description:
    '按兴趣 ID 将 digist 内容同步到 KnowLever 知识库（POST /api/sync-to-knowlever）。' +
    '需先 digist_interests 获取 interest_id；topic 默认取兴趣的 linked_topic。',
  parameters: {
    type: 'object',
    properties: {
      interest_id: {
        type: 'string',
        description: '兴趣 ID（必填，来自 digist_interests）',
      },
      topic: {
        type: 'string',
        description: 'KnowLever topic 名（可选，默认用兴趣的 linked_topic）',
      },
      user: {
        type: 'string',
        description: 'KnowLever 用户名（可选，默认 admin）',
      },
      dry_run: {
        type: 'boolean',
        description: '仅预检不同步（可选）',
      },
    },
    required: ['interest_id'],
  },
  async handler(args) {
    const interestId = String(args.interest_id ?? '').trim();
    if (!interestId) throw new Error('interest_id 不能为空');

    const payload: Record<string, unknown> = { interest_id: interestId };
    if (args.topic) payload.topic = String(args.topic);
    if (args.user) payload.user = String(args.user);
    if (args.dry_run === true) payload.dry_run = true;

    try {
      const { status, data } = await digistPost('/api/sync-to-knowlever', payload, 60000);
      return { success: status < 400, result: data as SyncToKnowleverResponse };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
};

// ─── Export ────────────────────────────────────────────────────────

export const digistTools: IToolHandler[] = [
  digistCrawl,
  digistSearch,
  digistRecommend,
  digistStatus,
  digistInterests,
  digistSyncToKnowlever,
];
