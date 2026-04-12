import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createSupervisionEngine } from "../src/supervision.mjs";

/** @type {Array<{ userId: string; message: string; entryId: string }>} */
let sent;
/** @type {ReturnType<typeof createSupervisionEngine>} */
let engine;
let mockNow;

beforeEach(() => {
  sent = [];
  mockNow = Date.now();
  engine = createSupervisionEngine({
    timeZone: "Asia/Shanghai",
    now: () => mockNow,
    async sendReminder(userId, message, entryId) {
      sent.push({ userId, message, entryId });
    },
  });
});

describe("parseCronLike", () => {
  it("parses HH:MM", () => {
    const r = engine.parseCronLike("08:30");
    assert.deepEqual(r, { dayOfWeek: null, hour: 8, minute: 30 });
  });

  it("parses MO:08:30", () => {
    const r = engine.parseCronLike("MO:08:30");
    assert.deepEqual(r, { dayOfWeek: 1, hour: 8, minute: 30 });
  });

  it("returns null for invalid", () => {
    assert.equal(engine.parseCronLike("invalid"), null);
    assert.equal(engine.parseCronLike("25:00"), null);
  });
});

describe("addEntry / getSchedule", () => {
  it("adds entries", () => {
    engine.addEntry("admin", { type: "class", title: "数学课", cronLike: "08:00" });
    engine.addEntry("admin", { type: "meal", title: "午饭", cronLike: "12:00" });
    const schedule = engine.getSchedule("admin");
    assert.equal(schedule.length, 2);
    assert.equal(schedule[0].title, "数学课");
  });

  it("rejects invalid cronLike", () => {
    assert.throws(() => {
      engine.addEntry("admin", { type: "class", title: "bad", cronLike: "99:99" });
    });
  });
});

describe("removeEntry", () => {
  it("removes an entry", () => {
    const e = engine.addEntry("admin", { type: "class", title: "test", cronLike: "10:00" });
    assert.equal(engine.getSchedule("admin").length, 1);
    engine.removeEntry("admin", e.id);
    assert.equal(engine.getSchedule("admin").length, 0);
  });
});

describe("addDefaultReminders", () => {
  it("adds meal and sleep reminders", () => {
    engine.addDefaultReminders("girlfriend");
    const schedule = engine.getSchedule("girlfriend");
    assert.ok(schedule.length >= 5);
    assert.ok(schedule.some((e) => e.type === "meal"));
    assert.ok(schedule.some((e) => e.type === "sleep"));
  });
});

describe("importSchedule", () => {
  it("imports multiple entries", () => {
    const results = engine.importSchedule("admin", [
      { title: "高数", cronLike: "MO:08:00", type: "class" },
      { title: "英语", cronLike: "TU:10:00", type: "class" },
      { title: "bad", cronLike: "ZZ:99:99" },
    ]);
    assert.equal(results.length, 3);
    assert.ok(results[0].ok);
    assert.ok(results[1].ok);
    assert.ok(!results[2].ok);
    assert.equal(engine.getSchedule("admin").length, 2);
  });
});

describe("rescheduleAll", () => {
  it("shifts all entries by delta minutes", () => {
    engine.addEntry("admin", { type: "class", title: "A", cronLike: "08:00" });
    engine.addEntry("admin", { type: "class", title: "B", cronLike: "10:30" });
    const updated = engine.rescheduleAll("admin", 15);
    assert.equal(updated.length, 2);
    assert.equal(updated[0].cronLike, "08:15");
    assert.equal(updated[1].cronLike, "10:45");
  });

  it("handles wrap-around midnight", () => {
    engine.addEntry("admin", { type: "sleep", title: "S", cronLike: "23:50" });
    const updated = engine.rescheduleAll("admin", 30);
    assert.equal(updated[0].cronLike, "00:20");
  });
});

describe("acknowledgeReminder", () => {
  it("is callable without error", () => {
    engine.acknowledgeReminder("nonexistent");
  });
});

describe("getStats", () => {
  it("returns correct stats", () => {
    engine.addEntry("admin", { type: "class", title: "A", cronLike: "08:00" });
    engine.addDefaultReminders("girlfriend");
    const stats = engine.getStats();
    assert.equal(stats.users, 2);
    assert.ok(stats.totalEntries >= 6);
  });
});
