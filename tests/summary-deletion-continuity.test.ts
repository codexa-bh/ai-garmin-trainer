import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { migrateDatabase } from "@/lib/db/migrations";
import { conversationHistory as history } from "@/lib/db/conversation-history";
import {
  summaryStorage as storage,
  summaryDensifyStorage,
  noteSummaryActivity,
} from "@/lib/db/summary-storage";
import { deleteConversation } from "@/lib/db/conversation-lifecycle";
import { clearChatAndProfile } from "@/lib/db/local-data-lifecycle";
import { readSummaryPin } from "@/lib/db/conversation-summary-pin";
import { summaryPinInput } from "@/lib/chat/summary-pin";
import {
  startSummaryRebuild,
  summaryRebuildInventory,
  summaryRebuildStatus,
} from "@/lib/db/summary-rebuild";
import {
  createSummaryEngine,
  type SummaryGeneration,
} from "@/lib/memory/summary-application";
import {
  minimizeSummarySource,
  validateSummaryReplacement,
  type SummaryBatch,
} from "@/lib/memory/summary-policy";
import { createSummaryImport } from "@/lib/db/summary-import";
import { removeDeletionContinuityFixtureSchema } from "./conversation-migration-fixture";

// Entirely authored fixtures; supplied generation proves persistence mechanics,
// not model quality.
let db: Database.Database;
let now: number;
vi.mock("@/lib/db/connection", () => ({ getDatabase: () => db }));
beforeEach(() => {
  db = new Database(":memory:");
  migrateDatabase(db);
  now = Date.UTC(2026, 10, 13, 12);
  storage.configure(true, "gpt-6-luna", 6000);
});
afterEach(() => {
  db.close();
  vi.restoreAllMocks();
});
const prior = Array.from(
  { length: 60 },
  (_, n) =>
    `Authored fact ${n}: short weekday sessions because caregiving limits time; long weekday plans failed.`,
).join("\n");

function complete(chat: string, user: string) {
  const turn = history.admit(chat, user);
  history.complete(turn.admission, {
    content: `Authored answer for ${chat}.`,
    grounding: null,
  });
  return turn;
}
function ready(): SummaryBatch {
  noteSummaryActivity(now);
  now += 120001;
  const batch = storage.admit(now, `job-${now}`);
  expect(batch).not.toBeNull();
  return batch!;
}
function append(batch: SummaryBatch) {
  const inputs = batch.sources.flatMap((source) => {
    const input = minimizeSummarySource(source);
    return input ? [input] : [];
  });
  return validateSummaryReplacement(
    {
      exclude: [],
      summary: [batch.previous.text, ...inputs.map((input) => input.user)]
        .filter(Boolean)
        .join("\n"),
    },
    batch,
    inputs,
  )!;
}
function publishPending() {
  const batch = ready();
  expect(storage.reserve(batch, now)).toBe(true);
  expect(storage.publish(batch, append(batch), now)).toBe(true);
  return batch;
}
/** Contributing history: substantial prior from chat A plus preference. */
function seeded() {
  complete("A", "Short weekday sessions suit caregiving.");
  publishPending();
  storage.editSummary(storage.version(), prior, now);
  storage.edit(storage.version(), null, "Authored preference: mornings.", now);
  complete("B", "Surviving chat keeps a hill-walk goal.");
  publishPending();
  return storage.inspect().text;
}
function debugRows() {
  return db
    .prepare(
      "select revision,parent_revision as parent,kind,model,source_domain as domain,source_first as first,source_last as last,source_count as count,payload,purged_at as purgedAt from summary_debug_revision order by revision",
    )
    .all() as {
    revision: number;
    parent: number;
    kind: string;
    model: string | null;
    domain: string;
    first: number | null;
    last: number | null;
    count: number;
    payload: string | null;
    purgedAt: number | null;
  }[];
}
function events() {
  return db
    .prepare("select kind,revision from summary_debug_event order by id")
    .all() as { kind: string; revision: number }[];
}

