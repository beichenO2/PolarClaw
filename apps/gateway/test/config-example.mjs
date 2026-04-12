import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const path = join(__dirname, "..", "config", "openclaw.coding-plan.cn.example.json");
const raw = readFileSync(path, "utf8");
const json = JSON.parse(raw);

assert.equal(json.models.providers.qwen.baseUrl, "https://coding.dashscope.aliyuncs.com/v1");
assert.equal(json.agents.defaults.model.primary, "qwen/qwen3.5-plus");
assert.ok(Array.isArray(json.agents.defaults.model.fallbacks));
