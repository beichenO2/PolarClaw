import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import { loadSecretsFromPolarPrivate } from "../src/secrets-loader.mjs";

describe("secrets-loader", () => {
  it("returns failed=true when PolarPrivate is unreachable", async () => {
    const orig = process.env.POLARPRIVATE_URL;
    process.env.POLARPRIVATE_URL = "http://127.0.0.1:1";
    try {
      const result = await loadSecretsFromPolarPrivate({ silent: true });
      assert.equal(result.failed, true);
      assert.equal(result.loaded, 0);
    } finally {
      if (orig) process.env.POLARPRIVATE_URL = orig;
      else delete process.env.POLARPRIVATE_URL;
    }
  });

  it("returns failed=true when vault is locked", async () => {
    const server = http.createServer((req, res) => {
      if (req.url === "/health") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ vault_unlocked: false }));
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const port = server.address().port;
    const orig = process.env.POLARPRIVATE_URL;
    process.env.POLARPRIVATE_URL = `http://127.0.0.1:${port}`;
    try {
      const result = await loadSecretsFromPolarPrivate({ silent: true });
      assert.equal(result.failed, true);
    } finally {
      if (orig) process.env.POLARPRIVATE_URL = orig;
      else delete process.env.POLARPRIVATE_URL;
      server.close();
    }
  });

  it("does not overwrite existing env vars", async () => {
    const server = http.createServer((req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      if (req.url === "/health") {
        res.end(JSON.stringify({ vault_unlocked: true }));
      } else if (req.url?.startsWith("/api/projects")) {
        res.end(JSON.stringify({ items: [{ id: "test-id", name: "MyClaw" }] }));
      } else if (req.url?.startsWith("/api/secrets?")) {
        res.end(JSON.stringify({
          items: [{
            id: "s1", key: "dashscope.api_key", enabled: true, category: "llm"
          }]
        }));
      } else if (req.url?.includes("/reveal")) {
        res.end(JSON.stringify({ value: "should-not-override" }));
      } else {
        res.end("{}");
      }
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const port = server.address().port;
    const origUrl = process.env.POLARPRIVATE_URL;
    const origKey = process.env.MYCLAW_LLM_API_KEY;
    process.env.POLARPRIVATE_URL = `http://127.0.0.1:${port}`;
    process.env.MYCLAW_LLM_API_KEY = "existing-key";
    try {
      const result = await loadSecretsFromPolarPrivate({ silent: true });
      assert.equal(result.skipped, 1);
      assert.equal(process.env.MYCLAW_LLM_API_KEY, "existing-key");
    } finally {
      if (origUrl) process.env.POLARPRIVATE_URL = origUrl;
      else delete process.env.POLARPRIVATE_URL;
      if (origKey) process.env.MYCLAW_LLM_API_KEY = origKey;
      else delete process.env.MYCLAW_LLM_API_KEY;
      server.close();
    }
  });
});