describe("ordinary deletion preserves published memory (approved deletion-only exception)", () => {
  it("keeps text, preferences, frontier and usability across contributing-chat deletion and reopen", () => {
    const text = seeded();
    expect(text).toContain("Authored fact 59");
    const before = storage.status(now);
    const prefs = storage.preferences();
    expect(deleteConversation("A")).toBe(true);
    expect(
      db
        .prepare("select count(*) n from message where conversation_id='A'")
        .get(),
    ).toEqual({ n: 0 });
    expect(storage.inspect().text).toBe(text);
    expect(storage.preferences()).toEqual(prefs);
    expect(storage.status(now)).toMatchObject({
      revision: before.revision,
      frontier: before.frontier,
      pending: 0,
      reason: null,
      coverageLost: false,
      state: "fresh",
    });
    // Repeated and absent-target deletion change nothing further.
    const version = storage.version();
    expect(deleteConversation("A")).toBe(false);
    expect(deleteConversation("never-existed")).toBe(false);
    expect(storage.version()).toEqual(version);
    const bytes = db.serialize();
    db.close();
    db = new Database(bytes);
    expect(migrateDatabase(db).applied).toEqual([]);
    expect(storage.inspect().text).toBe(text);
    // Surviving and new chats adopt the retained memory in their next turn.
    for (const chat of ["B", "new-chat"]) {
      const next = history.admit(chat, "What should I do this week?");
      const pin = history.read(next.admission).segment.pinnedSummary!;
      expect(JSON.parse(summaryPinInput(pin))).toMatchObject({
        generatedSummary: text,
        manualPreferences: prefs.map((p) => p.text),
      });
      history.abandon(next.admission);
    }
    expect(db.prepare("pragma integrity_check").get()).toEqual({
      integrity_check: "ok",
    });
    expect(db.pragma("foreign_key_check")).toEqual([]);
  });

  it("covers direct per-row message deletion, multi-row cascades and lifecycle semantic cleanup", () => {
    const text = seeded();
    db.prepare(
      "insert into semantic_memory(id,user_id,kind,text,status,embedding_json,embedding_model,source_conversation_id,source,created_at,updated_at) values('sm-a','local','conversation','Authored derived','active','[]','m','A','chat',1,1)",
    ).run();
    db.prepare(
      "delete from message where conversation_id='B' and role='assistant'",
    ).run();
    expect(storage.inspect().text).toBe(text);
    deleteConversation("A");
    expect(storage.inspect().text).toBe(text);
    expect(
      db.prepare("select status from semantic_memory where id='sm-a'").get(),
    ).toEqual({ status: "deleted" });
    // The deletion marker never outlives its own transaction.
    expect(
      db
        .prepare(
          "select deleting_conversation d from conversation_history_control",
        )
        .get(),
    ).toEqual({ d: null });
    // Any other semantic-memory removal remains a genuine revocation.
    db.prepare(
      "insert into semantic_memory(id,user_id,kind,text,status,embedding_json,embedding_model,source_conversation_id,source,created_at,updated_at) values('sm-b','local','conversation','Other derived','active','[]','m','B','chat',1,1)",
    ).run();
    db.prepare(
      "update semantic_memory set status='deleted' where id='sm-b'",
    ).run();
    expect(storage.inspect().text).toBe("");
  });

  it("rolls the deletion classification back with a failed lifecycle transaction", () => {
    const text = seeded();
    const before = db
      .prepare("select * from conversation_history_control")
      .get();
    db.exec(
      "create trigger injected before delete on conversation begin select raise(abort,'injected'); end",
    );
    expect(() => deleteConversation("A")).toThrow("injected");
    expect(
      db.prepare("select * from conversation_history_control").get(),
    ).toEqual(before);
    db.exec("drop trigger injected");
    expect(storage.inspect().text).toBe(text);
  });

  it("refuses stale source-dependent publication and continues ordinary updates from the complete prior", async () => {
    const text = seeded();
    complete("A", "Late source from a chat about to be deleted.");
    const stale = ready();
    expect(storage.reserve(stale, now)).toBe(true);
    deleteConversation("A");
    expect(storage.publish(stale, append(stale), now)).toBe(false);
    expect(storage.inspect().text).toBe(text);
    expect(
      db
        .prepare("select outcome from summary_attempt where job_id=?")
        .get(stale.jobId),
    ).toEqual({ outcome: "invalidated" });
    // A deleted original is neither reselected nor replayed.
    complete("B", "New eligible source after deletion.");
    let previous: string | undefined;
    const generation: SummaryGeneration = {
      generate: vi.fn(async (_system, prompt) => {
        const input = JSON.parse(prompt) as {
          previous: string;
          newSources: { user: string }[];
        };
        previous = input.previous;
        expect(input.newSources.map((s) => s.user)).toEqual([
          "New eligible source after deletion.",
        ]);
        return {
          patch: { exclude: [], summary: `${input.previous}\nNew fact.` },
          usage: { input: 10, output: 5, cached: null },
        };
      }),
    };
    noteSummaryActivity(now);
    now += 120001;
    await createSummaryEngine({
      storage,
      generation,
      now: () => now,
      identity: () => `engine-${now}`,
      current: () => true,
      jitter: () => 0,
    }).tick(new AbortController().signal);
    expect(previous).toBe(text);
    expect(storage.inspect().text).toBe(`${text}\nNew fact.`);
    expect(storage.status(now)).toMatchObject({ pending: 0, reason: null });
  });

  it("keeps independent source update, Clear, Off and bulk reset semantics", () => {
    const text = seeded();
    const b = db
      .prepare(
        "select id from message where conversation_id='B' and role='user'",
      )
      .get() as { id: string };
    db.prepare("update message set content='Edited authored' where id=?").run(
      b.id,
    );
    expect(storage.inspect().text).toBe("");
    expect(storage.status(now)).toMatchObject({
      coverageLost: true,
      reason: "summary_invalidated",
    });
    storage.editSummary(storage.version(), text, now);
    storage.control("disable", now);
    deleteConversation("A");
    storage.control("enable", now);
    expect(storage.read().text).toBe(text);
    // Bulk Chat/Profile reset intentionally erases more domains.
    clearChatAndProfile();
    expect(storage.inspect().text).toBe("");
  });
});

