import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { createSandboxManager } from "../apps/security/src/sandbox.mjs";
import { createGitGuardian } from "../apps/security/src/git-guardian.mjs";
import { createApiGuard } from "../apps/security/src/api-guard.mjs";
import { createInputSanitizer, securityDefaults, cspHeaders, secureCookieFlags } from "../apps/security/src/best-practices.mjs";

describe("SandboxManager", () => {
  let sandbox;
  before(() => {
    sandbox = createSandboxManager({
      allowedCommands: ["echo", "ls", "cat", "node"],
      allowedPaths: ["/tmp"],
      isolationLevel: "process",
    });
  });

  it("allows whitelisted commands", () => {
    assert.ok(sandbox.isCommandAllowed("echo hello"));
    assert.ok(sandbox.isCommandAllowed("ls -la"));
    assert.ok(sandbox.isCommandAllowed("node --version"));
  });

  it("blocks non-whitelisted commands", () => {
    assert.ok(!sandbox.isCommandAllowed("rm -rf /"));
    assert.ok(!sandbox.isCommandAllowed("sudo anything"));
    assert.ok(!sandbox.isCommandAllowed(""));
    assert.ok(!sandbox.isCommandAllowed(null));
  });

  it("validates path access", () => {
    assert.ok(sandbox.isPathAllowed("/tmp/test.txt"));
    assert.ok(sandbox.isPathAllowed("/tmp"));
    assert.ok(!sandbox.isPathAllowed("/etc/passwd"));
    assert.ok(!sandbox.isPathAllowed("/Users/secret"));
  });

  it("filters environment variables", () => {
    const env = sandbox.filterEnv({
      PATH: "/usr/bin",
      HOME: "/Users/test",
      SECRET_KEY: "sk-12345",
      RANDOM_VAR: "should_be_filtered",
    });
    assert.ok(env.PATH);
    assert.ok(env.HOME);
    assert.equal(env.SECRET_KEY, undefined);
    assert.equal(env.RANDOM_VAR, undefined);
  });

  it("executes allowed commands in sandbox", () => {
    const result = sandbox.execSandboxed("echo test-output");
    assert.ok(result.includes("test-output"));
  });

  it("throws on blocked commands", () => {
    assert.throws(() => sandbox.execSandboxed("rm -rf /"), /not allowed/);
  });

  it("throws on blocked paths", () => {
    assert.throws(
      () => sandbox.execSandboxed("echo ok", { cwd: "/etc" }),
      /not allowed/
    );
  });

  it("can dynamically add/remove commands", () => {
    sandbox.addCommand("python3");
    assert.ok(sandbox.isCommandAllowed("python3 script.py"));
    sandbox.removeCommand("python3");
    assert.ok(!sandbox.isCommandAllowed("python3 script.py"));
  });

  it("exposes configuration", () => {
    assert.equal(sandbox.isolationLevel, "process");
    assert.ok(Array.isArray(sandbox.allowedCommands));
    assert.ok(Array.isArray(sandbox.allowedPaths));
  });
});

describe("GitGuardian", () => {
  let guardian;
  before(() => {
    guardian = createGitGuardian();
  });

  it("lists all detection patterns", () => {
    const patterns = guardian.listPatterns();
    assert.ok(patterns.length >= 10, "should have at least 10 secret patterns");
    const names = patterns.map((p) => p.name);
    assert.ok(names.includes("AWS Access Key"));
    assert.ok(names.includes("GitHub Token"));
    assert.ok(names.includes("DashScope Key"));
  });

  it("scanStagedFiles returns clean for non-git dirs", () => {
    const result = guardian.scanStagedFiles("/tmp");
    assert.ok(result.clean);
  });

  it("accepts extra patterns", () => {
    const custom = createGitGuardian({
      extraPatterns: [{ name: "Custom Token", pattern: /CUSTOM_[A-Z]{10}/ }],
    });
    const patterns = custom.listPatterns();
    assert.ok(patterns.some((p) => p.name === "Custom Token"));
  });

  it("enforcePrivateRepo handles missing remote", () => {
    const result = guardian.enforcePrivateRepo("/tmp");
    assert.equal(result.isPrivate, null);
    assert.ok(result.warning);
  });
});

