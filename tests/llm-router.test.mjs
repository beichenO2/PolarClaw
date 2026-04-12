import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  inferIntentFromText,
  inferIntentFromMessages,
  selectModelForIntent,
  createRouter,
} from "../apps/llm/src/router.mjs";

describe("inferIntentFromText", () => {
  it("detects coding intent", () => {
    assert.equal(inferIntentFromText("refactor this function"), "coding");
    assert.equal(inferIntentFromText("debug the API endpoint"), "coding");
    assert.equal(inferIntentFromText("implement a new class"), "coding");
    assert.equal(inferIntentFromText("重构这个代码"), "coding");
    assert.equal(inferIntentFromText("fix the bug in test"), "coding");
  });

  it("detects research intent", () => {
    assert.equal(inferIntentFromText("research quantum computing"), "research");
    assert.equal(inferIntentFromText("summarize this paper"), "research");
    assert.equal(inferIntentFromText("analyze the literature"), "research");
    assert.equal(inferIntentFromText("写一篇研究综述"), "research");
  });

  it("detects vision intent", () => {
    assert.equal(inferIntentFromText("analyze this screenshot"), "vision");
    assert.equal(inferIntentFromText("describe the image"), "vision");
    assert.equal(inferIntentFromText("看这个图片"), "vision");
  });

  it("defaults to general for ambiguous text", () => {
    assert.equal(inferIntentFromText("hello world"), "general");
    assert.equal(inferIntentFromText("what is the weather today"), "general");
    assert.equal(inferIntentFromText(""), "general");
  });

  it("vision takes priority over coding", () => {
    assert.equal(inferIntentFromText("debug this screenshot of code"), "vision");
  });
});

describe("inferIntentFromMessages", () => {
  it("uses last user message by default", () => {
    const messages = [
      { role: "user", content: "研究量子计算" },
      { role: "assistant", content: "好的..." },
      { role: "user", content: "refactor the function" },
    ];
    assert.equal(inferIntentFromMessages(messages), "coding");
  });

  it("detects vision from image parts", () => {
    const messages = [
      {
        role: "user",
        content: [
          { type: "text", text: "what is this?" },
          { type: "image_url", image_url: { url: "data:image/png;base64,..." } },
        ],
      },
    ];
    assert.equal(inferIntentFromMessages(messages), "vision");
  });

  it("handles empty messages array", () => {
    assert.equal(inferIntentFromMessages([]), "general");
    assert.equal(inferIntentFromMessages(null), "general");
  });

  it("falls back to combined text when lastUserOnly is false", () => {
    const messages = [
      { role: "user", content: "research the topic" },
      { role: "assistant", content: "Here is my analysis" },
    ];
    assert.equal(
      inferIntentFromMessages(messages, { lastUserOnly: false }),
      "research"
    );
  });
});

describe("selectModelForIntent", () => {
  it("returns default model for each intent", () => {
    const coding = selectModelForIntent("coding");
    const research = selectModelForIntent("research");
    const general = selectModelForIntent("general");
    assert.ok(coding);
    assert.ok(research);
    assert.ok(general);
  });

  it("applies overrides", () => {
    const model = selectModelForIntent("coding", {
      coding: "custom-code-model",
    });
    assert.equal(model, "custom-code-model");
  });

  it("falls back to general for unknown intents", () => {
    const model = selectModelForIntent("nonexistent");
    assert.ok(model);
  });
});

describe("createRouter", () => {
  it("creates router with default models", () => {
    const router = createRouter();
    assert.ok(router.models);
    assert.ok(router.models.coding);
    assert.ok(router.models.general);
  });

  it("resolves model for messages", () => {
    const router = createRouter();
    const result = router.resolveModelForMessages([
      { role: "user", content: "debug this code" },
    ]);
    assert.equal(result.intent, "coding");
    assert.ok(result.model);
  });

  it("allows custom model overrides", () => {
    const router = createRouter({
      models: { coding: "my-custom-model" },
    });
    const result = router.resolveModelForMessages([
      { role: "user", content: "refactor the function" },
    ]);
    assert.equal(result.model, "my-custom-model");
  });

  it("exposes intent helpers", () => {
    const router = createRouter();
    assert.equal(router.intentFromText("research AI"), "research");
    assert.equal(
      router.intentFromMessages([{ role: "user", content: "fix the bug" }]),
      "coding"
    );
  });
});