describe("truthful coverage after genuine revocation", () => {
  it("survives new-only publication, Retry and reopen; Clear and completed reviewed rebuild settle it", () => {
    seeded();
    db.prepare(
      "update message set content='Edited' where conversation_id='B' and role='user'",
    ).run();
    expect(storage.status(now).coverageLost).toBe(true);
    complete("C", "Only new learning after revocation.");
    publishPending();
    storage.control("retry", now);
    expect(storage.inspect().text).toContain("Only new learning");
    expect(storage.status(now)).toMatchObject({
      coverageLost: true,
      reason: null,
    });
    // Manual edit is authored replacement, not reprocessed history.
    storage.editSummary(storage.version(), "Authored replacement", now);
    const bytes = db.serialize();
    db.close();
    db = new Database(bytes);
    expect(storage.status(now).coverageLost).toBe(true);
    // Completed explicit reviewed history update settles known loss.
    const review = summaryRebuildInventory("boot");
    startSummaryRebuild("op", review.snapshot, "boot", now);
    while (summaryRebuildStatus()!.state === "active") {
      now += 2100;
      const job = storage.admit(now, `rebuild-${now}`)!;
      expect(storage.reserve(job, now)).toBe(true);
      expect(storage.publish(job, append(job), now)).toBe(true);
    }
    expect(summaryRebuildStatus()!.state).toBe("complete");
    expect(storage.status(now).coverageLost).toBe(false);
    db.prepare(
      "update message set content='Edited again' where conversation_id='C' and role='user'",
    ).run();
    expect(storage.status(now).coverageLost).toBe(true);
    storage.control("clear", now);
    expect(storage.status(now).coverageLost).toBe(false);
  });

  it("does not report loss when revocation erased no generated text", () => {
    db.prepare(
      "update app_metadata set value=value where key='schema_version'",
    ).run();
    complete("A", "Source");
    db.prepare("update message set content='Edited' where role='user'").run();
    expect(storage.status(now).coverageLost).toBe(false);
  });
});

