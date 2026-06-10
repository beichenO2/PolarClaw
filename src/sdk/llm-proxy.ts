/**
 * LLM Proxy SDK — Capability-Level Based Model Selection
 *
 * 设计原则：调用方只描述需求档次（capability code），不选模型。
 * 模型选择权完全归 LLM Proxy（PolarPrivate），调用方无权也无需知道
 * 背后使用的具体模型名、供应商或 Base URL。
 *
 * 4-bit capability code: QCSA (Quality, Context, Speed, Agentic)
 *   - Q (质量): 0 = 普通, 1 = 旗舰
 *   - C (上下文): 0 = 标准 (~200K), 1 = 长上下文 (~1M)
 *   - S (速度): 0 = 均衡, 1 = 快速
 *   - A (Agentic): 0 = 对话, 1 = Agent/tool-use
 * V 前缀 = 视觉 (V0001 单图, V0011 多图)
 *
 * 调用方式:
 *   import { createLLMClient } from './llm-proxy.js';
 *   const llm = createLLMClient();
 *   const result = await llm.chat(messages, { capability: '1001' });
 */

const LLM_PROXY_BASE = 'http://127.0.0.1:12790';
const LLM_PROXY_V1 = `${LLM_PROXY_BASE}/v1`;

export type CapabilityCode = string; // 4-bit QCSA or V-prefixed (V0000)

/**
 * Normalize a capability code to 4-bit QCSA or V-prefix string.
 */
export function normalizeCode(code?: string): CapabilityCode {
  if (!code) return '0001';
  const trimmed = code.trim();
  if (trimmed.toUpperCase().startsWith('V') && trimmed.length === 5) return trimmed.toUpperCase();
  if (trimmed.length === 4 && /^[01]{4}$/.test(trimmed)) return trimmed;
  return '0001';
}

/** Cloud: send 4-bit QCSA or V-prefix. PolarPrivate maps to upstream. */
export function cloudCapabilityToModelId(code: CapabilityCode): string {
  return normalizeCode(code);
}

/** Local: only L0000 (embedding). No local chat models. */
export function localCapabilityToModelId(_code: CapabilityCode): string {
  return 'L0000';
}

function resolveModelInternal(code: CapabilityCode, tier: 'cloud' | 'local'): string {
  return tier === 'local' ? localCapabilityToModelId(code) : cloudCapabilityToModelId(code);
}

/** Map intent → 4-bit QCSA (cloud) or L0000 (local). */
export function intentToCode(intent: string, tier: 'cloud' | 'local' = 'cloud'): CapabilityCode {
  if (tier === 'local') return 'L0000';
  switch (intent) {
    case 'coding': return '1001';
    case 'research': return '1110';
    case 'vision': return 'V0001';
    case 'general':
    default: return '0001';
  }
}

export interface LLMProxyRequestOptions {
  capability?: CapabilityCode;
  /** cloud = PolarPrivate upstream; local = Ollama via L-prefix codes */
  tier?: 'cloud' | 'local';
  temperature?: number;
  maxTokens?: number;
  tools?: Array<{ type: 'function'; function: { name: string; description: string; parameters: Record<string, unknown> } }>;
  toolChoice?: 'auto' | 'none' | 'required';
  append_system_prompt?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface LLMProxyResponse {
  content: string | null;
  toolCalls: Array<{ id: string; function: { name: string; arguments: string } }>;
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
  model: string;
  latencyMs: number;
}

export interface LLMProxyClient {
  chat(messages: Array<{ role: string; content: string; tool_calls?: unknown[]; tool_call_id?: string }>, options?: LLMProxyRequestOptions): Promise<LLMProxyResponse>;
  healthCheck(): Promise<{ status: string; vault_unlocked: boolean }>;
}

/**
 * Create a client that talks to LLM Proxy (PolarPrivate).
 * The client sends capability codes — the proxy decides which model to use.
 *
 * No Base URL config, no model names, no API keys needed by the caller.
 */
export interface LLMClientOptions {
  /** Override LLM Proxy base URL (for testing). Defaults to PolarPrivate. */
  baseUrl?: string;
}

export function createLLMClient(clientOptions?: LLMClientOptions): LLMProxyClient {
  const proxyBase = clientOptions?.baseUrl ?? LLM_PROXY_BASE;
  const proxyV1 = `${proxyBase}/v1`;

  return {
    async chat(messages, options = {}) {
      const startMs = Date.now();
      const capability = normalizeCode(options.capability);
      const timeoutMs = options.timeoutMs ?? 300_000;

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      if (options.signal) {
        options.signal.addEventListener('abort', () => controller.abort());
      }

      const tier = options.tier ?? 'cloud';
      const model = resolveModelInternal(capability, tier);
      const body: Record<string, unknown> = {
        model,
        messages,
        temperature: options.temperature ?? 0.7,
        max_tokens: options.maxTokens ?? 4096,
      };
      if (options.append_system_prompt) {
        body.append_system_prompt = options.append_system_prompt;
      }
      if (options.tools?.length) {
        body.tools = options.tools;
        body.tool_choice = options.toolChoice ?? 'auto';
      }

      try {
        const res = await fetch(`${proxyV1}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        if (!res.ok) {
          const errText = await res.text().catch(() => '');
          throw new Error(`LLM Proxy error ${res.status}: ${errText.slice(0, 500)}`);
        }

        const data = await res.json() as {
          choices: Array<{ message: { content: string | null; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> } }>;
          usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
          model?: string;
        };

        const choice = data.choices?.[0]?.message;
        return {
          content: choice?.content ?? null,
          toolCalls: choice?.tool_calls ?? [],
          usage: data.usage ? {
            promptTokens: data.usage.prompt_tokens,
            completionTokens: data.usage.completion_tokens,
            totalTokens: data.usage.total_tokens,
          } : undefined,
          model: data.model ?? model,
          latencyMs: Date.now() - startMs,
        };
      } finally {
        clearTimeout(timer);
      }
    },

    async healthCheck() {
      const res = await fetch(`${proxyBase}/health`, { method: 'GET' });
      return res.json() as Promise<{ status: string; vault_unlocked: boolean }>;
    },
  };
}
