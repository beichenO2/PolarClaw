#!/usr/bin/env node
/**
 * @myclaw/core — library exports and CLI entry (`node src/index.mjs` or `myclaw-agent`).
 */

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { loadConfig } from "./config.mjs";
import { createMyClawAgent } from "./agent.mjs";
import { createChannelManager } from "./channels.mjs";

export { loadConfig } from "./config.mjs";
export { createMyClawAgent } from "./agent.mjs";
export { createChannelManager } from "./channels.mjs";

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

function isMainModule() {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(resolve(entry)).href;
  } catch {
    return false;
  }
}

async function main() {
  const configPath = parseConfigPath(process.argv);
  const config = loadConfig(configPath);
  const agent = createMyClawAgent(config);
  await agent.start();

  const shutdown = async (signal) => {
    console.error(`[@myclaw/core] ${signal} received, stopping…`);
    await agent.stop();
    process.exit(0);
  };

  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));

  console.error("[@myclaw/core] Running. Press Ctrl+C to stop.");
  console.error("[@myclaw/core] Status:", JSON.stringify(agent.getStatus(), null, 2));
}

if (isMainModule()) {
  main().catch((err) => {
    console.error("[@myclaw/core] Fatal:", err);
    process.exit(1);
  });
}
