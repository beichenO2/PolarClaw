import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  sanitizePii,
  sanitizeWithCustomEntities,
  desanitize,
  containsPii,
} from "../src/pii-detector.mjs";

describe("sanitizePii", () => {
  it("detects and replaces phone numbers", () => {
    const text = "我的手机号是 13812345678，请联系我";
    const result = sanitizePii(text);
    assert.ok(!result.sanitized.includes("13812345678"));
    assert.ok(result.sanitized.includes("$PHONE_"));
    assert.equal(result.entities.length, 1);
    assert.equal(result.entities[0].type, "PHONE");
  });

  it("detects email addresses", () => {
    const text = "发邮件到 test@example.com";
    const result = sanitizePii(text);
    assert.ok(!result.sanitized.includes("test@example.com"));
    assert.ok(result.sanitized.includes("$EMAIL_"));
  });

  it("detects ID card numbers", () => {
    const text = "身份证号 110101199001011234";
    const result = sanitizePii(text);
    assert.ok(!result.sanitized.includes("110101199001011234"));
    assert.ok(result.sanitized.includes("$ID_CARD_"));
  });

  it("handles multiple PII types", () => {
    const text = "姓名 张三，手机 13812345678，邮箱 zhang@test.com";
    const result = sanitizePii(text);
    assert.ok(!result.sanitized.includes("13812345678"));
    assert.ok(!result.sanitized.includes("zhang@test.com"));
    assert.ok(result.entities.length >= 2);
  });

  it("returns clean text if no PII", () => {
    const text = "今天天气不错";
    const result = sanitizePii(text);
    assert.equal(result.sanitized, text);
    assert.equal(result.entities.length, 0);
  });

  it("reuses existing vault for consistent naming", () => {
    const vault = new Map();
    const r1 = sanitizePii("电话 13812345678", vault);
    const ph = r1.entities[0].placeholder;
    const r2 = sanitizePii("再次：13812345678", vault);
    assert.ok(r2.sanitized.includes(ph));
  });
});

describe("sanitizeWithCustomEntities", () => {
  it("replaces custom named entities", () => {
    const text = "张三的成绩单发给李四了";
    const result = sanitizeWithCustomEntities(text, [
      { value: "张三", type: "NAME" },
      { value: "李四", type: "NAME" },
    ]);
    assert.ok(!result.sanitized.includes("张三"));
    assert.ok(!result.sanitized.includes("李四"));
    assert.ok(result.sanitized.includes("$NAME_"));
  });
});

describe("desanitize", () => {
  it("reverses substitution", () => {
    const text = "我的手机号是 13812345678";
    const result = sanitizePii(text);
    const restored = desanitize(result.sanitized, result.vault);
    assert.equal(restored, text);
  });

  it("handles mixed PII types", () => {
    const text = "联系 13812345678 或 test@example.com";
    const result = sanitizePii(text);
    const restored = desanitize(result.sanitized, result.vault);
    assert.equal(restored, text);
  });
});

describe("containsPii", () => {
  it("returns true for text with PII", () => {
    assert.ok(containsPii("打 13812345678"));
  });

  it("returns false for clean text", () => {
    assert.ok(!containsPii("你好世界"));
  });
});
