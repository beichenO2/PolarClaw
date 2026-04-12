import assert from "node:assert/strict";
import test from "node:test";
import {
  createRouter,
  inferIntentFromMessages,
  inferIntentFromText,
  selectModelForIntent,
} from "../src/index.mjs";

test("inferIntentFromText: coding", () => {
  assert.equal(inferIntentFromText("Refactor this TypeScript function"), "coding");
  assert.equal(inferIntentFromText("修复这个 bug"), "coding");
});

test("inferIntentFromText: research", () => {
  assert.equal(inferIntentFromText("Summarize this arxiv paper"), "research");
  assert.equal(inferIntentFromText("对比两篇文献的方法"), "research");
});

test("inferIntentFromText: vision wins over coding keywords", () => {
  assert.equal(inferIntentFromText("Describe this screenshot.png"), "vision");
});

test("inferIntentFromText: general", () => {
  assert.equal(inferIntentFromText("Hello, how are you?"), "general");
});

test("inferIntentFromMessages: image parts force vision", () => {
  const intent = inferIntentFromMessages([
    {
      role: "user",
      content: [
        { type: "text", text: "What is in this file?" },
        { type: "image_url", image_url: { url: "https://example.com/1.png" } },
      ],
    },
  ]);
  assert.equal(intent, "vision");
});

test("inferIntentFromMessages uses last user turn by default", () => {
  const intent = inferIntentFromMessages([
    { role: "user", content: "debug this" },
    { role: "assistant", content: "ok" },
    { role: "user", content: "Now summarize the paper" },
  ]);
  assert.equal(intent, "research");
});

test("selectModelForIntent uses REQ-012 defaults", () => {
  assert.match(selectModelForIntent("coding"), /coder/i);
  assert.match(selectModelForIntent("research"), /qwen3\.5-plus/);
  assert.match(selectModelForIntent("vision"), /vl/i);
});

test("createRouter.resolveModelForMessages", () => {
  const r = createRouter();
  const { intent, model } = r.resolveModelForMessages([
    { role: "user", content: "Implement a binary search in Python" },
  ]);
  assert.equal(intent, "coding");
  assert.equal(model, r.modelForIntent("coding"));
});

test("createRouter accepts model overrides", () => {
  const r = createRouter({
    models: { coding: "qwen/qwen3-coder-plus" },
  });
  assert.equal(r.modelForIntent("coding"), "qwen/qwen3-coder-plus");
});
