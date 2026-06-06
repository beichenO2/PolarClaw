/**
 * KnowLever Integration — PolarClaw 技能工具
 *
 * RAG 检索/摄入/Topic 管理经 KnowLever Bridge API（rag/api_server.py）。
 * 代码库摄入、同步编译、静态站构建经 wiki-engine CLI。
 * 端口经 port-sdk 发现 service_name=knowlever-rag，网关前缀 knowlever。
 *
 * API 契约对齐 KnowLever/rag/api_server.py 与 capabilities.json。
 */

import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import type { IToolHandler } from '../../src/ports/tools.js';
import { getServiceUrl, SERVICES } from '../_shared/port-discovery.js';

const execFileAsync = promisify(execFile);

// ─── KnowLever API response shapes ──────────────────────────────────

interface SearchResult {
  text: string;
  score: number;
  source: string;
  user?: string;
}

interface SearchResponse {
  results?: SearchResult[];
  user?: string;
}

interface IngestResponse {
  doc_id?: string;
  chunk_ids?: string[];
  num_chunks?: number;
}

interface TopicSummary {
  name: string;
  wiki_pages: number;
  raw_docs: number;
}

interface TopicsResponse {
  topics?: TopicSummary[];
  user?: string;
}

interface WikiPageSummary {
  filename: string;
  title: string;
  size: number;
}

interface PagesResponse {
  pages?: WikiPageSummary[];
  topic?: string;
}

interface PageContentResponse {
  content?: string;
  source?: string;
  topic?: string;
  page?: string;
  error?: string;
}

interface CompileTriggerResponse {
  ok?: boolean;
  queued?: Record<string, unknown>;
}

interface FeedbackResponse {
  ok?: boolean;
  path?: string;
  slug?: string;
  reason?: string;
}

function getKnowLeverDir(): string {
  const env = process.env.KNOWLEVER_DIR?.trim();
  if (env) return resolve(env);
  const home = process.env.HOME ?? '/Users/mac';
  return resolve(home, 'Polarisor/KnowLever');
}

async function getKnowleverBase(): Promise<string> {
  return getServiceUrl(SERVICES.KNOWLEVER_RAG.name, SERVICES.KNOWLEVER_RAG.gateway);
}

