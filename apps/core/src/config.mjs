/**
 * Unified MyClaw configuration: optional JSON file + environment overrides.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { MYCLAW_DEFAULT_MODEL_BY_INTENT } from "@myclaw/llm";

/** Aligned with `apps/gateway/src/defaults.mjs` (OpenClaw local dev). */
const MYCLAW_DEFAULT_GATEWAY_PORT = 18789;

const DEFAULT_LLM_BASE =
  "https://coding.dashscope.aliyuncs.com/v1";

/**
 * @param {unknown} value
 * @param {unknown} fallback
 */
function pick(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  return value;
}

/**
 * @param {boolean | undefined} b
 * @param {boolean} fallback
 */
function pickBool(b, fallback) {
  if (typeof b === "boolean") return b;
  return fallback;
}

/**
 * Deep-merge plain objects (no arrays).
 * @param {Record<string, unknown>} base
 * @param {Record<string, unknown>} patch
 */
function deepMerge(base, patch) {
  const out = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (v !== undefined && v !== null && typeof v === "object" && !Array.isArray(v)) {
      const prev = out[k];
      out[k] =
        prev && typeof prev === "object" && !Array.isArray(prev)
          ? deepMerge(/** @type {Record<string, unknown>} */ (prev), /** @type {Record<string, unknown>} */ (v))
          : { .../** @type {Record<string, unknown>} */ (v) };
    } else if (v !== undefined) {
      out[k] = v;
    }
  }
  return out;
}

/**
 * @param {NodeJS.ProcessEnv} env
 */
function configFromEnv(env) {
  const apiKey =
    pick(env.MYCLAW_LLM_API_KEY, "") ||
    pick(env.DASHSCOPE_API_KEY, "") ||
    pick(env.OPENAI_API_KEY, "");

  /** @type {Record<string, unknown>} */
  const patch = {
    projectRoot: env.MYCLAW_PROJECT_ROOT?.trim() || undefined,
    llm: {
      baseUrl: env.MYCLAW_LLM_BASE_URL?.trim() || undefined,
      apiKey: apiKey || undefined,
      temperature: env.MYCLAW_LLM_TEMPERATURE
        ? Number(env.MYCLAW_LLM_TEMPERATURE)
        : undefined,
    },
    memory: {
      dbPath: env.MYCLAW_MEMORY_DB?.trim() || undefined,
    },
    gateway: {
      port: env.MYCLAW_GATEWAY_PORT ? Number(env.MYCLAW_GATEWAY_PORT) : undefined,
      host: env.MYCLAW_GATEWAY_HOST?.trim() || undefined,
    },
    channels: {
      telegram:
        env.MYCLAW_TELEGRAM === "0"
          ? false
          : env.MYCLAW_TELEGRAM === "1"
            ? true
            : undefined,
      feishu:
        env.MYCLAW_FEISHU === "0"
          ? false
          : env.MYCLAW_FEISHU === "1"
            ? true
            : undefined,
    },
    telegram: {
      token: env.TELEGRAM_BOT_TOKEN?.trim() || undefined,
      adminToken: env.TELEGRAM_ADMIN_BOT_TOKEN?.trim() || undefined,
      girlfriendToken: env.TELEGRAM_GIRLFRIEND_BOT_TOKEN?.trim() || undefined,
      allowFrom: env.TELEGRAM_ALLOW_FROM?.trim()
        ? env.TELEGRAM_ALLOW_FROM.split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : undefined,
    },
    feishu: {
      appId: env.FEISHU_APP_ID?.trim() || undefined,
      appSecret: env.FEISHU_APP_SECRET?.trim() || undefined,
      verificationToken: env.FEISHU_VERIFICATION_TOKEN?.trim() || undefined,
      encryptKey: env.FEISHU_ENCRYPT_KEY?.trim() || undefined,
      domain: env.FEISHU_DOMAIN?.trim() || undefined,
      adminAppId: env.FEISHU_ADMIN_APP_ID?.trim() || undefined,
      adminAppSecret: env.FEISHU_ADMIN_APP_SECRET?.trim() || undefined,
      girlfriendAppId: env.FEISHU_GIRLFRIEND_APP_ID?.trim() || undefined,
      girlfriendAppSecret: env.FEISHU_GIRLFRIEND_APP_SECRET?.trim() || undefined,
      allowFrom: env.FEISHU_ALLOW_FROM?.trim()
        ? env.FEISHU_ALLOW_FROM.split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : undefined,
      webhookHost: env.FEISHU_WEBHOOK_HOST?.trim() || undefined,
      webhookPort: env.FEISHU_WEBHOOK_PORT ? Number(env.FEISHU_WEBHOOK_PORT) : undefined,
      webhookPath: env.FEISHU_WEBHOOK_PATH?.trim() || undefined,
      transport: env.FEISHU_TRANSPORT?.trim() || undefined,
    },
    proactive: {
      enabled: env.MYCLAW_PROACTIVE === "1" ? true : undefined,
      heartbeatIntervalMs: env.MYCLAW_HEARTBEAT_MS
        ? Number(env.MYCLAW_HEARTBEAT_MS)
        : undefined,
    },
    evolution: {
      enabled: env.MYCLAW_EVOLUTION === "1" ? true : undefined,
      modelCheckIntervalMs: env.MYCLAW_EVOLUTION_CHECK_MS
        ? Number(env.MYCLAW_EVOLUTION_CHECK_MS)
        : undefined,
    },
    skills: {
      scanDirs: env.MYCLAW_SKILLS_DIRS?.trim()
        ? env.MYCLAW_SKILLS_DIRS.split(",").map((s) => resolve(s.trim()))
        : undefined,
    },
    runtime: {
      lobsterPrompt: env.MYCLAW_LOBSTER_PROMPT === "0" ? false : undefined,
    },
    planner: {
      enabled: env.MYCLAW_PLANNER === "0" ? false : undefined,
    },
    users: {
      dbPath: env.MYCLAW_USERS_DB?.trim() || undefined,
      adminName: env.MYCLAW_ADMIN_NAME?.trim() || undefined,
      girlfriendName: env.MYCLAW_GIRLFRIEND_NAME?.trim() || undefined,
    },
  };

  return patch;
}

