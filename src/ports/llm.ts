/**
 * LLM Port — 大模型调用抽象
 *
 * 隔离 LLM Provider 具体实现，支持：
 * - 意图路由（coding/research/vision/general）
 * - Provider Fallback（主模型 → 备用模型）
 * - Token 计费跟踪
 */

import type { IChatMessage, IToolCall } from './memory.js';

/** 模型响应 */
export interface ILLMResponse {
  content: string | null;
  toolCalls: IToolCall[];
  /** token 使用量 */
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  /** 实际使用的模型 ID */
  model: string;
  /** 请求耗时(ms) */
  latencyMs: number;
}

/** 模型调用选项 */
export interface ILLMOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  tools?: IToolDefinition[];
  toolChoice?: 'auto' | 'none' | 'required';
}

/** 工具定义（function calling 格式） */
export interface IToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

/** 意图类型 */
export type IntentType = 'coding' | 'research' | 'vision' | 'general';

/** LLM 路由器接口 */
export interface ILLMRouter {
  /** 根据消息内容推断意图并选择模型 */
  resolveModel(messages: IChatMessage[]): { model: string; intent: IntentType };

  /** 直接调用 LLM */
  chat(messages: IChatMessage[], options?: ILLMOptions): Promise<ILLMResponse>;
}
