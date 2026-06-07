// Pattern from PilotDeck classifyAndRoute.ts (AGPL, rewritten)
import type { IChatMessage } from '../ports/memory.js';

export type RouteTier = 'light' | 'standard' | 'heavy';

export type RouteDecision = {
  tier: RouteTier;
  capability: string;
  reason: string;
};

const CODING_PATTERN = /(?:代码|编程|bug|debug|重构|implement|function|class|API|test|lint|fix)/i;
const RESEARCH_PATTERN = /(?:研究|论文|分析|综述|调研|对比|评估|architecture|design)/i;
const ALWAYS_ON_PATTERN = /^always-on\//;

/** Heuristic Judge — maps message profile → QCS capability code */
export function classifyAndRoute(
  messages: IChatMessage[],
  ctx?: { channel?: string; scenario?: 'main' | 'subagent' | 'always-on' },
): RouteDecision {
  if (ctx?.channel && ALWAYS_ON_PATTERN.test(ctx.channel)) {
    return { tier: 'light', capability: '001', reason: 'always-on channel → fast tier' };
  }
  if (ctx?.scenario === 'always-on') {
    return { tier: 'light', capability: '001', reason: 'always-on scenario' };
  }

  const lastUser = [...messages].reverse().find((m) => m.role === 'user');
  const text = typeof lastUser?.content === 'string' ? lastUser.content : '';
  const len = text.length;
  const toolHeavy = messages.some((m) => m.role === 'tool');

  if (RESEARCH_PATTERN.test(text) || len > 4000) {
    return { tier: 'heavy', capability: '010', reason: 'research or long context' };
  }

  if (CODING_PATTERN.test(text) || toolHeavy) {
    return { tier: 'standard', capability: '000', reason: 'coding or tool loop' };
  }

  if (len < 80 && !CODING_PATTERN.test(text) && !toolHeavy) {
    return { tier: 'light', capability: '001', reason: 'short simple message' };
  }

  return { tier: 'standard', capability: '001', reason: 'default balanced' };
}
