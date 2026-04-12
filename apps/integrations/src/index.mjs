import { createDigestAdapter } from "./digest-adapter.mjs";
import { createKnowLeverageAdapter } from "./knowleverage-adapter.mjs";
import { createLLMWikiAdapter } from "./llmwiki-adapter.mjs";
import { createAutoOfficeAdapter } from "./autooffice-adapter.mjs";
import { createMemPalaceAdapter } from "./mempalace-adapter.mjs";
import { createOpenSpaceAdapter } from "./openspace-adapter.mjs";
import { createCryptoToolsSuite } from "./crypto-tools.mjs";
import { createMcpBridge } from "./mcp-bridge.mjs";
import { createCliAnything } from "./cli-anything.mjs";

export {
  createDigestAdapter,
  createKnowLeverageAdapter,
  createLLMWikiAdapter,
  createAutoOfficeAdapter,
  createMemPalaceAdapter,
  createOpenSpaceAdapter,
  createCryptoToolsSuite,
  createMcpBridge,
  createCliAnything,
};

/**
 * Create all integration adapters and check availability.
 * @returns {Record<string, { adapter: object, available: boolean }>}
 */
export function createAllAdapters(overrides = {}) {
  const digest = createDigestAdapter(overrides.digest);
  const knowleverage = createKnowLeverageAdapter(overrides.knowleverage);
  const llmwiki = createLLMWikiAdapter(overrides.llmwiki);
  const autooffice = createAutoOfficeAdapter(overrides.autooffice);

  return {
    digest: { adapter: digest, available: digest.isAvailable() },
    knowleverage: { adapter: knowleverage, available: knowleverage.isAvailable() },
    llmwiki: { adapter: llmwiki, available: llmwiki.isAvailable() },
    autooffice: { adapter: autooffice, available: autooffice.isAvailable() },
  };
}
