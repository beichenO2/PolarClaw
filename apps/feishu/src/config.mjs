/**
 * Load and validate Feishu / Lark bot environment variables.
 */

/** @typedef {"feishu" | "lark"} FeishuDomain */

/**
 * @typedef {object} FeishuBotConfig
 * @property {string} appId
 * @property {string} appSecret
 * @property {string} encryptKey
 * @property {string} verificationToken
 * @property {FeishuDomain} domain
 * @property {Set<string>} allowFrom
 * @property {string} webhookHost
 * @property {number} webhookPort
 * @property {string} webhookPath
 */

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {FeishuBotConfig}
 */
export function loadFeishuConfig(env = process.env) {
  const appId = (env.FEISHU_APP_ID ?? "").trim();
  if (!appId) {
    throw new Error("FEISHU_APP_ID is required");
  }

  const appSecret = (env.FEISHU_APP_SECRET ?? "").trim();
  if (!appSecret) {
    throw new Error("FEISHU_APP_SECRET is required");
  }

  const verificationToken = (env.FEISHU_VERIFICATION_TOKEN ?? "").trim();
  if (!verificationToken) {
    throw new Error("FEISHU_VERIFICATION_TOKEN is required");
  }

  const encryptKey = (env.FEISHU_ENCRYPT_KEY ?? "").trim();

  const domainRaw = (env.FEISHU_DOMAIN ?? "feishu").trim().toLowerCase();
  /** @type {FeishuDomain} */
  let domain = "feishu";
  if (domainRaw === "lark") {
    domain = "lark";
  } else if (domainRaw && domainRaw !== "feishu") {
    throw new Error('FEISHU_DOMAIN must be "feishu" or "lark" when set');
  }

  const allowRaw = (env.FEISHU_ALLOW_FROM ?? "").trim();
  const allowFrom = new Set(
    allowRaw
      ? allowRaw
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : [],
  );

  const webhookHost = (env.FEISHU_WEBHOOK_HOST ?? "127.0.0.1").trim() || "127.0.0.1";
  const portRaw = (env.FEISHU_WEBHOOK_PORT ?? "3000").trim();
  const webhookPort = Number(portRaw);
  if (!Number.isFinite(webhookPort) || webhookPort < 1 || webhookPort > 65535) {
    throw new Error("FEISHU_WEBHOOK_PORT must be a valid TCP port (1–65535)");
  }

  const webhookPath = (env.FEISHU_WEBHOOK_PATH ?? "/feishu/events").trim() || "/feishu/events";
  if (!webhookPath.startsWith("/")) {
    throw new Error("FEISHU_WEBHOOK_PATH must start with /");
  }

  return {
    appId,
    appSecret,
    encryptKey,
    verificationToken,
    domain,
    allowFrom,
    webhookHost,
    webhookPort,
    webhookPath,
  };
}
