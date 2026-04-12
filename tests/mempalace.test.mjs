import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createMemPalaceAdapter } from "../apps/integrations/src/mempalace-adapter.mjs";

describe("MemPalaceAdapter", () => {
  it("creates adapter with default config", () => {
    const adapter = createMemPalaceAdapter();
    assert.ok(adapter.store);
    assert.ok(adapter.search);
    assert.ok(adapter.writeDiary);
    assert.ok(adapter.getStatus);
    assert.ok(adapter.getMcpServerCommand);
  });

  it("detects mempalace installation", () => {
    const adapter = createMemPalaceAdapter();
    const installed = adapter.isInstalled();
    assert.equal(typeof installed, "boolean");
    assert.ok(installed, "mempalace should be installed");
  });

  it("returns MCP server command", () => {
    const adapter = createMemPalaceAdapter();
    const cmd = adapter.getMcpServerCommand();
    assert.ok(cmd.includes("mempalace"));
    assert.ok(cmd.includes("mcp_server"));
  });

  it("returns status object", () => {
    const adapter = createMemPalaceAdapter();
    const status = adapter.getStatus();
    assert.equal(typeof status.installed, "boolean");
    assert.equal(typeof status.initialized, "boolean");
    assert.ok(status.palaceDir);
    assert.ok(status.mcpCommand);
  });

  it("validates input for store", async () => {
    const adapter = createMemPalaceAdapter({ palaceDir: "/tmp/test-palace" });
    const result = await adapter.store({ content: "" });
    assert.equal(result.ok, false);
    assert.ok(result.error);
  });

  it("validates input for search", async () => {
    const adapter = createMemPalaceAdapter({ palaceDir: "/tmp/test-palace" });
    const result = await adapter.search({ query: "" });
    assert.equal(result.ok, false);
  });

  it("validates input for diary", async () => {
    const adapter = createMemPalaceAdapter({ palaceDir: "/tmp/test-palace" });
    const result = await adapter.writeDiary({ entry: "" });
    assert.equal(result.ok, false);
  });
});
