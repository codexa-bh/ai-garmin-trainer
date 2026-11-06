import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { migrateDatabase, SCHEMA_MIGRATIONS } from "@/lib/db/migrations";
import {
  summaryStorage as storage,
  noteSummaryActivity,
} from "@/lib/db/summary-storage";
import { conversationHistory as history } from "@/lib/db/conversation-history";
import {
  adoptSummaryPin,
  readSummaryPin,
} from "@/lib/db/conversation-summary-pin";
import { summaryPinInput } from "@/lib/chat/summary-pin";
import { createSummaryEngine } from "@/lib/memory/summary-application";
import {
  emptySummary,
  minimizeSummarySource,
  validateSummaryReplacement,
  type SummaryBatch,
} from "@/lib/memory/summary-policy";
import {
  summaryRebuildInventory,
  startSummaryRebuild,
  readSummaryRebuildBatch,
  summaryRebuildStatus,
  cancelSummaryRebuild,
} from "@/lib/db/summary-rebuild";
let db: Database.Database, now: number;
vi.mock("@/lib/db/connection", () => ({ getDatabase: () => db }));
beforeEach(() => {
  db = new Database(":memory:");
  migrateDatabase(db);
  now = Date.now();
  storage.configure(true, "gpt-6-luna", 1000);
});
afterEach(() => {
  db.close();
  vi.restoreAllMocks();
});
function candidate(job: SummaryBatch, text: string) {
  const inputs = job.sources.flatMap((source) => {
    const input = minimizeSummarySource(source);
    return input ? [input] : [];
  });
  return validateSummaryReplacement({ summary: text }, job, inputs)!;
}
function originals(count: number) {
  db.prepare(
    "insert into conversation(id,title,created_at,updated_at) values('authored','Authored',1,1)",
  ).run();
  const insert = db.prepare(
    "insert into message(id,conversation_id,role,content,created_at) values(?,'authored','user',?,?)",
  );
  for (let n = 0; n < count; n++)
    insert.run(
      `original-${n}`,
      `Authored durable statement ${n}`,
      1700000000000 + n,
    );
}
function ready(id: string) {
  noteSummaryActivity(now);
  now += 3000;
  const job = storage.admit(now, id);
  expect(job).not.toBeNull();
  return job!;
}
function begin(id = "rebuild") {
  const inventory = summaryRebuildInventory("boot");
  startSummaryRebuild(id, inventory.snapshot, "boot", now);
  return inventory;
}
function complete(
  chat = "incremental",
  user = "Short weekdays because caregiving limits time.",
) {
  const admitted = history.admit(chat, user);
  history.complete(admitted.admission, {
    content: "Acknowledged",
    grounding: null,
  });
  return admitted;
}
describe("complete-text real SQLite lifecycle", () => {
  it("preserves above20000 text, preferences and historical condensation accounting across target lowering and SQLite reopen without migration", () => {
    const text = "😀".repeat(20001);
    storage.editSummary(storage.version(), text, now);
    storage.edit(
      storage.version(),
      null,
      "Independent preference. ".repeat(400),
      now,
    );
    complete();
    const job = ready("historical");
    expect(storage.reserve(job, now)).toBe(true);
    storage.usage(job, { input: 10, output: 20, cached: 0 }, "value", {
      invariant: "character-cap",
      actual: 6578,
      limit: 6000,
    });
    storage.fail(job, "summary_invalid_output", now);
    // Authored legacy observation, never a new provider effect or spend claim.
    db.prepare(
      "insert into summary_attempt(job_id,started_at,outcome,reserved,reserved_usd,usage_json,source_ids_json,upper_event,prior_revision,privacy_generation,control_generation) select 'historical:condense',started_at,outcome,1,0.25,usage_json,source_ids_json,upper_event,prior_revision,privacy_generation,control_generation from summary_attempt where job_id='historical'",
    ).run();
    const historyBefore = db
      .prepare("select * from summary_attempt order by job_id")
      .all();
    const spendBefore = db.prepare("select * from summary_spend").all();
    const preferencesBefore = storage.preferences();
    const revision = storage.version().revision;
    const schema = db.pragma("user_version");
    storage.configure(true, "gpt-6-luna", 6000);
    storage.configure(true, "gpt-6-luna", 1000);
    expect(storage.version().revision).toBe(revision);
    expect(storage.inspect().text).toBe(text);
    expect(storage.status(now)).toMatchObject({ characters: 20001, cap: 1000 });
    const bytes = db.serialize();
    db.close();
    db = new Database(bytes);
    expect(storage.read().text).toBe(text);
    expect(storage.preferences()).toEqual(preferencesBefore);
    expect(
      db.prepare("select * from summary_attempt order by job_id").all(),
    ).toEqual(historyBefore);
    expect(db.prepare("select * from summary_spend").all()).toEqual(
      spendBefore,
    );
    expect(db.pragma("user_version")).toEqual(schema);
    expect(db.pragma("integrity_check")).toEqual([{ integrity_check: "ok" }]);
    expect(db.pragma("foreign_key_check")).toEqual([]);
    const beforeInvalid = db.serialize();
    for (const cap of [999, 20001, NaN, 6000.5])
      expect(() => storage.configure(true, "gpt-6-luna", cap)).toThrow(
        "summary_invalid_character_limit",
      );
    expect(db.serialize()).toEqual(beforeInvalid);
  });
  it("requests one advisory target without hidden word/percentage ceilings", async () => {
    storage.configure(true, "gpt-6-luna", 6000);
    complete();
    noteSummaryActivity(now);
    now += 3000;
    const text = Array.from(
      { length: 85 },
      (_, n) => `Authored constraint ${n} has its own explicit rationale.`,
    ).join(" ");
    expect(text.length).toBeGreaterThan(3600);
    expect(text.length).toBeLessThan(6000);
    const engine = createSummaryEngine({
      storage,
      now: () => now,
      identity: () => "headroom",
      current: () => true,
      jitter: () => 0,
      generation: {
        generate: async (system, prompt) => {
          const input = JSON.parse(prompt);
          expect(input.targetCharacters).toBe(6000);
          expect(input).not.toHaveProperty("characterCap");
          expect(input).not.toHaveProperty("softTargetCharacters");
          expect(system).toContain("advisory guidance");
          expect(system).not.toMatch(/Hard limit|about 500 words/);
          return {
            patch: { summary: text },
            usage: { input: 1, output: 1, cached: 0 },
          };
        },
      },
    });
    await engine.tick(new AbortController().signal);
    expect(storage.inspect().text === text).toBe(true);
  });
  it("keeps malformed private payload and provider-message text out of closed metadata diagnostics", async () => {
    complete();
    noteSummaryActivity(now);
    now += 3000;
    const engine = createSummaryEngine({
      storage,
      now: () => now,
      identity: () => "closed-errors",
      current: () => true,
      jitter: () => 0,
      generation: {
        generate: async () => {
          throw Error("summary_private_source_snippet");
        },
      },
    });
    await engine.tick(new AbortController().signal);
    expect(storage.status(now).reason).toBe("summary_provider_failure");
    expect(
      JSON.stringify(db.prepare("select * from summary_attempt").all()),
    ).not.toContain("private_source_snippet");
    const row = db
      .prepare("select revision,frontier,privacy_generation from summary_state")
      .get() as {
      revision: number;
      frontier: number;
      privacy_generation: number;
    };
    const payload = "private unparseable source text";
    const checksum = createHash("sha256")
      .update(
        JSON.stringify([
          row.revision,
          row.frontier,
          row.privacy_generation,
          payload,
        ]),
      )
      .digest("hex");
    db.prepare("update summary_state set payload=?,checksum=?").run(
      payload,
      checksum,
    );
    const before = db.serialize();
    expect(storage.status(now).reason).toBe("summary_corrupt");
    expect(() => storage.inspect()).toThrow("summary_corrupt");
    expect(db.serialize().equals(before)).toBe(true);
    expect(JSON.stringify(storage.status(now))).not.toContain(
      "private unparseable",
    );
  });
  it("never retries an interrupted full-history effect even after a transient backoff when there is no routine backlog", async () => {
    originals(184);
    begin();
    let calls = 0;
    const engine = createSummaryEngine({
      storage,
      now: () => now,
      identity: () => `refused-${calls}`,
      current: () => true,
      jitter: () => 0,
      generation: {
        generate: async () => {
          calls++;
          throw Object.assign(Error("vendor failure"), { statusCode: 500 });
        },
      },
    });
    now += 3000;
    await engine.tick(new AbortController().signal);
    expect(calls).toBe(1);
    expect(summaryRebuildStatus()?.state).toBe("interrupted");
    for (let n = 0; n < 3; n++) {
      now += 600000;
      await engine.tick(new AbortController().signal);
    }
    expect(calls).toBe(1);
    expect(storage.status(now).pending).toBe(0);
  });
  it("processes all184 sources in five full replacements, starts empty and publishes exactly once", () => {
    storage.editSummary(storage.version(), "Previous valid publication", now);
    storage.edit(storage.version(), null, "Independent manual preference", now);
    const old = storage.inspect(),
      revision = storage.version().revision;
    originals(184);
    expect(begin().counts.includedUserMessages).toBe(184);
    let prior = emptySummary(),
      processed = 0,
      batches = 0;
    while (readSummaryRebuildBatch()) {
      const job = ready(`batch-${batches}`);
      expect(job.previous).toEqual(prior);
      expect(job.sources).toHaveLength(Math.min(40, 184 - processed));
      const text = `Full revised draft ${++batches}; short weekdays due to caregiving.`;
      expect(storage.reserve(job, now)).toBe(true);
      expect(storage.publish(job, candidate(job, text), now)).toBe(true);
      processed += job.sources.length;
      prior = { version: 2, text };
      if (processed < 184) {
        expect(storage.inspect()).toEqual(old);
        expect(storage.version().revision).toBe(revision);
      }
    }
    expect(batches).toBe(5);
    expect(processed).toBe(184);
    expect(storage.inspect()).toEqual(prior);
    expect(storage.version().revision).toBe(revision + 1);
    expect(storage.preferences().map((p) => p.text)).toEqual([
      "Independent manual preference",
    ]);
    expect(summaryRebuildStatus()).toMatchObject({
      state: "complete",
      processed: 184,
      total: 184,
      dispositions: { processed: 184 },
    });
    const receipt = db
      .prepare("select candidate_json from summary_rebuild")
      .get() as { candidate_json: string };
    expect(JSON.parse(receipt.candidate_json)).toEqual(emptySummary());
    expect(
      (
        db.prepare("select count(*) n from summary_item_disposition").get() as {
          n: number;
        }
      ).n,
    ).toBe(0);
  });
  it("keeps post-review arrivals pending instead of invalidating the pool or advancing past its captured frontier", () => {
    storage.editSummary(storage.version(), "Old publication", now);
    originals(81);
    begin();
    const first = ready("first-reviewed");
    expect(first.rebuild?.upperCompletion).toBe(0);
    expect(
      storage.publish(
        first,
        candidate(first, "First complete temporary draft"),
        now,
      ),
    ).toBe(true);
    complete(
      "new-arrival",
      "A new eligible preference after the reviewed boundary.",
    );
    let calls = 1;
    while (readSummaryRebuildBatch()) {
      const job = ready(`remaining-${calls++}`);
      expect(
        job.sources.every(
          (source) => source.original?.conversationId === "authored",
        ),
      ).toBe(true);
      expect(
        storage.publish(
          job,
          candidate(job, "Final complete reviewed summary"),
          now,
        ),
      ).toBe(true);
    }
    expect(calls).toBe(3);
    expect(summaryRebuildStatus()).toMatchObject({
      state: "complete",
      processed: 81,
      total: 81,
    });
    expect(storage.status(now)).toMatchObject({ frontier: 0, pending: 1 });
    const subsequent = ready("new-incremental");
    expect(subsequent.sources).toHaveLength(1);
    expect(subsequent.sources[0].user).toContain("new eligible preference");
    expect(subsequent.previous.text).toBe("Final complete reviewed summary");
  });
  it("retains the old publication on second-batch failure/cancel and rejects late results", () => {
    storage.editSummary(storage.version(), "Old valid summary", now);
    originals(41);
    begin();
    const first = ready("first");
    expect(
      storage.publish(
        first,
        candidate(first, "First private temporary draft"),
        now,
      ),
    ).toBe(true);
    const second = ready("second");
    expect(second.previous.text).toBe("First private temporary draft");
    storage.reserve(second, now);
    storage.fail(second, "summary_invalid_output", now);
    expect(storage.inspect().text).toBe("Old valid summary");
    expect(summaryRebuildStatus()).toMatchObject({
      state: "interrupted",
      processed: 40,
      total: 41,
    });
    expect(storage.publish(second, candidate(second, "Late answer"), now)).toBe(
      false,
    );
    begin("replacement");
    const pending = ready("cancelled");
    expect(cancelSummaryRebuild("replacement")).toBe(true);
    expect(
      storage.publish(
        pending,
        candidate(pending, "Late cancelled answer"),
        now,
      ),
    ).toBe(false);
    expect(storage.inspect().text).toBe("Old valid summary");
  });
  it("shares full replacement with incremental generation and does not send preferences or reconciliation fields", async () => {
    storage.editSummary(storage.version(), "Previous useful summary", now);
    storage.edit(
      storage.version(),
      null,
      "Private authored preference not a generated source",
      now,
    );
    complete();
    let promptValue: Record<string, unknown> | undefined;
    const engine = createSummaryEngine({
      storage,
      now: () => now,
      identity: () => "engine",
      current: () => true,
      jitter: () => 0,
      generation: {
        generate: async (_system, prompt) => {
          promptValue = JSON.parse(prompt);
          return {
            patch: { summary: "Revised useful summary with rationale" },
            usage: { input: 100, output: 30, cached: null },
          };
        },
      },
    });
    noteSummaryActivity(now);
    now += 3000;
    await engine.tick(new AbortController().signal);
    expect(promptValue?.previous).toBe("Previous useful summary");
    expect(JSON.stringify(promptValue)).not.toMatch(
      /Private authored|sourceId|keep|upsert|replaces|requiredCoverage/,
    );
    expect(storage.inspect().text).toBe(
      "Revised useful summary with rationale",
    );
    expect(storage.preferences()).toHaveLength(1);
    expect(
      (
        db.prepare("select count(*) n from summary_disposition").get() as {
          n: number;
        }
      ).n,
    ).toBe(1);
  });
  it("keeps preferences outside generated allowance, revokes on source edits, and adopts latest on next admission", () => {
    storage.edit(storage.version(), null, "p".repeat(1100), now);
    expect(storage.preferences()[0].text.length).toBe(1100);
    storage.editSummary(storage.version(), "Generated text", now);
    const admitted = complete();
    const conversationId = admitted.admission.conversationId;
    db.transaction(() => adoptSummaryPin(conversationId, true))();
    const pin = readSummaryPin(conversationId)!;
    expect(JSON.parse(summaryPinInput(pin))).toMatchObject({
      generatedSummary: "Generated text",
      manualPreferences: ["p".repeat(1100)],
    });
    const job = ready("incremental");
    expect(storage.publish(job, candidate(job, "New publication"), now)).toBe(
      true,
    );
    expect(readSummaryPin(conversationId)?.value.text).toBe("Generated text");
    const next = history.admit(conversationId, "Another authored question");
    expect(next.admission).toBeTruthy();
    expect(readSummaryPin(conversationId)?.value.text).toBe("New publication");
    db.prepare("update message set content='Changed original' where id=?").run(
      admitted.userRecord.id,
    );
    expect(storage.inspect()).toEqual(emptySummary());
    expect(storage.preferences()[0].text.length).toBe(1100);
    expect(readSummaryPin(conversationId)).toBeNull();
    const afterPrivacy = history.admit(
      "after-source-edit",
      "Use my separately authored preference.",
    );
    const preferencePin = history.read(afterPrivacy.admission).segment
      .pinnedSummary!;
    expect(preferencePin.value.text).toBe("");
    expect(preferencePin.preferences[0].text).toBe("p".repeat(1100));
  });
  it("CAS, one writer, lease expiry, manual/config changes and no-save do not publish stale or excluded prose", () => {
    complete();
    const first = ready("writer");
    expect(storage.admit(now, "competitor")).toBeNull();
    storage.edit(storage.version(), null, "Authored preference", now);
    expect(storage.publish(first, candidate(first, "Stale answer"), now)).toBe(
      false,
    );
    const next = ready("lease");
    now += 30001;
    expect(
      storage.publish(next, candidate(next, "Expired lease answer"), now),
    ).toBe(false);
    storage.control("clear", now);
    expect(storage.preferences()).toEqual([]);
    complete("no-save", "Do not save this private request.");
    const noSave = ready("no-save");
    expect(
      candidate(noSave, "").dispositions.every((d) => d.reason !== "processed"),
    ).toBe(true);
    storage.publish(noSave, candidate(noSave, ""), now);
    expect(storage.inspect().text).toBe("");
  });
});
let schema23Snapshot: Buffer | undefined;
function schema23() {
  db.close();
  if (!schema23Snapshot) {
    const legacy = new Database(":memory:");
    for (const migration of SCHEMA_MIGRATIONS.filter((m) => m.version <= 23))
      for (const statement of migration.statements) legacy.exec(statement);
    legacy
      .prepare(
        "insert into app_metadata(key,value,updated_at) values('schema_version','23',1) on conflict(key) do update set value='23'",
      )
      .run();
    schema23Snapshot = legacy.serialize();
    legacy.close();
  }
  // Independent byte-identical legacy input per case, not repeated historical
  // DDL in a single5s test on a contended CI runner. Real migration24 still runs.
  db = new Database(Buffer.from(schema23Snapshot));
  expect(
    db
      .prepare("select value from app_metadata where key='schema_version'")
      .get(),
  ).toEqual({ value: "23" });
  expect(
    db.prepare("select format_version from summary_state where id=1").get(),
  ).toEqual({ format_version: 1 });
}
describe("forward format admission", () => {
  it("carries standalone authored preferences losslessly, preserves legacy bytes, and refuses old readers", () => {
    schema23();
    const item = {
      id: "authored",
      text: "Standalone preference",
      category: "constraint",
      stance: "user-stated",
      sourceIds: ["manual:authored:1"],
      priority: 5,
      expiresAt: null,
      reviewAt: 1,
    };
    const raw = JSON.stringify(item);
    db.prepare("insert into summary_manual values(?,?)").run(item.id, raw);
    migrateDatabase(db);
    expect(storage.preferences()).toEqual([
      { id: "authored", text: item.text },
    ]);
    expect(
      (
        db.prepare("select payload from summary_manual").get() as {
          payload: string;
        }
      ).payload,
    ).toBe(raw);
    expect(
      (
        db.prepare("select format_version from summary_state").get() as {
          format_version: number;
        }
      ).format_version,
    ).toBe(2);
    const before = db.serialize();
    migrateDatabase(db);
    expect(db.serialize().equals(before)).toBe(true);
  });
  it("refuses ambiguous source-linked edits transactionally without choosing a D2 conversion", () => {
    schema23();
    const raw = JSON.stringify({
      id: "edited",
      text: "Authored/generated mixture",
      sourceIds: ["original:authored"],
      expiresAt: null,
    });
    db.prepare("insert into summary_manual values('edited',?)").run(raw);
    const before = db.serialize();
    expect(() => migrateDatabase(db)).toThrow(
      "summary_legacy_authored_decision_required",
    );
    expect(db.serialize().equals(before)).toBe(true);
  });
  it.each([
    { stance: "discussed-not-endorsed" },
    { priority: 0 },
    { category: "unsupported" },
    { reviewAt: "unknown" },
    { extra: true },
  ])(
    "refuses corrupt standalone manual metadata transactionally: %j",
    (changed) => {
      schema23();
      const item = {
        id: "authored",
        text: "Preserved original preference.",
        category: "constraint",
        stance: "user-stated",
        sourceIds: ["manual:authored:1"],
        priority: 5,
        expiresAt: null,
        reviewAt: 1,
        ...changed,
      };
      db.prepare("insert into summary_manual values(?,?)").run(
        item.id,
        JSON.stringify(item),
      );
      const before = db.serialize();
      expect(() => migrateDatabase(db)).toThrow(
        "summary_legacy_corrupt_or_unsupported",
      );
      expect(db.serialize().equals(before)).toBe(true);
    },
  );
  it("refuses corrupt and unsupported legacy state without resetting originals", () => {
    schema23();
    db.prepare("update summary_state set format_version=99").run();
    const before = db.serialize();
    expect(() => migrateDatabase(db)).toThrow();
    expect(db.serialize().equals(before)).toBe(true);
    schema23();
    const payload = JSON.stringify({
      version: 1,
      items: [],
      text: "invented mismatch",
    });
    db.prepare("update summary_state set payload=?,checksum=?").run(
      payload,
      createHash("sha256").update(payload).digest("hex"),
    );
    const corrupt = db.serialize();
    expect(() => migrateDatabase(db)).toThrow();
    expect(db.serialize().equals(corrupt)).toBe(true);
    schema23();
    db.prepare(
      "insert into conversation(id,title,created_at,updated_at) values('authored','Authored',1,1)",
    ).run();
    db.prepare(
      "insert into conversation_summary_pin(conversation_id,payload,seal) values('authored','{\"version\":99}', 'bad-seal')",
    ).run();
    const corruptPin = db.serialize();
    expect(() => migrateDatabase(db)).toThrow(
      "summary_legacy_corrupt_or_unsupported",
    );
    expect(db.serialize().equals(corruptPin)).toBe(true);
  });
});