/**
 * @param {string} configPath
 */
function readConfigFile(configPath) {
  const abs = isAbsolute(configPath) ? configPath : resolve(configPath);
  if (!existsSync(abs)) {
    throw new Error(`MyClaw config file not found: ${abs}`);
  }
  const raw = readFileSync(abs, "utf8");
  try {
    const parsed = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("config root must be a JSON object");
    }
    return /** @type {Record<string, unknown>} */ (parsed);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`Invalid JSON in config file: ${msg}`);
  }
}

/**
 * Build runtime config used by the agent and channel manager.
 *
 * @param {string | undefined} configPath - Explicit path, else MYCLAW_CONFIG / MYCLAW_CONFIG_PATH
 * @param {NodeJS.ProcessEnv} [env]
 */
export function loadConfig(configPath, env = process.env) {
  const pathFromEnv = env.MYCLAW_CONFIG?.trim() || env.MYCLAW_CONFIG_PATH?.trim();
  const path = configPath?.trim() || pathFromEnv;

  /** @type {Record<string, unknown>} */
  const defaults = {
    projectRoot: process.cwd(),
    llm: {
      baseUrl: DEFAULT_LLM_BASE,
      apiKey: "",
      models: { ...MYCLAW_DEFAULT_MODEL_BY_INTENT },
      temperature: 0.7,
      maxToolRounds: 8,
      maxTokens: 4096,
    },
    memory: {
      dbPath: resolve(process.cwd(), "data", "myclaw-memory.db"),
    },
    gateway: {
      host: "127.0.0.1",
      port: MYCLAW_DEFAULT_GATEWAY_PORT,
    },
    web: {
      /** Dev dashboard URL hint (Vite); core does not start the dev server. */
      devUrl: "http://127.0.0.1:5173",
    },
    runtime: {
      /** Extra system instructions appended after assemblePrompt() */
      systemSuffix: "",
      /** When true, block tool calls whose arguments look like embedded secrets (see @myclaw/runtime assertToolArgsSafe). */
      toolSafety: true,
      /** Tool names that must never run (API hard-deny). */
      deniedTools: /** @type {string[]} */ ([]),
      /** Inject FTS memory hits + flexible plan profile into the system prompt each turn (non-anonymous users). */
      turnContext: true,
      /** Max memory rows to inject per turn when turnContext is on. */
      turnMemoryLimit: 6,
      /** Append Lobster safety / memory / flexible-planning system block */
      lobsterPrompt: true,
    },
    planner: {
      enabled: true,
    },
    skills: {
      scanDirs: [] /** string[] — absolute or resolved later */,
    },
    research: {
      enabled: true,
      /** Use Wikipedia API as default evidence source (no API key). */
      wikipediaLang: "en",
    },
    proactive: {
      enabled: true,
      heartbeatIntervalMs: 3_600_000,
    },
    evolution: {
      enabled: false,
      modelCheckIntervalMs: 86_400_000,
    },
    yolo: {
      enabled: true,
    },
    content: {
      enabled: true,
    },
    users: {
      dbPath: resolve(process.cwd(), "data", "myclaw-users.db"),
      adminName: "管理员",
      girlfriendName: "女友",
    },
    channels: {
      /** 默认关闭，避免未配置 Bot 时启动失败；需要时在配置或环境中开启。 */
      telegram: false,
      feishu: false,
    },
    telegram: {
      token: "",
      adminToken: "",
      girlfriendToken: "",
      allowFrom: /** @type {string[]} */ ([]),
    },
    feishu: {
      appId: "",
      appSecret: "",
      verificationToken: "",
      encryptKey: "",
      domain: "feishu",
      allowFrom: /** @type {string[]} */ ([]),
      webhookHost: "127.0.0.1",
      webhookPort: 3000,
      webhookPath: "/feishu/events",
      transport: "websocket",
    },
  };

  let merged = { ...defaults };
  if (path) {
    merged = /** @type {Record<string, unknown>} */ (
      deepMerge(merged, readConfigFile(path))
    );
  }
  merged = /** @type {Record<string, unknown>} */ (deepMerge(merged, configFromEnv(env)));

  const projectRoot = resolve(String(merged.projectRoot ?? defaults.projectRoot));
  if (!existsSync(projectRoot)) {
    throw new Error(`MYCLAW projectRoot does not exist: ${projectRoot}`);
  }

  const llm = /** @type {Record<string, unknown>} */ (merged.llm ?? {});
  const apiKey = String(pick(llm.apiKey, "") ?? "");
  if (!apiKey.trim()) {
    throw new Error(
      "LLM API key required: set MYCLAW_LLM_API_KEY or DASHSCOPE_API_KEY (or llm.apiKey in config)",
    );
  }

  const memory = /** @type {Record<string, unknown>} */ (merged.memory ?? {});
  const dbPath = resolve(String(pick(memory.dbPath, defaults.memory.dbPath)));

  const skills = /** @type {Record<string, unknown>} */ (merged.skills ?? {});
  let scanDirs = Array.isArray(skills.scanDirs) ? skills.scanDirs.map((d) => resolve(String(d))) : [];
  if (scanDirs.length === 0) {
    scanDirs = [projectRoot];
  }

  const gateway = /** @type {Record<string, unknown>} */ (merged.gateway ?? {});
  const channels = /** @type {Record<string, unknown>} */ (merged.channels ?? {});
  const telegram = /** @type {Record<string, unknown>} */ (merged.telegram ?? {});
  const feishu = /** @type {Record<string, unknown>} */ (merged.feishu ?? {});
  const proactive = /** @type {Record<string, unknown>} */ (merged.proactive ?? {});
  const evolution = /** @type {Record<string, unknown>} */ (merged.evolution ?? {});
  const research = /** @type {Record<string, unknown>} */ (merged.research ?? {});
  const yolo = /** @type {Record<string, unknown>} */ (merged.yolo ?? {});
  const content = /** @type {Record<string, unknown>} */ (merged.content ?? {});
  const web = /** @type {Record<string, unknown>} */ (merged.web ?? {});
  const runtime = /** @type {Record<string, unknown>} */ (merged.runtime ?? {});
  const planner = /** @type {Record<string, unknown>} */ (merged.planner ?? {});

  /** @type {Record<string, string>} */
  const models = {
    ...MYCLAW_DEFAULT_MODEL_BY_INTENT,
    ...(typeof llm.models === "object" && llm.models !== null ? llm.models : {}),
  };

  const channelsOn = {
    telegram: pickBool(channels.telegram, false),
    feishu: pickBool(channels.feishu, false),
  };
  const users = /** @type {Record<string, unknown>} */ (merged.users ?? {});
  const usersDbPath = resolve(
    String(pick(users.dbPath, defaults.users.dbPath)),
  );

  const tgToken = String(pick(telegram.token, "") ?? "").trim();
  const tgAdminToken = String(pick(telegram.adminToken, "") ?? "").trim();
  const tgGirlfriendToken = String(pick(telegram.girlfriendToken, "") ?? "").trim();
  const hasTgMultiBot = !!(tgAdminToken || tgGirlfriendToken);
  const fsAppId = String(pick(feishu.appId, "") ?? "").trim();
  const fsSecret = String(pick(feishu.appSecret, "") ?? "").trim();
  const fsVerify = String(pick(feishu.verificationToken, "") ?? "").trim();

  if (channelsOn.telegram && !tgToken && !hasTgMultiBot) {
    throw new Error(
      "channels.telegram 已启用但缺少 telegram.token（或 admin/girlfriend token）：请在配置中设置或导出 TELEGRAM_BOT_TOKEN，或将 channels.telegram / MYCLAW_TELEGRAM 设为关闭",
    );
  }
  if (channelsOn.feishu && (!fsAppId || !fsSecret || !fsVerify)) {
    throw new Error(
      "channels.feishu 已启用但缺少凭证：需要 feishu.appId、feishu.appSecret、feishu.verificationToken（或对应 FEISHU_* 环境变量）",
    );
  }

  return {
    _configPath: path ? resolve(path) : null,
    projectRoot,
    llm: {
      baseUrl: String(pick(llm.baseUrl, DEFAULT_LLM_BASE)).replace(/\/+$/, ""),
      apiKey,
      models,
      temperature: Number.isFinite(Number(llm.temperature)) ? Number(llm.temperature) : 0.7,
      maxToolRounds: Number.isFinite(Number(llm.maxToolRounds)) ? Number(llm.maxToolRounds) : 8,
      maxTokens: Number.isFinite(Number(llm.maxTokens)) ? Number(llm.maxTokens) : 4096,
    },
    memory: { dbPath },
    gateway: {
      host: String(pick(gateway.host, "127.0.0.1")),
      port: Number.isFinite(Number(gateway.port)) ? Number(gateway.port) : MYCLAW_DEFAULT_GATEWAY_PORT,
    },
    web: {
      devUrl: String(pick(web.devUrl, "http://127.0.0.1:5173")),
    },
    runtime: {
      systemSuffix: String(pick(runtime.systemSuffix, "") ?? ""),
      toolSafety: pickBool(runtime.toolSafety, true),
      deniedTools: Array.isArray(runtime.deniedTools)
        ? runtime.deniedTools.map((t) => String(t).trim()).filter(Boolean)
        : [],
      turnContext: pickBool(runtime.turnContext, true),
      turnMemoryLimit: Number.isFinite(Number(runtime.turnMemoryLimit))
        ? Number(runtime.turnMemoryLimit)
        : 6,
      lobsterPrompt: pickBool(runtime.lobsterPrompt, true),
    },
    planner: {
      enabled: pickBool(planner.enabled, true),
    },
    skills: { scanDirs },
    research: {
      enabled: pickBool(research.enabled, true),
      wikipediaLang: String(pick(research.wikipediaLang, "en")),
    },
    proactive: {
      enabled: pickBool(proactive.enabled, true),
      heartbeatIntervalMs: Number.isFinite(Number(proactive.heartbeatIntervalMs))
        ? Number(proactive.heartbeatIntervalMs)
        : 3_600_000,
    },
    evolution: {
      enabled: pickBool(evolution.enabled, false),
      modelCheckIntervalMs: Number.isFinite(Number(evolution.modelCheckIntervalMs))
        ? Number(evolution.modelCheckIntervalMs)
        : 86_400_000,
    },
    yolo: { enabled: pickBool(yolo.enabled, true) },
    content: { enabled: pickBool(content.enabled, true) },
    users: {
      dbPath: usersDbPath,
      adminName: String(pick(users.adminName, defaults.users.adminName)),
      girlfriendName: String(pick(users.girlfriendName, defaults.users.girlfriendName)),
    },
    channels: channelsOn,
    telegram: {
      token: tgToken,
      adminToken: tgAdminToken,
      girlfriendToken: tgGirlfriendToken,
      allowFrom: new Set(
        Array.isArray(telegram.allowFrom)
          ? telegram.allowFrom.map(String)
          : defaults.telegram.allowFrom,
      ),
    },
    feishu: {
      appId: String(pick(feishu.appId, "") ?? ""),
      appSecret: String(pick(feishu.appSecret, "") ?? ""),
      verificationToken: String(pick(feishu.verificationToken, "") ?? ""),
      encryptKey: String(pick(feishu.encryptKey, "") ?? ""),
      domain: String(pick(feishu.domain, "feishu")),
      allowFrom: new Set(
        Array.isArray(feishu.allowFrom) ? feishu.allowFrom.map(String) : [],
      ),
      webhookHost: String(pick(feishu.webhookHost, "127.0.0.1")),
      webhookPort: Number.isFinite(Number(feishu.webhookPort)) ? Number(feishu.webhookPort) : 3000,
      webhookPath: String(pick(feishu.webhookPath, "/feishu/events")),
      transport: String(pick(feishu.transport, "websocket")),
    },
  };
}

/**
 * Resolve a path relative to the core package (for docs / defaults).
 */
export function coreModuleDir() {
  return fileURLToPath(new URL(".", import.meta.url));
}
