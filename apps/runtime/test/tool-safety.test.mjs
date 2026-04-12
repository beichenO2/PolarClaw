import { test } from "node:test";
import assert from "node:assert/strict";
import { assertToolArgsSafe } from "../src/tool-safety.mjs";

test("assertToolArgsSafe: allows normal content", () => {
  assertToolArgsSafe("memory_save", { content: "hello world" });
});

test("assertToolArgsSafe: blocks PEM", () => {
  assert.throws(
    () =>
      assertToolArgsSafe("memory_save", {
        content: "-----BEGIN RSA PRIVATE KEY-----\nabc",
      }),
    /blocked/,
  );
});

test("createToolExecutor beforeExecute: assertToolArgsSafe", async () => {
  const { createToolExecutor } = await import("../src/tool-executor.mjs");
  const tools = createToolExecutor({
    beforeExecute: assertToolArgsSafe,
  });
  tools.register({
    name: "echo",
    description: "e",
    parameters: { type: "object", properties: { x: { type: "string" } } },
    handler: (a) => a,
  });
  await assert.rejects(() => tools.execute("echo", { x: "ghp_123456789012345678901234567890123456" }), /blocked/);
});
