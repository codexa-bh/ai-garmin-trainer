import Database from "better-sqlite3";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { migrateDatabase } from "@/lib/db/migrations";
import {
  summaryStorage as storage,
  summaryDensifyStorage,
  summaryDensifyAvailable,
  noteSummaryActivity,
} from "@/lib/db/summary-storage";
import { createSummaryDensify } from "@/lib/memory/summary-densify";
import { characters } from "@/lib/memory/summary-policy";
import { parseSummaryCommand } from "@/lib/memory/summary-controls";
import { conversationHistory as history } from "@/lib/db/conversation-history";
import {
  adoptSummaryPin,
  readSummaryPin,
} from "@/lib/db/conversation-summary-pin";
import { summaryPinInput } from "@/lib/chat/summary-pin";
import type { SummaryGeneration } from "@/lib/memory/summary-application";

let db: Database.Database;
vi.mock("@/lib/db/connection", () => ({ getDatabase: () => db }));
// Authored qualification/count fixture, not personal history or semantic-quality evidence.
function authored(length: number) {
  const paragraphs = Array.from(
    { length: 80 },
    (_, n) =>
      `Scenario ${n}: Short weekdays remain preferred because caregiving limits time; previous long weekday plans failed. Earlier evening training was corrected to mornings. Cycling is not prohibited. Poles remain an unchosen assistant suggestion; the rejected heavy bag caused discomfort. Weather was historical, not a current constraint.\n`,
  );
  let text = "";
  for (const paragraph of paragraphs) {
    if (characters(text + paragraph) > length) break;
    text += paragraph;
  }
  return text + " ".repeat(length - characters(text));
}
const original = authored(13250),
  shorter = authored(7000);
