/**
 * MyClaw — 主入口
 *
 * 组装端口-适配器架构的所有组件并启动 Agent。
 */

import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { loadConfig, loadEnvFileEarly } from './config.js';
import { createAgent } from './core/agent.js';
import { createSqliteMemoryStore } from './adapters/memory/sqlite-store.js';
import { createPersistentConversation } from './adapters/memory/persistent-conversation.js';
import { createOpenAICompatibleRouter } from './adapters/llm/openai-compatible.js';
import { createToolExecutor } from './adapters/tools/tool-executor.js';
import { createPrivacyGateway } from './adapters/privacy/privacy-gateway.js';
import { loadSecretsToEnv } from './adapters/privacy/secrets-loader.js';
import { createFeishuAdapter } from './adapters/channel/feishu.js';
import { loadFeishuConfig } from './adapters/channel/feishu-config.js';
import { createCLIAdapter } from './adapters/channel/cli.js';
import { createContextCompressor } from './adapters/compression/summarizer.js';
import { createSkillRegistry } from './adapters/skills/skill-registry.js';
import { createLearningStore } from './adapters/learning/feedback-store.js';
import { createTrackedToolExecutor } from './adapters/learning/usage-tracker.js';
import { createPatternDetector } from './adapters/learning/pattern-detector.js';
import { createSkillGenerator } from './adapters/learning/skill-generator.js';
import { createSkillComposer } from './adapters/learning/skill-composer.js';
import { createLearningTools } from './adapters/learning/learning-tools.js';
import type { IChannelAdapter } from './ports/channel.js';

