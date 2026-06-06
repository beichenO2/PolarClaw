/**
 * PolarPrivate D-class Grant → process.env 加载器
 *
 * 通过 PolarPrivate D-class grant 接口获取飞书等第三方 SDK 凭证。
 * D-class 受 SHA256 白名单约束，每次 grant 写审计日志。
 *
 * 飞书 SDK 需要 APP_ID/APP_SECRET/VERIFICATION_TOKEN 明文初始化，
 * 属于"第三方 SDK 协议需要明文"的 D-class 场景。
 */

export interface ISecretsLoaderOptions {
  baseUrl: string;
  projectName: string;
  timeoutMs?: number;
}

interface DClassGrantResponse {
  granted: boolean;
  secrets?: Record<string, string>;
  error?: string;
}

/**
 * 通过 PolarPrivate D-class grant 获取指定服务的凭证并注入 process.env。
 * 仅注入 env 中尚未设置的变量。
 */
export async function loadSecretsToEnv(options: ISecretsLoaderOptions): Promise<number> {
  const { baseUrl, projectName, timeoutMs = 5000 } = options;

  const services = [
    {
      service: 'feishu-admin',
      keys: ['app_id', 'app_secret', 'verification_token', 'encrypt_key'],
      envPrefix: 'FEISHU_ADMIN',
    },
    {
      service: 'feishu-girlfriend',
      keys: ['app_id', 'app_secret', 'verification_token', 'encrypt_key'],
      envPrefix: 'FEISHU_GIRLFRIEND',
    },
  ];

  let injected = 0;

  for (const svc of services) {
    try {
      const resp = await fetch(`${baseUrl}/api/d-class/grant`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          service_name: svc.service,
          project: projectName,
          allowed_secret_keys: svc.keys,
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!resp.ok) {
        if (resp.status === 403 || resp.status === 404) {
          // Service not configured in PolarPrivate or not whitelisted — skip silently
          continue;
        }
        console.warn(`[secrets-loader] D-class grant for ${svc.service}: HTTP ${resp.status}`);
        continue;
      }

      const data = (await resp.json()) as DClassGrantResponse;
      if (!data.granted || !data.secrets) {
        continue;
      }

      const keyMap: Record<string, string> = {
        app_id: `${svc.envPrefix}_APP_ID`,
        app_secret: `${svc.envPrefix}_APP_SECRET`,
        verification_token: `${svc.envPrefix}_VERIFICATION_TOKEN`,
        encrypt_key: `${svc.envPrefix}_ENCRYPT_KEY`,
      };

      for (const [secretKey, envKey] of Object.entries(keyMap)) {
        const value = data.secrets[secretKey];
        if (value && !process.env[envKey]) {
          process.env[envKey] = value;
          injected++;
        }
      }

      if (injected > 0) {
        console.error(`[secrets-loader] D-class grant for ${svc.service}: ${injected} env vars injected`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('ECONNREFUSED')) {
        console.warn(`[secrets-loader] PolarPrivate not reachable at ${baseUrl} — skipping D-class grant`);
        return 0;
      }
      console.warn(`[secrets-loader] D-class grant for ${svc.service} failed: ${msg}`);
    }
  }

  return injected;
}
