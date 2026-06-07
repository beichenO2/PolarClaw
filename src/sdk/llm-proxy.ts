/**
 * LLM Proxy SDK — Capability-Level Based Model Selection
 *
 * 设计原则：调用方只描述需求档次（capability code），不选模型。
 * 模型选择权完全归 LLM Proxy（PolarPrivate），调用方无权也无需知道
 * 背后使用的具体模型名、供应商或 Base URL。
 *
 * 3-bit capability code: QCS (Quality, Context, Speed)
 *   - Q (质量): 0 = 普通, 1 = 高质量
 *   - C (上下文): 0 = 标准 (~200K), 1 = 长上下文 (~1M)
 *   - S (速度): 0 = 普通, 1 = 高速
 *
 * 调用方式:
 *   import { createLLMClient } from './llm-proxy.js';
 *   const llm = createLLMClient();
 *   const result = await llm.chat(messages, { capability: '100' });
 */

const LLM_PROXY_BASE = 'http://127.0.0.1:12790';
const LLM_PROXY_V1 = `${LLM_PROXY_BASE}/v1`;

export type CapabilityCode = string; // 3-char binary like '000', '101', '111'

/**
 * Normalize a capability code to 3-char 0/1 string.
 */
export function normalizeCode(code?: string): CapabilityCode {
  return (code ?? '000').padEnd(3, '0').slice(0, 3).replace(/[^01]/g, '0');
}

/** Cloud: send 3-bit QCS only. PolarPrivate maps to upstream — never vendor names here. */
export function cloudCapabilityToModelId(code: CapabilityCode): string {
  return normalizeCode(code);
}

/** Local: only L000 (8B), L100 (32B), L101 (VLM). Maps QCS → allowed L-code. */
export function localCapabilityToModelId(code: CapabilityCode): string {
  const qcs = normalizeCode(code);
  if (qcs === '101') return 'L101';
  if (qcs === '100') return 'L100';
  return 'L000';
}

function resolveModelInternal(code: CapabilityCode, tier: 'cloud' | 'local'): string {
  return tier === 'local' ? localCapabilityToModelId(code) : cloudCapabilityToModelId(code);
}

/** Map intent → QCS (cloud) or direct local L-code via {@link localCapabilityToModelId}. */
export function intentToCode(intent: string, tier: 'cloud' | 'local' = 'cloud'): CapabilityCode {
  if (tier === 'local') {
    switch (intent) {
      case 'vision': return '101';
      case 'coding':
      case 'research': return '100';
      default: return '000';
    }
  }
  switch (intent) {
    case 'coding': return '000';
    case 'research': return '010';
    case 'vision': return '101';
    case 'general':
    default: return '001';
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
