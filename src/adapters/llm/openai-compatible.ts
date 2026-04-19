/**
 * OpenAI-Compatible LLM 适配器
 *
 * 支持所有兼容 OpenAI Chat Completions API 的服务商：
 * - 阿里云百炼 Coding Plan
 * - OpenAI
 * - 本地 Ollama
 *
 * 三层弹性 Provider Fallback：主模型 → 备用 → 降级
 * 每层带独立健康状态追踪（半开熔断器），避免持续请求已知不可用的 Provider。
 *
 * 包含意图路由：根据消息内容选择最合适的模型。
 */

import type { ILLMRouter, ILLMResponse, ILLMOptions, IntentType } from '../../ports/llm.js';
import type { IChatMessage, IToolCall } from '../../ports/memory.js';

/** 单个 Provider 的配置 */
export interface IProviderConfig {
  baseUrl: string;
  apiKey: string;
  models: Record<IntentType, string>;
}

export interface ILLMConfig {
  baseUrl: string;
  apiKey: string;
  models: Record<IntentType, string>;
  /** 默认温度 */
  defaultTemperature?: number;
  /** 默认最大 token */
  defaultMaxTokens?: number;
  /** 备用 Provider 列表（按优先级排序） */
  fallbackProviders?: IProviderConfig[];
  /** 单个 Provider 连续失败多少次后熔断（默认 3） */
  circuitBreakerThreshold?: number;
  /** 熔断后多少 ms 后尝试半开恢复（默认 60s） */
  circuitBreakerCooldownMs?: number;
  /** 单次请求超时 ms（默认 60s） */
  requestTimeoutMs?: number;
}

/** Provider 健康状态（简化的半开熔断器） */
interface IProviderHealth {
  consecutiveFailures: number;
  lastFailureAt: number;
  /** closed=正常, open=熔断, half-open=尝试恢复 */
  state: 'closed' | 'open' | 'half-open';
}

/** 意图检测正则 */
const INTENT_HINTS: Array<{ pattern: RegExp; intent: IntentType }> = [
  { pattern: /(?:代码|编程|bug|debug|重构|实现|函数|类|接口|API|写一个|修改|编译|运行)/i, intent: 'coding' },
  { pattern: /(?:研究|论文|分析|综述|调研|对比|评估|arXiv|paper)/i, intent: 'research' },
  { pattern: /(?:图片|截图|看看|识别|图中|照片|视觉|image|photo)/i, intent: 'vision' },
];

function detectIntent(messages: IChatMessage[]): IntentType {
  const lastUser = [...messages].reverse().find(m => m.role === 'user');
  if (!lastUser) return 'general';

  for (const { pattern, intent } of INTENT_HINTS) {
    if (pattern.test(lastUser.content)) return intent;
  }
  return 'general';
}