describe("bounded local debug revisions", () => {
  it("records every committed writer path with typed metadata and no preference text", async () => {
    complete("A", "Routine source one.");
    const routine = publishPending();
    complete("A", "Imported-or-routine two.");
    publishPending();
    storage.edit(storage.version(), null, "Private preference text.", now);
    storage.editSummary(storage.version(), prior, now);
    const rows = debugRows();
    expect(rows.map((r) => r.kind)).toEqual([
      "routine",
      "routine",
      "preference-change",
      "manual-edit",
    ]);
    expect(rows[0]).toMatchObject({
      parent: routine.revision,
      revision: routine.revision + 1,
      model: "gpt-6-luna",
      domain: "completion-events",
      first: 1,
      last: 1,
      count: 1,
    });
    expect(rows[2]).toMatchObject({
      payload: null,
      domain: "none",
      model: null,
    });
    expect(JSON.stringify(rows)).not.toContain("Private preference text");
    // Direct replacement purges earlier debug text, keeping only its own value.
    expect(
      rows.slice(0, 2).every((r) => r.payload === null && r.purgedAt),
    ).toBe(true);
    expect(rows[3]).toMatchObject({ payload: prior, purgedAt: null });
    // Densify acceptance is recorded with its own captured model.
    const shorter = prior.slice(0, 2000);
    const job = summaryDensifyStorage.admit(
      "d1",
      storage.version(),
      now,
      "gpt-6-luna",
    )!;
    summaryDensifyStorage.reserve(job, now);
    // Preview settles the lease without publication; acceptance commits later.
    summaryDensifyStorage.settle(job, "densify_previewed", now);
    expect(debugRows().at(-1)!.kind).toBe("manual-edit");
    summaryDensifyStorage.accept(job, { version: 2, text: shorter }, now);
    expect(debugRows().at(-1)).toMatchObject({
      kind: "densify",
      model: "gpt-6-luna",
      payload: shorter,
      parent: job.revision,
    });
  });

  it("records reviewed import and final rebuild publication with their own source domains", () => {
    storage.configure(false, "gpt-6-luna", 6000);
    complete("A", "Off-time authored source for reviewed import.");
    storage.configure(true, "gpt-6-luna", 6000);
    const sourceId = (
      db
        .prepare(
          "select turn_id||':'||source_version as id from conversation_turn",
        )
        .get() as { id: string }
    ).id;
    createSummaryImport([sourceId]);
    // Import admission uses the wall clock; align the authored clock to it.
    now = Date.now() + 130000;
    const job = storage.admit(now, "import-job")!;
    expect(job.import).toBeTruthy();
    storage.reserve(job, now);
    expect(storage.publish(job, append(job), now)).toBe(true);
    expect(debugRows().at(-1)).toMatchObject({
      kind: "import",
      domain: "import-selection",
      count: 1,
      first: null,
      last: null,
    });
    const review = summaryRebuildInventory("boot");
    startSummaryRebuild("op", review.snapshot, "boot", now);
    const staged: number[] = [];
    while (summaryRebuildStatus()!.state === "active") {
      now += 2100;
      const batch = storage.admit(now, `rebuild-${now}`)!;
      storage.reserve(batch, now);
      expect(storage.publish(batch, append(batch), now)).toBe(true);
      staged.push(debugRows().length);
    }
    // Intermediate staged candidates never become revisions; only the final one.
    expect(debugRows().at(-1)).toMatchObject({
      kind: "rebuild",
      domain: "reviewed-history",
      count: review.counts.includedUserMessages,
    });
    expect(debugRows().filter((r) => r.kind === "rebuild")).toHaveLength(1);
  });

  it("bounds history to 50 newest revisions and failed/stale/rolled-back candidates add none", () => {
    for (let n = 0; n < 55; n++)
      storage.editSummary(storage.version(), `Authored revision ${n}`, now + n);
    const rows = debugRows();
    expect(rows).toHaveLength(50);
    expect(rows.at(-1)!.payload).toBe("Authored revision 54");
    expect(rows[0]!.revision).toBe(rows.at(-1)!.revision - 49);
    complete("A", "Source");
    const batch = ready();
    storage.reserve(batch, now);
    db.exec(
      "create trigger injected before insert on summary_debug_revision begin select raise(abort,'injected'); end",
    );
    const revision = storage.version().revision;
    expect(() => storage.publish(batch, append(batch), now)).toThrow(
      "injected",
    );
    expect(storage.version().revision).toBe(revision);
    expect(storage.status(now).frontier).toBe(0);
    db.exec("drop trigger injected");
    expect(
      storage.publish({ ...batch, jobId: "stale" }, append(batch), now),
    ).toBe(false);
    expect(debugRows()).toEqual(rows);
    expect(storage.publish(batch, append(batch), now)).toBe(true);
    // Idempotent re-settlement does not append again.
    expect(storage.publish(batch, append(batch), now)).toBe(true);
    expect(debugRows()).toHaveLength(50);
    expect(debugRows().at(-1)!.kind).toBe("routine");
  });

  it("purges payloads on deletion/update with bounded coalesced events; restart cannot resurrect them", () => {
    seeded();
    expect(debugRows().some((r) => r.payload !== null)).toBe(true);
    deleteConversation("A");
    expect(debugRows().every((r) => r.payload === null)).toBe(true);
    expect(events()).toEqual([
      { kind: "source-deleted", revision: storage.version().revision },
    ]);
    const bytes = db.serialize();
    db.close();
    db = new Database(bytes);
    expect(debugRows().every((r) => r.payload === null)).toBe(true);
    for (let n = 0; n < 60; n++) {
      complete(`del-${n}`, "Authored throwaway");
      storage.editSummary(storage.version(), `Revision ${n}`, now);
      deleteConversation(`del-${n}`);
    }
    expect(events()).toHaveLength(50);
    expect(JSON.stringify(events())).not.toContain("Revision");
    db.prepare(
      "update message set content='Edited' where conversation_id='B' and role='user'",
    ).run();
    expect(events().at(-1)!.kind).toBe("memory-revoked");
  });

  it("Clear removes all debug history and events; Off preserves without use", () => {
    seeded();
    deleteConversation("A");
    storage.control("disable", now);
    const kept = debugRows();
    expect(kept.length).toBeGreaterThan(0);
    expect(storage.read().text).toBe("");
    storage.control("enable", now);
    expect(debugRows()).toEqual(kept);
    storage.control("clear", now);
    expect(debugRows()).toEqual([]);
    expect(events()).toEqual([]);
  });

  it("is never part of status, pin or generation input", async () => {
    seeded();
    const marker = debugRows().find((r) => r.payload)!.payload!;
    db.prepare(
      "update summary_debug_revision set payload='DEBUG-ONLY-MARKER'",
    ).run();
    const next = history.admit("B", "Next");
    const pin =
      readSummaryPin("B") ??
      history.read(next.admission).segment.pinnedSummary!;
    expect(summaryPinInput(pin)).not.toContain("DEBUG-ONLY-MARKER");
    expect(JSON.stringify(storage.status(now))).not.toContain(
      "DEBUG-ONLY-MARKER",
    );
    history.abandon(next.admission);
    complete("B", "Another source");
    const batch = ready();
    expect(JSON.stringify(batch)).not.toContain("DEBUG-ONLY-MARKER");
    expect(marker).toBeTruthy();
  });
});

