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
  /** 4-bit QCSA capability code: overrides model if set. E.g. '1001' = agent flagship, '0001' = agent fast */
  capability?: string;
  temperature?: number;
  maxTokens?: number;
  tools?: IToolDefinition[];
  toolChoice?: 'auto' | 'none' | 'required';
  /** Extra system prompt appended via PolarPrivate's append_system_prompt mechanism. */
  append_system_prompt?: string;
  /** Optional channel hint for smart routing (e.g. always-on/discovery) */
  channel?: string;
  /** Session key for token stats */
  sessionKey?: string;
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
