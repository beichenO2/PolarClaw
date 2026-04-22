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
import { createLLMRouter } from './adapters/llm/llm-router.js';
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
import { createCareEngine } from './adapters/proactive/care-engine.js';
import { createClockSseBridge } from './adapters/proactive/clock-sse-bridge.js';
import { createYoloEngine } from './adapters/yolo/engine.js';
import { createRecoveryStrategy } from './adapters/yolo/recovery.js';
import { createWebServer } from './adapters/web/server.js';
import type { IChannelAdapter } from './ports/channel.js';

async function main() {
  // 先加载 .env（确保 POLARPRIVATE_URL 等基础配置可用）
  loadEnvFileEarly();

  // 动态发现 PolarPrivate 端口
  if (!process.env.POLARPRIVATE_URL) {
    try {
      const { createRequire } = await import('node:module');
      const { resolve, dirname } = await import('node:path');
      const _req = createRequire(import.meta.url);
      const sdkPath = resolve(dirname(new URL(import.meta.url).pathname), '..', '..', 'SOTAgent', 'sdk-port', 'index.js');
      const { getPort } = _req(sdkPath);
      const ppPort = await getPort('polarprivate');
      if (ppPort) process.env.POLARPRIVATE_URL = `http://127.0.0.1:${ppPort}`;
    } catch { /* port-sdk not available, use env fallback */ }
  }

  // 从 PolarPrivate Vault 补充 .env 中缺失的 secrets
  await loadSecretsToEnv({
    baseUrl: process.env.POLARPRIVATE_URL?.trim() || 'http://127.0.0.1:12790',
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
    maxMessages: config.memory.maxMessages,
    maxTokens: config.memory.maxTokens,
  });
  const llm = createLLMRouter({
    baseUrl: config.llm.baseUrl,
    apiKey: config.llm.apiKey,
    models: config.llm.models,
    defaultTemperature: config.llm.temperature,
    defaultMaxTokens: config.llm.maxTokens,
    fallbackProviders: config.llm.fallbackProviders,
    requestTimeoutMs: config.llm.requestTimeoutMs,
    concurrencyLimit: config.llm.concurrencyLimit,
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

  // 消息队列：同一用户的消息串行处理，避免对话历史竞争
  const userLocks = new Map<string, Promise<unknown>>();

  async function handleChannelMessage(msg: { channel: string; userId: string; text: string }) {
    const convId = `${msg.channel}:${msg.userId}`;

    const prev = userLocks.get(convId) ?? Promise.resolve();
    const current = prev.then(async () => {
      tools.setContext(msg.userId, convId);
      return agent.handleMessage(msg.channel, msg.userId, msg.text, convId);
    }).catch((err) => {
      console.error(`[MyClaw] handleChannelMessage error for ${convId}:`, err);
      return { text: '抱歉，处理消息时出错了，请稍后再试。' };
    });

    userLocks.set(convId, current);
    current.finally(() => {
      if (userLocks.get(convId) === current) userLocks.delete(convId);
    });

    const result = await current;
    return result.text;
  }

  // 主动关怀引擎
  const careEngine = createCareEngine(
    {
      pollIntervalMs: 60000,
      minCareIntervalMs: 2 * 3600000,
      inactivityThresholdMs: 4 * 3600000,
    },
    {
      memory,
      tools,
      onCareMessage: async (msg) => {
        const reply = await handleChannelMessage({
          channel: 'proactive',
          userId: msg.userId,
          text: msg.prompt,
        });
        console.error(`[CareEngine] → ${msg.userId}: ${reply.slice(0, 80)}...`);
      },
    },
  );

  // YOLO 自主执行引擎
  const yoloEngine = createYoloEngine({
    agent,
    recovery: createRecoveryStrategy(),
    onStepComplete: (step, session) => {
      console.error(`[YOLO] 步骤 ${step.step}/${session.stepsCompleted} 完成 (${step.tokensUsed} tokens)`);
    },
    onEscalate: (_sessionId, message) => {
      console.error(`[YOLO] 需要用户介入: ${message}`);
    },
    async onAlignmentCheck(_sessionId, plan) {
      console.error(`[YOLO] 对齐计划:\n${plan.slice(0, 500)}`);
      const reply = await handleChannelMessage({
        channel: 'yolo',
        userId: 'admin',
        text: `[YOLO 对齐确认] 以下是 Agent 的执行计划，请确认是否执行：\n\n${plan}\n\n回复"确认"或"拒绝"。`,
      });
      const lower = reply.toLowerCase();
      const confirmed = lower.includes('确认') || lower.includes('ok') || lower.includes('yes')
        || lower.includes('proceed') || lower.includes('go');
      console.error(`[YOLO] 用户确认结果: ${confirmed ? '✓ 通过' : '✗ 拒绝'}`);
      return confirmed;
    },
  });

  // 注册引擎工具（让 Agent 可通过对话控制）
  tools.register({
    name: 'yolo_start',
    description: '启动 YOLO 自主执行模式，Agent 将自主完成指定目标，无需逐步确认。',
    parameters: {
      type: 'object',
      properties: {
        goal: { type: 'string', description: '要完成的目标描述' },
        max_steps: { type: 'number', description: '最大自主步数（默认 10）' },
      },
      required: ['goal'],
    },
    async handler(args) {
      const goal = String(args.goal ?? '');
      const maxSteps = Number(args.max_steps) || 10;
      const result = await yoloEngine.run(
        { goal, maxSteps, maxTotalTokens: 200000, maxWallTimeMs: 600000, maxRetries: 2 },
        { channel: 'yolo', userId: 'admin' },
      );
      return {
        status: result.status,
        steps: result.stepsCompleted,
        tokens: result.totalTokensUsed,
        elapsed: `${Math.round(result.elapsedMs / 1000)}s`,
        stopReason: result.stopReason,
      };
    },
  });

  tools.register({
    name: 'care_add_rule',
    description: '添加一条主动关怀定时规则。',
    parameters: {
      type: 'object',
      properties: {
        username: { type: 'string', description: 'Clock 用户名（与 clock_* 工具一致）' },
        user_id: { type: 'string', description: '兼容旧参数，等同于 username' },
        schedule: { type: 'string', description: '调度间隔（如 "30m", "2h"）' },
        reason: { type: 'string', description: '触发原因（如 "inactivity", "scheduled"）' },
      },
      required: ['schedule', 'reason'],
    },
    handler(args) {
      const userKey = String((args as Record<string, unknown>).username ?? args.user_id ?? '');
      if (!userKey) {
        throw new Error('username 必填（可与 Clock 工具共用同一用户名）');
      }
      const id = `rule-${Date.now()}`;
      careEngine.addRule({
        id,
        userId: userKey,
        schedule: String(args.schedule),
        reason: String(args.reason),
        enabled: true,
      });
      return { id, ok: true };
    },
  });

  console.error('[MyClaw] Agent 已启动');
  console.error('[MyClaw] 状态:', JSON.stringify(agent.getStatus(), null, 2));
  console.error(`[MyClaw] 学习系统: ${learningTools.length} 工具已注册`);

  // Web 服务器（Review API + SPA + YOLO API）— 端口通过 port-sdk 申请
  let webPort = 3910;
  try {
    const { createRequire } = await import('node:module');
    const { resolve, dirname } = await import('node:path');
    const _req = createRequire(import.meta.url);
    const sdkPath = resolve(dirname(new URL(import.meta.url).pathname), '..', '..', 'SOTAgent', 'sdk-port', 'index.js');
    const { claimPort } = _req(sdkPath);
    webPort = await claimPort({ service: 'myclaw-web', project: 'MyClaw', preferred: 3910 });
  } catch (err) {
    console.error('[MyClaw] port-sdk 不可用，Web 服务器无法启动:', err);
    process.exit(1);
  }
  const webServer = createWebServer({
    port: webPort,
    dataDir: join(config.projectRoot, 'data'),
    webDistDir: join(config.projectRoot, 'web', 'dist'),
    getStatus: () => {
      const skills = skillRegistry.listSkills();
      return {
        name: 'MyClaw',
        version: '0.1.0',
        channels: channels.map(ch => ({ name: ch.name, connected: true })),
        uptime: process.uptime(),
        memory: { totalEntries: memory.search('*', { limit: 0 }).total, dbSizeBytes: 0 },
        skills: { count: skills.length, names: skills.map(s => s.name) },
        yolo: { activeSessions: 0 },
      };
    },
    yoloEngine,
  });
  await webServer.start();

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

  if (config.channels.cli && process.stdin.isTTY) {
    const cli = createCLIAdapter({ userId: 'admin' });
    cli.onMessage(async (msg) => handleChannelMessage(msg));
    await cli.start();
    channels.push(cli);
    console.error('[MyClaw] CLI 通道已启动');
  } else if (config.channels.cli) {
    console.error('[MyClaw] CLI 已配置但非 TTY 环境，跳过');
  }

  if (channels.length === 0) {
    console.error('[MyClaw] 未启用任何通道，等待通道连接...');
  }

  // 启动主动关怀引擎
  let clockSseBridge: ReturnType<typeof createClockSseBridge> | null = null;

  if (process.env.MYCLAW_PROACTIVE === '1') {
    careEngine.start();
    console.error('[MyClaw] 主动关怀引擎已启动');

    const clockUrl = process.env.CLOCK_API_URL?.trim();
    const clockUser = process.env.CLOCK_DEFAULT_USERNAME?.trim();
    if (clockUrl && clockUser) {
      clockSseBridge = createClockSseBridge(
        {
          clockBaseUrl: clockUrl,
          syncKey: process.env.CLOCK_SYNC_KEY?.trim() || undefined,
          usernames: clockUser.split(',').map(u => u.trim()).filter(Boolean),
        },
        careEngine,
      );
      clockSseBridge.start();
      console.error('[MyClaw] Clock SSE 桥接已启动');
    }
  }

  // 优雅退出
  const shutdown = async () => {
    console.error('[MyClaw] 正在关闭...');
    webServer.stop();
    clockSseBridge?.stop();
    careEngine.stop();
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
