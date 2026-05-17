/**
 * LLM Proxy SDK — Capability-Level Based Model Selection
 *
 * 3-bit capability code: QCS (Quality, Context, Speed)
 *   - Q (质量): 0 = 普通, 1 = 高质量
 *   - C (上下文): 0 = 标准 (~200K), 1 = 长上下文 (~1M)
 *   - S (速度): 0 = 普通, 1 = 高速
 *
 * 选取规则（最左位最重要）:
 *   - 1xx → GLM-5.1（质量最强，上下文/速度一般）
 *   - xx1 → MiniMax-M2.7-highspeed（高速响应）
 *   - 其他 → qwen3.6-plus（均衡选择）
 *
 * 调用方式:
 *   import { resolveModel, LLM_MODELS } from './llm-proxy.js';
 *   const model = resolveModel('100');  // GLM-5.1
 *   const model = resolveModel('001');  // MiniMax-M2.7-highspeed
 *   const model = resolveModel('010');  // qwen3.6-plus
 */

export const LLM_MODELS = {
  quality: 'GLM-5.1',
  balanced: 'qwen3.6-plus',
  fast: 'MiniMax-M2.7-highspeed',
} as const;

export type CapabilityCode = string; // 3-char binary like '000', '101', '111'

export interface ResolvedModel {
  model: string;
  reason: string;
  code: CapabilityCode;
}

/**
 * Resolve a 3-bit capability code to a concrete model name.
 *
 * @param code  3-char string of 0/1 — QCS (Quality, Context, Speed)
 * @returns     model name + selection reason
 */
export function resolveModel(code: CapabilityCode): ResolvedModel {
  const normalized = (code ?? '000').padEnd(3, '0').slice(0, 3);
  const [q, _c, s] = normalized;

  if (q === '1') {
    return { model: LLM_MODELS.quality, reason: 'quality-first (Q=1)', code: normalized };
  }
  if (s === '1') {
    return { model: LLM_MODELS.fast, reason: 'speed-first (S=1)', code: normalized };
  }
  return { model: LLM_MODELS.balanced, reason: 'balanced (default)', code: normalized };
}

/**
 * Map legacy intent names to capability codes.
 */
export function intentToCode(intent: string): CapabilityCode {
  switch (intent) {
    case 'coding': return '100';   // quality matters most
    case 'research': return '010'; // long context for papers
    case 'vision': return '100';   // quality for image analysis
    case 'general':
    default: return '001';         // fast for chat
  }
}

/**
 * Convenience: resolve model from a legacy intent string.
 */
export function resolveFromIntent(intent: string): ResolvedModel {
  return resolveModel(intentToCode(intent));
}
