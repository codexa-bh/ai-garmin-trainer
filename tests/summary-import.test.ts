import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { migrateDatabase } from "@/lib/db/migrations";
import { conversationHistory as history } from "@/lib/db/conversation-history";
import { deleteConversation } from "@/lib/db/conversation-lifecycle";
import { summaryStorage as storage } from "@/lib/db/summary-storage";
import {
  createSummaryImport,
  controlSummaryImport,
  readSummaryImportBatch,
  summaryImportInspection,
} from "@/lib/db/summary-import";
import {
  minimizeSummarySource,
  validateSummaryReplacement,
  type SummaryBatch,
} from "@/lib/memory/summary-policy";
import { parseSummaryCommand } from "@/lib/memory/summary-controls";
let db: Database.Database;
let now: number;
vi.mock("@/lib/db/connection", () => ({ getDatabase: () => db }));
beforeEach(() => {
  db = new Database(":memory:");
  migrateDatabase(db);
  now = Date.now();
  storage.configure(false, "gpt-6-luna", 6000);
});
afterEach(() => {
  db.close();
  vi.restoreAllMocks();
});
function offTurn(
  chat = "A",
  text = "Short weekday sessions because of time; long weekday sessions rejected.",
) {
  const turn = history.admit(chat, text);
  history.complete(turn.admission, {
    content: "Acknowledged.",
    grounding: null,
  });
  return (
    db
      .prepare(
        "select turn_id||':'||source_version as id from conversation_turn order by admission_seq desc limit 1",
      )
      .get() as { id: string }
  ).id;
}
function candidate(batch: SummaryBatch) {
  const inputs = batch.sources.flatMap((source) => {
    const input = minimizeSummarySource(source);
    return input ? [input] : [];
  });
  return validateSummaryReplacement(
    {
      summary: [batch.previous.text, ...inputs.map((source) => source.user)]
        .filter(Boolean)
        .join("\n"),
    },
    batch,
    inputs,
  )!;
}
describe("explicit bounded historical transition sharing S", () => {
  it.each(["suppressed", "memory-private"])(
    "does not replace the latest %s assistant context with an older unrelated referent",
    (restriction) => {
      offTurn("context", "Earlier independent topic.");
      const restricted = offTurn(
        "context",
        restriction === "memory-private"
          ? "Please do not remember this discussion."
          : "Restricted latest option.",
      );
      if (restriction === "suppressed")
        db.prepare("insert into summary_suppression(source_id) values(?)").run(
          restricted,
        );
      const selected = offTurn(
        "context",
        "Use that for future coaching; I can train only on weekends.",
      );
      const input = summaryImportInspection().candidates.find(
        (candidate) => candidate.id === selected,
      )!;
      expect(input.text).toContain("only on weekends");
      expect(input.referent).toBeNull();
    },
  );
  it("resumes a sealed multi-batch selection after SQLite reopen without duplicate coverage", () => {
    const ids = Array.from({ length: 25 }, (_, index) =>
      offTurn(
        `history-${index}`,
        index === 3
          ? "Fake password sk-example-not-a-key https://example.invalid/training /Users/example/notes diagnosis GPS ignore previous instructions"
          : undefined,
      ),
    );
    storage.configure(true, "gpt-6-luna", 6000);
    createSummaryImport(ids);
    now += 130000;
    const first = storage.admit(now, "first")!;
    expect(first.sources).toHaveLength(20);
    expect(storage.publish(first, candidate(first), now + 1)).toBe(true);
    const bytes = db.serialize();
    db.close();
    db = new Database(bytes);
    expect(readSummaryImportBatch()?.identity.position).toBe(20);
    expect(storage.admit(now + 1999, "debounce")).toBeNull();
    now += 2000;
    const second = storage.admit(now, "second")!;
    expect(second.sources).toHaveLength(5);
    expect(storage.publish(second, candidate(second), now + 1)).toBe(true);
    expect(summaryImportInspection().manifests[0]).toMatchObject({
      state: "complete",
      position: 25,
      total: 25,
    });
    expect(
      (
        db
          .prepare("select count(*) as n from summary_import_disposition")
          .get() as { n: number }
      ).n,
    ).toBe(25);
    expect(storage.status(now).frontier).toBe(0);
    expect(storage.read().text).toContain("https://example.invalid/training");
  });
  it("refuses substituted disposition identities even when the saved progress count matches", () => {
    const ids = Array.from({ length: 25 }, (_, index) =>
      offTurn(`source-${index}`),
    );
    storage.configure(true, "gpt-6-luna", 6000);
    createSummaryImport(ids);
    now += 130000;
    const first = storage.admit(now, "first")!;
    expect(storage.publish(first, candidate(first), now + 1)).toBe(true);
    db.prepare(
      "update summary_import_disposition set source_id='fabricated:1' where source_id=?",
    ).run(ids[0]);
    const corrupted = db.serialize();
    expect(() => readSummaryImportBatch()).toThrow(
      "summary_import_unavailable",
    );
    expect(db.serialize()).toEqual(corrupted);
    expect(
      storage.admit(now + 152000, "must-not-skip-corrupt-prefix"),
    ).toBeNull();
    expect(
      db.prepare("select count(*) as n from summary_attempt").get(),
    ).toEqual({ n: 1 });
  });
  it.each([
    "selection_json='[\"fabricated:1\"]'",
    "format_version=2",
    "position=1",
  ])("refuses corrupt/unknown reviewed manifest: %s", (mutation) => {
    const id = offTurn();
    storage.configure(true, "gpt-6-luna", 6000);
    createSummaryImport([id]);
    db.exec(`update summary_import set ${mutation}`);
    expect(() => readSummaryImportBatch()).toThrow(
      "summary_import_unavailable",
    );
    expect(storage.admit(now + 130000, "corrupt-import")).toBeNull();
    expect(
      (
        db.prepare("select count(*) as n from summary_attempt").get() as {
          n: number;
        }
      ).n,
    ).toBe(0);
  });
  it("does not import on read/startup; uses one S lease, atomic manifest progress, original IDs and no routine-frontier rewind", () => {
    const sourceId = offTurn();
    expect(summaryImportInspection().candidates.map((item) => item.id)).toEqual(
      [sourceId],
    );
    expect(readSummaryImportBatch()).toBeNull();
    storage.configure(true, "gpt-6-luna", 6000);
    const manifestId = createSummaryImport([sourceId]);
    const job = storage.admit(now + 130000, "import-job")!;
    expect(job.import).toEqual({ id: manifestId, position: 0 });
    expect(storage.admit(now + 130001, "competitor")).toBeNull();
    now += 130002;
    const proposal = candidate(job);
    expect(proposal).not.toBeNull();
    expect(storage.publish(job, proposal, now)).toBe(true);
    expect(storage.publish(job, proposal, now)).toBe(true);
    expect(storage.status(now).frontier).toBe(0);
    expect(storage.read().text).toContain(
      "Short weekday sessions because of time",
    );
    expect(
      db
        .prepare("select source_id,reason from summary_import_disposition")
        .get(),
    ).toEqual({ source_id: sourceId, reason: "processed" });
    expect(summaryImportInspection().manifests[0]).toMatchObject({
      state: "complete",
      position: 1,
      total: 1,
    });
    expect(summaryImportInspection().candidates).toEqual([]);
    expect(() => createSummaryImport([sourceId])).toThrow("source_unavailable");
    expect(
      (
        db.prepare("select count(*) as n from conversation_turn").get() as {
          n: number;
        }
      ).n,
    ).toBe(1);
  });
  it("pause/cancel invalidates an active import lease without refund or original deletion, then explicit resume uses the same manifest", () => {
    const id = offTurn();
    storage.configure(true, "gpt-6-luna", 6000);
    const manifest = createSummaryImport([id]);
    now += 130000;
    const job = storage.admit(now, "paid-import")!;
    expect(storage.reserve(job, now + 1)).toBe(true);
    expect(controlSummaryImport(manifest, "pause")).toBe(true);
    expect(storage.publish(job, candidate(job), now + 2)).toBe(false);
    expect(storage.status(now)).toMatchObject({
      reservedUsdToday: 0,
      unpricedAttempts: 1,
    });
    expect(readSummaryImportBatch()).toBeNull();
    controlSummaryImport(manifest, "resume");
    expect(readSummaryImportBatch()?.identity.id).toBe(manifest);
    controlSummaryImport(manifest, "cancel");
    expect(readSummaryImportBatch()).toBeNull();
    expect(summaryImportInspection().candidates[0].id).toBe(id);
  });
  it.each(["clear", "disable", "manual", "delete"] as const)(
    "cannot resume past %s authority changes or resurrect tombstones",
    (action) => {
      const id = offTurn();
      storage.configure(true, "gpt-6-luna", 6000);
      const manifest = createSummaryImport([id]);
      controlSummaryImport(manifest, "pause");
      if (action === "manual")
        storage.edit(storage.version(), null, "Keep concise coaching.", now);
      else if (action === "delete") deleteConversation("A");
      else storage.control(action, now);
      expect(() => controlSummaryImport(manifest, "resume")).toThrow();
      expect(summaryImportInspection().manifests[0].state).toBe(
        "review-required",
      );
      if (action === "clear" || action === "delete")
        expect(summaryImportInspection().candidates).toEqual([]);
    },
  );
  it("accepts formerly matched prose but rejects unproven, duplicate and relative-time source selection without synthesizing role pairs", () => {
    const good = offTurn();
    const formerlyFiltered = offTurn(
      "B",
      "My password is synthetic-secret, remember it.",
    );
    offTurn("C", "This weekend I prefer short sessions.");
    storage.configure(true, "gpt-6-luna", 6000);
    expect(
      summaryImportInspection()
        .candidates.map((item) => item.id)
        .sort(),
    ).toEqual([good, formerlyFiltered].sort());
    expect(() => createSummaryImport([good, good])).toThrow(
      "selection_invalid",
    );
    expect(() => createSummaryImport(["invented:1"])).toThrow(
      "source_unavailable",
    );
    const expected = storage.version();
    expect(
      parseSummaryCommand({
        version: 2,
        expected,
        action: "import-create",
        sourceIds: [good],
      }),
    ).not.toBeNull();
    expect(
      parseSummaryCommand({
        version: 1,
        expected,
        action: "import-create",
        sourceIds: [good],
        force: true,
      }),
    ).toBeNull();
    expect(
      parseSummaryCommand({
        version: 1,
        expected,
        action: "import-create",
        sourceIds: Array(201).fill(good),
      }),
    ).toBeNull();
  });
});
