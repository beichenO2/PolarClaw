/**
 * SessionMemory — 运行时记忆管理
 *
 * 参考 MemGPT Summarizer 实现，提供两种压缩模式：
 * - STATIC_MESSAGE_BUFFER：保留最近 N 条消息
 * - PARTIAL_EVICT_MESSAGE_BUFFER：按百分比驱逐并生成摘要
 *
 * 核心能力：
 * - compressForNextTurn：将当前会话压缩为 ≤20K 字符的摘要，供下次对话注入
 * - injectFromPrevious：反序列化压缩结果注入上下文
 * - fetchLongTermMemory：调用 PolarMemory /api/blocks/search 获取长期记忆 Block
 */

import type { IChatMessage } from '../ports/memory.js';

// ─── 类型定义 ───

/** PolarMemory Block 结构（与 PolarMemory/src/block.ts 对齐） */
export interface Block {
  label: string;
  value: string;
  tokens: number;
  read_only: boolean;
  source_wiki: string;
  created_at: string;
  updated_at: string;
}

/** 压缩后的情景记忆 */
export interface CompressedMemory {
  /** 摘要文本 */
  summary: string;
  /** 被压缩的原始消息数量 */
  originalCount: number;
  /** 压缩时间戳 */
  compressedAt: string;
}

/** 会话记忆结构 */
export interface SessionMemory {
  /** 当前轮次的完整消息（未压缩） */
  working: IChatMessage[];
  /** 历史轮次的压缩摘要 */
  episodic: CompressedMemory[];
  /** 核心事实（用户画像、关键决策等） */
  coreFacts: string;
  /** 从 PolarMemory 获取的长期记忆 Block */
  longTermBlocks: Block[];
}

/** 压缩模式（对齐 MemGPT SummarizationMode） */
export enum CompressionMode {
  /** 保留最近 N 条消息，其余驱逐 */
  STATIC_MESSAGE_BUFFER = 'static_message_buffer',
  /** 按百分比驱逐，生成摘要插入上下文 */
  PARTIAL_EVICT_MESSAGE_BUFFER = 'partial_evict_message_buffer',
}

/** SessionMemoryManager 配置 */
export interface ISessionMemoryManagerConfig {
  /** 压缩模式（默认 STATIC_MESSAGE_BUFFER） */
  mode?: CompressionMode;
  /** STATIC 模式：消息缓冲区上限（默认 20） */
  messageBufferLimit?: number;
  /** STATIC 模式：最少保留消息数（默认 6） */
  messageBufferMin?: number;
  /** PARTIAL_EVICT 模式：驱逐百分比（默认 0.3） */
  partialEvictPercentage?: number;
  /** 压缩输出最大字符数（默认 20000 = 20K） */
  maxCompressedChars?: number;
  /** PolarMemory API 基础 URL（默认 http://localhost:3100） */
  polarMemoryBaseUrl?: string;
  /** fetchLongTermMemory 返回的最大 Block 数（默认 5） */
  maxLongTermBlocks?: number;
  /** LLM 摘要函数（可选，不提供则使用规则压缩） */
  summarize?: (text: string) => Promise<string>;
}

// ─── 工具函数 ───

/** 粗略 token 估算：中文 ~1.5 token/字，英文 ~0.3 token/char */
function estimateTokens(text: string): number {
  const cjkChars = (text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []).length;
  const nonCjk = text.length - cjkChars;
  return Math.ceil(cjkChars * 1.5 + nonCjk * 0.3);
}

/** 将消息列表格式化为可读文本（参考 MemGPT format_transcript） */
function formatMessages(messages: IChatMessage[]): string {
  return messages
    .filter(m => m.role !== 'system')
    .map(m => {
      let content = m.content;
      if (m.role === 'assistant' && m.toolCalls?.length) {
        const toolNames = m.toolCalls.map(tc => tc.function.name).join(', ');
        content = `${content} -> [工具调用: ${toolNames}]`;
      }
      return `[${m.role}] ${content}`;
    })
    .join('\n');
}

/** 规则压缩：提取关键事实生成摘要（无需 LLM） */
function ruleBasedCompress(messages: IChatMessage[]): string {
  const facts: string[] = [];
  for (const m of messages) {
    if (m.role === 'user') {
      facts.push(`用户: ${m.content.slice(0, 200)}`);
    } else if (m.role === 'assistant') {
      if (m.toolCalls?.length) {
        const toolNames = m.toolCalls.map(tc => tc.function.name).join(', ');
        facts.push(`助手调用工具: ${toolNames}`);
      }
      if (m.content) {
        facts.push(`助手: ${m.content.slice(0, 200)}`);
      }
    } else if (m.role === 'tool') {
      facts.push(`工具结果: ${m.content.slice(0, 100)}`);
    }
  }
  return facts.join('\n');
}

