/**
 * PolarPrivate API 客户端
 *
 * 与 PolarPrivate（端口 8790）通信：
 * - 拉取用户已登记的 Identity 实体
 * - 检查消息中是否包含已知 Secret
 *
 * PolarPrivate 必须处于解锁状态（unlock token 有效）。
 * 如果 PolarPrivate 不可用，降级为纯正则检测。
 */

import type { IPrivacyEntity } from '../../ports/privacy.js';

export interface IPolarPrivateConfig {
  baseUrl: string;
  /** 获取 unlock token 的方法（从 Keychain 或环境变量） */
  getUnlockToken: () => string | null;
  /** 超时 ms */
  timeoutMs?: number;
}

interface IdentityRow {
  id: number;
  category: string;
  label: string;
  value: string;
}

interface SecretRow {
  id: number;
  name: string;
  category: string;
  value?: string;
}

export function createPolarPrivateClient(config: IPolarPrivateConfig) {
  const { baseUrl, getUnlockToken, timeoutMs = 3000 } = config;

  async function fetchJson<T>(path: string): Promise<T | null> {
    const token = getUnlockToken();
    if (!token) return null;

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const res = await fetch(`${baseUrl}${path}`, {
        headers: {
          'X-Unlock-Token': token,
          'Accept': 'application/json',
        },
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok) return null;
      return await res.json() as T;
    } catch {
      return null;
    }
  }

  return {
    /** 检查 PolarPrivate 是否可用且已解锁 */
    async isAvailable(): Promise<boolean> {
      const result = await fetchJson<{ status: string }>('/api/status');
      return result?.status === 'unlocked';
    },

    /** 拉取所有 Identity 实体 → 转为 IPrivacyEntity 格式 */
    async loadIdentities(): Promise<IPrivacyEntity[]> {
      const rows = await fetchJson<IdentityRow[]>('/api/identities');
      if (!rows) return [];

      return rows.map(row => ({
        type: (row.category || 'NAME').toUpperCase(),
        value: row.value,
      }));
    },

    /**
     * 检查文本中是否包含任何已知的 Secret 值
     * 注意：需要 PolarPrivate 返回解密后的 Secret 值进行匹配
     */
    async containsKnownSecret(text: string): Promise<{
      found: boolean;
      matchedSecrets: Array<{ name: string; category: string }>;
    }> {
      const secrets = await fetchJson<SecretRow[]>('/api/secrets?include_values=true');
      if (!secrets) return { found: false, matchedSecrets: [] };

      const matched: Array<{ name: string; category: string }> = [];
      for (const s of secrets) {
        if (s.value && text.includes(s.value)) {
          matched.push({ name: s.name, category: s.category });
        }
      }

      return { found: matched.length > 0, matchedSecrets: matched };
    },
  };
}
