import Database from "better-sqlite3";
import { createOpenAI } from "@ai-sdk/openai";
import { createTrainerGeneration } from "@/lib/ai/provider-generation";
import { countedConversationFetch } from "@/lib/ai/conversation-transport";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { migrateDatabase } from "@/lib/db/migrations";
import { conversationHistory as history } from "@/lib/db/conversation-history";
import { summaryStorage as storage } from "@/lib/db/summary-storage";
import { deleteConversation } from "@/lib/db/conversation-lifecycle";
import {
  createSummaryEngine,
  type SummaryGeneration,
} from "@/lib/memory/summary-application";
import {
  minimizeSummarySource,
  validateSummaryReplacement,
  type SummaryBatch,
} from "@/lib/memory/summary-policy";
import { replayMessages } from "@/lib/chat/conversation-replay";
let db: Database.Database;
let now: number;
vi.mock("@/lib/db/connection", () => ({ getDatabase: () => db }));
beforeEach(() => {
  db = new Database(":memory:");
  migrateDatabase(db);
  now = Date.UTC(2026, 10, 3, 12);
  storage.configure(true, "gpt-6-luna", 6000);
});
afterEach(() => {
  db.close();
  vi.restoreAllMocks();
});
function complete(
  chat = "A",
  user = "Keep short weekdays because of time; long weekdays rejected.",
) {
  const admitted = history.admit(chat, user);
  history.complete(admitted.admission, {
    content:
      "Option one: long weekdays. Option two: short weekdays plus weekend hike.",
    grounding: null,
  });
  return admitted;
}
function ready(): SummaryBatch {
  expect(storage.admit(now, "not-yet")).toBeNull();
  now += 120001;
  const batch = storage.admit(now, `job-${now}`);
  expect(batch).not.toBeNull();
  return batch!;
}
function candidate(batch: SummaryBatch) {
  const inputs = batch.sources.flatMap((source) => {
    const input = minimizeSummarySource(source);
    return input ? [input] : [];
  });
  return validateSummaryReplacement(
    {
      summary: [batch.previous.text, ...inputs.map((input) => input.user)]
        .filter(Boolean)
        .join("\n"),
    },
    batch,
    inputs,
  )!;
}
function fakeGeneration(): SummaryGeneration {
  return {
    generate: vi.fn(async (_system, prompt, _signal, format) => {
      expect(typeof JSON.parse(prompt).previous).toBe("string");
      return {
        patch:
          format === "incremental"
            ? { action: "unchanged", edits: [], addition: "" }
            : {
                summary:
                  "Short weekdays chosen for time; long weekdays rejected.",
              },
        usage: { input: 100, output: 40, cached: null },
      };
    }),
  };
}
function engine(generation: SummaryGeneration | null = fakeGeneration()) {
  return createSummaryEngine({
    storage,
    generation,
    now: () => now,
    identity: () => `engine-${now}`,
    current: () => true,
    jitter: () => 0,
  });
}