/** 中间截断（参考 MemGPT middle_truncate_text） */
function middleTruncate(text: string, budgetChars: number): string {
  if (text.length <= budgetChars) return text;
  const headLen = Math.floor(budgetChars * 0.3);
  const tailLen = Math.floor(budgetChars * 0.3);
  const head = text.slice(0, headLen);
  const tail = text.slice(-tailLen);
  const dropped = text.length - headLen - tailLen;
  return `${head}\n\n[...已截断: 跳过中间 ${dropped} 字符...]\n\n${tail}`;
}

// ─── 序列化/反序列化 ───

interface SerializedSessionMemory {
  episodic: CompressedMemory[];
  coreFacts: string;
  longTermBlocks: Block[];
  compressedAt: string;
}

function serializeSessionMemory(memory: SessionMemory): string {
  const payload: SerializedSessionMemory = {
    episodic: memory.episodic,
    coreFacts: memory.coreFacts,
    longTermBlocks: memory.longTermBlocks,
    compressedAt: new Date().toISOString(),
  };
  return JSON.stringify(payload);
}

function deserializeSessionMemory(json: string): SerializedSessionMemory | null {
  try {
    return JSON.parse(json) as SerializedSessionMemory;
  } catch {
    return null;
  }
}

// ─── SessionMemoryManager 类 ───

export class SessionMemoryManager {
  private readonly mode: CompressionMode;
  private readonly messageBufferLimit: number;
  private readonly messageBufferMin: number;
  private readonly partialEvictPercentage: number;
  private readonly maxCompressedChars: number;
  private readonly polarMemoryBaseUrl: string;
  private readonly maxLongTermBlocks: number;
  private readonly summarize?: (text: string) => Promise<string>;

  /** 按 conversationId 维护的会话记忆状态 */
  private readonly sessions = new Map<string, SessionMemory>();

  constructor(config: ISessionMemoryManagerConfig = {}) {
    this.mode = config.mode ?? CompressionMode.STATIC_MESSAGE_BUFFER;
    this.messageBufferLimit = config.messageBufferLimit ?? 20;
    this.messageBufferMin = config.messageBufferMin ?? 6;
    this.partialEvictPercentage = config.partialEvictPercentage ?? 0.3;
    this.maxCompressedChars = config.maxCompressedChars ?? 20000;
    this.polarMemoryBaseUrl = config.polarMemoryBaseUrl ?? 'http://localhost:3100';
    this.maxLongTermBlocks = config.maxLongTermBlocks ?? 5;
    this.summarize = config.summarize;
  }

  /** 获取或创建会话记忆 */
  getOrCreateSession(convId: string): SessionMemory {
    let session = this.sessions.get(convId);
    if (!session) {
      session = {
        working: [],
        episodic: [],
        coreFacts: '',
        longTermBlocks: [],
      };
      this.sessions.set(convId, session);
    }
    return session;
  }

  /** 更新会话的 working memory（当前轮消息） */
  updateWorkingMemory(convId: string, messages: IChatMessage[]): void {
    const session = this.getOrCreateSession(convId);
    session.working = messages;
  }

  /** 更新会话的 coreFacts */
  updateCoreFacts(convId: string, facts: string): void {
    const session = this.getOrCreateSession(convId);
    session.coreFacts = facts;
  }

  /**
   * compressForNextTurn — 将当前会话压缩为 ≤20K 字符的 JSON 字符串
   *
   * 两种模式：
   * - STATIC_MESSAGE_BUFFER：保留最近 messageBufferMin 条消息，其余生成摘要
   * - PARTIAL_EVICT_MESSAGE_BUFFER：按百分比驱逐，摘要插入上下文
   *
   * @returns 压缩后的 JSON 字符串，可直接传给 injectFromPrevious
   */
  async compressForNextTurn(convId: string): Promise<string> {
    const session = this.getOrCreateSession(convId);
    const messages = session.working;

    if (messages.length === 0) {
      return serializeSessionMemory(session);
    }

    let compressed: CompressedMemory;

    if (this.mode === CompressionMode.STATIC_MESSAGE_BUFFER) {
      compressed = await this.staticBufferCompress(messages);
    } else {
      compressed = await this.partialEvictCompress(messages);
    }

    // 追加到情景记忆
    session.episodic.push(compressed);

    // 保留 working 中的最近消息
    const retainCount = this.mode === CompressionMode.STATIC_MESSAGE_BUFFER
      ? this.messageBufferMin
      : Math.ceil(messages.length * (1 - this.partialEvictPercentage));
    session.working = messages.slice(-retainCount);

    // 序列化并确保不超过 20K
    let result = serializeSessionMemory(session);
    if (result.length > this.maxCompressedChars) {
      // 截断 episodic 摘要以适配预算
      const lastEpisodic = session.episodic[session.episodic.length - 1];
      if (lastEpisodic) {
        const overRatio = this.maxCompressedChars / result.length;
        const newSummaryLen = Math.floor(lastEpisodic.summary.length * overRatio * 0.8);
        lastEpisodic.summary = middleTruncate(lastEpisodic.summary, newSummaryLen);
        result = serializeSessionMemory(session);
      }
    }

    return result;
  }