describe("authored schema26 to schema27 migration", () => {
  it("preserves populated summary, preferences, originals, frontier and accounting without inventing history", () => {
    const text = seeded();
    complete("C", "Pending after publication.");
    removeDeletionContinuityFixtureSchema(db);
    const tables = [
      "message",
      "summary_state",
      "summary_preference",
      "summary_disposition",
      "summary_attempt",
      "summary_spend",
      "conversation_turn",
      "conversation_summary_pin",
    ];
    const snapshot = () =>
      tables.map((t) => db.prepare(`select * from ${t} order by 1`).all());
    const before = snapshot();
    const privacy = (
      db
        .prepare(
          "select privacy_generation n from conversation_history_control",
        )
        .get() as { n: number }
    ).n;
    const result = migrateDatabase(db);
    expect(result).toMatchObject({
      fromVersion: 26,
      toVersion: 27,
      applied: ["27:memory_survives_source_deletion"],
      integrity: "ok",
    });
    expect(snapshot()).toEqual(before);
    expect(debugRows()).toEqual([]);
    expect(events()).toEqual([]);
    expect(storage.status(now).coverageLost).toBe(false);
    expect(
      db
        .prepare(
          "select memory_generation m,deletion_generation d from conversation_history_control",
        )
        .get(),
    ).toEqual({ m: privacy, d: 0 });
    expect(storage.inspect().text).toBe(text);
    expect(db.pragma("foreign_key_check")).toEqual([]);
    const bytes = db.serialize();
    db.close();
    db = new Database(bytes);
    expect(migrateDatabase(db).applied).toEqual([]);
    deleteConversation("A");
    expect(storage.inspect().text).toBe(text);
  });
});
