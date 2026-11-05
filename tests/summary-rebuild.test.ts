import Database from "better-sqlite3";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { migrateDatabase } from "@/lib/db/migrations";
import {
  summaryStorage as storage,
  summaryInspectionSources,
  noteSummaryActivity,
} from "@/lib/db/summary-storage";
import { conversationHistory as history } from "@/lib/db/conversation-history";
import {
  summaryRebuildInventory,
  startSummaryRebuild as start,
  readSummaryRebuildBatch,
  summaryRebuildStatus as status,
  cancelSummaryRebuild,
  reconcileSummaryRebuild,
} from "@/lib/db/summary-rebuild";
import {
  minimizeSummarySource,
  SUMMARY_SYSTEM,
  validateSummaryPatch,
  type SummaryBatch,
  type SummaryCandidate,
} from "@/lib/memory/summary-policy";
import { parseSummaryCommand } from "@/lib/memory/summary-controls";
import { createSummaryEngine } from "@/lib/memory/summary-application";
import { removeRebuildFixtureSchema } from "./conversation-migration-fixture";
let db: Database.Database, now: number;
const inventory = () => summaryRebuildInventory("boot");
vi.mock("@/lib/db/connection", () => ({ getDatabase: () => db }));
beforeEach(() => {
  db = new Database(":memory:");
  migrateDatabase(db);
  now = Date.now();
  storage.configure(true, "gpt-6-luna", 6000);
});
afterEach(() => {
  db.close();
  vi.restoreAllMocks();
});
function message(
  id: string,
  content = "Short weekdays because caregiving limits time; long weekday plans repeatedly failed.",
  role = "user",
  chat = "authored",
  time = 1700000000,
) {
  db.prepare(
    "insert into conversation(id,title,created_at,updated_at) values(?,?,?,?) on conflict do nothing",
  ).run(chat, "Authored rebuild test", time, time);
  db.prepare(
    "insert into message(id,conversation_id,role,content,created_at) values(?,?,?,?,?)",
  ).run(id, chat, role, content, time);
}
// Supplied patches prove mechanics/validation, not actual model relevance.
function proposal(batch: SummaryBatch, keep = true): SummaryCandidate {
  const inputs = batch.sources.flatMap((s) => {
    const input = minimizeSummarySource(s);
    return input ? [input] : [];
  });
  const patch = {
    version: 1,
    keep: keep ? batch.previous.items.map((i) => i.id) : [],
    upsert:
      batch.previous.items.length && keep
        ? []
        : [
            {
              id: `choice_${batch.jobId.replace(/[^a-z0-9]/gi, "")}`,
              text: "Short weekday sessions suit caregiving; repeatedly overlong weekday plans failed.",
              category: "constraint",
              stance: "user-stated",
              sourceIds: [inputs[0].sourceId],
              priority: 5,
              expiresAt: null,
              replaces: [],
            },
          ],
    remove: keep
      ? []
      : batch.previous.items.map((i) => ({ id: i.id, reason: "low-value" })),
    coverage: inputs.map((s, i) => ({
      sourceId: s.sourceId,
      reason:
        !batch.previous.items.length && i === 0 ? "represented" : "low-value",
    })),
  };
  return validateSummaryPatch(patch, batch, inputs, now)!;
}
function begin(id = "operation") {
  const i = inventory();
  start(id, i.snapshot, "boot", now);
  return i;
}
function oldMemory() {
  const turn = history.admit("old-chat", "I prefer short weekday coaching.");
  history.complete(turn.admission, {
    content: "Acknowledged.",
    grounding: null,
  });
  noteSummaryActivity(now);
  now += 3000;
  const job = storage.admit(now, "old-memory")!;
  expect(storage.publish(job, proposal(job), now)).toBe(true);
  now += 3000;
  return storage.inspect();
}
describe("full-pool original admission and local preflight", () => {
  it("counts more than the sidebar/import cap without export or effects and preserves genuine original roles/time/hash", () => {
    for (let n = 0; n < 241; n++)
      message(`user-${n}`, undefined, "user", `chat-${n % 13}`, 1700000000 + n);
    message("unsafe", "My password is synthetic-private.");
    message("no-save", "Do not save this coaching preference.");
    message(
      "assistant-only",
      "An unendorsed suggestion.",
      "assistant",
      "assistant-only",
    );
    const bytes = db.serialize();
    const inspected = inventory();
    expect(db.serialize()).toEqual(bytes);
    expect(inspected.counts).toMatchObject({
      chats: 15,
      messages: 244,
      userMessages: 243,
      includedChats: 13,
      includedUserMessages: 241,
      excludedUserMessages: 2,
      assistantContext: 0,
      excludedMessages: 3,
    });
    expect(inspected.reasons).toEqual({ "unsafe-or-unresolved-context": 2 });
    expect(
      inspected.preflight.estimatedUsd.conservativeMaximum,
    ).toBeGreaterThan(0);
    expect(inspected.preflight.ready).toBe(true);
    begin();
    const first = readSummaryRebuildBatch()!;
    expect(first.sources).toHaveLength(20);
    const input = minimizeSummarySource(first.sources[0])!;
    expect(input.original).toMatchObject({
      messageId: "user-0",
      speaker: "user",
      createdAt: 1700000000,
    });
    expect(input.sourceId).toMatch(/^original:[a-f0-9]{64}$/);
    expect(
      db.prepare("select count(*) as n from conversation_turn").get(),
    ).toEqual({ n: 0 });
  });
  it("anchors relative-time prose without keyword-dropping a durable conclusion and screens context plus its originating authority", () => {
    message(
      "u1",
      "I have not chosen equipment; short weekdays suit caregiving.",
      "user",
      "A",
      1700000000,
    );
    message(
      "a1",
      "Consider poles or a bag; neither is chosen yet.",
      "assistant",
      "A",
      1700000001,
    );
    message(
      "u2",
      "Today was noisy, but long weekdays failed repeatedly because caregiving limits time. I reject the bag because it is awkward.",
      "user",
      "A",
      1700000002,
    );
    begin();
    const batch = readSummaryRebuildBatch()!;
    const source = batch.sources.find((s) => s.original?.messageId === "u2")!;
    const input = minimizeSummarySource(source)!;
    expect(input.user).toContain("Today");
    expect(input.referent).toContain("neither is chosen");
    expect(input.original?.context).toMatchObject({
      messageId: "a1",
      speaker: "assistant",
      createdAt: 1700000001,
    });
    const candidate = validateSummaryPatch(
      {
        version: 1,
        keep: [],
        remove: [],
        upsert: [
          {
            id: "choice",
            text: "The bag was rejected as awkward; poles remain unresolved.",
            category: "rejected",
            stance: "user-stated",
            sourceIds: [input.sourceId],
            priority: 4,
            expiresAt: null,
            replaces: [],
          },
        ],
        coverage: batch.sources.map((s) => ({
          sourceId: s.sourceId,
          reason: s.sourceId === input.sourceId ? "represented" : "low-value",
        })),
      },
      {
        ...batch,
        jobId: "x",
        cap: 6000,
        revision: 0,
        privacyGeneration: 0,
        controlGeneration: 0,
        manualRevision: 0,
        frontier: 0,
        upper: 0,
      },
      batch.sources.map((s) => minimizeSummarySource(s)!),
      now,
    )!;
    expect(candidate.value.items[0].sourceIds).toContain(
      input.original!.context!.sourceId,
    );
    expect(candidate.value.items[0].sourceIds).toContain(
      input.original!.context!.userSourceId,
    );
    now += 3000;
    const job = storage.admit(now, "context-link")!;
    expect(storage.publish(job, candidate, now)).toBe(true);
    expect(summaryInspectionSources()).toContainEqual({
      sourceId: input.original!.context!.sourceId,
      conversationId: "A",
      messageId: "a1",
      manual: false,
    });
    db.prepare("insert into summary_suppression(source_id) values(?)").run(
      input.original!.context!.userSourceId,
    );
    expect(inventory().counts.assistantContext).toBe(0);
  });
  it("does not bring no-save/unsafe prior user content back through apparently safe assistant prose", () => {
    message(
      "u1",
      "Do not save this: I prefer mornings.",
      "user",
      "A",
      1700000000,
    );
    message("a1", "Morning coaching suits you.", "assistant", "A", 1700000001);
    message("u2", "I prefer short weekday sessions.", "user", "A", 1700000002);
    begin();
    expect(readSummaryRebuildBatch()!.sources[0].referent).toBeNull();
  });
  it("Clear covers unlinked originals even with no completion/admission rows and does not reopen on enable", () => {
    message("pre-clear");
    storage.control("clear", now);
    storage.control("disable", now);
    storage.control("enable", now);
    message("post-clear", undefined, "user", "A", 1700000001);
    expect(inventory().counts).toMatchObject({
      includedUserMessages: 1,
      excludedUserMessages: 1,
    });
    expect(inventory().reasons).toEqual({
      "unproven-legacy-or-cleared-original": 1,
    });
  });
  it("discloses oversized sources and unresolved tied assistant context without clipping or invented pairing", () => {
    message("large", "x".repeat(16001));
    message("a1", "First option is poles.", "assistant", "A", 1700000000);
    message("u1", "I choose the first option.", "user", "A", 1700000000);
    expect(inventory().counts.includedUserMessages).toBe(0);
    expect(inventory().reasons).toEqual({
      "oversized-message": 1,
      "unsafe-or-unresolved-context": 1,
    });
    expect(() => begin()).toThrow("not_ready");
  });
  it("refuses extra/stale/unknown command fields", () => {
    const base = {
      version: 1,
      expected: storage.version(),
      action: "rebuild-start",
      id: "op",
      snapshot: inventory().snapshot,
    };
    expect(parseSummaryCommand(base)).not.toBeNull();
    for (const changed of [
      { ...base, force: true },
      { ...base, snapshot: "unknown" },
      { ...base, id: "../escape" },
    ])
      expect(parseSummaryCommand(changed)).toBeNull();
    expect(
      parseSummaryCommand({
        version: 1,
        expected: storage.version(),
        action: "rebuild-cancel",
        id: "op",
      }),
    ).not.toBeNull();
  });
});
describe("same writer, staged candidate and atomic complete replacement", () => {
  it("handles >200 originals in finite batches, retaining old memory/pins until one complete publication, without copying old generated noise", () => {
    const old = oldMemory();
    storage.edit(storage.version(), null, "Keep concise coaching.", now);
    const before = storage.inspect(),
      revision = storage.version().revision;
    history.admit("pinned-chat", "A pending message excluded by this rebuild.");
    const pin = db
      .prepare(
        "select payload,seal from conversation_summary_pin where conversation_id='pinned-chat'",
      )
      .get();
    for (let n = 0; n < 221; n++)
      message(`u-${n}`, undefined, "user", `A${n % 3}`, 1700000000 + n);
    const admitted = begin();
    let iterations = 0;
    while (status()!.state === "active") {
      now += 2100;
      const job = storage.admit(now, `batch-${iterations}`)!;
      expect(job).not.toBeNull();
      expect(job.sources.length).toBeLessThanOrEqual(20);
      if (iterations === 0) expect(job.previous.items).toEqual([]);
      expect(storage.reserve(job, now)).toBe(true);
      const candidate = proposal(job);
      expect(candidate).not.toBeNull();
      expect(storage.publish(job, candidate, now)).toBe(true);
      if (status()!.state === "active") {
        expect(storage.inspect()).toEqual(before);
        expect(storage.version().revision).toBe(revision);
      }
      expect(
        db
          .prepare(
            "select payload,seal from conversation_summary_pin where conversation_id='pinned-chat'",
          )
          .get(),
      ).toEqual(pin);
      iterations++;
    }
    expect(iterations).toBeGreaterThan(10);
    expect(status()).toMatchObject({
      state: "complete",
      processed: admitted.counts.includedUserMessages,
      total: admitted.counts.includedUserMessages,
    });
    expect(storage.version().revision).toBe(revision + 1);
    expect(storage.inspect().items.some((i) => i.id === old.items[0].id)).toBe(
      false,
    );
    expect(
      storage.inspect().items.some((i) => i.text === "Keep concise coaching."),
    ).toBe(true);
    expect(
      summaryInspectionSources().some((s) => s.messageId?.startsWith("u-")),
    ).toBe(true);
    expect(db.prepare("select count(*) as n from message").get()).toEqual({
      n: 224,
    });
    expect(db.prepare("pragma integrity_check").get()).toEqual({
      integrity_check: "ok",
    });
  });
  it("reconciles the same Start identity without replay, refuses concurrent starts and stale preflight", () => {
    message("u1");
    const before = inventory();
    expect(start("same", before.snapshot, "boot", now)).toBe("same");
    expect(start("same", before.snapshot, "boot", now)).toBe("same");
    expect(() => start("different", before.snapshot, "boot", now)).toThrow(
      "busy",
    );
    expect(() => start("same", "0".repeat(64), "boot", now)).toThrow(
      "identity_conflict",
    );
    cancelSummaryRebuild("same");
    message("u2");
    expect(() => start("new", before.snapshot, "boot", now)).toThrow(
      "stale_preflight",
    );
    expect(
      db.prepare("select count(*) as n from summary_attempt").get(),
    ).toEqual({ n: 0 });
  });
  it.each([
    "cancel",
    "failure",
    "manual",
    "clear",
    "disable",
    "edit-source",
    "new-source",
    "timestamp",
    "reopen",
  ])(
    "retains active memory on unsuccessful %s (except independent explicit privacy/control revocation)",
    (action) => {
      oldMemory();
      message("u1");
      begin();
      now += 3000;
      const job = storage.admit(now, "in-flight")!;
      expect(storage.reserve(job, now)).toBe(true);
      const candidate = proposal(job),
        before = storage.inspect();
      if (action === "cancel") cancelSummaryRebuild("operation");
      if (action === "failure")
        storage.fail(job, "summary_invalid_output", now);
      if (action === "manual")
        storage.edit(storage.version(), null, "Use concise coaching.", now);
      if (action === "clear" || action === "disable")
        storage.control(action, now);
      if (action === "edit-source")
        db.prepare(
          "update message set content='A corrected original.' where id='u1'",
        ).run();
      if (action === "new-source") message("u2");
      if (action === "timestamp")
        db.prepare(
          "update message set created_at=created_at+1 where id='u1'",
        ).run();
      if (action === "reopen") {
        const bytes = db.serialize();
        db.close();
        db = new Database(bytes);
        reconcileSummaryRebuild("new-boot", now);
      }
      expect(storage.publish(job, candidate, now)).toBe(false);
      if (
        ["cancel", "failure", "new-source", "timestamp", "reopen"].includes(
          action,
        )
      )
        expect(storage.inspect()).toEqual(before);
      expect(storage.status(now).reservedUsdToday).toBeGreaterThan(0);
      expect(db.prepare("select count(*) as n from message").get()).toEqual({
        n: action === "new-source" ? 4 : 3,
      });
    },
  );
  it("respects linked suppression/manual overlays and rejects final manual-capacity overflow", () => {
    oldMemory();
    const item = storage.inspect().items[0];
    storage.forget(storage.version(), item.id, now);
    message("u1");
    expect(inventory().reasons.suppressed).toBe(1);
    storage.edit(storage.version(), null, "q".repeat(1200), now);
    storage.configure(true, "gpt-6-luna", 1000); // Existing active text too large is independently revoked.
    // Use an admitted candidate that fits alone, but cannot discard the overlay.
    begin();
    now += 3000;
    const job = storage.admit(now, "capacity")!;
    const before = storage.inspect();
    expect(storage.publish(job, proposal(job), now)).toBe(false);
    expect(storage.inspect()).toEqual(before);
    storage.fail(job, "summary_publication_conflict", now);
    expect(status()?.state).toBe("interrupted");
  });
  it("records invalid generation/unknown cost without partial publication or automatic retry", async () => {
    const before = oldMemory();
    message("u1");
    begin();
    now += 3000;
    const generate = vi.fn(async (_system: string, _prompt: string) => ({
      patch: { invalid: true },
      usage: { input: null, output: null, cached: null },
    }));
    const engine = createSummaryEngine({
      storage,
      generation: { generate },
      identity: () => "invalid",
      now: () => now,
      current: () => true,
      jitter: () => 0,
    });
    await engine.tick(new AbortController().signal);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(generate.mock.calls[0][0]).toBe(SUMMARY_SYSTEM);
    expect(SUMMARY_SYSTEM).toContain("FUTURE COACHING");
    expect(SUMMARY_SYSTEM).toContain("one incident is not a universal rule");
    expect(SUMMARY_SYSTEM).toContain("latest explicit correction");
    expect(SUMMARY_SYSTEM).toContain("A question is not commitment");
    expect(
      JSON.parse(generate.mock.calls[0][1]).newSources[0].original.speaker,
    ).toBe("user");
    expect(storage.inspect()).toEqual(before);
    expect(status()?.state).toBe("interrupted");
    expect(storage.status(now).unknownReservedUsd).toBeGreaterThan(0);
    await engine.tick(new AbortController().signal);
    expect(generate).toHaveBeenCalledTimes(1);
  });
  it.each([false, true])(
    "supplies the exact noise-only coverage census and keeps strict incomplete rejection (%s)",
    async (incomplete) => {
      storage.edit(storage.version(), null, "Keep concise coaching.", now);
      const old = storage.inspect();
      for (let n = 0; n < 25; n++)
        message(
          `noise-${n}`,
          "One-off picnic bench chatter, not future coaching context.",
        );
      begin();
      now += 3000;
      const generate = vi.fn(async (_system: string, prompt: string) => {
        const request = JSON.parse(prompt);
        expect(request.requiredCoverageSourceIds).toEqual(
          request.newSources.map(
            (source: { sourceId: string }) => source.sourceId,
          ),
        );
        expect(_system).toContain(
          "coverage.length MUST equal requiredCoverageSourceIds.length",
        );
        return {
          patch: {
            version: 1,
            keep: request.previous.map((item: { id: string }) => item.id),
            upsert: [],
            remove: [],
            coverage: (incomplete
              ? request.requiredCoverageSourceIds.slice(0, -1)
              : request.requiredCoverageSourceIds
            ).map((sourceId: string) => ({ sourceId, reason: "low-value" })),
          },
          usage: { input: 100, output: 50, cached: 0 },
        };
      });
      let index = 0;
      const engine = createSummaryEngine({
        storage,
        generation: { generate },
        identity: () => `census-${index++}`,
        now: () => now,
        current: () => true,
        jitter: () => 0,
      });
      await engine.tick(new AbortController().signal);
      expect(storage.inspect()).toEqual(old);
      if (incomplete) {
        expect(status()).toMatchObject({ state: "interrupted", processed: 0 });
        expect(
          db
            .prepare(
              "select usage_json from summary_attempt where job_id='census-0'",
            )
            .get(),
        ).toEqual({
          usage_json: JSON.stringify({
            input: 100,
            output: 50,
            cached: 0,
            rejection: "coverage_incomplete",
          }),
        });
      } else {
        expect(status()).toMatchObject({ state: "active", processed: 20 });
        now += 2100;
        await engine.tick(new AbortController().signal);
        expect(status()).toMatchObject({ state: "complete", processed: 25 });
        expect(storage.inspect()).toEqual(old);
      }
      expect(generate).toHaveBeenCalledTimes(incomplete ? 1 : 2);
    },
  );
  it("scrubs staged text on authority/privacy invalidation without losing operation progress or original bytes", () => {
    oldMemory();
    for (let n = 0; n < 25; n++) message(`privacy-${n}`);
    begin();
    now += 3000;
    const job = storage.admit(now, "stage-privacy")!;
    expect(storage.publish(job, proposal(job), now)).toBe(true);
    expect(status()?.processed).toBe(20);
    expect(
      (
        db.prepare("select candidate_json from summary_rebuild").get() as {
          candidate_json: string;
        }
      ).candidate_json,
    ).toContain("caregiving");
    storage.control("clear", now);
    expect(status()).toMatchObject({ state: "invalidated", processed: 20 });
    expect(
      db
        .prepare(
          "select candidate_json,candidate_checksum from summary_rebuild",
        )
        .get(),
    ).toEqual({
      candidate_json: '{"version":1,"items":[],"text":""}',
      candidate_checksum: "",
    });
    expect(db.prepare("select count(*) as n from message").get()).toEqual({
      n: 27,
    });
  });
  it("keeps Forget effective for the same original after content/timestamp edits", () => {
    message("forgotten");
    begin();
    now += 3000;
    const job = storage.admit(now, "publish-forget")!;
    expect(storage.publish(job, proposal(job), now)).toBe(true);
    storage.forget(storage.version(), storage.inspect().items[0].id, now);
    db.prepare(
      "update message set content='I now prefer long weekdays.',created_at=created_at+1 where id='forgotten'",
    ).run();
    expect(inventory().reasons.suppressed).toBe(1);
    expect(inventory().counts.includedUserMessages).toBe(0);
  });
  it.each([
    "format_version=2",
    "candidate_json='corrupt'",
    "position=1",
    "state='unknown'",
  ])(
    "preserves unsupported/corrupt operation bytes and refuses use: %s",
    (mutation) => {
      message("u");
      begin();
      db.exec(`update summary_rebuild set ${mutation}`);
      const bytes = db.prepare("select * from summary_rebuild").get();
      expect(() => status()).toThrow("unavailable");
      expect(() => start("another", inventory().snapshot, "boot", now)).toThrow(
        "unavailable",
      );
      expect(db.prepare("select * from summary_rebuild").get()).toEqual(bytes);
      expect(
        db.prepare("select count(*) as n from summary_attempt").get(),
      ).toEqual({ n: 0 });
    },
  );
  it("fences populated schema21 originals conservatively and preserves original/manual/accounting bytes across migration and reopen", () => {
    oldMemory();
    message("legacy-unlinked");
    storage.edit(storage.version(), null, "Keep manual coaching.", now);
    const originals = db.prepare("select * from message order by id").all(),
      manual = db.prepare("select * from summary_manual").all(),
      spend = db.prepare("select * from summary_spend").all();
    removeRebuildFixtureSchema(db);
    db.prepare(
      "update app_metadata set value='21' where key='schema_version'",
    ).run();
    const result = migrateDatabase(db);
    expect(result).toMatchObject({
      fromVersion: 21,
      toVersion: 22,
      integrity: "ok",
    });
    const bytes = db.serialize();
    db.close();
    db = new Database(bytes);
    expect(db.prepare("select * from message order by id").all()).toEqual(
      originals,
    );
    expect(db.prepare("select * from summary_manual").all()).toEqual(manual);
    expect(db.prepare("select * from summary_spend").all()).toEqual(spend);
    expect(inventory().reasons["unproven-legacy-or-cleared-original"]).toBe(1);
    message("post-fence");
    expect(inventory().counts.includedUserMessages).toBe(2);
    expect(migrateDatabase(db).applied).toEqual([]);
  });
});
