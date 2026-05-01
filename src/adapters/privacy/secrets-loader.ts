/**
 * PolarPrivate Secrets → process.env 加载器
 *
 * 启动时从 PolarPrivate Vault 读取 PolarClaw 项目的所有 Secret，
 * 将 dot-notation key 转为 UPPER_SNAKE_CASE 环境变量注入 process.env。
 *
 * 映射规则：feishu.admin.app_id → FEISHU_ADMIN_APP_ID
 *
 * 仅注入 process.env 中尚未设置的变量（手动 .env 优先）。
 * PolarPrivate 不可达时静默降级，不阻断启动。
 */

interface SecretOut {
  id: string;
  key: string;
  enabled: boolean;
  project_id: string | null;
}

interface ListResponse<T> {
  items: T[];
  total: number;
}

interface ProjectOut {
  id: string;
  name: string;
}

export interface ISecretsLoaderOptions {
  baseUrl: string;
  projectName: string;
  timeoutMs?: number;
  /** PolarPrivate Service Token (Bearer) for reveal endpoint auth */
  serviceToken?: string;
}

function dotToEnvKey(dotKey: string): string {
  return dotKey.replace(/\./g, '_').toUpperCase();
}

async function fetchJson<T>(url: string, timeoutMs: number): Promise<T | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    return await res.json() as T;
  } catch {
    return null;
  }
}

async function postJson<T>(url: string, timeoutMs: number, bearerToken?: string): Promise<T | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const headers: Record<string, string> = { 'Accept': 'application/json' };
    if (bearerToken) headers['Authorization'] = `Bearer ${bearerToken}`;
    const res = await fetch(url, {
      method: 'POST',
      headers,
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    return await res.json() as T;
  } catch {
    return null;
  }
}

/**
 * 从 PolarPrivate 加载 secrets 并注入 process.env
 * @returns 注入的变量数量
 */
export async function loadSecretsToEnv(options: ISecretsLoaderOptions): Promise<number> {
  const { baseUrl, projectName, timeoutMs = 3000, serviceToken } = options;
  const token = serviceToken || process.env.POLARPRIVATE_SERVICE_TOKEN;

  const health = await fetchJson<{ vault_unlocked: boolean }>(`${baseUrl}/health`, timeoutMs);
  if (!health?.vault_unlocked) {
    console.error('[secrets-loader] PolarPrivate 不可达或 Vault 未解锁，跳过');
    return 0;
  }

  const projectsData = await fetchJson<ListResponse<ProjectOut> | ProjectOut[]>(
    `${baseUrl}/api/projects`, timeoutMs,
  );
  if (!projectsData) return 0;

  const projects = Array.isArray(projectsData)
    ? projectsData
    : projectsData.items ?? [];

  const project = projects.find(p => p.name === projectName);
  if (!project) {
    console.error(`[secrets-loader] PolarPrivate 中未找到项目 "${projectName}"，跳过`);
    return 0;
  }

  const secretsData = await fetchJson<ListResponse<SecretOut>>(
    `${baseUrl}/api/secrets?project_id=${project.id}&limit=200`, timeoutMs,
  );
  if (!secretsData?.items?.length) return 0;

  let injected = 0;
  for (const secret of secretsData.items) {
    if (!secret.enabled) continue;

    const envKey = dotToEnvKey(secret.key);
    if (process.env[envKey]?.trim()) continue;

    const revealed = await postJson<{ value: string }>(
      `${baseUrl}/api/secrets/${secret.id}/reveal`, timeoutMs, token,
    );
    if (!revealed?.value || revealed.value === 'PLACEHOLDER') continue;

    process.env[envKey] = revealed.value;
    injected++;
  }

  if (injected > 0) {
    console.error(`[secrets-loader] 从 PolarPrivate 注入了 ${injected} 个环境变量`);
  }
  return injected;
}
