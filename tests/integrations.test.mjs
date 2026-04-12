import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createDigestAdapter,
  createKnowLeverageAdapter,
  createLLMWikiAdapter,
  createAutoOfficeAdapter,
  createAllAdapters,
} from "../apps/integrations/src/index.mjs";

describe("DigestAdapter", () => {
  it("creates adapter with default config", () => {
    const adapter = createDigestAdapter();
    assert.ok(adapter.crawl);
    assert.ok(adapter.preprocess);
    assert.ok(adapter.listPlatforms);
    assert.equal(typeof adapter.isAvailable(), "boolean");
  });

  it("returns error for missing project", () => {
    const adapter = createDigestAdapter({ digestDir: "/nonexistent" });
    assert.equal(adapter.isAvailable(), false);
  });

  it("crawl returns error when project unavailable", async () => {
    const adapter = createDigestAdapter({ digestDir: "/nonexistent" });
    const result = await adapter.crawl({ url: "https://example.com" });
    assert.equal(result.ok, false);
    assert.ok(result.error);
  });

  it("preprocess requires filePath", async () => {
    const adapter = createDigestAdapter({ digestDir: "/nonexistent" });
    const result = await adapter.preprocess({ filePath: "/no/such/file.pdf" });
    assert.equal(result.ok, false);
  });
});

describe("KnowLeverageAdapter", () => {
  it("creates adapter", () => {
    const adapter = createKnowLeverageAdapter();
    assert.ok(adapter.ingestDocument);
    assert.ok(adapter.buildContext);
    assert.ok(adapter.distillSkill);
  });

  it("buildContext validates input", async () => {
    const adapter = createKnowLeverageAdapter({ projectDir: "/nonexistent" });
    const result = await adapter.buildContext({ query: "" });
    assert.equal(result.ok, false);
  });

  it("ingestDocument validates input", async () => {
    const adapter = createKnowLeverageAdapter({ projectDir: "/nonexistent" });
    const result = await adapter.ingestDocument({ text: "", docId: "" });
    assert.equal(result.ok, false);
  });
});

describe("LLMWikiAdapter", () => {
  it("creates adapter", () => {
    const adapter = createLLMWikiAdapter();
    assert.ok(adapter.createPage);
    assert.ok(adapter.buildSite);
    assert.ok(adapter.generateMermaidGraph);
  });

  it("generates valid Mermaid graph", () => {
    const adapter = createLLMWikiAdapter();
    const graph = adapter.generateMermaidGraph({
      rootTitle: "MyClaw Architecture",
      children: [
        { title: "Core", children: ["Agent", "Config"] },
        { title: "Memory", children: ["Store", "Search"] },
        { title: "Security" },
      ],
    });
    assert.ok(graph.includes("graph TD"));
    assert.ok(graph.includes("MyClaw Architecture"));
    assert.ok(graph.includes("Core"));
    assert.ok(graph.includes("Agent"));
  });

  it("createPage validates input", async () => {
    const adapter = createLLMWikiAdapter({ projectDir: "/nonexistent" });
    const result = await adapter.createPage({
      slug: "test", title: "Test", content: "Hello",
    });
    assert.equal(result.ok, false);
  });
});

describe("AutoOfficeAdapter", () => {
  it("creates adapter with supported formats", () => {
    const adapter = createAutoOfficeAdapter();
    assert.ok(adapter.supportedFormats.includes("pptx"));
    assert.ok(adapter.supportedFormats.includes("pdf"));
    assert.ok(adapter.supportedFormats.includes("docx"));
    assert.ok(adapter.supportedFormats.includes("latex"));
  });

  it("rejects unsupported format", async () => {
    const adapter = createAutoOfficeAdapter({ projectDir: "/nonexistent" });
    const result = await adapter.generateReport({
      title: "Test", content: "Hello", format: "xlsx",
    });
    assert.equal(result.ok, false);
    assert.ok(result.error.includes("Unsupported format"));
  });
});

describe("createAllAdapters", () => {
  it("returns all four adapters with availability", () => {
    const all = createAllAdapters();
    assert.ok(all.digest);
    assert.ok(all.knowleverage);
    assert.ok(all.llmwiki);
    assert.ok(all.autooffice);
    assert.equal(typeof all.digest.available, "boolean");
  });
});