let now: number;
beforeEach(() => {
  vi.useFakeTimers();
  db = new Database(":memory:");
  migrateDatabase(db);
  now = Date.now();
  storage.configure(true, "gpt-6-luna", 6000);
  storage.editSummary(storage.version(), original, now);
  storage.edit(
    storage.version(),
    null,
    "Keep separate: no preference rewrite.",
    now,
  );
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  db.close();
});
function owner(
  generate: SummaryGeneration["generate"] = vi.fn(async () => ({
    patch: { summary: shorter },
    usage: { input: 120, output: 40, cached: 0 },
  })),
) {
  const native = new AbortController();
  let current = true;
  return {
    generate,
    native,
    revoke: () => {
      current = false;
    },
    service: createSummaryDensify({
      storage: summaryDensifyStorage,
      now: () => now,
      begin: () => ({
        generation: { generate },
        current: () => current && !native.signal.aborted,
        signal: native.signal,
        finish: () => {},
      }),
    }),
  };
}
function preserved() {
  return [
    "summary_disposition",
    "summary_import",
    "summary_import_disposition",
    "summary_rebuild",
    "summary_preference",
    "conversation_completion",
  ].map((table) => db.prepare(`select * from ${table}`).all());
}
describe("explicit summary-only review and real schema24 SQLite acceptance", () => {
  it("one request previews without publication, accepts above-target shorter text, preserves pins/frontiers/preferences, reopens without migration", async () => {
    expect(characters(original)).toBe(13250);
    expect(characters(shorter)).toBe(7000);
    history.admit("pinned", "Authored pending turn");
    adoptSummaryPin("pinned");
    const pin = readSummaryPin("pinned");
    const before = storage.version(),
      rows = preserved(),
      schema = db.pragma("user_version");
    const { service, generate } = owner();
    expect(service.inspect()).toBeNull();
    expect(generate).not.toHaveBeenCalled();
    const review = await service.request("request-one", before);
    expect(review).toMatchObject({
      state: "review",
      text: shorter,
      before: 13250,
      after: 7000,
      target: 6000,
      shorter: true,
    });
    expect(storage.version()).toEqual(before);
    expect(storage.inspect().text).toBe(original);
    expect(preserved()).toEqual(rows);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(JSON.parse(vi.mocked(generate).mock.calls[0][1])).toEqual({
      summary: original,
      targetCharacters: 6000,
    });
    service.act("densify-accept", "request-one");
    service.act("densify-accept", "request-one");
    expect(storage.version()).toEqual({
      ...before,
      revision: before.revision + 1,
    });
    expect(storage.read().text).toBe(shorter);
    expect(preserved()).toEqual(rows);
    expect(readSummaryPin("pinned")).toEqual(pin);
    history.admit("next", "Authored next turn");
    adoptSummaryPin("next");
    expect(JSON.parse(summaryPinInput(readSummaryPin("next")!))).toMatchObject({
      generatedSummary: shorter,
    });
    expect(
      db
        .prepare("select outcome,reserved,source_ids_json from summary_attempt")
        .all(),
    ).toEqual([
      { outcome: "densify_accepted", reserved: 1, source_ids_json: "[]" },
    ]);
    const bytes = db.serialize();
    db.close();
    db = new Database(bytes);
    expect(storage.read().text).toBe(shorter);
    expect(db.pragma("user_version")).toEqual(schema);
    expect(db.pragma("integrity_check", { simple: true })).toBe("ok");
    expect(db.pragma("foreign_key_check")).toEqual([]);
  });
  it.each([original, authored(13251), "Different words".padEnd(13250, " ")])(
    "never accepts equal/longer valid candidates or buys another request",
    async (text) => {
      const { service, generate } = owner(
        vi.fn(async () => ({
          patch: { summary: text },
          usage: { input: 5, output: 5, cached: null },
        })),
      );
      const before = storage.version();
      expect(await service.request("no-reduction", before)).toMatchObject({
        state: "review",
        shorter: false,
      });
      expect(() => service.act("densify-accept", "no-reduction")).toThrow();
      service.act("densify-discard", "no-reduction");
      await service.request("no-reduction", before);
      expect(generate).toHaveBeenCalledTimes(1);
      expect(storage.version()).toEqual(before);
      expect(storage.inspect().text).toBe(original);
    },
  );
  it.each(["", "   ", "\ud800", { extra: true }])(
    "preserves saved text on invalid output",
    async (text) => {
      const { service } = owner(async () => ({
        patch:
          typeof text === "string"
            ? { summary: text }
            : { summary: "short", ...text },
        usage: { input: null, output: null, cached: null },
      }));
      expect(await service.request("invalid", storage.version())).toMatchObject(
        { state: "failed", text: null },
      );
      expect(storage.inspect().text).toBe(original);
      expect(
        db.prepare("select reserved,usage_json from summary_attempt").get(),
      ).toMatchObject({ reserved: 1, usage_json: expect.any(String) });
    },
  );
  it("cancels late success, deduplicates concurrent requests and never poisons routine recovery", async () => {
    let resolve!: (
      value: Awaited<ReturnType<SummaryGeneration["generate"]>>,
    ) => void;
    const generate = vi.fn(
      () =>
        new Promise<Awaited<ReturnType<SummaryGeneration["generate"]>>>((r) => {
          resolve = r;
        }),
    );
    const { service } = owner(generate);
    const expected = storage.version();
    const pending = service.request("cancel", expected),
      duplicate = service.request("cancel", expected);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(summaryDensifyAvailable()).toBe(false);
    service.act("densify-cancel", "cancel");
    await pending;
    await duplicate;
    resolve({
      patch: { summary: shorter },
      usage: { input: 10, output: 20, cached: null },
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(service.inspect()).toMatchObject({ state: "cancelled", text: null });
    expect(storage.version()).toEqual(expected);
    expect(
      db
        .prepare("select reason,retry_at,failures,job_id from summary_control")
        .get(),
    ).toEqual({ reason: null, retry_at: 0, failures: 0, job_id: null });
    expect(
      db.prepare("select usage_json from summary_attempt").get(),
    ).toMatchObject({ usage_json: expect.stringContaining('"input":10') });
  });
  it.each(["edit", "preference", "off", "clear", "config", "expiry", "native"])(
    "revokes review after %s",
    async (action) => {
      const o = owner();
      await o.service.request("stale", storage.version());
      if (action === "edit")
        storage.editSummary(storage.version(), "New publication", now);
      if (action === "preference")
        storage.edit(storage.version(), null, "New preference", now);
      if (action === "off") storage.control("disable", now);
      if (action === "clear") storage.control("clear", now);
      if (action === "config") storage.configure(true, "gpt-6-luna", 7000);
      if (action === "expiry") now += 600001;
      if (action === "native") o.revoke();
      expect(o.service.inspect()).toMatchObject({
        state: "expired",
        text: null,
      });
      expect(() => o.service.act("densify-accept", "stale")).toThrow();
    },
  );
  it.each(["small", "😀\r\n".repeat(500)])(
    "available below target, scalar counts preserve validated complete output",
    async (text) => {
      storage.editSummary(storage.version(), text, now);
      expect(summaryDensifyAvailable()).toBe(true);
      const { service } = owner(async () => ({
        patch: { summary: "😀\r\n" },
        usage: { input: 1, output: 1, cached: 0 },
      }));
      expect(await service.request("unicode", storage.version())).toMatchObject(
        { before: characters(storage.inspect().text), after: 3, shorter: true },
      );
      service.act("densify-accept", "unicode");
      expect(storage.read().text).toBe("😀\r\n");
    },
  );
  it("refuses acceptance during a routine writer and never auto-replays an expired manual lease", async () => {
    const o = owner();
    await o.service.request("preview-busy", storage.version());
    const turn = history.admit("routine", "Authored new source");
    history.complete(turn.admission, {
      content: "Acknowledged",
      grounding: null,
    });
    noteSummaryActivity(now);
    now += 3000;
    const routine = storage.admit(now, "routine-writer");
    expect(routine).not.toBeNull();
    expect(summaryDensifyAvailable()).toBe(false);
    expect(() => o.service.act("densify-accept", "preview-busy")).toThrow(
      /busy/,
    );
    storage.fail(routine!, "authored_stop", now);
    storage.control("retry", now);
    const manual = summaryDensifyStorage.admit(
      "lost-process",
      storage.version(),
      now,
    );
    expect(summaryDensifyStorage.reserve(manual, now)).toBe(true);
    now += 30001;
    expect(storage.admit(now, "routine-recovery")).toBeNull();
    expect(
      db
        .prepare("select outcome from summary_attempt where job_id=?")
        .get(manual.jobId),
    ).toEqual({ outcome: "densify_unknown" });
    expect(
      db
        .prepare("select job_id,reason,retry_at,failures from summary_control")
        .get(),
    ).toMatchObject({ job_id: null, reason: null, retry_at: 0 });
    expect(storage.inspect().text).toBe(original);
  });
  it("refuses duplicate durable IDs after a process restart and strict renderer envelopes", async () => {
    const expected = storage.version();
    const first = owner();
    await first.service.request("same", expected);
    first.service.act("densify-discard", "same");
    await expect(owner().service.request("same", expected)).rejects.toThrow();
    expect(
      parseSummaryCommand({
        version: 2,
        expected,
        action: "densify-request",
        id: "safe",
      }),
    ).not.toBeNull();
    expect(
      parseSummaryCommand({
        version: 2,
        expected,
        action: "densify-accept",
        id: "safe",
        text: "tamper",
      }),
    ).toBeNull();
  });
});
