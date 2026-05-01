/**
 * MyClaw Agent Core — 核心 Agent 循环
 *
 * 端口-适配器架构的核心层：
 * - 只依赖 ports/ 中的接口
 * - 通过依赖注入接收所有适配器
 * - 实现多轮对话（修复旧版单轮无状态的关键差距）
 *
 * 消息流：
 * Channel → PrivacyGateway.sanitize → AgentLoop → PrivacyGateway.desanitize → Channel
 */

import { appendFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import type { IPrivacyGateway } from '../ports/privacy.js';
import type { IMemoryStore, IConversationHistory, IChatMessage } from '../ports/memory.js';
import type { ILLMRouter, ILLMResponse } from '../ports/llm.js';
import type { IToolExecutor } from '../ports/tools.js';
import type { IContextCompressor } from '../ports/compression.js';

export interface IAgentConfig {
  /** 工具调用安全上限（0 = 无限制，由压缩器管理上下文） */
  maxToolRounds: number;
  /** system prompt（基础部分，persona 会追加到末尾） */
  systemPrompt: string;
  /** 按 userId 返回 persona 内容；不提供则所有用户共享同一 systemPrompt */
  personaResolver?: (userId: string) => string;
  /** 温度 */
  temperature?: number;
  /** 最大输出 token */
  maxTokens?: number;
  /** 工具输出截断长度 */
  maxToolOutputLength?: number;
}

export interface IAgentDeps {
  llm: ILLMRouter;
  memory: IMemoryStore;
  conversations: IConversationHistory;
  tools: IToolExecutor;
  privacy: IPrivacyGateway;
  /** 上下文压缩器（可选，不提供则不启用压缩） */
  compressor?: IContextCompressor;
}

export interface IAgentResponse {
  /** Agent 回复（已还原隐私） */
  text: string;
  /** 是否被隐私网关拦截 */
  blocked: boolean;
  /** 拦截警告 */
  warning?: string;
  /** token 使用统计 */
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export function createAgent(config: IAgentConfig, deps: IAgentDeps) {
  const { llm, memory, conversations, tools, privacy, compressor } = deps;
  const maxToolOutputLen = config.maxToolOutputLength ?? 12000;

  const memoryContextCache = new Map<string, { context: string; ts: number }>();
  const MEMORY_CACHE_TTL_MS = 1000;

  /**
   * 处理用户消息（完整流程）
   *
   * @param channel 通道名称
   * @param userId 用户 ID
   * @param text 用户消息原文
   * @param conversationId 对话 ID（同一对话共享上下文）
   */
  async function handleMessage(
    channel: string,
    userId: string,
    text: string,
    conversationId?: string,
  ): Promise<IAgentResponse> {
    const convId = conversationId ?? `${channel}:${userId}`;

    // 1. 隐私网关入站脱敏
    const sanitizeResult = await privacy.sanitize(userId, text);
    if (sanitizeResult.blocked) {
      return {
        text: sanitizeResult.warning ?? '⚠️ 消息被隐私网关拦截',
        blocked: true,
        warning: sanitizeResult.warning,
      };
    }

    const sanitizedText = sanitizeResult.sanitized;

    // 2. 记录用户活跃状态
    memory.saveProfile(userId, 'lastActiveAt', new Date().toISOString());
    memory.saveProfile(userId, 'lastChannel', channel);

    // 3. 构建记忆上下文
    const memoryContext = buildMemoryContext(userId, sanitizedText);

    // 4. 追加用户消息到对话历史
    const userContent = memoryContext
      ? `${memoryContext}\n\n${sanitizedText}`
      : sanitizedText;

    conversations.append(convId, { role: 'user', content: userContent });

    // 5. 执行 Agent 循环（ReAct: 推理 → 工具调用 → 观察）
    const existingHistory = conversations.getHistory(convId);
    const isOngoing = existingHistory.length > 2;
    const result = await runLoop(convId, userId, isOngoing);

    // 5a. 持久化 LLM token usage 到日志
    if (result.usage) {
      persistUsage(userId, channel, result.usage);
    }

    // 6. 隐私网关出站还原
    const restoredText = privacy.desanitize(userId, result.text);

    return {
      text: restoredText,
      blocked: false,
      usage: result.usage,
    };
  }

  /** 构建注入的记忆上下文（用户画像 + FTS 相关记忆），带短窗口缓存避免高频消息重复查询 */
  function buildMemoryContext(userId: string, queryText: string): string {
    if (userId === 'anonymous') return '';

    const cacheKey = `${userId}:${queryText.slice(0, 60)}`;
    const cached = memoryContextCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < MEMORY_CACHE_TTL_MS) {
      return cached.context;
    }

    const lines: string[] = [];

    // 用户画像
    const profiles = memory.getAllProfiles(userId);
    const prefs = profiles.filter(p => !p.key.startsWith('last'));
    if (prefs.length > 0) {
      lines.push('**用户画像**');
      for (const p of prefs.slice(0, 15)) {
        lines.push(`- ${p.key}: ${(p.value ?? '').slice(0, 200)}`);
      }
    }

    // FTS 搜索相关记忆（按 userId 隔离）
    const query = queryText.trim().slice(0, 120);
    if (query.length >= 2) {
      const result = memory.search(query, { limit: 5, userId });
      if (result.entries.length > 0) {
        lines.push('**相关记忆**');
        for (const entry of result.entries) {
          lines.push(`- [${entry.type}] ${entry.content.slice(0, 300)}`);
        }
      }
    }

    if (lines.length === 0) {
      memoryContextCache.set(cacheKey, { context: '', ts: Date.now() });
      return '';
    }
    const context = `## 长期记忆（自动注入）\n${lines.join('\n')}`;
    memoryContextCache.set(cacheKey, { context, ts: Date.now() });
    return context;
  }

  /** Agent 主循环：system + 历史消息 → LLM → 工具调用 → 观察 → 重复 */
  async function runLoop(convId: string, userId: string, isOngoing = false): Promise<{ text: string; usage?: ILLMResponse['usage'] }> {
    let totalUsage: NonNullable<ILLMResponse['usage']> | undefined;

    // 上下文压缩的 token 预算（留 20% 余量给 system prompt + 输出）
    const compressionBudget = (config.maxTokens ?? 4096) * 12;

    // 按 userId 解析 persona 并合并到 system prompt
    const persona = config.personaResolver?.(userId) ?? '';
    const basePrompt = persona
      ? `${config.systemPrompt}\n\n${persona}`
      : config.systemPrompt;

    const maxRounds = config.maxToolRounds > 0 ? config.maxToolRounds : Infinity;
    for (let round = 0; round < maxRounds; round++) {
      const history = conversations.getHistory(convId);
      let contextMessages = history;

      // 上下文压缩：对话历史接近预算时渐进式压缩
      if (compressor && compressor.shouldCompress(contextMessages, compressionBudget)) {
        const result = await compressor.compress(contextMessages, compressionBudget);
        contextMessages = result.messages;
        if (result.phasesUsed.length > 0) {
          console.error(
            `[Compression] ${result.originalTokens} → ${result.compressedTokens} tokens` +
            ` (phases: ${result.phasesUsed.join(',')})`
          );
        }
      }

      const systemContent = isOngoing
        ? basePrompt + '\n\n[对话已在进行中，无需重新自我介绍。直接回应用户最新消息。]'
        : basePrompt;

      const messages: IChatMessage[] = [
        { role: 'system', content: systemContent },
        ...contextMessages,
      ];

      const response = await llm.chat(messages, {
        tools: tools.list(),
        toolChoice: 'auto',
        temperature: config.temperature,
        maxTokens: config.maxTokens,
      });

      // 累计 token
      if (response.usage) {
        if (!totalUsage) {
          totalUsage = { ...response.usage };
        } else {
          totalUsage.promptTokens += response.usage.promptTokens;
          totalUsage.completionTokens += response.usage.completionTokens;
          totalUsage.totalTokens += response.usage.totalTokens;
        }
      }

      // 追加 assistant 消息
      conversations.append(convId, {
        role: 'assistant',
        content: response.content ?? '',
        toolCalls: response.toolCalls.length > 0 ? response.toolCalls : undefined,
      });

      // 无工具调用 → 返回文本
      if (response.toolCalls.length === 0) {
        const text = response.content?.trim();
        return { text: text || '（暂无文本回复）', usage: totalUsage };
      }

      // 并发执行所有工具调用（Promise.allSettled 保证全部完成，不因单个失败终止）
      const toolTasks = response.toolCalls.map(async (tc) => {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(tc.function.arguments);
        } catch { /* empty */ }

        let result: unknown;
        try {
          result = await tools.execute(tc.function.name, args);
        } catch (err) {
          result = { error: err instanceof Error ? err.message : String(err) };
        }

        let payload: string;
        try {
          payload = JSON.stringify(result);
        } catch {
          payload = String(result);
        }
        if (payload.length > maxToolOutputLen) {
          payload = `${payload.slice(0, maxToolOutputLen)}…(已截断)`;
        }

        return { id: tc.id, payload };
      });

      const toolResults = await Promise.allSettled(toolTasks);

      // 按原始 toolCalls 顺序追加结果，保证 LLM 消息交替正确
      for (let i = 0; i < response.toolCalls.length; i++) {
        const settled = toolResults[i]!;
        const toolCallId = response.toolCalls[i]!.id;
        const payload = settled.status === 'fulfilled'
          ? settled.value.payload
          : JSON.stringify({ error: String((settled as PromiseRejectedResult).reason) });

        conversations.append(convId, {
          role: 'tool',
          content: payload,
          toolCallId,
        });
      }
    }

    return { text: '已达到工具调用轮数上限，请简化任务或分步提问。', usage: totalUsage };
  }

  const USAGE_LOG_PATH = join(homedir(), '.polarcop', 'logs', 'llm-usage.jsonl');
  let usageLogDirCreated = false;

  function persistUsage(userId: string, channel: string, usage: NonNullable<ILLMResponse['usage']>) {
    try {
      if (!usageLogDirCreated) {
        mkdirSync(dirname(USAGE_LOG_PATH), { recursive: true });
        usageLogDirCreated = true;
      }
      const entry = {
        ts: new Date().toISOString(),
        user_id: userId,
        channel,
        prompt_tokens: usage.promptTokens,
        completion_tokens: usage.completionTokens,
        total_tokens: usage.totalTokens,
      };
      appendFileSync(USAGE_LOG_PATH, JSON.stringify(entry) + '\n');
    } catch {
      // non-fatal: don't break agent flow if logging fails
    }
  }

  return {
    handleMessage,
    /** 获取 Agent 状态 */
    getStatus() {
      return {
        toolCount: tools.list().length,
      };
    },
  };
}
