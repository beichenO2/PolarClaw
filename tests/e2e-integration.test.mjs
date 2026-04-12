/**
 * Phase 12: End-to-End Integration Test
 * Scenario: Bitcoin quantitative trading research
 * Verifies all modules work together as a complete system.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { inferIntentFromText, createRouter } from "../apps/llm/src/router.mjs";
import { createSandboxManager } from "../apps/security/src/sandbox.mjs";
import { createApiGuard } from "../apps/security/src/api-guard.mjs";
import { ResearchPipeline, createMultiSearch } from "../apps/research/src/index.mjs";
import { createDigestAdapter, createLLMWikiAdapter, createAutoOfficeAdapter, createCryptoToolsSuite, createMcpBridge, createCliAnything } from "../apps/integrations/src/index.mjs";

describe("E2E: Bitcoin Quantitative Trading Research", () => {
  it("routes crypto-related queries to correct intent", () => {
    assert.equal(inferIntentFromText("research Bitcoin trading strategies"), "research");
    assert.equal(inferIntentFromText("analyze BTC price chart image"), "vision");
    assert.equal(inferIntentFromText("implement a trading bot in Python"), "coding");
  });

  it("LLM router resolves models for crypto research", () => {
    const router = createRouter();
    const { intent, model } = router.resolveModelForMessages([
      { role: "user", content: "研究比特币量化交易策略" },
    ]);
    assert.equal(intent, "research");
    assert.ok(model, "should resolve a model for research intent");
  });

  it("security sandbox allows safe crypto commands", () => {
    const sandbox = createSandboxManager({ isolationLevel: "process" });
    assert.ok(sandbox.isCommandAllowed("node --version"));
    assert.ok(sandbox.isCommandAllowed("echo hello"));
    assert.ok(!sandbox.isCommandAllowed("rm -rf /"));
  });

  it("API guard protects trading endpoints", () => {
    const guard = createApiGuard({
      validTokens: ["trading-api-key-123"],
      rateLimit: 10,
    });
    const valid = guard.authenticate({
      headers: { authorization: "Bearer trading-api-key-123" },
    });
    assert.ok(valid.ok);

    const invalid = guard.authenticate({ headers: {} });
    assert.ok(!invalid.ok);
  });

  it("research pipeline handles crypto topics", async () => {
    const pipeline = new ResearchPipeline({
      search: async (q) => [
        { title: "BTC Analysis", snippet: `Analysis of ${q}: price trends show...`, source: "mock" },
        { title: "Trading Strategy", snippet: "Quantitative approaches to crypto trading", source: "mock" },
      ],
    });
    const report = await pipeline.run({
      query: "Bitcoin quantitative trading strategies for 2026",
    });
    assert.ok(report.topic.includes("Bitcoin"));
    assert.ok(report.sections.length > 0);
    assert.ok(report.executiveSummary.length > 0);
  });

  it("multi-search aggregates crypto data from multiple sources", async () => {
    const multiSearch = createMultiSearch({
      sources: [
        { name: "crypto-news", search: async (q) => [{ title: "BTC Flash", snippet: `Breaking: ${q}`, source: "crypto-news" }] },
        { name: "academic", search: async (q) => [{ title: "Research Paper", snippet: `Study on ${q}`, source: "academic" }] },
      ],
    });
    const results = await multiSearch.search("bitcoin trading");
    assert.equal(results.length, 2);
    assert.ok(results.some(r => r.source === "crypto-news"));
    assert.ok(results.some(r => r.source === "academic"));
  });

  it("crypto tools suite initializes correctly", () => {
    const suite = createCryptoToolsSuite();
    const status = suite.getStatus();
    assert.ok(status.sources);
    assert.ok(status.sources.coinmarketcap);
    assert.ok(status.sources.dune);
    assert.ok(status.sources.blockbeats);
    assert.ok(status.sources.coinank);
  });

  it("digest adapter is available for data collection", () => {
    const adapter = createDigestAdapter();
    assert.ok(adapter.crawl);
    assert.ok(adapter.preprocess);
  });

  it("llmwiki adapter generates mermaid visualization", () => {
    const wiki = createLLMWikiAdapter();
    const graph = wiki.generateMermaidGraph({
      rootTitle: "BTC Trading System",
      children: [
        { title: "Data Input", children: ["Market Data", "On-chain Data", "News"] },
        { title: "Strategy", children: ["Mean Reversion", "Momentum", "Arbitrage"] },
        { title: "Execution", children: ["Order Management", "Risk Control"] },
      ],
    });
    assert.ok(graph.includes("graph TD"));
    assert.ok(graph.includes("BTC Trading System"));
    assert.ok(graph.includes("Mean Reversion"));
    assert.ok(graph.includes("Risk Control"));
  });

  it("autooffice adapter reports format support", () => {
    const office = createAutoOfficeAdapter();
    assert.ok(office.supportedFormats.includes("pdf"));
    assert.ok(office.supportedFormats.includes("pptx"));
  });

  it("MCP bridge registers OpenTwitter source", () => {
    const bridge = createMcpBridge();
    const result = bridge.registerOpenTwitter();
    assert.ok(result.ok);
    const servers = bridge.listServers();
    assert.ok(servers.opentwitter);
  });

  it("CLI Anything checks network status", () => {
    const cli = createCliAnything();
    const network = cli.checkNetwork();
    assert.ok(typeof network.ok === "boolean");
    assert.ok(network.network === "online" || network.network === "offline");
  });

  it("full workflow: intent → route → research → visualize", async () => {
    const router = createRouter();
    const query = "Compare Bitcoin and Ethereum trading volume trends";

    const { intent, model } = router.resolveModelForMessages([
      { role: "user", content: query },
    ]);
    assert.equal(intent, "research");

    const pipeline = new ResearchPipeline({
      search: async (q) => [
        { title: "BTC Volume", snippet: "Bitcoin 24h volume: $32B", source: "mock" },
        { title: "ETH Volume", snippet: "Ethereum 24h volume: $18B", source: "mock" },
      ],
    });
    const report = await pipeline.run({ query });
    assert.ok(report.sections.length > 0);

    const wiki = createLLMWikiAdapter();
    const graph = wiki.generateMermaidGraph({
      rootTitle: report.topic.slice(0, 40),
      children: report.sections.map(s => ({
        title: s.heading.slice(0, 30),
        children: ["Data Point 1", "Data Point 2"],
      })),
    });
    assert.ok(graph.includes("graph TD"));

    assert.ok(model, "model should be resolved for research");
    assert.ok(report.executiveSummary, "report should have summary");
    assert.ok(graph.length > 50, "mermaid graph should be substantial");
  });
});
