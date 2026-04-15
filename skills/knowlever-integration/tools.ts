/**
 * KnowLever Integration — 工具实现
 *
 * 通过 Python 子进程调用 KnowLever RAG 管道。
 * 直接访问知识库，不依赖 AutoOffice 中间层。
 */

import { execFile, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { readdirSync, existsSync, statSync } from 'node:fs';
import { promisify } from 'node:util';
import type { IToolHandler } from '../../src/ports/tools.js';

const execFileAsync = promisify(execFile);
const PYTHON_CANDIDATES = ['/opt/homebrew/bin/python3', 'python3'];

function getKnowLeverDir(): string {
  const env = process.env.KNOWLEVER_DIR?.trim();
  if (env) return resolve(env);
  const home = process.env.HOME ?? '/Users/mac';
  return resolve(home, 'Polarisor/KnowLever');
}

function findPython(): string {
  const klDir = getKnowLeverDir();
  for (const candidate of PYTHON_CANDIDATES) {
    try {
      const { status } = spawnSync(candidate, [
        '-c',
        `import sys; sys.path.insert(0, sys.argv[1]); import rag.pipeline`,
        klDir,
      ], { stdio: 'pipe' });
      if (status === 0) return candidate;
    } catch { /* try next */ }
  }
  for (const candidate of PYTHON_CANDIDATES) {
    try {
      const { status } = spawnSync(candidate, ['--version'], { stdio: 'pipe' });
      if (status === 0) return candidate;
    } catch { /* try next */ }
  }
  return 'python3';
}

async function runPythonScript(
  script: string,
  payload: Record<string, string | number>,
  timeoutMs = 15000,
): Promise<{ stdout: string; stderr: string }> {
  const klDir = getKnowLeverDir();
  const python = findPython();
  return execFileAsync(python, ['-c', script, klDir, JSON.stringify(payload)], {
    timeout: timeoutMs,
    cwd: klDir,
  });
}

const RAG_QUERY_SCRIPT = `
import json, sys
sys.path.insert(0, sys.argv[1])
payload = json.loads(sys.argv[2])
from rag.pipeline import RAGPipeline
pipeline = RAGPipeline()
context = pipeline.build_context(query=payload["query"], top_k=payload["top_k"])
print(context)
`;

const RAG_INGEST_SCRIPT = `
import json, sys
sys.path.insert(0, sys.argv[1])
payload = json.loads(sys.argv[2])
from rag.pipeline import RAGPipeline
pipeline = RAGPipeline()
pipeline.ingest_document(text=payload["text"], doc_id=payload["doc_id"])
print("OK")
`;

export const knowleverQuery: IToolHandler = {
  name: 'knowlever_query',
  description:
    '从 KnowLever 知识库中检索相关上下文。使用 BM25 + 向量混合检索。' +
    '适合需要背景知识、参考资料、事实核查的场景。',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: '检索查询（自然语言问题或关键词）' },
      top_k: { type: 'number', description: '返回结果数量（默认 3，最大 10）' },
    },
    required: ['query'],
  },
  async handler(args) {
    const query = String(args.query ?? '').trim();
    if (!query) throw new Error('query 不能为空');
    const topK = Math.min(10, Math.max(1, Number(args.top_k) || 3));

    try {
      const { stdout, stderr } = await runPythonScript(
        RAG_QUERY_SCRIPT,
        { query, top_k: topK },
      );
      if (stderr && stderr.includes('ERROR:')) {
        return { success: false, error: stderr.trim(), query };
      }
      return { success: true, context: stdout.trim(), query };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: msg, query };
    }
  },
};

export const knowleverListTopics: IToolHandler = {
  name: 'knowlever_list_topics',
  description: '列出 KnowLever 知识库中所有可用的 Topic（知识主题）。',
  parameters: { type: 'object', properties: {} },
  async handler() {
    const klDir = getKnowLeverDir();
    const dataDir = resolve(klDir, 'data/users');

    if (!existsSync(dataDir)) {
      return { topics: [], error: 'KnowLever data 目录不存在' };
    }

    const topics: Array<{ user: string; topic: string; path: string }> = [];

    try {
      for (const user of readdirSync(dataDir)) {
        const userDir = resolve(dataDir, user);
        if (!statSync(userDir).isDirectory()) continue;
        const topicsDir = resolve(userDir, 'topics');
        if (!existsSync(topicsDir)) continue;

        for (const topic of readdirSync(topicsDir)) {
          const topicDir = resolve(topicsDir, topic);
          if (statSync(topicDir).isDirectory()) {
            topics.push({ user, topic, path: topicDir });
          }
        }
      }
    } catch (err) {
      return { topics: [], error: err instanceof Error ? err.message : String(err) };
    }

    return { topics, total: topics.length };
  },
};

export const knowleverIngest: IToolHandler = {
  name: 'knowlever_ingest',
  description: '将文本摄入 KnowLever 知识库，建立检索索引。适合保存重要笔记或文档。',
  parameters: {
    type: 'object',
    properties: {
      text: { type: 'string', description: '要摄入的文本内容' },
      doc_id: { type: 'string', description: '文档 ID（唯一标识，如 note-2026-04-15）' },
    },
    required: ['text', 'doc_id'],
  },
  async handler(args) {
    const text = String(args.text ?? '').trim();
    const docId = String(args.doc_id ?? '').trim();
    if (!text) throw new Error('text 不能为空');
    if (!docId) throw new Error('doc_id 不能为空');

    try {
      const { stderr } = await runPythonScript(
        RAG_INGEST_SCRIPT,
        { text: text.slice(0, 10000), doc_id: docId },
        30000,
      );
      const success = !stderr || !stderr.includes('ERROR:');
      return { success, doc_id: docId };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
};

export const knowleverTools: IToolHandler[] = [
  knowleverQuery,
  knowleverListTopics,
  knowleverIngest,
];