  /**
   * injectFromPrevious — 将上轮压缩结果注入当前会话
   *
   * 将压缩的情景记忆和核心事实作为 system 消息注入对话上下文
   */
  async injectFromPrevious(convId: string, compressed: string): Promise<void> {
    const deserialized = deserializeSessionMemory(compressed);
    if (!deserialized) return;

    const session = this.getOrCreateSession(convId);
    session.episodic = deserialized.episodic;
    session.coreFacts = deserialized.coreFacts;
    session.longTermBlocks = deserialized.longTermBlocks;
  }

  /**
   * fetchLongTermMemory — 调用 PolarMemory /api/blocks/search 获取长期记忆 Block
   *
   * 优雅降级：API 不可用时返回空数组
   */
  async fetchLongTermMemory(query: string): Promise<Block[]> {
    try {
      const response = await fetch(`${this.polarMemoryBaseUrl}/api/blocks/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, top_k: this.maxLongTermBlocks }),
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) {
        console.error(`[SessionMemory] PolarMemory API returned ${response.status}`);
        return [];
      }

      const data = await response.json() as { blocks: Block[]; total: number };
      return data.blocks ?? [];
    } catch (err) {
      console.error('[SessionMemory] fetchLongTermMemory failed:', err instanceof Error ? err.message : String(err));
      return [];
    }
  }

  /**
   * buildMemoryInjection — 构建注入到 LLM 上下文的记忆文本
   *
   * 将情景记忆、核心事实、长期记忆 Block 合并为结构化文本
   */
  buildMemoryInjection(convId: string): string {
    const session = this.getOrCreateSession(convId);
    const parts: string[] = [];

    if (session.episodic.length > 0) {
      parts.push('## 历史对话摘要');
      for (const ep of session.episodic) {
        parts.push(`- [${ep.compressedAt}] (${ep.originalCount}条消息) ${ep.summary.slice(0, 500)}`);
      }
    }

    if (session.coreFacts) {
      parts.push('## 核心事实');
      parts.push(session.coreFacts);
    }

    if (session.longTermBlocks.length > 0) {
      parts.push('## 长期记忆');
      for (const block of session.longTermBlocks) {
        parts.push(`### ${block.label}`);
        parts.push(block.value.slice(0, 800));
      }
    }

    return parts.length > 0 ? parts.join('\n') : '';
  }

  /** 清除会话记忆 */
  clearSession(convId: string): void {
    this.sessions.delete(convId);
  }

  // ─── 私有方法 ───

  /** STATIC_MESSAGE_BUFFER 压缩：保留最近 N 条，其余生成摘要 */
  private async staticBufferCompress(messages: IChatMessage[]): Promise<CompressedMemory> {
    if (messages.length <= this.messageBufferLimit) {
      return {
        summary: formatMessages(messages),
        originalCount: messages.length,
        compressedAt: new Date().toISOString(),
      };
    }

    const evicted = messages.slice(0, -this.messageBufferMin);
    const summary = await this.generateSummary(evicted);

    return {
      summary,
      originalCount: evicted.length,
      compressedAt: new Date().toISOString(),
    };
  }

  /** PARTIAL_EVICT_MESSAGE_BUFFER 压缩：按百分比驱逐 */
  private async partialEvictCompress(messages: IChatMessage[]): Promise<CompressedMemory> {
    const total = messages.length;
    const evictCount = Math.floor(total * this.partialEvictPercentage);

    if (evictCount <= 0 || total <= 2) {
      return {
        summary: formatMessages(messages),
        originalCount: messages.length,
        compressedAt: new Date().toISOString(),
      };
    }

    // 找到驱逐边界：确保在 assistant 消息处切割（参考 MemGPT）
    let cutIndex = evictCount;
    for (let i = cutIndex; i < total; i++) {
      if (messages[i]?.role === 'assistant') {
        cutIndex = i;
        break;
      }
    }

    const evicted = messages.slice(0, cutIndex);
    const summary = await this.generateSummary(evicted);

    return {
      summary,
      originalCount: evicted.length,
      compressedAt: new Date().toISOString(),
    };
  }

  /** 生成摘要：优先使用 LLM，否则使用规则压缩 */
  private async generateSummary(messages: IChatMessage[]): Promise<string> {
    if (this.summarize) {
      try {
        const transcript = formatMessages(messages);
        return await this.summarize(transcript);
      } catch (err) {
        console.error('[SessionMemory] LLM 摘要失败，降级为规则压缩:', err);
      }
    }
    return ruleBasedCompress(messages);
  }
}
