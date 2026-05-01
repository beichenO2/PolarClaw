/**
 * PolarClaw — 主入口
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
import { createFeishuDedup } from './adapters/channel/feishu-dedup.js';
import { createCLIAdapter } from './adapters/channel/cli.js';
import { createContextCompressor } from './adapters/compression/summarizer.js';
import { createSkillRegistry } from './adapters/skills/skill-registry.js';
import { createMetaIndex } from './adapters/skills/meta-index.js';
import { createSkillDiscoveryTools } from './adapters/skills/skill-discovery.js';
import { createLearningStore } from './adapters/learning/feedback-store.js';
import { createTrackedToolExecutor } from './adapters/learning/usage-tracker.js';
import { createPatternDetector } from './adapters/learning/pattern-detector.js';
import { createSkillGenerator } from './adapters/learning/skill-generator.js';
import { createSkillComposer } from './adapters/learning/skill-composer.js';
import { createLearningTools } from './adapters/learning/learning-tools.js';
import { createCareEngine } from './adapters/proactive/care-engine.js';
import { createClockSseBridge } from './adapters/proactive/clock-sse-bridge.js';
import { createScheduleBridge } from './adapters/proactive/schedule-bridge.js';
import { createYoloEngine } from './adapters/yolo/engine.js';
import { createRecoveryStrategy } from './adapters/yolo/recovery.js';
import { createWebServer } from './adapters/web/server.js';
import { createPilotStore } from './adapters/pilot/store.js';
import { createPilotEngine } from './adapters/pilot/engine.js';
import { createPolarUserRegistry } from './core/polar-user.js';
import { createPolarClawSDK } from './sdk/index.js';
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
    projectName: 'PolarClaw',
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

  // Pilot: PolarClaw 的自主项目执行系统
  const pilotDb = (await import('better-sqlite3')).default(join(dataDir, 'pilot.db'));
  pilotDb.pragma('journal_mode = WAL');
  const pilotStore = createPilotStore(pilotDb);
  const pilotEngine = createPilotEngine({ store: pilotStore, llm });

  const privacy = createPrivacyGateway({
    polarPrivate: {
      baseUrl: config.privacy.polarPrivateUrl,
    },
    enableSecretInterception: config.privacy.enableSecretInterception,
  });

  // 读取 SOUL.md 作为 system prompt 基础（优先 skills/SOUL.md 生态地图）
  let soulPrompt = 'You are PolarClaw, a helpful AI assistant.';
  const soulEcosystemPath = join(config.projectRoot, 'skills', 'SOUL.md');
  const soulRootPath = join(config.projectRoot, 'SOUL.md');
  if (existsSync(soulEcosystemPath)) {
    const ecosystem = readFileSync(soulEcosystemPath, 'utf8');
    const identity = existsSync(soulRootPath) ? readFileSync(soulRootPath, 'utf8') : '';
    soulPrompt = identity ? `${identity}\n\n${ecosystem}` : ecosystem;
  } else if (existsSync(soulRootPath)) {
    soulPrompt = readFileSync(soulRootPath, 'utf8');
  }

  // 元技能索引（轻量扫描，不加载工具实现）
  const metaIndex = createMetaIndex();
  metaIndex.scan(config.skills.scanDirs);
  console.error(`[PolarClaw] 元技能索引: ${metaIndex.all().length} 技能, ${metaIndex.allMetaSkills().length} 元技能已索引`);

  // 技能注册表（按需加载模式：只扫描目录，工具通过 skill_activate 按需加载）
  const skillRegistry = createSkillRegistry(tools);
  await skillRegistry.init(config.skills.scanDirs, { loadTools: false });
  skillRegistry.watch();

  // 学习子系统
  const patternDetector = createPatternDetector(learningStore);
  const skillGenerator = createSkillGenerator({
    outputDir: join(config.projectRoot, 'skills'),
  }, llm);
  const skillComposer = createSkillComposer(tools);

  // 技能发现工具（skill_search / skill_activate / skill_deactivate）
  const discoveryTools = createSkillDiscoveryTools({
    metaIndex,
    skillRegistry,
    polarisorRoot: join(config.projectRoot, '..'),
    localSkillDirs: config.skills.scanDirs,
  });
  for (const dt of discoveryTools) {
    tools.register(dt);
  }

  // 连接自进化晋升系统
  tools.setSkillRegistry(skillRegistry);
  tools.onPromotion((skillName, useCount) => {
    console.error(`[PolarClaw] 技能晋升: ${skillName} → verified (${useCount} 次成功使用)`);
  });

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

  // 注册内置工具 — 文件组织（将飞书收到的文件移到正确位置）
  tools.register({
    name: 'file_organize',
    description: '将文件从飞书收件箱移动到指定目录。用于对收到的文件进行分类归档。学习类文件放 macbook/Class/<科目>/，科研类放 macbook/<项目名>/。',
    parameters: {
      type: 'object',
      properties: {
        source: { type: 'string', description: '源文件路径（通常是 _feishu_inbox 中的文件）' },
        destination: { type: 'string', description: '目标目录路径（如 ~/Polarisor/macbook/Class/雷达实验/）' },
        filename: { type: 'string', description: '目标文件名（可选，默认保留原名）' },
      },
      required: ['source', 'destination'],
    },
    async handler(args) {
      const { rename, mkdir, stat, access } = await import('node:fs/promises');
      const { join: pjoin, basename, resolve: presolve } = await import('node:path');

      const src = presolve(String(args.source));
      const destDir = presolve(String(args.destination));
      const fname = args.filename ? String(args.filename) : basename(src).replace(/^\d+_/, '');

      try { await access(src); } catch { throw new Error(`源文件不存在: ${src}`); }

      await mkdir(destDir, { recursive: true });
      const destPath = pjoin(destDir, fname);
      await rename(src, destPath);
      const info = await stat(destPath);
      return {
        ok: true,
        path: destPath,
        size: info.size,
      };
    },
  });

  tools.register({
    name: 'file_inbox_list',
    description: '列出飞书收件箱中尚未归档的文件。结果按用户隔离。',
    parameters: { type: 'object', properties: {}, required: [] },
    async handler() {
      const { readdir, stat } = await import('node:fs/promises');
      const { join: pjoin } = await import('node:path');
      const { homedir } = await import('node:os');
      const { existsSync, mkdirSync } = await import('node:fs');

      const userId = tools.getCurrentUserId();
      const baseInbox = process.env.FEISHU_FILE_ROOT
        ? pjoin(process.env.FEISHU_FILE_ROOT, '_feishu_inbox')
        : pjoin(homedir(), 'Polarisor', 'macbook', '_feishu_inbox');
      const inboxDir = pjoin(baseInbox, userId);

      if (!existsSync(inboxDir)) mkdirSync(inboxDir, { recursive: true });

      try {
        const entries = await readdir(inboxDir);
        const files = [];
        for (const e of entries) {
          if (e.startsWith('.')) continue;
          const info = await stat(pjoin(inboxDir, e));
          files.push({
            name: e,
            path: pjoin(inboxDir, e),
            size: info.size,
            mtime: info.mtime.toISOString(),
          });
        }
        return { inbox: inboxDir, files, count: files.length };
      } catch {
        return { inbox: inboxDir, files: [], count: 0 };
      }
    },
  });

  tools.register({
    name: 'memory_save',
    description: '保存一条长期记忆（笔记），可选标签。记忆按用户隔离。',
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
      const userId = tools.getCurrentUserId();
      const entry = memory.save({
        type: String(args.type ?? 'note'),
        content,
        tags: args.tags != null ? String(args.tags) : undefined,
        metadata: JSON.stringify({ source: 'tool' }),
        userId,
      });
      return { id: entry.id, ok: true };
    },
  });

  tools.register({
    name: 'memory_search',
    description: '按关键词搜索记忆库（FTS5）。结果按用户隔离。',
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
      const userId = tools.getCurrentUserId();
      const result = memory.search(q, { limit, userId });
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

  // 技能目录（独立传入 agent，可按 persona 过滤）
  const skillCatalog = metaIndex.toPromptCatalog();

  // PolarUser registry: 统一身份模型（human/project 分组、persona/memory/scope 隔离）
  const polarUsers = createPolarUserRegistry();
  console.error(`[PolarClaw] PolarUser registry: ${polarUsers.listHumans().length} humans, ${polarUsers.listProjects().length} projects`);

  // Persona resolver：按 PolarUser 身份加载差异化人格
  const personaDir = join(config.projectRoot, 'personas');
  const personaCache = new Map<string, { content: string; allowedSkills?: string[]; mtime: number }>();

  function parsePersonaFrontmatter(raw: string): { body: string; allowedSkills?: string[] } {
    const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
    if (!fmMatch) return { body: raw };
    const fmBlock = fmMatch[1]!;
    const body = fmMatch[2]!;
    let allowedSkills: string[] | undefined;
    for (const line of fmBlock.split('\n')) {
      const kv = line.match(/^allowed_skills:\s*(.*)/);
      if (kv) {
        const val = kv[1]!.trim();
        if (val === 'all' || val === '*') break;
        allowedSkills = val.split(',').map(s => s.trim()).filter(Boolean);
      }
    }
    return { body, allowedSkills };
  }

  function resolvePersona(userId: string): { content: string; allowedSkills?: string[] } {
    const polarUser = polarUsers.resolve(userId);
    const personaName = polarUser.persona;
    const candidates = [
      join(personaDir, `${personaName}.md`),
      join(personaDir, 'default.md'),
    ];
    for (const p of candidates) {
      try {
        const stat = require('node:fs').statSync(p);
        const mtime = stat.mtimeMs;
        const cached = personaCache.get(p);
        if (cached && cached.mtime === mtime) return { content: cached.content, allowedSkills: cached.allowedSkills };

        let raw = readFileSync(p, 'utf8');
        const { body, allowedSkills } = parsePersonaFrontmatter(raw);
        raw = body;

        // 模板变量替换
        if (raw.includes('{{llm_model}}')) {
          const modelName = config.llm.models.general ?? 'qwen3.6-plus';
          raw = raw.replace(/\{\{llm_model\}\}/g, modelName);
        }
        if (raw.includes('{{capabilities}}')) {
          const caps = [
            'ReAct 工具调用 + 多通道交互（飞书/CLI/Web）',
            '主动关怀与日程驱动调度',
            'YOLO 自主执行模式',
            'Web 控制台与文档审阅',
            '生态技能集成（AutoOffice/KnowLever/digist/ComputerUse 等 ' + tools.list().length + ' 个工具）',
            '元技能架构 + 自学习能力',
          ];
          raw = raw.replace(/\{\{capabilities\}\}/g, caps.map(c => `> - ${c}`).join('\n'));
        }

        personaCache.set(p, { content: raw, allowedSkills, mtime });
        return { content: raw, allowedSkills };
      } catch { /* file not found, try next */ }
    }
    return { content: '' };
  }

  // 创建 Agent
  const agent = createAgent(
    {
      systemPrompt: soulPrompt,
      skillCatalog,
      personaResolver: resolvePersona,
      maxToolRounds: config.llm.maxToolRounds,
      temperature: config.llm.temperature,
      maxTokens: config.llm.maxTokens,
    },
    { llm, memory, conversations, tools, privacy, compressor },
  );

  // 纠正信号检测：当用户消息包含纠正意图时，注入提示让 Agent 记录反馈
  // 纠正信号预过滤（低成本正则，只决定是否启动后台 LLM 分析）
  const CORRECTION_PATTERNS = [
    /不[是对]/, /错了/, /我[要想]的是/, /不是这样/, /你[搞弄]错/,
    /重[新来做]/, /我说的是/, /别这样/, /不要这样/,
    /应该是/, /改[成为]/, /换[个一]种/, /不够好/, /太[差烂]/,
  ];

  function maybeCorrecting(text: string): boolean {
    return CORRECTION_PATTERNS.some(p => p.test(text));
  }

  /** 后台 LLM 分析：独立链路判断纠正并自动记录反馈（不污染主对话） */
  async function analyzeCorrection(userId: string, userText: string, lastAssistantText: string) {
    try {
      const res = await llm.chat([
        { role: 'system', content: `你是一个行为分析器。判断用户消息是否在纠正 AI 助手的行为。
如果是纠正，返回 JSON: {"correction": true, "original": "AI做了什么", "expected": "用户期望什么", "rule": "一句话偏好规则"}
如果不是纠正，返回 JSON: {"correction": false}
只返回 JSON，不要解释。` },
        { role: 'user', content: `AI 上一条回复：${lastAssistantText.slice(0, 500)}\n\n用户消息：${userText}` },
      ], { temperature: 0, maxTokens: 200 });

      const content = res.content?.trim() ?? '';
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return;

      const result = JSON.parse(jsonMatch[0]);
      if (result.correction) {
        learningStore.recordFeedback({
          userId,
          type: 'correction',
          original: String(result.original ?? ''),
          expected: String(result.expected ?? ''),
          rule: result.rule ? String(result.rule) : undefined,
        });
        console.error(`[SelfEvolution] 后台检测到纠正 → 已记录: ${result.rule ?? '(无规则)'}`);
      }
    } catch {
      // 后台分析失败不影响主流程
    }
  }

  // 定期模式扫描：每 SCAN_INTERVAL 次工具调用后触发
  const PATTERN_SCAN_INTERVAL = 20;
  let toolCallsSinceLastScan = 0;

  const originalExecute = tools.execute.bind(tools);
  const wrappedExecute: typeof tools.execute = async (name, args) => {
    const result = await originalExecute(name, args);
    toolCallsSinceLastScan++;
    if (toolCallsSinceLastScan >= PATTERN_SCAN_INTERVAL) {
      toolCallsSinceLastScan = 0;
      try {
        const patterns = patternDetector.detect('admin');
        if (patterns.length > 0) {
          console.error(`[SelfEvolution] 新模式发现: ${patterns.map(p => p.name).join(', ')}`);
        }
      } catch { /* non-critical */ }
    }
    return result;
  };
  Object.defineProperty(tools, 'execute', { value: wrappedExecute, writable: true });

  // 消息队列：同一用户的消息串行处理，避免对话历史竞争
  const userLocks = new Map<string, Promise<unknown>>();
  const lastAssistantReply = new Map<string, string>();

  async function handleChannelMessage(msg: { channel: string; userId: string; text: string }) {
    const convId = `${msg.channel}:${msg.userId}`;
    const possibleCorrection = maybeCorrecting(msg.text);
    const prevReply = lastAssistantReply.get(convId) ?? '';

    const prev = userLocks.get(convId) ?? Promise.resolve();
    const current = prev.then(async () => {
      tools.setContext(msg.userId, convId);
      return agent.handleMessage(msg.channel, msg.userId, msg.text, convId);
    }).catch((err) => {
      console.error(`[PolarClaw] handleChannelMessage error for ${convId}:`, err);
      return { text: '抱歉，处理消息时出错了，请稍后再试。' };
    });

    userLocks.set(convId, current);
    current.finally(() => {
      if (userLocks.get(convId) === current) userLocks.delete(convId);
    });

    const result = await current;
    lastAssistantReply.set(convId, result.text);

    // 后台纠正分析（异步，不阻塞响应返回、不污染主对话）
    if (possibleCorrection && prevReply) {
      analyzeCorrection(msg.userId, msg.text, prevReply).catch(() => {});
    }

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

  console.error('[PolarClaw] Agent 已启动');
  console.error('[PolarClaw] 状态:', JSON.stringify(agent.getStatus(), null, 2));
  console.error(`[PolarClaw] 学习系统: ${learningTools.length} 工具已注册`);

  // Web 服务器（Review API + SPA + YOLO API）— 端口通过 port-sdk 申请
  let webPort = 3910;
  try {
    const { createRequire } = await import('node:module');
    const { resolve, dirname } = await import('node:path');
    const _req = createRequire(import.meta.url);
    const sdkPath = resolve(dirname(new URL(import.meta.url).pathname), '..', '..', 'SOTAgent', 'sdk-port', 'index.js');
    const { claimPort } = _req(sdkPath);
    webPort = await claimPort({ service: 'polarclaw-web', project: 'PolarClaw', preferred: 3910 });
    try { claimPort({ service: 'myclaw-web', project: 'PolarClaw', preferred: webPort }); } catch {}
  } catch (err) {
    console.error('[PolarClaw] port-sdk 不可用，Web 服务器无法启动:', err);
    process.exit(1);
  }
  // PolarClaw SDK — unified API for Hub, external projects, and polarclaw-project-sdk
  const polarisorRoot = join(config.projectRoot, '..');
  const polarClawSDK = createPolarClawSDK({
    userRegistry: polarUsers,
    pilotStore,
    pilotDb,
    sotAgentUrl: process.env.SOTAGENT_URL?.trim() || undefined,
    localEventsPath: join(polarisorRoot, 'SOTAgent', 'data', 'lobster-events.jsonl'),
    polarisorRoot,
  });
  console.error(`[PolarClaw] SDK v${polarClawSDK.version} initialized`);

  const webServer = createWebServer({
    port: webPort,
    dataDir: join(config.projectRoot, 'data'),
    webDistDir: join(config.projectRoot, 'web', 'dist'),
    getStatus: () => {
      const skills = skillRegistry.listSkills();
      return {
        name: 'PolarClaw',
        version: '0.1.0',
        channels: channels.map(ch => ({ name: ch.name, connected: true })),
        uptime: process.uptime(),
        memory: { totalEntries: memory.search('*', { limit: 0 }).total, dbSizeBytes: 0 },
        skills: { count: skills.length, names: skills.map(s => s.name) },
        yolo: { activeSessions: 0 },
      };
    },
    llm,
    memoryStore: memory,
    agentHandler: handleChannelMessage,
    yoloEngine,
    pilotStore,
    pilotEngine,
    sdk: polarClawSDK,
  });
  await webServer.start();

  // 启动通道
  const channels: IChannelAdapter[] = [];

  if (config.channels.feishu) {
    const feishuDataDir = join(config.projectRoot, '.data');

    const debounceMs = Number(process.env.FEISHU_DEBOUNCE_MS) || 3000;
    const fileReceiveRoot = process.env.FEISHU_FILE_ROOT
      || join(process.env.HOME ?? '~', 'Polarisor', 'macbook');

    const { createPolarPrivateClient } = await import('./adapters/privacy/polar-private-client.js');
    const ppClient = createPolarPrivateClient({
      baseUrl: config.privacy.polarPrivateUrl,
    });
    const resolveUser = async (openId: string) => ppClient.resolveFeishuUser(openId);

    try {
      const adminConfig = loadFeishuConfig('FEISHU_ADMIN');
      const adminDedup = createFeishuDedup(feishuDataDir, 'feishu-admin');
      const feishuAdmin = createFeishuAdapter({
        config: adminConfig,
        transport: (process.env.FEISHU_TRANSPORT as 'websocket' | 'webhook') || 'websocket',
        channelName: 'feishu:admin',
        dedup: adminDedup,
        debounceMs,
        fileReceiveRoot,
        resolveUser,
      });
      feishuAdmin.onMessage(async (msg) => handleChannelMessage(msg));
      await feishuAdmin.start();
      channels.push(feishuAdmin);
      console.error('[PolarClaw] 飞书管理员 Bot 已连接');

      feishuAdmin.catchUp?.().catch((err: unknown) =>
        console.error('[PolarClaw] 管理员 Bot 补漏失败:', err));
    } catch (err) {
      console.error('[PolarClaw] 飞书管理员 Bot 启动失败:', err);
    }

    if (process.env.FEISHU_GIRLFRIEND_APP_ID) {
      try {
        const gfConfig = loadFeishuConfig('FEISHU_GIRLFRIEND');
        const gfDedup = createFeishuDedup(feishuDataDir, 'feishu-girlfriend');
        const feishuGf = createFeishuAdapter({
          config: gfConfig,
          transport: (process.env.FEISHU_TRANSPORT as 'websocket' | 'webhook') || 'websocket',
          channelName: 'feishu:girlfriend',
          dedup: gfDedup,
          debounceMs,
          fileReceiveRoot,
          resolveUser,
        });
        feishuGf.onMessage(async (msg) => handleChannelMessage(msg));
        await feishuGf.start();
        channels.push(feishuGf);
        console.error('[PolarClaw] 飞书女友 Bot 已连接');

        feishuGf.catchUp?.().catch((err: unknown) =>
          console.error('[PolarClaw] 女友 Bot 补漏失败:', err));
      } catch (err) {
        console.error('[PolarClaw] 飞书女友 Bot 启动失败:', err);
      }
    }
  }

  if (config.channels.cli && process.stdin.isTTY) {
    const cli = createCLIAdapter({ userId: 'admin' });
    cli.onMessage(async (msg) => handleChannelMessage(msg));
    await cli.start();
    channels.push(cli);
    console.error('[PolarClaw] CLI 通道已启动');
  } else if (config.channels.cli) {
    console.error('[PolarClaw] CLI 已配置但非 TTY 环境，跳过');
  }

  if (channels.length === 0) {
    console.error('[PolarClaw] 未启用任何通道，等待通道连接...');
  }

  // 启动主动关怀引擎
  let clockSseBridge: ReturnType<typeof createClockSseBridge> | null = null;
  let scheduleBridge: ReturnType<typeof createScheduleBridge> | null = null;

  if ((process.env.POLARCLAW_PROACTIVE ?? process.env.MYCLAW_PROACTIVE) === '1') {
    careEngine.start();
    console.error('[PolarClaw] 主动关怀引擎已启动');

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
      console.error('[PolarClaw] Clock SSE 桥接已启动');

      scheduleBridge = createScheduleBridge(
        {
          clockBaseUrl: clockUrl,
          username: clockUser.split(',')[0]?.trim() ?? clockUser,
          clockToken: process.env.CLOCK_TOKEN?.trim() || undefined,
        },
        careEngine,
      );
      scheduleBridge.start();
      console.error('[PolarClaw] 日程关怀桥接已启动');
    }
  }

  // 优雅退出
  const shutdown = async () => {
    console.error('[PolarClaw] 正在关闭...');
    webServer.stop();
    scheduleBridge?.stop();
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
  console.error('[PolarClaw] Fatal:', err);
  process.exit(1);
});
