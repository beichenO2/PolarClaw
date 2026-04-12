import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { openUserDb } from "../src/db.mjs";
import { createUserManager, hashBotToken } from "../src/user-manager.mjs";
import { createGroupRouter, GROUP_CATEGORIES } from "../src/group-router.mjs";

let db;
let mgr;
let router;

beforeEach(() => {
  db = openUserDb(":memory:");
  mgr = createUserManager(db);
  router = createGroupRouter(db);
});

afterEach(() => {
  db.close();
});

describe("bootstrap", () => {
  it("creates admin and girlfriend users", () => {
    mgr.bootstrap();
    const admin = db.getUser("admin");
    assert.equal(admin.role, "admin");
    const gf = db.getUser("girlfriend");
    assert.equal(gf.role, "girlfriend");
  });

  it("is idempotent", () => {
    mgr.bootstrap();
    mgr.bootstrap();
    assert.equal(db.listUsers().length, 2);
  });
});

describe("channel binding & identity resolution", () => {
  it("resolves identity via explicit binding", () => {
    mgr.bootstrap();
    db.bindChannel({ channel: "telegram", externalId: "tg123", userId: "admin" });
    assert.equal(mgr.resolveIdentity({ channel: "telegram", externalId: "tg123" }), "admin");
  });

  it("auto-binds via bot token", () => {
    mgr.bootstrap();
    const fakeToken = "bot:admin:secret-token";
    mgr.registerBotForUser({ botToken: fakeToken, userId: "admin", channel: "telegram" });

    const resolved = mgr.resolveIdentity({
      channel: "telegram",
      externalId: "tg456",
      botToken: fakeToken,
    });
    assert.equal(resolved, "admin");

    assert.equal(
      mgr.resolveIdentity({ channel: "telegram", externalId: "tg456" }),
      "admin",
    );
  });

  it("returns null for unknown user without bot token", () => {
    mgr.bootstrap();
    assert.equal(mgr.resolveIdentity({ channel: "telegram", externalId: "unknown" }), null);
  });

  it("cross-channel: same user on telegram and feishu", () => {
    mgr.bootstrap();
    db.bindChannel({ channel: "telegram", externalId: "tg100", userId: "girlfriend" });
    db.bindChannel({ channel: "feishu", externalId: "fs200", userId: "girlfriend" });
    assert.equal(mgr.resolveIdentity({ channel: "telegram", externalId: "tg100" }), "girlfriend");
    assert.equal(mgr.resolveIdentity({ channel: "feishu", externalId: "fs200" }), "girlfriend");
  });
});

describe("role checks", () => {
  it("isAdmin / isGirlfriend", () => {
    mgr.bootstrap();
    assert.equal(mgr.isAdmin("admin"), true);
    assert.equal(mgr.isAdmin("girlfriend"), false);
    assert.equal(mgr.isGirlfriend("girlfriend"), true);
    assert.equal(mgr.isGirlfriend("admin"), false);
    assert.equal(mgr.isAdmin(null), false);
  });
});

describe("getFullProfile", () => {
  it("returns user + bindings", () => {
    mgr.bootstrap();
    db.bindChannel({ channel: "telegram", externalId: "t1", userId: "admin" });
    db.bindChannel({ channel: "cli", externalId: "local", userId: "admin" });
    const profile = mgr.getFullProfile("admin");
    assert.equal(profile.role, "admin");
    assert.equal(profile.bindings.length, 2);
  });

  it("returns null for unknown user", () => {
    assert.equal(mgr.getFullProfile("nobody"), null);
  });
});

describe("group router", () => {
  it("register and resolve category", () => {
    router.registerGroup({
      channel: "telegram",
      externalChatId: "-100123",
      category: GROUP_CATEGORIES.DIGEST,
      label: "Daily Digest",
    });
    assert.equal(router.resolveCategory("telegram", "-100123"), "digest");
  });

  it("getTargets by category", () => {
    router.registerGroup({
      channel: "telegram",
      externalChatId: "-100",
      category: "alert",
    });
    router.registerGroup({
      channel: "feishu",
      externalChatId: "oc_abc",
      category: "alert",
    });
    router.registerGroup({
      channel: "telegram",
      externalChatId: "-200",
      category: "digest",
    });
    const alertTargets = router.getTargets("alert");
    assert.equal(alertTargets.length, 2);
    const digestTargets = router.getTargets("digest");
    assert.equal(digestTargets.length, 1);
  });

  it("upsert updates category", () => {
    router.registerGroup({
      channel: "telegram",
      externalChatId: "-100",
      category: "general",
    });
    assert.equal(router.resolveCategory("telegram", "-100"), "general");
    router.registerGroup({
      channel: "telegram",
      externalChatId: "-100",
      category: "debug",
      label: "Debug chat",
    });
    assert.equal(router.resolveCategory("telegram", "-100"), "debug");
  });
});

describe("hashBotToken", () => {
  it("produces consistent short hash", () => {
    const h1 = hashBotToken("mytoken123");
    const h2 = hashBotToken("mytoken123");
    assert.equal(h1, h2);
    assert.equal(h1.length, 16);
  });
});
