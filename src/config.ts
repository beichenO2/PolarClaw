/**
 * MyClaw 配置加载器
 *
 * 从环境变量加载配置，支持 .env 文件。
 */

import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

export interface IProviderEntry {
  baseUrl: string;
  apiKey: string;
  models: {
    coding: string;
    research: string;
    vision: string;
    general: string;
  };
}

export interface IMyclawConfig {
  projectRoot: string;
  llm: {
    baseUrl: string;
    apiKey: string;
    models: {
      coding: string;
      research: string;
      vision: string;
      general: string;
    };
    temperature: number;
    maxTokens: number;
    maxToolRounds: number;
    /** 备用 Provider 列表 */
    fallbackProviders: IProviderEntry[];
    /** 单次 LLM 请求超时 ms */
    requestTimeoutMs: number;
  };
  memory: {
    dbPath: string;
  };
  privacy: {
    polarPrivateUrl: string;
    enableSecretInterception: boolean;
  };
  channels: {
    feishu: boolean;
    telegram: boolean;
    cli: boolean;
  };
  skills: {
    scanDirs: string[];
  };
}

/** 最简 .env 解析器 */
function loadEnvFile(filePath: string): void {
  if (!existsSync(filePath)) return;
  const text = readFileSync(filePath, 'utf8');
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (!key || Object.hasOwn(process.env, key)) continue;
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
  }
}

function env(key: string, fallback = ''): string {
  return process.env[key]?.trim() ?? fallback;
}

export function loadConfig(): IMyclawConfig {
  loadEnvFile(join(ROOT, '.env'));

  const apiKey = env('MYCLAW_LLM_API_KEY') || env('DASHSCOPE_API_KEY') || env('OPENAI_API_KEY');
  if (!apiKey) {
    throw new Error('缺少 LLM API key：请设置 MYCLAW_LLM_API_KEY 环境变量');
  }

  // 解析备用 Provider（环境变量格式：MYCLAW_FALLBACK_1_URL, MYCLAW_FALLBACK_1_KEY, ...）
  const fallbackProviders: IProviderEntry[] = [];
  for (let i = 1; i <= 5; i++) {
    const fbUrl = env(`MYCLAW_FALLBACK_${i}_URL`);
    const fbKey = env(`MYCLAW_FALLBACK_${i}_KEY`);
    if (fbUrl && fbKey) {
      fallbackProviders.push({
        baseUrl: fbUrl,
        apiKey: fbKey,
        models: {
          coding: env(`MYCLAW_FALLBACK_${i}_MODEL_CODING`, env('MYCLAW_MODEL_CODING', 'qwen3-coder-plus')),
          research: env(`MYCLAW_FALLBACK_${i}_MODEL_RESEARCH`, env('MYCLAW_MODEL_RESEARCH', 'qwen3.6-plus')),
          vision: env(`MYCLAW_FALLBACK_${i}_MODEL_VISION`, env('MYCLAW_MODEL_VISION', 'qwen3.6-plus')),
          general: env(`MYCLAW_FALLBACK_${i}_MODEL_GENERAL`, env('MYCLAW_MODEL_GENERAL', 'qwen3.6-plus')),
        },
      });
    }
  }

  return {
    projectRoot: ROOT,
    llm: {
      baseUrl: env('MYCLAW_LLM_BASE_URL', 'https://coding.dashscope.aliyuncs.com/v1'),
      apiKey,
      models: {
        coding: env('MYCLAW_MODEL_CODING', 'qwen3-coder-plus'),
        research: env('MYCLAW_MODEL_RESEARCH', 'qwen3.6-plus'),
        vision: env('MYCLAW_MODEL_VISION', 'qwen3.6-plus'),
        general: env('MYCLAW_MODEL_GENERAL', 'qwen3.6-plus'),
      },
      temperature: Number(env('MYCLAW_TEMPERATURE', '0.7')),
      maxTokens: Number(env('MYCLAW_MAX_TOKENS', '4096')),
      maxToolRounds: Number(env('MYCLAW_MAX_TOOL_ROUNDS', '10')),
      fallbackProviders,
      requestTimeoutMs: Number(env('MYCLAW_LLM_TIMEOUT_MS', '60000')),
    },
    memory: {
      dbPath: env('MYCLAW_DB_PATH', join(ROOT, '.data', 'myclaw.db')),
    },
    privacy: {
      polarPrivateUrl: env('POLARPRIVATE_URL', 'http://127.0.0.1:8787'),
      enableSecretInterception: env('MYCLAW_SECRET_INTERCEPTION', 'true') === 'true',
    },
    channels: {
      feishu: env('MYCLAW_FEISHU', '0') === '1',
      telegram: env('MYCLAW_TELEGRAM', '0') === '1',
      cli: env('MYCLAW_CLI', '0') === '1',
    },
    skills: {
      scanDirs: [join(ROOT, 'skills')],
    },
  };
}