async function knowleverGet(path: string, timeoutMs = 8000): Promise<unknown> {
  const base = await getKnowleverBase();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}${path}`, { signal: controller.signal });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`KnowLever API ${res.status}: ${text.slice(0, 200)}`);
    }
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  } finally {
    clearTimeout(timer);
  }
}

async function knowleverPost(
  path: string,
  body: Record<string, unknown>,
  timeoutMs = 30000,
): Promise<{ status: number; data: unknown }> {
  const base = await getKnowleverBase();
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
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
    if (!res.ok) {
      throw new Error(`KnowLever API ${res.status}: ${String(data).slice(0, 200)}`);
    }
    return { status: res.status, data };
  } finally {
    clearTimeout(timer);
  }
}

function formatSearchContext(results: SearchResult[]): string {
  return results
    .map((r, i) => `[${i + 1}] (score=${r.score}, source=${r.source})\n${r.text}`)
    .join('\n\n---\n\n');
}

async function runNodeScript(
  scriptPath: string,
  args: string[],
  timeoutMs = 30000,
): Promise<{ stdout: string; stderr: string }> {
  const klDir = getKnowLeverDir();
  return execFileAsync(process.execPath, [resolve(klDir, scriptPath), ...args], {
    timeout: timeoutMs,
    cwd: klDir,
    maxBuffer: 10 * 1024 * 1024,
  });
}

// ─── Tool 1: RAG Search ─────────────────────────────────────────────

export const knowleverQuery: IToolHandler = {
  name: 'knowlever_query',
  description:
    '从 KnowLever 知识库语义检索相关上下文（POST /api/search，向量相似度）。' +
    '适合背景知识、参考资料、事实核查。',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: '检索查询（自然语言问题或关键词）' },
      top_k: { type: 'number', description: '返回结果数量（默认 5，最大 10）' },
      user: { type: 'string', description: '用户名（默认 admin）' },
      topic: { type: 'string', description: '按 Topic 过滤（可选）' },
    },
    required: ['query'],
  },
  async handler(args) {
    const query = String(args.query ?? '').trim();
    if (!query) throw new Error('query 不能为空');
    const topK = Math.min(10, Math.max(1, Number(args.top_k) || 5));
    const user = String(args.user ?? 'admin').trim();

    const body: Record<string, unknown> = { query, top_k: topK, user };
    if (args.topic) body.topic = String(args.topic).trim();

    try {
      const { data } = await knowleverPost('/api/search', body);
      const resp = data as SearchResponse;
      const results = resp.results ?? [];
      return {
        success: true,
        query,
        user: resp.user ?? user,
        results,
        context: formatSearchContext(results),
        total: results.length,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: msg, query };
    }
  },
};

// ─── Tool 2: List Topics ────────────────────────────────────────────

export const knowleverListTopics: IToolHandler = {
  name: 'knowlever_list_topics',
  description: '列出 KnowLever 知识库中某用户的所有 Topic（GET /api/topics）。',
  parameters: {
    type: 'object',
    properties: {
      user: { type: 'string', description: '用户名（默认 admin）' },
    },
  },
  async handler(args) {
    const user = String(args.user ?? 'admin').trim();
    try {
      const data = (await knowleverGet(
        `/api/topics?user=${encodeURIComponent(user)}`,
      )) as TopicsResponse;
      const topics = data.topics ?? [];
      return { topics, total: topics.length, user: data.user ?? user };
    } catch (err) {
      return {
        topics: [],
        total: 0,
        user,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
};

// ─── Tool 3: Ingest Text ────────────────────────────────────────────

export const knowleverIngest: IToolHandler = {
  name: 'knowlever_ingest',
  description:
    '将文本摄入 KnowLever 向量索引（POST /api/ingest）。摄入后可自动排队编译。',
  parameters: {
    type: 'object',
    properties: {
      text: { type: 'string', description: '要摄入的文本内容' },
      doc_id: { type: 'string', description: '文档 ID（唯一标识，如 note-2026-04-15）' },
      user: { type: 'string', description: '用户名（默认 admin）' },
      topic: { type: 'string', description: '关联 Topic（写入 extra_meta.topic）' },
    },
    required: ['text', 'doc_id'],
  },
  async handler(args) {
    const text = String(args.text ?? '').trim();
    const docId = String(args.doc_id ?? '').trim();
    const user = String(args.user ?? 'admin').trim();
    if (!text) throw new Error('text 不能为空');
    if (!docId) throw new Error('doc_id 不能为空');

    const extraMeta: Record<string, string> = {};
    if (args.topic) extraMeta.topic = String(args.topic).trim();

    try {
      const { data } = await knowleverPost(
        '/api/ingest',
        {
          text: text.slice(0, 10000),
          doc_id: docId,
          user,
          extra_meta: Object.keys(extraMeta).length > 0 ? extraMeta : undefined,
        },
        30000,
      );
      const resp = data as IngestResponse;
      return {
        success: true,
        doc_id: resp.doc_id ?? docId,
        num_chunks: resp.num_chunks ?? 0,
        chunk_ids: resp.chunk_ids ?? [],
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
        doc_id: docId,
      };
    }
  },
};

// ─── Tool 4: Ingest Codebase ───────────────────────────────────────

export const knowleverIngestCodebase: IToolHandler = {
  name: 'knowlever_ingest_codebase',
  description:
    '将代码库（本地目录或 Git URL）摄入 KnowLever Topic（wiki-engine/ingest.js --from-codebase）。' +
    '自动识别项目结构、语言、框架。',
  parameters: {
    type: 'object',
    properties: {
      input: {
        type: 'string',
        description: '代码库路径（本地目录）或 Git URL',
      },
      topic: { type: 'string', description: 'Topic 名称（如 react-source）' },
      user: { type: 'string', description: '用户名（默认 admin）' },
      domain: { type: 'string', description: '领域标签（可选，传给 --domain）' },
    },
    required: ['input', 'topic'],
  },
  async handler(args) {
    const input = String(args.input ?? '').trim();
    const topic = String(args.topic ?? '').trim();
    const user = String(args.user ?? 'admin').trim();
    if (!input) throw new Error('input 不能为空');
    if (!topic) throw new Error('topic 不能为空');

    const nodeArgs = [input, '--topic', topic, '--user', user, '--from-codebase'];
    if (args.domain) nodeArgs.push('--domain', String(args.domain).trim());

    try {
      const { stdout, stderr } = await runNodeScript(
        'wiki-engine/ingest.js',
        nodeArgs,
        120000,
      );
      const success = !stderr || !stderr.includes('[error]');
      return { success, output: stdout.trim(), topic, input };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
        topic,
        input,
      };
    }
  },
};

// ─── Tool 5: Sync Compile (CLI) ─────────────────────────────────────

export const knowleverCompile: IToolHandler = {
  name: 'knowlever_compile',
  description:
    '同步 LLM 知识编译（wiki-engine/_legacy/compile.js）。' +
    '将 raw/normalized 内容编译为结构化 wiki 页面。需要 PolarPrivate（默认 :12790）。',
  parameters: {
    type: 'object',
    properties: {
      topic: { type: 'string', description: 'Topic 名称' },
      user: { type: 'string', description: '用户名（默认 admin）' },
      source: {
        type: 'string',
        description: '编译特定 source ID（不指定则编译所有未编译的 source）',
      },
      force: { type: 'boolean', description: '强制重新编译（默认 false）' },
      dry_run: { type: 'boolean', description: '仅分析不写入（默认 false）' },
      limit: { type: 'number', description: '最大编译 source 数量' },
    },
    required: ['topic'],
  },
  async handler(args) {
    const topic = String(args.topic ?? '').trim();
    const user = String(args.user ?? 'admin').trim();
    if (!topic) throw new Error('topic 不能为空');

    const nodeArgs = ['--topic', topic, '--user', user];
    if (args.source) nodeArgs.push('--source', String(args.source));
    if (args.force) nodeArgs.push('--force');
    if (args.dry_run) nodeArgs.push('--dry-run');
    if (args.limit) nodeArgs.push('--limit', String(args.limit));

    try {
      const { stdout, stderr } = await runNodeScript(
        'wiki-engine/_legacy/compile.js',
        nodeArgs,
        300000,
      );
      const success = !stderr || !stderr.includes('[fatal]');
      return { success, output: stdout.trim(), topic };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
        topic,
      };
    }
  },
};

// ─── Tool 6: Async Compile Trigger (HTTP) ───────────────────────────

export const knowleverCompileTrigger: IToolHandler = {
  name: 'knowlever_compile_trigger',
  description:
    '异步触发 Topic 编译+构建（POST /api/compile/trigger）。后台队列执行，适合摄入后自动编译。',
  parameters: {
    type: 'object',
    properties: {
      topic: { type: 'string', description: 'Topic 名称' },
      user: { type: 'string', description: '用户名（默认 admin）' },
      force: { type: 'boolean', description: '强制重新编译（默认 false）' },
      source: {
        type: 'string',
        description: '触发来源标识（默认 polarclaw，如 digist/sdk/clock-feed-report）',
      },
    },
    required: ['topic'],
  },
  async handler(args) {
    const topic = String(args.topic ?? '').trim();
    const user = String(args.user ?? 'admin').trim();
    if (!topic) throw new Error('topic 不能为空');

    try {
      const { data } = await knowleverPost('/api/compile/trigger', {
        topic,
        user,
        force: Boolean(args.force),
        source: String(args.source ?? 'polarclaw'),
      });
      const resp = data as CompileTriggerResponse;
      return {
        success: resp.ok ?? true,
        queued: resp.queued,
        topic,
        user,
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
        topic,
      };
    }
  },
};

// ─── Tool 7: Build Static Site ──────────────────────────────────────

export const knowleverBuild: IToolHandler = {
  name: 'knowlever_build',
  description:
    '构建 Topic 静态 HTML 站点（wiki-engine/_legacy/build.js）。将 wiki/ Markdown 渲染为可浏览网页。',
  parameters: {
    type: 'object',
    properties: {
      topic: { type: 'string', description: 'Topic 名称' },
      user: { type: 'string', description: '用户名（默认 admin）' },
    },
    required: ['topic'],
  },
  async handler(args) {
    const topic = String(args.topic ?? '').trim();
    const user = String(args.user ?? 'admin').trim();
    if (!topic) throw new Error('topic 不能为空');

    try {
      const { stdout, stderr } = await runNodeScript(
        'wiki-engine/_legacy/build.js',
        ['--topic', topic, '--user', user],
        60000,
      );
      const success = !stderr || !stderr.includes('[error]');
      return { success, output: stdout.trim(), topic };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
        topic,
      };
    }
  },
};

// ─── Tool 8: List Wiki Pages ────────────────────────────────────────

export const knowleverListPages: IToolHandler = {
  name: 'knowlever_list_pages',
  description: '列出 Topic 下所有 wiki 页面（GET /api/topics/{topic}/pages）。',
  parameters: {
    type: 'object',
    properties: {
      topic: { type: 'string', description: 'Topic 名称' },
      user: { type: 'string', description: '用户名（默认 admin）' },
    },
    required: ['topic'],
  },
  async handler(args) {
    const topic = String(args.topic ?? '').trim();
    const user = String(args.user ?? 'admin').trim();
    if (!topic) throw new Error('topic 不能为空');

    try {
      const data = (await knowleverGet(
        `/api/topics/${encodeURIComponent(topic)}/pages?user=${encodeURIComponent(user)}`,
      )) as PagesResponse;
      const pages = data.pages ?? [];
      return { pages, total: pages.length, topic: data.topic ?? topic, user };
    } catch (err) {
      return {
        pages: [],
        total: 0,
        topic,
        user,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
};

// ─── Tool 9: Get Wiki Page ──────────────────────────────────────────

export const knowleverGetPage: IToolHandler = {
  name: 'knowlever_get_page',
  description:
    '读取 Topic 下单个 wiki/raw 页面内容（GET /api/topics/{topic}/pages/{page}）。',
  parameters: {
    type: 'object',
    properties: {
      topic: { type: 'string', description: 'Topic 名称' },
      page: { type: 'string', description: '页面文件名或 slug（如 index.md）' },
      user: { type: 'string', description: '用户名（默认 admin）' },
    },
    required: ['topic', 'page'],
  },
  async handler(args) {
    const topic = String(args.topic ?? '').trim();
    const page = String(args.page ?? '').trim();
    const user = String(args.user ?? 'admin').trim();
    if (!topic) throw new Error('topic 不能为空');
    if (!page) throw new Error('page 不能为空');

    try {
      const data = (await knowleverGet(
        `/api/topics/${encodeURIComponent(topic)}/pages/${encodeURIComponent(page)}?user=${encodeURIComponent(user)}`,
      )) as PageContentResponse;
      if (data.error === 'not_found') {
        return { success: false, error: 'page not found', topic, page };
      }
      return {
        success: true,
        content: data.content ?? '',
        source: data.source,
        topic: data.topic ?? topic,
        page: data.page ?? page,
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
        topic,
        page,
      };
    }
  },
};

// ─── Tool 10: Q&A Feedback ─────────────────────────────────────────

export const knowleverFeedback: IToolHandler = {
  name: 'knowlever_feedback',
  description:
    '将高质量 Q&A 回灌到 wiki 并重新索引（POST /api/feedback，quality_score >= 0.7）。',
  parameters: {
    type: 'object',
    properties: {
      topic: { type: 'string', description: 'Topic 名称' },
      query: { type: 'string', description: '用户问题' },
      answer: { type: 'string', description: '回答内容' },
      user: { type: 'string', description: '用户名（默认 admin）' },
      quality_score: {
        type: 'number',
        description: '质量分 0.0–1.0（默认 0.8，需 >= 0.7）',
      },
    },
    required: ['topic', 'query', 'answer'],
  },
  async handler(args) {
    const topic = String(args.topic ?? '').trim();
    const query = String(args.query ?? '').trim();
    const answer = String(args.answer ?? '').trim();
    const user = String(args.user ?? 'admin').trim();
    if (!topic || !query || !answer) {
      throw new Error('topic、query、answer 均不能为空');
    }

    try {
      const { data } = await knowleverPost('/api/feedback', {
        topic,
        query,
        answer,
        user,
        quality_score: Number(args.quality_score) || 0.8,
        source: 'polarclaw',
      });
      const resp = data as FeedbackResponse;
      return {
        success: resp.ok ?? false,
        path: resp.path,
        slug: resp.slug,
        reason: resp.reason,
        topic,
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
        topic,
      };
    }
  },
};

export const knowleverTools: IToolHandler[] = [
  knowleverQuery,
  knowleverListTopics,
  knowleverIngest,
  knowleverIngestCodebase,
  knowleverCompile,
  knowleverCompileTrigger,
  knowleverBuild,
  knowleverListPages,
  knowleverGetPage,
  knowleverFeedback,
];
