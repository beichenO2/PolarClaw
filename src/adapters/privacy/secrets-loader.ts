/**
 * PolarPrivate D-class Grant → process.env 加载器
 *
 * 通过 PolarPrivate D-class grant 接口获取飞书等第三方 SDK 凭证。
 * D-class 受 SHA256 白名单约束（~/.privportal/d-class-allowlist.json），
 * 每次 grant 写审计日志。
 *
 * 飞书 SDK 需要 APP_ID/APP_SECRET/VERIFICATION_TOKEN 明文初始化，
 * 属于"第三方 SDK 协议需要明文"的 D-class 场景。
 *
 * 前提条件：
 *   1. PolarPrivate 中已存储 feishu.admin.app_id 等 secret
 *   2. d-class-allowlist.json 中有 feishu-admin 条目，包含 node 的 SHA256
 */

import { execSync } from 'node:child_process';

export interface ISecretsLoaderOptions {
  baseUrl: string;
  projectName: string;
  timeoutMs?: number;
}

interface DClassGrantResponse {
  secrets: Record<string, string>;
}

function getNodeExecutableSha256(): string {
  const nodePath = process.execPath;
  const output = execSync(`shasum -a 256 "${nodePath}"`, { encoding: 'utf-8' });
  return output.split(/\s+/)[0] ?? '';
}

interface ServiceConfig {
  serviceName: string;
  secretKeyPrefix: string;
  envPrefix: string;
  fields: Array<{ secretSuffix: string; envSuffix: string }>;
}

const FEISHU_SERVICES: ServiceConfig[] = [
  {
    serviceName: 'feishu-admin',
    secretKeyPrefix: 'feishu.admin',
    envPrefix: 'FEISHU_ADMIN',
    fields: [
      { secretSuffix: 'app_id', envSuffix: 'APP_ID' },
      { secretSuffix: 'app_secret', envSuffix: 'APP_SECRET' },
      { secretSuffix: 'verification_token', envSuffix: 'VERIFICATION_TOKEN' },
      { secretSuffix: 'encrypt_key', envSuffix: 'ENCRYPT_KEY' },
    ],
  },
  {
    serviceName: 'feishu-girlfriend',
    secretKeyPrefix: 'feishu.girlfriend',
    envPrefix: 'FEISHU_GIRLFRIEND',
    fields: [
      { secretSuffix: 'app_id', envSuffix: 'APP_ID' },
      { secretSuffix: 'app_secret', envSuffix: 'APP_SECRET' },
      { secretSuffix: 'verification_token', envSuffix: 'VERIFICATION_TOKEN' },
      { secretSuffix: 'encrypt_key', envSuffix: 'ENCRYPT_KEY' },
    ],
  },
];

/**
 * 通过 PolarPrivate D-class grant 获取指定服务的凭证并注入 process.env。
 * 仅注入 env 中尚未设置的变量。
 */
export async function loadSecretsToEnv(options: ISecretsLoaderOptions): Promise<number> {
  const { baseUrl, timeoutMs = 5000 } = options;

  let callerSha256: string;
  try {
    callerSha256 = getNodeExecutableSha256();
  } catch {
    console.warn('[secrets-loader] Cannot compute node executable SHA256 — skipping D-class grant');
    return 0;
  }

  let injected = 0;

  for (const svc of FEISHU_SERVICES) {
    try {
      const resp = await fetch(`${baseUrl}/api/d-class/grant`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Caller-PID': String(process.pid),
        },
        body: JSON.stringify({
          service_name: svc.serviceName,
          caller_executable_sha256: callerSha256,
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!resp.ok) {
        if (resp.status === 403) {
          console.warn(`[secrets-loader] D-class denied for ${svc.serviceName} — node SHA256 not in allowlist`);
          continue;
        }
        if (resp.status === 404 || resp.status === 422) {
          continue;
        }
        console.warn(`[secrets-loader] D-class grant for ${svc.serviceName}: HTTP ${resp.status}`);
        continue;
      }

      const data = (await resp.json()) as DClassGrantResponse;
      if (!data.secrets || Object.keys(data.secrets).length === 0) {
        continue;
      }

      let svcInjected = 0;
      for (const field of svc.fields) {
        const secretKey = `${svc.secretKeyPrefix}.${field.secretSuffix}`;
        const envKey = `${svc.envPrefix}_${field.envSuffix}`;
        const value = data.secrets[secretKey];
        if (value && !process.env[envKey]) {
          process.env[envKey] = value;
          svcInjected++;
        }
      }

      if (svcInjected > 0) {
        console.error(`[secrets-loader] D-class grant for ${svc.serviceName}: ${svcInjected} env vars injected`);
        injected += svcInjected;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('ECONNREFUSED')) {
        console.warn(`[secrets-loader] PolarPrivate not reachable at ${baseUrl} — skipping D-class grant`);
        return 0;
      }
      console.warn(`[secrets-loader] D-class grant for ${svc.serviceName} failed: ${msg}`);
    }
  }

  return injected;
}