/** 向单个 Provider 发起请求 */
async function callProvider(
  provider: IProviderConfig,
  messages: IChatMessage[],
  model: string,
  options: ILLMOptions,
  defaultTemp: number,
  defaultMaxTokens: number,
  timeoutMs: number,
): Promise<ILLMResponse> {
  const startMs = Date.now();

  const body: Record<string, unknown> = {
    model,
    messages: messages.map(m => {
      const msg: Record<string, unknown> = { role: m.role, content: m.content };
      if (m.toolCalls?.length) msg.tool_calls = m.toolCalls;
      if (m.toolCallId) msg.tool_call_id = m.toolCallId;
      return msg;
    }),
    temperature: options.temperature ?? defaultTemp,
    max_tokens: options.maxTokens ?? defaultMaxTokens,
  };

  if (options.tools?.length) {
    body.tools = options.tools;
    body.tool_choice = options.toolChoice ?? 'auto';
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (provider.apiKey && provider.apiKey !== 'proxy-managed') {
      headers['Authorization'] = `Bearer ${provider.apiKey}`;
    }

    const res = await fetch(`${provider.baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`LLM API error ${res.status}: ${errText.slice(0, 500)}`);
    }

    const data = await res.json() as {
      choices: Array<{
        message: {
          content: string | null;
          tool_calls?: Array<{
            id: string;
            function: { name: string; arguments: string };
          }>;
        };
      }>;
      usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
    };

    const choice = data.choices?.[0]?.message;
    const toolCalls: IToolCall[] = (choice?.tool_calls ?? []).map(tc => ({
      id: tc.id,
      function: { name: tc.function.name, arguments: tc.function.arguments },
    }));

    return {
      content: choice?.content ?? null,
      toolCalls,
      usage: data.usage ? {
        promptTokens: data.usage.prompt_tokens,
        completionTokens: data.usage.completion_tokens,
        totalTokens: data.usage.total_tokens,
      } : undefined,
      model,
      latencyMs: Date.now() - startMs,
    };
  } finally {
    clearTimeout(timer);
  }
}

export function createOpenAICompatibleRouter(config: ILLMConfig): ILLMRouter {
  const defaultTemp = config.defaultTemperature ?? 0.7;
  const defaultMaxTokens = config.defaultMaxTokens ?? 4096;
  const cbThreshold = config.circuitBreakerThreshold ?? 3;
  const cbCooldownMs = config.circuitBreakerCooldownMs ?? 60_000;
  const requestTimeoutMs = config.requestTimeoutMs ?? 60_000;

  // 构建 Provider 链：主 → 备用们
  const providers: IProviderConfig[] = [
    { baseUrl: config.baseUrl, apiKey: config.apiKey, models: config.models },
    ...(config.fallbackProviders ?? []),
  ];

  // 每个 Provider 的健康状态
  const healthMap = new Map<number, IProviderHealth>();
  for (let i = 0; i < providers.length; i++) {
    healthMap.set(i, { consecutiveFailures: 0, lastFailureAt: 0, state: 'closed' });
  }

  /** 判断 Provider 当前是否可用 */
  function isAvailable(idx: number): boolean {
    const h = healthMap.get(idx)!;
    if (h.state === 'closed') return true;
    if (h.state === 'open') {
      // 冷却期过后进入半开状态
      if (Date.now() - h.lastFailureAt >= cbCooldownMs) {
        h.state = 'half-open';
        return true;
      }
      return false;
    }
    // half-open: 允许一次尝试
    return true;
  }

  /** 记录成功：重置熔断器 */
  function recordSuccess(idx: number): void {
    const h = healthMap.get(idx)!;
    h.consecutiveFailures = 0;
    h.state = 'closed';
  }

  /** 记录失败：可能触发熔断 */
  function recordFailure(idx: number): void {
    const h = healthMap.get(idx)!;
    h.consecutiveFailures++;
    h.lastFailureAt = Date.now();
    if (h.consecutiveFailures >= cbThreshold) {
      h.state = 'open';
    }
  }

  return {
    resolveModel(messages) {
      const intent = detectIntent(messages);
      for (let i = 0; i < providers.length; i++) {
        if (isAvailable(i)) {
          const models = providers[i]!.models;
          return { model: models[intent] ?? models.general, intent };
        }
      }
      const models = providers[0]!.models;
      return { model: models[intent] ?? models.general, intent };
    },

    async chat(messages, options = {}) {
      const intent = detectIntent(messages);
      const errors: Array<{ provider: number; error: string }> = [];

      for (let i = 0; i < providers.length; i++) {
        if (!isAvailable(i)) continue;

        const provider = providers[i]!;
        const model = options.model ?? (provider.models[intent] ?? provider.models.general);

        try {
          const result = await callProvider(
            provider, messages, model, options,
            defaultTemp, defaultMaxTokens, requestTimeoutMs,
          );
          recordSuccess(i);

          if (i > 0) {
            console.error(`[LLM Fallback] 使用备用 Provider #${i} (${provider.baseUrl}) 成功`);
          }

          return result;
        } catch (err) {
          recordFailure(i);
          const errMsg = err instanceof Error ? err.message : String(err);
          errors.push({ provider: i, error: errMsg });
          console.error(`[LLM Fallback] Provider #${i} (${provider.baseUrl}) 失败: ${errMsg}`);
        }
      }

      // 所有 Provider 都失败
      const summary = errors.map(e => `#${e.provider}: ${e.error}`).join(' | ');
      throw new Error(`所有 LLM Provider 均不可用: ${summary}`);
    },
  };
}
