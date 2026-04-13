/**
 * 对话历史管理器
 *
 * 关键差距修复：让 Agent 从单轮无状态变为多轮有记忆。
 * 每个 conversation 维护一个消息数组，支持 token 估算和自动截断。
 */

import type { IConversationHistory, IChatMessage } from '../../ports/memory.js';

/** 粗略 token 估算：中文 ~1.5 token/字，英文 ~0.75 token/word */
function estimateTokenCount(text: string): number {
  const cjkChars = (text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []).length;
  const nonCjk = text.length - cjkChars;
  return Math.ceil(cjkChars * 1.5 + nonCjk * 0.3);
}

export function createConversationHistory(options?: {
  /** 每个对话最多保留的消息数 */
  maxMessages?: number;
  /** 最大 token 估算（超出时从头部截断） */
  maxTokens?: number;
}): IConversationHistory {
  const maxMessages = options?.maxMessages ?? 100;
  const maxTokens = options?.maxTokens ?? 60000;
  const conversations = new Map<string, IChatMessage[]>();

  function getOrCreate(id: string): IChatMessage[] {
    let msgs = conversations.get(id);
    if (!msgs) {
      msgs = [];
      conversations.set(id, msgs);
    }
    return msgs;
  }

  /** 从头部截断直到 token 估算 < maxTokens */
  function trimIfNeeded(msgs: IChatMessage[]): void {
    while (msgs.length > maxMessages) {
      msgs.shift();
    }

    let total = 0;
    for (const m of msgs) total += estimateTokenCount(m.content);

    while (total > maxTokens && msgs.length > 1) {
      const removed = msgs.shift();
      if (removed) total -= estimateTokenCount(removed.content);
    }
  }

  return {
    append(conversationId, message) {
      const msgs = getOrCreate(conversationId);
      msgs.push({ ...message, timestamp: message.timestamp ?? new Date() });
      trimIfNeeded(msgs);
    },

    getHistory(conversationId, options = {}) {
      const msgs = conversations.get(conversationId) ?? [];
      if (options.limit && options.fromLatest) {
        return msgs.slice(-options.limit);
      }
      if (options.limit) {
        return msgs.slice(0, options.limit);
      }
      return [...msgs];
    },

    clear(conversationId) {
      conversations.delete(conversationId);
    },

    estimateTokens(conversationId) {
      const msgs = conversations.get(conversationId) ?? [];
      return msgs.reduce((sum, m) => sum + estimateTokenCount(m.content), 0);
    },
  };
}
