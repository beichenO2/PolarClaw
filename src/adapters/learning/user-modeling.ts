/**
 * User Modeling — 增强版用户建模
 *
 * 在每次对话结束后异步更新用户画像。
 * 从对话内容中提取：技术水平、偏好工具、沟通风格、专长领域。
 * 不实时、不阻塞，fire-and-forget。
 *
 * 灵感来源：Hermes 的 Honcho 辨证式用户建模。
 */

import type { IMemoryStore } from '../../ports/memory.js';

export interface IUserTraits {
  technicalLevel?: 'beginner' | 'intermediate' | 'advanced' | 'expert';
  communicationStyle?: 'brief' | 'detailed' | 'mixed';
  preferredLanguage?: 'zh' | 'en' | 'mixed';
  expertiseAreas?: string[];
  frequentTools?: string[];
}

/**
 * 从对话文本中提取用户特征。
 * 轻量规则引擎，不依赖 LLM。
 */
export function extractUserTraits(messages: string[]): Partial<IUserTraits> {
  const combined = messages.join('\n');
  const traits: Partial<IUserTraits> = {};

  const codeIndicators = [
    /\bfunction\b/, /\bconst\b/, /\bimport\b/, /\bclass\b/,
    /\basync\b/, /\bawait\b/, /\breturn\b/, /=>/, /\bdef\b/,
  ];
  const codeScore = codeIndicators.filter(r => r.test(combined)).length;
  if (codeScore >= 5) traits.technicalLevel = 'expert';
  else if (codeScore >= 3) traits.technicalLevel = 'advanced';
  else if (codeScore >= 1) traits.technicalLevel = 'intermediate';
  else traits.technicalLevel = 'beginner';

  const zhChars = (combined.match(/[\u4e00-\u9fff]/g) || []).length;
  const enChars = (combined.match(/[a-zA-Z]/g) || []).length;
  if (zhChars > enChars * 3) traits.preferredLanguage = 'zh';
  else if (enChars > zhChars * 3) traits.preferredLanguage = 'en';
  else traits.preferredLanguage = 'mixed';

  const avgLen = messages.length > 0
    ? messages.reduce((s, m) => s + m.length, 0) / messages.length
    : 0;
  traits.communicationStyle = avgLen > 200 ? 'detailed' : avgLen < 50 ? 'brief' : 'mixed';

  const toolMentions: Record<string, number> = {};
  const toolPatterns = [
    /\bgit\b/gi, /\bnpm\b/gi, /\bdocker\b/gi, /\bpython\b/gi,
    /\btypescript\b/gi, /\bvue\b/gi, /\breact\b/gi, /\bnode\b/gi,
    /\brust\b/gi, /\bgo\b/gi, /\bkubernetes\b/gi, /\bsql\b/gi,
  ];
  for (const pat of toolPatterns) {
    const matches = combined.match(pat);
    if (matches && matches.length > 0) {
      const name = pat.source.replace(/\\b/g, '');
      toolMentions[name] = (toolMentions[name] ?? 0) + matches.length;
    }
  }
  const sorted = Object.entries(toolMentions).sort((a, b) => b[1] - a[1]);
  if (sorted.length > 0) {
    traits.frequentTools = sorted.slice(0, 5).map(([name]) => name);
  }

  return traits;
}

/**
 * 将用户特征持久化到 memory store。
 * 非覆盖式——只更新有值的字段。
 */
export function persistUserTraits(
  memory: IMemoryStore,
  userId: string,
  traits: Partial<IUserTraits>,
): void {
  if (traits.technicalLevel) {
    memory.saveProfile(userId, 'technical_level', traits.technicalLevel);
  }
  if (traits.communicationStyle) {
    memory.saveProfile(userId, 'communication_style', traits.communicationStyle);
  }
  if (traits.preferredLanguage) {
    memory.saveProfile(userId, 'preferred_language', traits.preferredLanguage);
  }
  if (traits.frequentTools?.length) {
    memory.saveProfile(userId, 'frequent_tools', JSON.stringify(traits.frequentTools));
  }
  if (traits.expertiseAreas?.length) {
    memory.saveProfile(userId, 'expertise_areas', JSON.stringify(traits.expertiseAreas));
  }
}
