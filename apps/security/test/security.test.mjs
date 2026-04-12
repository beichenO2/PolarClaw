import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createSandboxManager } from "../src/sandbox.mjs";
import { createGitGuardian } from "../src/git-guardian.mjs";
import { createApiGuard } from "../src/api-guard.mjs";
import { createInputSanitizer, cspHeaders, secureCookieFlags } from "../src/best-practices.mjs";

describe("SandboxManager", () => {
  let sandbox;
  beforeEach(() => {
    sandbox = createSandboxManager({ allowedPaths: ["/tmp"] });
  });

  it("allows whitelisted commands", () => {
    assert.ok(sandbox.isCommandAllowed("node --version"));
    assert.ok(sandbox.isCommandAllowed("git status"));
    assert.ok(sandbox.isCommandAllowed("npm install"));
  });

  it("blocks non-whitelisted commands", () => {
    assert.ok(!sandbox.isCommandAllowed("rm -rf /"));
    assert.ok(!sandbox.isCommandAllowed("sudo reboot"));
    assert.ok(!sandbox.isCommandAllowed(""));
  });

  it("validates path access", () => {
    assert.ok(sandbox.isPathAllowed("/tmp/test"));
    assert.ok(!sandbox.isPathAllowed("/etc/passwd"));
  });

  it("filters environment variables", () => {
    const filtered = sandbox.filterEnv({ PATH: "/usr/bin", SECRET_KEY: "abc", HOME: "/home/u" });
    assert.ok("PATH" in filtered);
    assert.ok("HOME" in filtered);
    assert.ok(!("SECRET_KEY" in filtered));
  });

  it("execSandboxed blocks forbidden commands", () => {
    assert.throws(() => sandbox.execSandboxed("rm -rf /"), /not allowed/);
  });

  it("dynamically adds/removes commands", () => {
    sandbox.addCommand("python");
    assert.ok(sandbox.isCommandAllowed("python script.py"));
    sandbox.removeCommand("python");
    assert.ok(!sandbox.isCommandAllowed("python script.py"));
  });
});

describe("GitGuardian", () => {
  let guardian;
  beforeEach(() => {
    guardian = createGitGuardian();
  });

  it("lists built-in patterns", () => {
    const patterns = guardian.listPatterns();
    assert.ok(patterns.length >= 8);
    assert.ok(patterns.some((p) => p.name === "AWS Access Key"));
    assert.ok(patterns.some((p) => p.name === "DashScope Key"));
  });

  it("scanStagedFiles returns clean when no git repo", () => {
    const result = guardian.scanStagedFiles("/nonexistent/path");
    assert.ok(result.clean);
  });

  it("enforcePrivateRepo handles missing remote", () => {
    const result = guardian.enforcePrivateRepo("/tmp");
    assert.ok(result.warning !== null);
  });
});

describe("ApiGuard", () => {
  let guard;
  beforeEach(() => {
    guard = createApiGuard({ validTokens: ["test-token-123"], rateLimit: 3, rateLimitWindowMs: 1000 });
  });

  it("authenticates valid bearer token", () => {
    const result = guard.authenticate({ headers: { authorization: "Bearer test-token-123" } });
    assert.ok(result.ok);
  });

  it("rejects missing token", () => {
    const result = guard.authenticate({ headers: {} });
    assert.equal(result.ok, false);
    assert.equal(result.status, 401);
  });

  it("rejects invalid token", () => {
    const result = guard.authenticate({ headers: { authorization: "Bearer wrong" } });
    assert.equal(result.ok, false);
    assert.equal(result.status, 403);
  });

  it("enforces rate limiting", () => {
    guard.rateLimit("client-a");
    guard.rateLimit("client-a");
    guard.rateLimit("client-a");
    const fourth = guard.rateLimit("client-a");
    assert.equal(fourth.ok, false);
    assert.equal(fourth.status, 429);
  });

  it("rate limit is per-client", () => {
    guard.rateLimit("client-a");
    guard.rateLimit("client-a");
    guard.rateLimit("client-a");
    const bFirst = guard.rateLimit("client-b");
    assert.ok(bFirst.ok);
  });

  it("validates CORS origins", () => {
    const specific = createApiGuard({ corsOrigins: ["https://example.com"] });
    assert.ok(specific.corsCheck("https://example.com").ok);
    assert.ok(!specific.corsCheck("https://evil.com").ok);
  });
});

describe("BestPractices", () => {
  it("CSP headers have required directives", () => {
    const csp = cspHeaders["Content-Security-Policy"];
    assert.ok(csp.includes("default-src 'self'"));
    assert.ok(csp.includes("frame-ancestors 'none'"));
  });

  it("cookie flags are secure", () => {
    assert.ok(secureCookieFlags.httpOnly);
    assert.ok(secureCookieFlags.secure);
    assert.equal(secureCookieFlags.sameSite, "Lax");
  });

  it("InputSanitizer escapes HTML", () => {
    const san = createInputSanitizer();
    assert.equal(san.escapeHtml('<script>alert("xss")</script>'), '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
  });

  it("InputSanitizer strips null bytes", () => {
    const san = createInputSanitizer();
    assert.equal(san.stripNullBytes("hello\0world"), "helloworld");
  });

  it("sanitizeObject handles nested structures", () => {
    const san = createInputSanitizer();
    const result = san.sanitizeObject({ name: "<b>test</b>", items: ["<i>a</i>"] });
    assert.equal(result.name, "&lt;b&gt;test&lt;/b&gt;");
    assert.equal(result.items[0], "&lt;i&gt;a&lt;/i&gt;");
  });
});
