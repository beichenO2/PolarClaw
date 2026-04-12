#!/usr/bin/env node
/**
 * MyClaw — root entry: load .env, validate LLM key, print module banner, run @myclaw/core agent.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createMyClawAgent, loadConfig } from "./apps/core/src/index.mjs";
import { createHealthServer } from "./apps/core/src/health.mjs";
import { loadSecretsFromPolarPrivate } from "./apps/security/src/secrets-loader.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));

/**
 * Minimal .env parser: KEY=VALUE, # comments, no override of existing process.env keys.
 * @param {string} filePath
 */
function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return;
  const text = readFileSync(filePath, "utf8");
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (!key || key.startsWith("#")) continue;
    if (Object.prototype.hasOwnProperty.call(process.env, key)) continue;

    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
  }
}

function validateLlmKey() {
  const key =
    process.env.MYCLAW_LLM_API_KEY?.trim() ||
    process.env.DASHSCOPE_API_KEY?.trim() ||
    process.env.OPENAI_API_KEY?.trim();
  if (!key) {
    console.error(
      "[MyClaw] 缺少 LLM API key：请在 .env 或环境中设置 MYCLAW_LLM_API_KEY（或 DASHSCOPE_API_KEY / OPENAI_API_KEY）。",
    );
    process.exit(1);
  }
}

/**
 * @param {string[]} argv
 * @returns {string | undefined}
 */
function parseConfigPath(argv) {
  const args = argv.slice(2);
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === "--config" || a === "-c") {
      return args[i + 1];
    }
    if (a.startsWith("--config=")) {
      return a.slice("--config=".length);
    }
  }
  return undefined;
}

function readModuleRows() {
  const appsDir = join(ROOT, "apps");
  if (!existsSync(appsDir)) return [];
  /** @type {{ folder: string; name: string; version: string }[]} */
  const rows = [];
  for (const folder of readdirSync(appsDir).sort()) {
    const pkgPath = join(appsDir, folder, "package.json");
    if (!existsSync(pkgPath)) continue;
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
      rows.push({
        folder,
        name: typeof pkg.name === "string" ? pkg.name : folder,
        version: typeof pkg.version === "string" ? pkg.version : "—",
      });
    } catch {
      rows.push({ folder, name: folder, version: "?" });
    }
  }
  return rows;
}

function printBanner(rows) {
  const line = "═".repeat(52);
  console.error(`\n╔${line}╗`);
  console.error("║  MyClaw — workspace modules                        ║");
  console.error(`╚${line}╝`);
  console.error(`  project root: ${ROOT}\n`);
  console.error("  apps/ module status:");
  const wName = Math.max(4, ...rows.map((r) => r.name.length), 20);
  const wVer = 12;
  console.error(`    ${"module".padEnd(wName)}  ${"ver".padEnd(wVer)}  folder`);
  console.error(`    ${"-".repeat(wName)}  ${"-".repeat(wVer)}  ------`);
  for (const r of rows) {
    const ok = existsSync(join(ROOT, "apps", r.folder, "package.json")) ? "ok" : "—";
    console.error(
      `    ${r.name.padEnd(wName)}  ${r.version.padEnd(wVer)}  ${r.folder}  [${ok}]`,
    );
  }
  console.error("");
}

async function main() {
  process.chdir(ROOT);

  // 1) Try PolarPrivate first (won't overwrite already-set env vars)
  await loadSecretsFromPolarPrivate();

  // 2) .env fallback for anything PolarPrivate didn't provide
  loadEnvFile(join(ROOT, ".env"));
  validateLlmKey();

  const rows = readModuleRows();
  printBanner(rows);

  const configPath = parseConfigPath(process.argv);
  const config = loadConfig(configPath);
  const agent = createMyClawAgent(config);
  await agent.start();

  const healthPort = Number(process.env.MYCLAW_HEALTH_PORT) || 18790;
  let healthServer = null;
  try {
    healthServer = createHealthServer({ agent, port: healthPort });
    await healthServer.start();
  } catch (e) {
    console.error("[MyClaw] Health server failed (non-fatal):", e.message);
  }

  let stopping = false;
  const shutdown = async (signal) => {
    if (stopping) return;
    stopping = true;
    console.error(`[MyClaw] ${signal} received, stopping…`);
    try {
      if (healthServer) await healthServer.stop();
      await agent.stop();
    } catch (e) {
      console.error("[MyClaw] stop error:", e);
    }
    process.exit(0);
  };

  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));

  console.error("[MyClaw] Running. Press Ctrl+C to stop.");
  console.error("[MyClaw] Status:", JSON.stringify(agent.getStatus(), null, 2));
}

main().catch((err) => {
  console.error("[MyClaw] Fatal:", err);
  process.exit(1);
});
