import { test } from "node:test";
import assert from "node:assert/strict";
import { getLobsterRuntimeBlock } from "../src/lobster-runtime-block.mjs";

test("getLobsterRuntimeBlock includes safety, memory, planning", () => {
  const b = getLobsterRuntimeBlock();
  assert.ok(b.includes("安全"));
  assert.ok(b.includes("长期记忆"));
  assert.ok(b.includes("柔性规划"));
  assert.ok(b.includes("flexible_plan"));
});