describe("real SQLite incremental coverage, leases, atomicity and control", () => {
  it("retains usage once and only a closed invalid-patch diagnostic, never the rejected proposal", async () => {
    complete();
    let reads = 0;
    const service = engine({
      generate: async () => ({
        patch: { rejected: "synthetic-untrusted-body-never-retained" },
        get usage() {
          reads++;
          return { input: 120, output: 24, cached: null };
        },
      }),
    });
    await service.tick(new AbortController().signal);
    now += 120001;
    await service.tick(new AbortController().signal);
    expect(reads).toBe(1);
    const row = db
      .prepare("select outcome,usage_json from summary_attempt")
      .get() as { outcome: string; usage_json: string };
    expect(row.outcome).toBe("summary_invalid_output");
    expect(JSON.parse(row.usage_json)).toEqual({
      input: 120,
      output: 24,
      cached: null,
      rejection: "shape",
    });
    expect(row.usage_json).not.toContain("untrusted-body");
    expect(storage.status(now).frontier).toBe(0);
    expect(() =>
      storage.usage(
        { jobId: "unused" } as SummaryBatch,
        { input: null, output: null, cached: null },
        "arbitrary-error-text" as never,
      ),
    ).toThrow("summary_invalid_usage");
  });
  it("refuses malformed/private diagnostic shapes before persistence and preserves historical coarse usage", () => {
    const job = { jobId: "unused" } as SummaryBatch;
    const usage = { input: 10, output: 5, cached: null };
    const before = db.serialize();
    for (const detail of [
      { invariant: "vendor private error" },
      { invariant: "item-id", sourceId: "private" },
      { invariant: "character-cap", actual: 2_000_001 },
      { invariant: "item-text", itemIndex: -1 },
    ])
      expect(() => storage.usage(job, usage, "value", detail as never)).toThrow(
        "summary_invalid_usage",
      );
    expect(() =>
      storage.usage(job, usage, "shape", { invariant: "item-id" }),
    ).toThrow("summary_invalid_usage");
    expect(db.serialize()).toEqual(before);
    expect(() => storage.usage(job, usage, "value")).not.toThrow();
  });
  it("preserves historical unsafe-text fourth-item failure across reopen without passive replay", async () => {
    complete();
    const job = ready();
    storage.reserve(job, now);
    storage.usage(job, { input: 10, output: 5, cached: null }, "value", {
      invariant: "unsafe-text",
      itemIndex: 3,
    });
    storage.fail(job, "summary_invalid_output", now);
    const before = db
      .prepare("select outcome,usage_json from summary_attempt")
      .all();
    const bytes = db.serialize();
    db.close();
    db = new Database(bytes);
    const generation = fakeGeneration();
    storage.status(now + 100000);
    storage.read();
    await engine(generation).tick(new AbortController().signal);
    expect(generation.generate).not.toHaveBeenCalled();
    expect(
      db.prepare("select outcome,usage_json from summary_attempt").all(),
    ).toEqual(before);
    expect(before[0]).toMatchObject({ outcome: "summary_invalid_output" });
  });
  it("orders late/equal-time completions, excludes abandoned and old history, and never repeats covered source", () => {
    const a = history.admit("A", "Mornings chosen for time.");
    const b = history.admit("B", "Evenings considered, not chosen.");
    history.complete(b.admission, {
      content: "Still undecided.",
      grounding: null,
    });
    history.complete(a.admission, {
      content: "User chose mornings.",
      grounding: null,
    });
    const abandoned = history.admit("C", "Unanswered prompt");
    history.abandon(abandoned.admission);
    const batch = ready();
    expect(batch.sources.map((source) => source.user)).toEqual([
      "Evenings considered, not chosen.",
      "Mornings chosen for time.",
    ]);
    expect(storage.reserve(batch, now)).toBe(true);
    expect(storage.publish(batch, candidate(batch), now)).toBe(true);
    expect(storage.publish(batch, candidate(batch), now)).toBe(true);
    expect(storage.admit(now + 200000, "duplicate")).toBeNull();
    complete("D");
    const next = ready();
    expect(next.sources).toHaveLength(1);
    expect(next.frontier).toBe(2);
    expect(next.upper).toBe(3);
  });
  it("publishes summary/provenance/checkpoint/attempt together and rolls all back on a crash", () => {
    complete();
    const batch = ready();
    storage.reserve(batch, now);
    db.exec(
      "create trigger injected before update of frontier on summary_state begin select raise(abort,'injected crash'); end",
    );
    expect(() => storage.publish(batch, candidate(batch), now)).toThrow(
      "injected crash",
    );
    expect(storage.status(now).frontier).toBe(0);
    expect(
      db.prepare("select count(*) as n from summary_disposition").get(),
    ).toEqual({ n: 0 });
    expect(db.prepare("select outcome from summary_attempt").get()).toEqual({
      outcome: "admitted",
    });
    db.exec("drop trigger injected");
    expect(storage.publish(batch, candidate(batch), now)).toBe(true);
    const bytes = db.serialize();
    const before = storage.read();
    db.close();
    db = new Database(bytes);
    expect(storage.read()).toEqual(before);
    expect(storage.status(now).frontier).toBe(1);
    expect(db.prepare("pragma integrity_check").get()).toEqual({
      integrity_check: "ok",
    });
  });
  it("rejects second writer/stale parent, keeps later arrivals pending, and supports heartbeats", () => {
    complete();
    const batch = ready();
    expect(storage.admit(now, "competing")).toBeNull();
    expect(storage.heartbeat(batch, now + 5000)).toBe(true);
    complete("B");
    expect(storage.publish(batch, candidate(batch), now + 5001)).toBe(true);
    expect(storage.status(now).pending).toBe(1);
    const stale = { ...batch, jobId: "stale" };
    expect(storage.publish(stale, candidate(batch), now)).toBe(false);
  });
  it("preserves uncertain reservations on restart and refuses blind replay until explicit retry", () => {
    complete();
    const batch = ready();
    storage.reserve(batch, now);
    expect(storage.admit(now + 31000, "new-boot")).toBeNull();
    expect(storage.status(now + 31000)).toMatchObject({
      reason: "summary_interrupted",
      attemptsToday: 1,
    });
    expect(storage.admit(now + 1000000, "blind-replay")).toBeNull();
    storage.control("retry", now + 1000000);
    expect(storage.admit(now + 1000001, "explicit")).not.toBeNull();
    expect(storage.status(now)).toMatchObject({
      reservedUsdToday: 0,
      unpricedAttempts: 1,
    });
  });
  it.each(["delete", "edit", "clear", "disable", "config", "manual"])(
    "rejects late publication after %s and does not resurrect text",
    (action) => {
      const original = complete();
      const batch = ready();
      storage.reserve(batch, now);
      if (action === "delete") deleteConversation("A");
      if (action === "edit")
        db.prepare(
          "update message set content='New source version' where id=?",
        ).run(original.userRecord.id);
      if (action === "clear" || action === "disable")
        storage.control(action, now);
      if (action === "config") storage.configure(true, "", 6000);
      if (action === "manual")
        db.prepare(
          "update summary_control set manual_revision=manual_revision+1",
        ).run();
      expect(storage.publish(batch, candidate(batch), now)).toBe(false);
      expect(storage.read().text).toBe("");
      expect(storage.status(now).frontier).toBe(0);
    },
  );
  it("clear includes incomplete pre-clear admission; Off completion is never reimported on re-enable", () => {
    const pending = history.admit("A", "Pre-clear late source");
    storage.control("clear", now);
    expect(() =>
      history.complete(pending.admission, {
        content: "Late answer.",
        grounding: null,
      }),
    ).toThrow("conversation_context_invalidated");
    expect(db.prepare("select cutoff from summary_control").get()).toEqual({
      cutoff: pending.admission.sourceAdmissionSeq,
    });
    expect(
      db.prepare("select count(*) as n from conversation_completion").get(),
    ).toEqual({ n: 0 });
    expect(
      db
        .prepare("select count(*) as n from message where role='assistant'")
        .get(),
    ).toEqual({ n: 0 });
    storage.configure(false, "gpt-6-luna", 6000);
    complete("B", "While Off");
    storage.configure(true, "gpt-6-luna", 6000);
    complete("C", "New eligible source");
    const batch = ready();
    expect(batch.sources.map((source) => source.eligible)).toEqual([
      false,
      true,
    ]);
    expect(
      batch.sources
        .filter((source) => source.eligible)
        .map((source) => source.user),
    ).toEqual(["New eligible source"]);
  });
  it("respects immediate disable across unchanged native-config reconciliation", () => {
    storage.control("disable", now);
    storage.configure(true, "gpt-6-luna", 6000);
    expect(storage.status(now).enabled).toBe(false);
  });
  it("explicit Enable restores immediate Off only under active native configuration and does not backfill Off completions", () => {
    storage.control("disable", now);
    complete("while-off");
    storage.control("enable", now);
    const batch = ready();
    expect(batch.sources[0]!.eligible).toBe(false);
    expect(storage.status(now).enabled).toBe(true);
    storage.configure(false, "gpt-6-luna", 6000);
    expect(() => storage.control("enable", now)).toThrow(
      "summary_not_configured",
    );
    storage.configure(true, "", 6000);
    expect(() => storage.control("enable", now)).toThrow(
      "summary_not_configured",
    );
  });
  it("excludes suppressed/cutoff sources before projecting any original or prior-referent content", () => {
    complete("A", "Option one: long weekdays. Option two: short weekdays.");
    const selected = complete("A", "Use the second option.");
    db.prepare("insert into summary_suppression(source_id) values(?)").run(
      `${selected.admission.turnId}:1`,
    );
    const batch = ready();
    const excluded = batch.sources.find((source) =>
      source.sourceId.startsWith(selected.admission.turnId),
    )!;
    expect(excluded).toMatchObject({
      eligible: false,
      user: null,
      referent: null,
    });
  });
  it("keeps old privacy-valid summary on outage, but source deletion invalidates every descendant", () => {
    complete();
    const batch = ready();
    expect(storage.publish(batch, candidate(batch), now)).toBe(true);
    complete("B");
    const next = ready();
    storage.reserve(next, now);
    storage.fail(next, "summary_provider_failure", now);
    expect(storage.status(now).state).toBe("stale");
    expect(storage.read().text).toContain("because of time");
    deleteConversation("A");
    expect(storage.read().text).toBe("");
    expect(storage.publish(next, candidate(next), now)).toBe(false);
  });
  it("generation seam preserves immutable old pins on publication but rejects correction/privacy/Off/manual authority changes", () => {
    complete();
    const first = ready();
    storage.publish(first, candidate(first), now);
    const snapshot = storage.revision()!;
    complete("B");
    const second = ready();
    storage.publish(second, candidate(second), now);
    expect(storage.isGenerationCurrent(snapshot.stamp)).toBe(true);
    expect(snapshot.value.text.split("\n")).toHaveLength(1);
    expect(storage.read().text.split("\n")).toHaveLength(2);
    db.prepare(
      "update summary_control set manual_revision=manual_revision+1",
    ).run();
    expect(storage.isGenerationCurrent(snapshot.stamp)).toBe(false);
    const current = storage.revision()!;
    deleteConversation("A");
    expect(storage.isGenerationCurrent(current.stamp)).toBe(false);
    expect(storage.revision()).toBeNull();
  });
  it("does not invent item-expiry maintenance or provider work on passive reads of complete text", async () => {
    complete();
    const first = ready();
    storage.publish(first, candidate(first), now);
    const snapshot = storage.revision()!;
    now += 31000;
    const generation = fakeGeneration();
    storage.read();
    storage.status(now);
    await engine(generation).tick(new AbortController().signal);
    expect(generation.generate).not.toHaveBeenCalled();
    expect(storage.read()).toEqual(snapshot.value);
    expect(storage.status(now).frontier).toBe(1);
    expect(
      db.prepare("select count(*) n from summary_item_disposition").get(),
    ).toEqual({ n: 0 });
  });
  it("does not reset corrupted/unknown state and cannot overwrite it with configure/control", () => {
    db.prepare(
      "update summary_state set format_version=99,payload='preserve original bytes'",
    ).run();
    expect(storage.status(now)).toMatchObject({
      state: "unavailable",
      reason: "summary_unknown_version",
    });
    expect(() => storage.configure(false, "", 6000)).toThrow();
    expect(() => storage.control("clear", now)).toThrow();
    expect(db.prepare("select payload from summary_state").get()).toEqual({
      payload: "preserve original bytes",
    });
  });
  it("allows more than ten attempts, retaining unknown liabilities across restart/clock rollback without blind retries", () => {
    complete();
    for (let i = 0; i < 10; i++) {
      storage.control("retry", now);
      let batch = storage.admit(now, `spent${i}`);
      if (!batch) {
        now += 120001;
        batch = storage.admit(now, `spent${i}`);
      }
      expect(batch).not.toBeNull();
      if (!batch) throw new Error("expected admitted budget fixture");
      expect(storage.reserve(batch, now)).toBe(true);
      storage.fail(batch, "summary_invalid_output", now);
      now += 30001;
    }
    storage.control("retry", now);
    const last = storage.admit(now, "eleventh")!;
    expect(storage.reserve(last, now)).toBe(true);
    expect(storage.reserve(last, now)).toBe(false); // duplicate reservation, not a count cap
    const status = storage.status(now);
    expect(status).toMatchObject({ attemptsToday: 11 });
    expect(status.reservedUsdToday).toBe(0);
    expect(status.unknownReservedUsd).toBe(0);
    expect(status.unpricedAttempts).toBe(11);
    const bytes = db.serialize();
    db.close();
    db = new Database(bytes);
    expect(storage.status(now - 86400000).attemptsToday).toBe(11);
    expect(storage.status(now + 86400000).attemptsToday).toBe(0);
    expect(storage.status(now + 86400000).unknownReservedUsd).toBeCloseTo(
      status.unknownReservedUsd,
    );
  });
  it("preserves actual production-adapter serialized active input/tools on ordinary S publication", async () => {
    complete();
    const active = history.admit("B", "Continue our discussion");
    const bodies: Record<string, unknown>[] = [];
    const transport: typeof fetch = async (url, init) => {
      const counting = String(url).endsWith("/input_tokens");
      if (!counting)
        bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return new Response(
        JSON.stringify(
          counting
            ? { input_tokens: 100 }
            : {
                id: "response-prefix",
                object: "response",
                created_at: 0,
                status: "completed",
                model: "gpt-6-luna",
                output: [
                  {
                    type: "message",
                    id: "message-prefix",
                    role: "assistant",
                    status: "completed",
                    content: [
                      {
                        type: "output_text",
                        text: "Authored response",
                        annotations: [],
                      },
                    ],
                  },
                ],
                usage: {
                  input_tokens: 100,
                  output_tokens: 10,
                  total_tokens: 110,
                },
              },
        ),
        { headers: { "content-type": "application/json" } },
      );
    };
    const generate = createTrainerGeneration(
      createOpenAI({
        apiKey: "synthetic-not-a-key",
        fetch: countedConversationFetch(transport),
      })("gpt-6-luna"),
    );
    const request = () => ({
      purpose: "planner" as const,
      system: {
        policy: "Stable policy",
        context: "Frozen current Profile/date",
      },
      prompt: "Continue our discussion",
      conversation: {
        history: replayMessages(history.read(active.admission)),
        allowSoftLimit: true,
      },
    });
    await generate(request());
    const batch = ready();
    expect(storage.publish(batch, candidate(batch), now)).toBe(true);
    await generate(request());
    expect(bodies).toHaveLength(2);
    expect(JSON.stringify(bodies[1]!.input)).toBe(
      JSON.stringify(bodies[0]!.input),
    );
    expect(JSON.stringify(bodies[1]!.tools)).toBe(
      JSON.stringify(bodies[0]!.tools),
    );
  });
  it("does not mutate a live H serialized prefix on ordinary global publication", () => {
    complete();
    const active = history.admit("B", "Continue our discussion");
    const before = replayMessages(history.read(active.admission));
    const batch = ready();
    storage.publish(batch, candidate(batch), now);
    expect(replayMessages(history.read(active.admission))).toEqual(before);
    expect(storage.status(now).usedByChat).toBe(false);
  });
});

