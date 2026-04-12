import assert from "node:assert/strict";
import test from "node:test";
import { loadFeishuConfig } from "../src/config.mjs";

test("loadFeishuConfig throws when FEISHU_APP_ID missing", () => {
  assert.throws(
    () =>
      loadFeishuConfig({
        FEISHU_APP_SECRET: "s",
        FEISHU_VERIFICATION_TOKEN: "t",
      }),
    /FEISHU_APP_ID is required/,
  );
});

test("loadFeishuConfig throws when FEISHU_APP_SECRET missing", () => {
  assert.throws(
    () =>
      loadFeishuConfig({
        FEISHU_APP_ID: "id",
        FEISHU_VERIFICATION_TOKEN: "t",
      }),
    /FEISHU_APP_SECRET is required/,
  );
});

test("loadFeishuConfig throws when FEISHU_VERIFICATION_TOKEN missing", () => {
  assert.throws(
    () =>
      loadFeishuConfig({
        FEISHU_APP_ID: "id",
        FEISHU_APP_SECRET: "secret",
      }),
    /FEISHU_VERIFICATION_TOKEN is required/,
  );
});

test("loadFeishuConfig throws on invalid FEISHU_DOMAIN", () => {
  assert.throws(
    () =>
      loadFeishuConfig({
        FEISHU_APP_ID: "id",
        FEISHU_APP_SECRET: "secret",
        FEISHU_VERIFICATION_TOKEN: "tok",
        FEISHU_DOMAIN: "invalid",
      }),
    /FEISHU_DOMAIN/,
  );
});

test("loadFeishuConfig throws on bad FEISHU_WEBHOOK_PORT", () => {
  assert.throws(
    () =>
      loadFeishuConfig({
        FEISHU_APP_ID: "id",
        FEISHU_APP_SECRET: "secret",
        FEISHU_VERIFICATION_TOKEN: "tok",
        FEISHU_WEBHOOK_PORT: "99999",
      }),
    /FEISHU_WEBHOOK_PORT/,
  );
});

test("loadFeishuConfig throws when FEISHU_WEBHOOK_PATH has no leading slash", () => {
  assert.throws(
    () =>
      loadFeishuConfig({
        FEISHU_APP_ID: "id",
        FEISHU_APP_SECRET: "secret",
        FEISHU_VERIFICATION_TOKEN: "tok",
        FEISHU_WEBHOOK_PATH: "bad",
      }),
    /FEISHU_WEBHOOK_PATH/,
  );
});

test("loadFeishuConfig returns validated object with defaults", () => {
  const c = loadFeishuConfig({
    FEISHU_APP_ID: " cli_id ",
    FEISHU_APP_SECRET: " sec ",
    FEISHU_VERIFICATION_TOKEN: " vt ",
    FEISHU_ENCRYPT_KEY: "",
    FEISHU_ALLOW_FROM: " u1 , u2 ",
  });
  assert.equal(c.appId, "cli_id");
  assert.equal(c.appSecret, "sec");
  assert.equal(c.verificationToken, "vt");
  assert.equal(c.encryptKey, "");
  assert.equal(c.domain, "feishu");
  assert.deepEqual([...c.allowFrom], ["u1", "u2"]);
  assert.equal(c.webhookHost, "127.0.0.1");
  assert.equal(c.webhookPort, 3000);
  assert.equal(c.webhookPath, "/feishu/events");
});

test("loadFeishuConfig accepts lark domain", () => {
  const c = loadFeishuConfig({
    FEISHU_APP_ID: "id",
    FEISHU_APP_SECRET: "sec",
    FEISHU_VERIFICATION_TOKEN: "vt",
    FEISHU_DOMAIN: "Lark",
  });
  assert.equal(c.domain, "lark");
});