async function main() {
  // 先加载 .env（确保 POLARPRIVATE_URL 等基础配置可用）
  loadEnvFileEarly();

  // 从 PolarPrivate Vault 补充 .env 中缺失的 secrets
  await loadSecretsToEnv({
    baseUrl: process.env.POLARPRIVATE_URL?.trim() || 'http://127.0.0.1:8790',
    projectName: 'MyClaw',
  });

  const config = loadConfig();

  // 确保数据目录存在
  const dataDir = dirname(config.memory.dbPath);
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });

  // 组装适配器
  const memory = createSqliteMemoryStore(config.memory.dbPath);
  const conversations = createPersistentConversation({
    dbPath: config.memory.dbPath,
    maxMessages: 100,
    maxTokens: 60000,
  });
  const llm = createOpenAICompatibleRouter({
    baseUrl: config.llm.baseUrl,
    apiKey: config.llm.apiKey,
    models: config.llm.models,
    defaultTemperature: config.llm.temperature,
    defaultMaxTokens: config.llm.maxTokens,
    fallbackProviders: config.llm.fallbackProviders,
    requestTimeoutMs: config.llm.requestTimeoutMs,
  });
  const rawTools = createToolExecutor();

  // 学习系统：包装工具执行器以追踪使用记录
  const learningStore = createLearningStore(config.memory.dbPath);
  const tools = createTrackedToolExecutor(rawTools, learningStore);

  const privacy = createPrivacyGateway({
    polarPrivate: {
      baseUrl: config.privacy.polarPrivateUrl,
    },
    enableSecretInterception: config.privacy.enableSecretInterception,
  });

  // 读取 SOUL.md 作为 system prompt 基础
  let soulPrompt = 'You are MyClaw, a helpful AI assistant.';
  const soulPath = join(config.projectRoot, 'SOUL.md');
  if (existsSync(soulPath)) {
    soulPrompt = readFileSync(soulPath, 'utf8');
  }

  // 技能注册表（替代旧的 skillLoader.scan + registerTools）
  const skillRegistry = createSkillRegistry(tools);
  await skillRegistry.init(config.skills.scanDirs);
  skillRegistry.watch();

  // 学习子系统
  const patternDetector = createPatternDetector(learningStore);
  const skillGenerator = createSkillGenerator({
    outputDir: join(config.projectRoot, 'skills'),
  }, llm);
  const skillComposer = createSkillComposer(tools);

  // 注册学习系统工具（让 Agent 能调用反馈/生成/组合能力）
  const learningTools = createLearningTools({
    learningStore,
    skillRegistry,
    patternDetector,
    skillGenerator,
    skillComposer,
  });
  for (const lt of learningTools) {
    tools.register(lt);
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

  // 上下文压缩器（Phase 3 摘要使用 general 模型）
  const compressor = createContextCompressor({
    triggerRatio: 0.7,
    toolOutputMaxLen: 2000,
    headKeep: 4,
    tailKeep: 8,
    summarize: async (text) => {
      const res = await llm.chat([
        { role: 'system', content: '你是一个对话摘要助手。请将以下多轮对话内容压缩为简洁的结构化摘要，保留关键事实、决策和工具调用结果。使用中文，不超过 500 字。' },
        { role: 'user', content: text },
      ], { temperature: 0.3, maxTokens: 800 });
      return res.content ?? '';
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
    { llm, memory, conversations, tools, privacy, compressor },
  );

  console.error('[MyClaw] Agent 已启动');
  console.error('[MyClaw] 状态:', JSON.stringify(agent.getStatus(), null, 2));
  console.error(`[MyClaw] 学习系统: ${learningTools.length} 工具已注册`);

  // 通用消息处理：设置学习上下文后交给 Agent
  async function handleChannelMessage(msg: { channel: string; userId: string; text: string }) {
    const convId = `${msg.channel}:${msg.userId}`;
    tools.setContext(msg.userId, convId);
    const result = await agent.handleMessage(msg.channel, msg.userId, msg.text, convId);
    return result.text;
  }

  // 启动通道
  const channels: IChannelAdapter[] = [];

  if (config.channels.feishu) {
    try {
      const adminConfig = loadFeishuConfig('FEISHU_ADMIN');
      const feishuAdmin = createFeishuAdapter({
        config: adminConfig,
        transport: (process.env.FEISHU_TRANSPORT as 'websocket' | 'webhook') || 'websocket',
        channelName: 'feishu:admin',
      });
      feishuAdmin.onMessage(async (msg) => handleChannelMessage(msg));
      await feishuAdmin.start();
      channels.push(feishuAdmin);
      console.error('[MyClaw] 飞书管理员 Bot 已连接');
    } catch (err) {
      console.error('[MyClaw] 飞书管理员 Bot 启动失败:', err);
    }

    if (process.env.FEISHU_GIRLFRIEND_APP_ID) {
      try {
        const gfConfig = loadFeishuConfig('FEISHU_GIRLFRIEND');
        const feishuGf = createFeishuAdapter({
          config: gfConfig,
          transport: (process.env.FEISHU_TRANSPORT as 'websocket' | 'webhook') || 'websocket',
          channelName: 'feishu:girlfriend',
        });
        feishuGf.onMessage(async (msg) => handleChannelMessage(msg));
        await feishuGf.start();
        channels.push(feishuGf);
        console.error('[MyClaw] 飞书女友 Bot 已连接');
      } catch (err) {
        console.error('[MyClaw] 飞书女友 Bot 启动失败:', err);
      }
    }
  }

  if (config.channels.cli) {
    const cli = createCLIAdapter({ userId: 'admin' });
    cli.onMessage(async (msg) => handleChannelMessage(msg));
    await cli.start();
    channels.push(cli);
    console.error('[MyClaw] CLI 通道已启动');
  }

  if (channels.length === 0) {
    console.error('[MyClaw] 未启用任何通道，等待通道连接...');
  }

  // 优雅退出
  const shutdown = async () => {
    console.error('[MyClaw] 正在关闭...');
    skillRegistry.unwatch();
    for (const ch of channels) {
      try { await ch.stop(); } catch { /* ignore */ }
    }
    memory.close();
    process.exit(0);
  };
  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());

  // 保持进程运行
  await new Promise(() => {});
}

main().catch((err) => {
  console.error('[MyClaw] Fatal:', err);
  process.exit(1);
});
