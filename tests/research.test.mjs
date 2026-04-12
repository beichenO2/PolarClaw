import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ResearchPipeline,
  coordinateTopic,
  defaultPlan,
  gatherEvidence,
  synthesizeReport,
  createMultiSearch,
  createWikipediaSearch,
  createArxivSearch,
} from "../apps/research/src/index.mjs";

describe("coordinateTopic", () => {
  it("normalizes topic input", () => {
    const t = coordinateTopic({ query: "  quantum computing  " });
    assert.equal(t.query, "quantum computing");
  });

  it("preserves optional title", () => {
    const t = coordinateTopic({ query: "test", title: "My Research" });
    assert.equal(t.title, "My Research");
  });

  it("drops empty title", () => {
    const t = coordinateTopic({ query: "test", title: "  " });
    assert.equal(t.title, undefined);
  });
});

describe("defaultPlan", () => {
  it("generates sub-questions from topic", async () => {
    const plan = await defaultPlan({ query: "How does quantum computing work? What are its applications?" });
    assert.ok(plan.subQuestions.length >= 2);
    assert.ok(plan.subQuestions[0].id.startsWith("sq-"));
  });

  it("handles single sentence", async () => {
    const plan = await defaultPlan({ query: "Bitcoin price prediction" });
    assert.ok(plan.subQuestions.length >= 1);
  });
});

describe("gatherEvidence", () => {
  it("collects evidence from mock search", async () => {
    const mockSearch = async (q) => [
      { title: "Result 1", snippet: `Info about ${q}`, url: "https://example.com" },
    ];
    const plan = { subQuestions: [{ id: "sq-1", question: "test query" }] };
    const evidence = await gatherEvidence(plan, mockSearch);
    assert.equal(evidence.length, 1);
    assert.equal(evidence[0].subQuestionId, "sq-1");
    assert.ok(evidence[0].hits.length > 0);
  });
});

describe("synthesizeReport", () => {
  it("creates structured report", () => {
    const topic = { query: "AI memory systems" };
    const plan = { subQuestions: [{ id: "sq-1", question: "What are AI memory systems?" }] };
    const evidence = [{ subQuestionId: "sq-1", hits: [{ title: "MemPalace", snippet: "A memory system for agents" }] }];
    const report = synthesizeReport(topic, plan, evidence);
    assert.equal(report.topic, "AI memory systems");
    assert.ok(report.sections.length >= 1);
    assert.ok(report.executiveSummary);
    assert.ok(report.sections[0].body.includes("memory system"));
  });
});

describe("ResearchPipeline", () => {
  it("runs full pipeline with mock search", async () => {
    const pipeline = new ResearchPipeline({
      search: async (q) => [
        { title: "Source", snippet: `Data about ${q}`, url: "https://test.com" },
      ],
    });
    const report = await pipeline.run({ query: "How do neural networks learn?" });
    assert.ok(report.topic);
    assert.ok(report.plan.subQuestions.length > 0);
    assert.ok(report.evidence.length > 0);
    assert.ok(report.sections.length > 0);
    assert.ok(report.executiveSummary);
  });

  it("rejects empty query", async () => {
    const pipeline = new ResearchPipeline({ search: async () => [] });
    await assert.rejects(() => pipeline.run({ query: "" }), /empty topic/);
  });
});

describe("createMultiSearch", () => {
  it("creates multi-search with default sources", () => {
    const ms = createMultiSearch();
    const sources = ms.listSources();
    assert.ok(sources.includes("wikipedia"));
    assert.ok(sources.includes("arxiv"));
  });

  it("allows adding custom sources", () => {
    const ms = createMultiSearch({ sources: [] });
    ms.addSource("custom", async () => [{ title: "Custom", snippet: "result" }]);
    assert.ok(ms.listSources().includes("custom"));
  });

  it("searches with mock sources", async () => {
    const ms = createMultiSearch({
      sources: [
        { name: "mock1", search: async (q) => [{ title: "M1", snippet: q, source: "mock1" }] },
        { name: "mock2", search: async (q) => [{ title: "M2", snippet: q, source: "mock2" }] },
      ],
    });
    const results = await ms.search("test query");
    assert.equal(results.length, 2);
    assert.ok(results.some(r => r.source === "mock1"));
    assert.ok(results.some(r => r.source === "mock2"));
  });

  it("handles failing sources gracefully", async () => {
    const ms = createMultiSearch({
      sources: [
        { name: "good", search: async () => [{ title: "OK", snippet: "works" }] },
        { name: "bad", search: async () => { throw new Error("network error"); } },
      ],
    });
    const results = await ms.search("test");
    assert.equal(results.length, 1);
    assert.equal(results[0].title, "OK");
  });
});

describe("createWikipediaSearch", () => {
  it("creates search function", () => {
    const search = createWikipediaSearch("en");
    assert.equal(typeof search, "function");
  });

  it("returns empty for empty query", async () => {
    const search = createWikipediaSearch();
    const results = await search("");
    assert.equal(results.length, 0);
  });
});

describe("createArxivSearch", () => {
  it("creates search function", () => {
    const search = createArxivSearch();
    assert.equal(typeof search, "function");
  });

  it("returns empty for empty query", async () => {
    const search = createArxivSearch();
    const results = await search("");
    assert.equal(results.length, 0);
  });
});
