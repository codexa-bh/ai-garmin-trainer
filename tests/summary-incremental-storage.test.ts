import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { migrateDatabase } from "@/lib/db/migrations";
import { conversationHistory as history } from "@/lib/db/conversation-history";
import {
  summaryStorage as storage,
  noteSummaryActivity,
} from "@/lib/db/summary-storage";
import {
  createSummaryEngine,
  type SummaryGeneration,
} from "@/lib/memory/summary-application";
import { readSummaryPin } from "@/lib/db/conversation-summary-pin";
import { summaryPinInput } from "@/lib/chat/summary-pin";
import { deleteConversation } from "@/lib/db/conversation-lifecycle";

let db: Database.Database;
let now: number;
vi.mock("@/lib/db/connection", () => ({ getDatabase: () => db }));
beforeEach(() => {
  db = new Database(":memory:");
  migrateDatabase(db);
  now = Date.UTC(2026, 10, 8, 12);
  storage.configure(true, "gpt-6-luna", 6000);
});
afterEach(() => db.close());
// Entirely fictional; neither excerpts nor paraphrases of operator history.
const prior = Array.from(
  { length: 100 },
  (_, n) =>
    `Authored project ${n}: short weekday practice because caregiving limits time; long weekday sessions failed. Equipment remains undecided.`,
).join("\n");
function complete(
  user = "I now practice watercolor on Sundays because the studio is quiet.",
) {
  const turn = history.admit("authored", user);
  history.complete(turn.admission, {
    content: "Acknowledged.",
    grounding: null,
  });
  return turn;
}
async function tick(patch: unknown, inspect?: SummaryGeneration["generate"]) {
  noteSummaryActivity(now);
  now += 3000;
  const generate = vi.fn(
    inspect ??
      (async () => ({ patch, usage: { input: 100, output: 20, cached: 0 } })),
  );
  await createSummaryEngine({
    storage,
    generation: { generate },
    now: () => now,
    identity: () => `authored-${now}`,
    current: () => true,
    jitter: () => 0,
  }).tick(new AbortController().signal);
  return generate;
}
describe("ordinary continuity on real SQLite (supplied output, not model quality)", () => {
  it("preserves substantial prior and pending sources on invalid output without automatic replay", async () => {
    expect([...prior].length).toBeGreaterThan(13000);
    storage.editSummary(storage.version(), prior, now);
    complete();
    await tick(
      {
        summary: "Watercolor on Sundays because the studio is quiet.",
        extra: true,
      },
      async (_system, prompt) => {
        expect(JSON.parse(prompt).previous).toBe(prior);
        return {
          patch: {
            summary: "Watercolor on Sundays because the studio is quiet.",
            extra: true,
          },
          usage: { input: 100, output: 20, cached: 0 },
        };
      },
    );
    expect(storage.inspect().text).toBe(prior);
    expect(storage.status(now)).toMatchObject({
      frontier: 0,
      pending: 1,
      reason: "summary_invalid_output",
    });
    const attempt = db
      .prepare("select outcome,usage_json from summary_attempt")
      .get() as { outcome: string; usage_json: string };
    expect(attempt.outcome).toBe("summary_invalid_output");
    expect(JSON.parse(attempt.usage_json)).toMatchObject({
      input: 100,
      output: 20,
      rejection: "shape",
    });
    expect(
      await tick({ action: "unchanged", edits: [], addition: "" }),
    ).not.toHaveBeenCalled();
  });
  it("preserves roughly13k prior across successive additions/correction, SQLite reopen and full next-turn composition", async () => {
    storage.editSummary(storage.version(), prior, now);
    storage.edit(
      storage.version(),
      null,
      "Separate authored preference: concise answers.",
      now,
    );
    const first = complete();
    const chat = first.admission.conversationId;
    const frozen = readSummaryPin(chat)!;
    const schema = db
      .prepare("select name,sql from sqlite_master order by name")
      .all();
    const addition = "Watercolor on Sundays because the studio is quiet.";
    await tick(null, async (_system, prompt, _signal, format) => {
      const input = JSON.parse(prompt);
      expect(format).toBe("maintenance");
      expect(input.previous).toBe(prior);
      expect(input.newSources).toHaveLength(1);
      expect(JSON.stringify(input)).not.toMatch(/Separate authored|sourceId/);
      return {
        patch: { summary: prior + "\n\n" + addition, exclude: [] },
        usage: { input: 100, output: 20, cached: 0 },
      };
    });
    expect(storage.read().text).toBe(prior + "\n\n" + addition);
    expect(readSummaryPin(chat)).toEqual(frozen);
    const second = complete(
      "My studio now opens on Saturdays, not Sundays; the quiet-practice reason still applies.",
    );
    await tick({
      exclude: [],
      summary:
        prior +
        "\n\nWatercolor on Saturdays because the studio is quiet; equipment still undecided.",
    });
    const expected =
      prior +
      "\n\nWatercolor on Saturdays because the studio is quiet; equipment still undecided.";
    expect(storage.read().text).toBe(expected);
    expect(storage.status(now)).toMatchObject({
      pending: 0,
      frontier: 2,
      reason: null,
    });
    const originals = db.prepare("select * from message order by id").all();
    const attempts = db
      .prepare("select * from summary_attempt order by job_id")
      .all();
    const spend = db.prepare("select * from summary_spend").all();
    const prefs = storage.preferences();
    const bytes = db.serialize();
    db.close();
    db = new Database(bytes);
    expect(migrateDatabase(db).toVersion).toBe(25);
    expect(
      db.prepare("select name,sql from sqlite_master order by name").all(),
    ).toEqual(schema);
    expect(db.pragma("integrity_check")).toEqual([{ integrity_check: "ok" }]);
    expect(db.pragma("foreign_key_check")).toEqual([]);
    expect(storage.read().text).toBe(expected);
    expect(storage.preferences()).toEqual(prefs);
    expect(db.prepare("select * from message order by id").all()).toEqual(
      originals,
    );
    expect(
      db.prepare("select * from summary_attempt order by job_id").all(),
    ).toEqual(attempts);
    expect(db.prepare("select * from summary_spend").all()).toEqual(spend);
    const next = history.admit("next-authored", "What should we discuss next?");
    const pin = history.read(next.admission).segment.pinnedSummary!;
    expect(JSON.parse(summaryPinInput(pin))).toMatchObject({
      generatedSummary: expected,
      manualPreferences: prefs.map((p) => p.text),
    });
    // A source edit is independent erasure authority, never a preservation fallback.
    db.prepare(
      "update message set content='Revised authored source' where id=?",
    ).run(second.userRecord.id);
    expect(storage.inspect().text).toBe("");
    expect(storage.preferences()).toEqual(prefs);
    expect(readSummaryPin(next.admission.conversationId)).toBeNull();
  });
  it("processes no-useful/unchanged sources without rewriting or falsely adding facts", async () => {
    storage.editSummary(storage.version(), prior, now);
    complete("Thanks for the discussion.");
    await tick({ summary: prior, exclude: [] });
    expect(storage.read().text).toBe(prior);
    expect(storage.status(now)).toMatchObject({
      pending: 0,
      frontier: 1,
      reason: null,
    });
    expect(db.prepare("select reason from summary_disposition").all()).toEqual([
      { reason: "processed" },
    ]);
  });
  it("preserves pending sources, prior and cost on explicit uncertainty without automatic replay", async () => {
    storage.editSummary(storage.version(), prior, now);
    complete();
    await tick({ action: "uncertain", edits: [], addition: "" });
    expect(storage.read().text).toBe(prior);
    expect(storage.status(now)).toMatchObject({
      pending: 1,
      frontier: 0,
      reason: "summary_invalid_output",
      attemptsToday: 1,
    });
    expect(
      await tick({ action: "unchanged", edits: [], addition: "" }),
    ).not.toHaveBeenCalled();
  });
  it("interprets no-save in the single model call and durably excludes it", async () => {
    storage.editSummary(storage.version(), prior, now);
    complete("Do not remember this request.");
    expect(await tick({ summary: prior, exclude: [0] })).toHaveBeenCalledTimes(
      1,
    );
    expect(storage.read().text).toBe(prior);
    expect(db.prepare("select reason from summary_disposition").all()).toEqual([
      { reason: "privacy-excluded" },
    ]);
  });
  it.each(["actually", "correction"])(
    "keeps substantive prior through %s correction and automatic single-request consolidation",
    async (prefix) => {
      storage.editSummary(storage.version(), prior, now);
      storage.edit(storage.version(), null, "Separate preference", now);
      complete(
        prefix === "actually"
          ? "Actually evenings now fit my work schedule."
          : "Correction: evenings now fit my work schedule.",
      );
      expect(storage.inspect().text).toBe(prior);
      await tick(null, async (system, prompt, _signal, format) => {
        expect(JSON.parse(prompt).previous).toBe(prior);
        expect(system).toContain(
          "automatically learns, corrects and consolidates",
        );
        expect(system).toContain(
          "keeping still-useful prior knowledge when new input is unrelated",
        );
        expect(format).toBe("maintenance");
        return {
          patch: {
            summary: prior + "\nEvenings fit the current work schedule.",
            exclude: [],
          },
          usage: { input: 10, output: 10, cached: 0 },
        };
      });
      expect(storage.read().text).toBe(
        prior + "\nEvenings fit the current work schedule.",
      );
      expect(storage.preferences()[0].text).toBe("Separate preference");
    },
  );
  it.each([
    "summary",
    "preference",
    "config",
    "lease",
    "clear",
    "off",
    "source-edit",
    "delete",
  ])(
    "refuses a late consolidated result after %s authority loss",
    async (change) => {
      storage.editSummary(storage.version(), prior, now);
      storage.edit(storage.version(), null, "Separate preference", now);
      const turn = complete();
      await tick(null, async () => {
        if (change === "summary")
          storage.editSummary(storage.version(), "Manual replacement", now);
        if (change === "preference")
          storage.edit(storage.version(), null, "Another preference", now);
        if (change === "config") storage.configure(true, "gpt-6-luna", 1000);
        if (change === "lease") now += 30001;
        if (change === "clear") storage.control("clear", now);
        if (change === "off") storage.control("disable", now);
        if (change === "source-edit")
          db.prepare(
            "update message set content='Edited source' where id=?",
          ).run(turn.userRecord.id);
        if (change === "delete")
          deleteConversation(turn.admission.conversationId);
        return {
          patch: { summary: prior + "\nLate new meaning" },
          usage: { input: 100, output: 20, cached: 0 },
        };
      });
      expect(storage.inspect().text).toBe(
        ["clear", "source-edit", "delete"].includes(change)
          ? ""
          : change === "summary"
            ? "Manual replacement"
            : prior,
      );
      expect(storage.inspect().text).not.toContain("Late new meaning");
      expect(
        db
          .prepare(
            "select count(*) n from summary_disposition where reason='processed'",
          )
          .get(),
      ).toEqual({ n: 0 });
    },
  );
  it("aborts an in-flight request, retains unknown effect and refuses its result after reopen", async () => {
    storage.editSummary(storage.version(), prior, now);
    complete();
    noteSummaryActivity(now);
    now += 3000;
    const abort = new AbortController();
    let resolve!: (
      value: Awaited<ReturnType<SummaryGeneration["generate"]>>,
    ) => void;
    const result = new Promise<
      Awaited<ReturnType<SummaryGeneration["generate"]>>
    >((r) => {
      resolve = r;
    });
    const service = createSummaryEngine({
      storage,
      generation: {
        generate: async () => {
          abort.abort();
          return result;
        },
      },
      now: () => now,
      identity: () => "aborted-authored",
      current: () => true,
      jitter: () => 0,
    });
    await service.tick(abort.signal);
    const bytes = db.serialize();
    db.close();
    db = new Database(bytes);
    resolve({
      patch: { summary: prior + "\nLate" },
      usage: { input: 1, output: 1, cached: 0 },
    });
    await Promise.resolve();
    expect(storage.read().text).toBe(prior);
    expect(storage.status(now)).toMatchObject({
      pending: 1,
      frontier: 0,
      reason: "summary_interrupted",
      attemptsToday: 1,
    });
    expect(await tick(null)).not.toHaveBeenCalled();
  });
});