describe("ApiGuard", () => {
  let guard;
  before(() => {
    guard = createApiGuard({
      validTokens: ["test-token-123"],
      rateLimit: 5,
      rateLimitWindowMs: 1000,
      corsOrigins: ["https://myclaw.dev"],
    });
  });

  it("authenticates valid bearer tokens", () => {
    const result = guard.authenticate({
      headers: { authorization: "Bearer test-token-123" },
    });
    assert.ok(result.ok);
  });

  it("rejects missing bearer token", () => {
    const result = guard.authenticate({ headers: {} });
    assert.ok(!result.ok);
    assert.equal(result.status, 401);
  });

  it("rejects invalid bearer token", () => {
    const result = guard.authenticate({
      headers: { authorization: "Bearer wrong-token" },
    });
    assert.ok(!result.ok);
    assert.equal(result.status, 403);
  });

  it("enforces rate limiting", () => {
    guard.resetBuckets();
    for (let i = 0; i < 5; i++) {
      const r = guard.rateLimit("client-1");
      assert.ok(r.ok, `request ${i + 1} should be allowed`);
    }
    const exceeded = guard.rateLimit("client-1");
    assert.ok(!exceeded.ok);
    assert.equal(exceeded.status, 429);
  });

  it("rate limits per client independently", () => {
    guard.resetBuckets();
    for (let i = 0; i < 5; i++) guard.rateLimit("client-a");
    const clientB = guard.rateLimit("client-b");
    assert.ok(clientB.ok, "different client should not be rate limited");
  });

  it("validates CORS origins", () => {
    const valid = guard.corsCheck("https://myclaw.dev");
    assert.ok(valid.ok);

    const invalid = guard.corsCheck("https://evil.com");
    assert.ok(!invalid.ok);
  });

  it("generates CORS headers", () => {
    const headers = guard.corsHeaders("https://myclaw.dev");
    assert.ok(headers["Access-Control-Allow-Origin"]);
    assert.ok(headers["Access-Control-Allow-Methods"]);
  });

  it("no tokens configured = open access", () => {
    const openGuard = createApiGuard({});
    const result = openGuard.authenticate({ headers: {} });
    assert.ok(result.ok);
    assert.equal(result.reason, "no_tokens_configured");
  });

  it("can dynamically manage tokens", () => {
    guard.addToken("new-token-456");
    const r = guard.authenticate({
      headers: { authorization: "Bearer new-token-456" },
    });
    assert.ok(r.ok);
    guard.removeToken("new-token-456");
    const r2 = guard.authenticate({
      headers: { authorization: "Bearer new-token-456" },
    });
    assert.ok(!r2.ok);
  });
});

describe("InputSanitizer", () => {
  let sanitizer;
  before(() => {
    sanitizer = createInputSanitizer();
  });

  it("escapes HTML entities", () => {
    assert.equal(sanitizer.escapeHtml('<script>alert("xss")</script>'),
      '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
  });

  it("strips null bytes", () => {
    assert.equal(sanitizer.stripNullBytes("hello\0world"), "helloworld");
    assert.equal(sanitizer.stripNullBytes("\0\0\0"), "");
  });

  it("trims to length", () => {
    assert.equal(sanitizer.trimToLength("abcdef", 3), "abc");
    assert.equal(sanitizer.trimToLength("ab", 10), "ab");
  });

  it("sanitize combines all operations", () => {
    const result = sanitizer.sanitize('<img src="x" onerror="alert(1)">\0', { maxLength: 50 });
    assert.ok(!result.includes("<"));
    assert.ok(!result.includes("\0"));
  });

  it("sanitizeObject handles nested structures", () => {
    const input = {
      name: '<script>evil</script>',
      tags: ['<b>bold</b>', 'normal'],
      nested: { key: 'value\0with\0nulls' },
    };
    const result = sanitizer.sanitizeObject(input);
    assert.ok(!result.name.includes("<script>"));
    assert.ok(!result.tags[0].includes("<b>"));
    assert.ok(!result.nested.key.includes("\0"));
  });

  it("handles non-string types gracefully", () => {
    assert.equal(sanitizer.escapeHtml(null), "");
    assert.equal(sanitizer.escapeHtml(123), "");
    assert.equal(sanitizer.stripNullBytes(undefined), "");
  });

  it("sanitizeObject preserves non-string values", () => {
    const input = { count: 42, active: true, data: null };
    const result = sanitizer.sanitizeObject(input);
    assert.equal(result.count, 42);
    assert.equal(result.active, true);
    assert.equal(result.data, null);
  });
});

describe("SecurityDefaults", () => {
  it("has reasonable session config", () => {
    assert.ok(securityDefaults.minPasswordLength >= 8);
    assert.ok(securityDefaults.bcryptRounds >= 10);
    assert.ok(securityDefaults.maxBodySizeBytes > 0);
  });

  it("has CSP headers", () => {
    assert.ok(cspHeaders["Content-Security-Policy"].includes("default-src"));
    assert.equal(cspHeaders["X-Frame-Options"], "DENY");
    assert.equal(cspHeaders["X-Content-Type-Options"], "nosniff");
  });

  it("has secure cookie flags", () => {
    assert.equal(secureCookieFlags.httpOnly, true);
    assert.equal(secureCookieFlags.secure, true);
    assert.equal(secureCookieFlags.sameSite, "Lax");
  });
});
