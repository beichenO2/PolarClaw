/**
 * MyClaw — 主入口
 *
 * 组装端口-适配器架构的所有组件并启动 Agent。
 */

import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { loadConfig } from './config.js';
import { createAgent } from './core/agent.js';
import { createSqliteMemoryStore } from './adapters/memory/sqlite-store.js';
import { createConversationHistory } from './adapters/memory/conversation-history.js';
import { createOpenAICompatibleRouter } from './adapters/llm/openai-compatible.js';
import { createToolExecutor } from './adapters/tools/tool-executor.js';
import { createPrivacyGateway } from './adapters/privacy/privacy-gateway.js';

async function main() {
  const config = loadConfig();

  // 确保数据目录存在
  const dataDir = dirname(config.memory.dbPath);
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });

  // 组装适配器
  const memory = createSqliteMemoryStore(config.memory.dbPath);
  const conversations = createConversationHistory({ maxMessages: 100, maxTokens: 60000 });
  const llm = createOpenAICompatibleRouter({
    baseUrl: config.llm.baseUrl,
    apiKey: config.llm.apiKey,
    models: config.llm.models,
    defaultTemperature: config.llm.temperature,
    defaultMaxTokens: config.llm.maxTokens,
  });
  const tools = createToolExecutor();
  const privacy = createPrivacyGateway({
    polarPrivate: {
      baseUrl: config.privacy.polarPrivateUrl,
      getUnlockToken: () => process.env.POLARPRIVATE_UNLOCK_TOKEN ?? null,
    },
    enableSecretInterception: config.privacy.enableSecretInterception,
  });

  // 读取 SOUL.md 作为 system prompt 基础
  let soulPrompt = 'You are MyClaw, a helpful AI assistant.';
  const soulPath = join(config.projectRoot, 'SOUL.md');
  if (existsSync(soulPath)) {
    soulPrompt = readFileSync(soulPath, 'utf8');
  }

  // 注册内置工具
  tools.register({
    name: 'memory_save',
    description: '保存一条长期记忆（笔记），可选标签。',
    parameters: {
      type: 'object',
      properties: {
        content: { type: 'string', description: '要保存的正文' },
        type: { type: 'string', description: '类型，默认 note' },
        tags: { type: 'string', description: '空格或逗号分隔标签' },
      },
      required: ['content'],
    },
    handler(args) {
      const content = String(args.content ?? '');
      if (!content.trim()) throw new Error('content 不能为空');
      const entry = memory.save({
        type: String(args.type ?? 'note'),
        content,
        tags: args.tags != null ? String(args.tags) : undefined,
        metadata: JSON.stringify({ source: 'tool' }),
      });
      return { id: entry.id, ok: true };
    },
  });

  tools.register({
    name: 'memory_search',
    description: '按关键词搜索记忆库（FTS5）。',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        limit: { type: 'number' },
      },
      required: ['query'],
    },
    handler(args) {
      const q = String(args.query ?? '').trim();
      const limit = Number.isFinite(Number(args.limit)) ? Number(args.limit) : 8;
      const result = memory.search(q, { limit });
      return { hits: result.entries, total: result.total };
    },
  });

  // 创建 Agent
  const agent = createAgent(
    {
      systemPrompt: soulPrompt,
      maxToolRounds: config.llm.maxToolRounds,
      temperature: config.llm.temperature,
      maxTokens: config.llm.maxTokens,
    },
    { llm, memory, conversations, tools, privacy },
  );

  console.error('[MyClaw] Agent 已启动');
  console.error('[MyClaw] 状态:', JSON.stringify(agent.getStatus(), null, 2));
  console.error('[MyClaw] 等待通道连接...');

  // 优雅退出
  const shutdown = () => {
    console.error('[MyClaw] 正在关闭...');
    memory.close();
    process.exit(0);
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);

  // 保持进程运行
  await new Promise(() => {});
}

main().catch((err) => {
  console.error('[MyClaw] Fatal:', err);
  process.exit(1);
});
