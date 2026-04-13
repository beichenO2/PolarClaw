/**
 * OpenAI-Compatible LLM 适配器
 *
 * 支持所有兼容 OpenAI Chat Completions API 的服务商：
 * - 阿里云百炼 Coding Plan
 * - OpenAI
 * - 本地 Ollama
 *
 * 包含意图路由：根据消息内容选择最合适的模型。
 */

import type { ILLMRouter, IntentType } from '../../ports/llm.js';
import type { IChatMessage, IToolCall } from '../../ports/memory.js';

export interface ILLMConfig {
  baseUrl: string;
  apiKey: string;
  models: Record<IntentType, string>;
  /** 默认温度 */
  defaultTemperature?: number;
  /** 默认最大 token */
  defaultMaxTokens?: number;
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

export function createOpenAICompatibleRouter(config: ILLMConfig): ILLMRouter {
  const { baseUrl, apiKey, models } = config;
  const defaultTemp = config.defaultTemperature ?? 0.7;
  const defaultMaxTokens = config.defaultMaxTokens ?? 4096;

  return {
    resolveModel(messages) {
      const intent = detectIntent(messages);
      return { model: models[intent] ?? models.general, intent };
    },

    async chat(messages, options = {}) {
      const startMs = Date.now();
      const { model: resolvedModel } = this.resolveModel(messages);
      const model = options.model ?? resolvedModel;

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

      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
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
    },
  };
}
