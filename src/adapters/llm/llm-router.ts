/**
 * LLM 路由器适配器
 *
 * 通过 LLM Proxy SDK 与 PolarPrivate 通信。
 * 调用方只传 capability code（QCSA 4-bit），不传模型名。
 * 模型选择权完全在 LLM Proxy 侧。
 *
 * 保留意图检测：自动将 intent 映射为 capability code，
 * 也支持调用方直接指定 capability code。
 */

import type { ILLMRouter, ILLMResponse, ILLMOptions, IntentType } from '../../ports/llm.js';
import type { IChatMessage, IToolCall } from '../../ports/memory.js';
import { createLLMClient, intentToCode, normalizeCode, type LLMProxyClient } from '../../sdk/llm-proxy.js';

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

export interface ILLMConfig {
  /** @deprecated — ignored, SDK hardcodes LLM Proxy address */
  baseUrl?: string;
  /** @deprecated — ignored, LLM Proxy manages keys */
  apiKey?: string;
  /** @deprecated — ignored, model selection is proxy-side */
  models?: Record<IntentType, string>;
  defaultTemperature?: number;
  defaultMaxTokens?: number;
  /** @deprecated — single gateway, no fallback needed */
  fallbackProviders?: unknown[];
  requestTimeoutMs?: number;
  concurrencyLimit?: number;
  circuitBreakerThreshold?: number;
  circuitBreakerCooldownMs?: number;
}

class Semaphore {
  private queue: Array<() => void> = [];
  private active = 0;

  constructor(private readonly limit: number) {}

  async acquire(): Promise<void> {
    if (this.active < this.limit) {
      this.active++;
      return;
    }
    return new Promise<void>(resolve => {
      this.queue.push(() => { this.active++; resolve(); });
    });
  }

  release(): void {
    this.active--;
    const next = this.queue.shift();
    if (next) next();
  }
}

const RESILIENCE_RETRY_DELAYS = [1000, 3000, 8000]; // exponential backoff ms

export function createLLMRouter(config: ILLMConfig): ILLMRouter {
  const defaultTemp = config.defaultTemperature ?? 0.7;
  const defaultMaxTokens = config.defaultMaxTokens ?? 4096;
  const requestTimeoutMs = config.requestTimeoutMs ?? 300_000;
  const concurrencyLimit = config.concurrencyLimit ?? 5;
  const semaphore = new Semaphore(concurrencyLimit);

  const client: LLMProxyClient = createLLMClient();

  return {
    resolveModel(messages) {
      const intent = detectIntent(messages);
      const code = intentToCode(intent);
      return { model: `capability:${code}`, intent };
    },

    async chat(messages, options = {}) {
      await semaphore.acquire();
      try {
        const intent = detectIntent(messages);
        const capability = options.capability
          ?? intentToCode(intent);

        const formattedMessages = messages.map(m => {
          const msg: Record<string, unknown> = { role: m.role, content: m.content };
          if (m.toolCalls?.length) msg.tool_calls = m.toolCalls;
          if (m.toolCallId) msg.tool_call_id = m.toolCallId;
          return msg as { role: string; content: string; tool_calls?: unknown[]; tool_call_id?: string };
        });

        const chatOptions = {
          capability: normalizeCode(capability),
          temperature: options.temperature ?? defaultTemp,
          maxTokens: options.maxTokens ?? defaultMaxTokens,
          tools: options.tools,
          toolChoice: options.toolChoice,
          append_system_prompt: options.append_system_prompt,
          timeoutMs: requestTimeoutMs,
        };

        // === ResilienceChain: Tier 1 → retry → Tier 3 (Ollama) ===
        let lastError: Error | null = null;

        // Tier 1: PolarPrivate LLM Proxy (with exponential backoff retries)
        for (let attempt = 0; attempt <= RESILIENCE_RETRY_DELAYS.length; attempt++) {
          try {
            const result = await client.chat(formattedMessages, chatOptions);
            const toolCalls: IToolCall[] = result.toolCalls.map(tc => ({
              id: tc.id,
              function: { name: tc.function.name, arguments: tc.function.arguments },
            }));
            return {
              content: result.content,
              toolCalls,
              usage: result.usage,
              model: result.model,
              latencyMs: result.latencyMs,
            };
          } catch (err) {
            lastError = err instanceof Error ? err : new Error(String(err));
            const isRetriable = /timeout|ECONNREFUSED|ENOTFOUND|503|429|reset/i.test(lastError.message);
            if (!isRetriable || attempt >= RESILIENCE_RETRY_DELAYS.length) break;
            const delay = RESILIENCE_RETRY_DELAYS[attempt]!;
            console.warn(`[LLMRouter] Tier 1 attempt ${attempt + 1} failed (${lastError.message}), retrying in ${delay}ms...`);
            await new Promise(r => setTimeout(r, delay));
          }
        }

        // Tier 3: Local via PolarPrivate L-codes (Ollama behind proxy; L0000 = embedding only)
        console.warn(`[LLMRouter] Tier 1 exhausted: ${lastError?.message}. Trying local L-tier (L0000)...`);
        try {
          const fallbackResult = await client.chat(formattedMessages, {
            ...chatOptions,
            capability: '0000',
            tier: 'local',
            tools: undefined,
            toolChoice: undefined,
            timeoutMs: 120_000,
          });
          console.info(`[LLMRouter] Tier 3 local (${fallbackResult.model}) succeeded (${fallbackResult.latencyMs}ms)`);
          return {
            content: fallbackResult.content,
            toolCalls: [],
            model: fallbackResult.model,
            latencyMs: fallbackResult.latencyMs,
          };
        } catch (localErr) {
          console.error(`[LLMRouter] Tier 3 local failed:`, localErr);
        }

        throw new Error(
          `[LLMRouter] All tiers exhausted. Last error: ${lastError?.message ?? 'unknown'}. ` +
          `Tried: cloud capability → local L-tier via PolarPrivate.`,
        );
      } finally {
        semaphore.release();
      }
    },
  };
}