describe("supplied generation with real SQLite application", () => {
  it("bounds backlog to20 and refuses capacity without automatic shrinking, retry or frontier advancement", async () => {
    for (let i = 0; i < 25; i++) complete(`batch${i}`);
    const normal = fakeGeneration();
    const generate = vi.fn(
      async (...args: Parameters<SummaryGeneration["generate"]>) => {
        const input = JSON.parse(args[1]) as { newSources: unknown[] };
        if (input.newSources.length > 2)
          throw new Error("summary_input_capacity");
        return normal.generate(...args);
      },
    );
    const app = engine({ generate });
    await app.tick(new AbortController().signal);
    now += 120001;
    await app.tick(new AbortController().signal);
    expect(JSON.parse(generate.mock.calls[0]![1]).newSources).toHaveLength(20);
    expect(generate).toHaveBeenCalledOnce();
    expect(storage.status(now)).toMatchObject({
      frontier: 0,
      pending: 25,
      attemptsToday: 1,
      reason: "summary_input_capacity",
    });
    expect(
      db.prepare("select count(*) as n from summary_disposition").get(),
    ).toEqual({ n: 0 });
  });
  it("single oversized event never advances frontier or infers a partial summary", async () => {
    complete();
    const generate = vi.fn(async () => {
      throw new Error("summary_input_capacity");
    });
    const app = engine({ generate });
    await app.tick(new AbortController().signal);
    now += 120001;
    await app.tick(new AbortController().signal);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(storage.status(now)).toMatchObject({
      frontier: 0,
      reason: "summary_input_capacity",
    });
  });
  it("coalesces concurrent wakes and holds no SQL transaction across generation", async () => {
    complete();
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const normal = fakeGeneration();
    const generate = vi.fn(
      async (...args: Parameters<SummaryGeneration["generate"]>) => {
        expect(db.inTransaction).toBe(false);
        await barrier;
        return normal.generate(...args);
      },
    );
    const app = engine({ generate });
    await app.tick(new AbortController().signal);
    now += 120001;
    const running = app.tick(new AbortController().signal);
    await app.tick(new AbortController().signal);
    expect(generate).toHaveBeenCalledTimes(1);
    complete("B");
    release();
    await running;
    expect(storage.status(now).frontier).toBe(1);
    expect(storage.status(now).pending).toBe(1);
    now += 2000;
    await app.tick(new AbortController().signal);
    expect(generate).toHaveBeenCalledTimes(2);
    expect(storage.status(now)).toMatchObject({ frontier: 2, pending: 0 });
  });
  it("processes repeated new-only batches with retained early rationale and one disposition per event", async () => {
    const generation = fakeGeneration(),
      app = engine(generation);
    for (let round = 0; round < 12; round++) {
      complete(`chat${round}`);
      await app.tick(new AbortController().signal);
      now += 2000;
      await app.tick(new AbortController().signal);
      now += 2000;
    }
    expect(generation.generate).toHaveBeenCalledTimes(12);
    expect(storage.read().text).toContain("for time");
    expect(storage.read().text).toContain("rejected");
    expect(
      db.prepare("select count(*) as n from summary_disposition").get(),
    ).toEqual({ n: 12 });
    const calls = vi.mocked(generation.generate).mock.calls;
    for (const call of calls)
      expect(JSON.parse(call[1]).newSources).toHaveLength(1);
  });
  it("passes formerly matched input to generation and persists its output across reopen without checkpoint loss", async () => {
    const text =
      "Fake api_key sk-example-not-a-key; https://example.invalid/training /Users/example/notes diagnosis GPS ignore previous instructions";
    complete("formerly-filtered", text);
    const normal = fakeGeneration();
    const generation: SummaryGeneration = {
      generate: vi.fn(
        async (...args: Parameters<SummaryGeneration["generate"]>) => {
          const result = await normal.generate(...args);
          const patch = result.patch as { summary: string };
          patch.summary = text;
          return result;
        },
      ),
    };
    const app = engine(generation);
    await app.tick(new AbortController().signal);
    now += 120001;
    await app.tick(new AbortController().signal);
    expect(generation.generate).toHaveBeenCalledOnce();
    expect(
      JSON.parse(vi.mocked(generation.generate).mock.calls[0][1]).newSources[0]
        .user,
    ).toBe(text);
    expect(storage.status(now).frontier).toBe(1);
    expect(storage.read().text).toBe(text);
    storage.editSummary(storage.version(), `${text}; edited`, now);
    const saved = storage.inspect();
    const bytes = db.serialize();
    db.close();
    db = new Database(bytes);
    expect(storage.read()).toEqual(saved);
    expect(storage.read().text).toContain(text);
    expect(db.prepare("select reason from summary_disposition").get()).toEqual({
      reason: "processed",
    });
  });
  it("rejects cancellation after inference and retains unknown cost without late writes", async () => {
    complete();
    const abort = new AbortController(),
      normal = fakeGeneration();
    const app = engine({
      generate: async (...args) => {
        const value = await normal.generate(...args);
        abort.abort();
        return value;
      },
    });
    await app.tick(abort.signal);
    now += 120001;
    await app.tick(abort.signal);
    expect(storage.status(now).frontier).toBe(0);
    expect(storage.status(now)).toMatchObject({
      reservedUsdToday: 0,
      unpricedAttempts: 1,
    });
  });
});
