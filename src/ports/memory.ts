/**
 * Memory Port — 记忆系统抽象
 *
 * 三层记忆模型：
 * 1. 冻结快照（MEMORY.md / USER.md）—— 长期不变的知识
 * 2. 会话记忆（对话历史）—— 多轮对话上下文
 * 3. 检索记忆（FTS5 / 向量搜索）—— 相关记忆召回
 */

/** 记忆条目 */
export interface IMemoryEntry {
  id: number;
  type: string;
  content: string;
  tags?: string;
  metadata?: string;
  createdAt: Date;
  updatedAt: Date;
}

/** 搜索结果 */
export interface ISearchResult {
  entries: IMemoryEntry[];
  total: number;
}

/** 用户画像键值 */
export interface IUserProfile {
  userId: string;
  key: string;
  value: string | null;
}

/** 记忆存储接口 */
export interface IMemoryStore {
  /** 保存一条记忆 */
  save(entry: Omit<IMemoryEntry, 'id' | 'createdAt' | 'updatedAt'>): IMemoryEntry;

  /** 全文搜索 */
  search(query: string, options?: { limit?: number }): ISearchResult;

  /** 保存用户画像 */
  saveProfile(userId: string, key: string, value: string | null): void;

  /** 获取用户画像 */
  getProfile(userId: string, key: string): string | null;

  /** 获取用户全部画像 */
  getAllProfiles(userId: string): IUserProfile[];

  /** 关闭数据库连接 */
  close(): void;
}

/**
 * 对话历史管理接口
 * 核心差距修复：让 Agent 支持多轮对话
 */
export interface IConversationHistory {
  /** 追加消息到对话 */
  append(conversationId: string, message: IChatMessage): void;

  /** 获取对话历史 */
  getHistory(conversationId: string, options?: {
    limit?: number;
    /** 从最近的消息往回取 */
    fromLatest?: boolean;
  }): IChatMessage[];

  /** 清除对话 */
  clear(conversationId: string): void;

  /** 获取对话的 token 估算 */
  estimateTokens(conversationId: string): number;
}

/** 聊天消息 */
export interface IChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  /** tool_calls（assistant 消息） */
  toolCalls?: IToolCall[];
  /** tool_call_id（tool 消息） */
  toolCallId?: string;
  timestamp?: Date;
}

export interface IToolCall {
  id: string;
  function: {
    name: string;
    arguments: string;
  };
}
