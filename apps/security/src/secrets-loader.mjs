/**
 * PolarPrivate secret loader — fetch decrypted credentials at startup,
 * inject into process.env so downstream config.mjs picks them up transparently.
 *
 * Falls back silently to existing env / .env if PolarPrivate is unreachable.
 */

function ppBase() {
  return process.env.POLARPRIVATE_URL || "http://127.0.0.1:8790";
}
function ppProject() {
  return process.env.POLARPRIVATE_PROJECT || "MyClaw";
}

const SECRET_TO_ENV = {
  "feishu.admin.app_id":                "FEISHU_ADMIN_APP_ID",
  "feishu.admin.app_secret":            "FEISHU_ADMIN_APP_SECRET",
  "feishu.admin.verification_token":    "FEISHU_VERIFICATION_TOKEN",
  "feishu.admin.encrypt_key":           "FEISHU_ENCRYPT_KEY",
  "feishu.girlfriend.app_id":           "FEISHU_GIRLFRIEND_APP_ID",
  "feishu.girlfriend.app_secret":       "FEISHU_GIRLFRIEND_APP_SECRET",
  "feishu.girlfriend.verification_token": "FEISHU_GIRLFRIEND_VERIFICATION_TOKEN",
  "feishu.girlfriend.encrypt_key":      "FEISHU_GIRLFRIEND_ENCRYPT_KEY",
  "telegram.admin.bot_token":           "TELEGRAM_ADMIN_BOT_TOKEN",
  "telegram.girlfriend.bot_token":      "TELEGRAM_GIRLFRIEND_BOT_TOKEN",
  "dashscope.api_key":                  "MYCLAW_LLM_API_KEY",
};

/**
 * @param {string} url
 * @param {RequestInit} [opts]
 * @returns {Promise<any>}
 */
async function ppFetch(url, opts) {
  const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`PP ${res.status}: ${await res.text()}`);
  return res.json();
}

/**
 * Try to resolve the project UUID from PolarPrivate by name.
 * @returns {Promise<string | null>}
 */
/**
 * @param {string} base
 * @param {string} project
 */
async function resolveProjectId(base, project) {
  try {
    const data = await ppFetch(`${base}/api/projects?q=${encodeURIComponent(project)}`);
    const items = data.items || data;
    if (!Array.isArray(items) || items.length === 0) return null;
    const match = items.find((p) => p.name === project);
    return match?.id ?? items[0]?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * Load all secrets for a project, reveal each, and set as env vars.
 * Does NOT overwrite already-set env vars (explicit .env takes priority).
 *
 * @param {{ silent?: boolean }} [opts]
 * @returns {Promise<{ loaded: number; skipped: number; failed: boolean }>}
 */
export async function loadSecretsFromPolarPrivate(opts = {}) {
  const result = { loaded: 0, skipped: 0, failed: false };
  const silent = opts.silent ?? false;
  const log = silent ? () => {} : (/** @type {string} */ m) => console.error(`[secrets-loader] ${m}`);
  const base = ppBase();
  const project = ppProject();

  let projectId;
  try {
    const health = await ppFetch(`${base}/health`);
    if (!health?.vault_unlocked) {
      log("PolarPrivate vault is locked — skipping secret injection");
      result.failed = true;
      return result;
    }
    projectId = await resolveProjectId(base, project);
    if (!projectId) {
      log(`Project "${project}" not found in PolarPrivate — skipping`);
      result.failed = true;
      return result;
    }
  } catch (e) {
    log(`PolarPrivate unreachable (${e.message}) — falling back to .env`);
    result.failed = true;
    return result;
  }

  let secrets;
  try {
    const data = await ppFetch(`${base}/api/secrets?project_id=${projectId}&limit=100`);
    secrets = data.items || [];
  } catch (e) {
    log(`Failed to list secrets: ${e.message}`);
    result.failed = true;
    return result;
  }

  for (const sec of secrets) {
    const envKey = SECRET_TO_ENV[sec.key];
    if (!envKey) continue;
    if (!sec.enabled) continue;

    if (process.env[envKey]) {
      result.skipped++;
      continue;
    }

    try {
      const revealed = await ppFetch(`${base}/api/secrets/${sec.id}/reveal`, { method: "POST" });
      const val = revealed.value;
      if (val && val !== "PLACEHOLDER") {
        process.env[envKey] = val;
        result.loaded++;
      }
    } catch (e) {
      log(`Failed to reveal ${sec.key}: ${e.message}`);
    }
  }

  if (result.loaded > 0) {
    log(`Injected ${result.loaded} secret(s) from PolarPrivate (${result.skipped} skipped — already in env)`);
  }
  return result;
}
