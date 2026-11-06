import Database from "better-sqlite3";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { migrateDatabase } from "@/lib/db/migrations";
import {
  summaryStorage as storage,
  noteSummaryActivity,
} from "@/lib/db/summary-storage";
import { conversationHistory as history } from "@/lib/db/conversation-history";
import {
  summaryRebuildInventory,
  startSummaryRebuild,
  summaryRebuildStatus,
} from "@/lib/db/summary-rebuild";
import {
  createSummaryEngine,
  type SummaryGeneration,
} from "@/lib/memory/summary-application";
let db: Database.Database, now: number;
vi.mock("@/lib/db/connection", () => ({ getDatabase: () => db }));
beforeEach(() => {
  db = new Database(":memory:");
  migrateDatabase(db);
  now = Date.now();
  storage.configure(true, "gpt-6-luna", 6000);
  storage.editSummary(storage.version(), "Previous valid publication.", now);
});
afterEach(() => db.close());
// Exact Unicode-scalar regressions of the attributed 6578 / 6399 at6000 failure.
const authored = (n: number) => "😀".repeat(n - 1) + ".";
const response = (summary: string) => ({
  patch: { summary },
  usage: { input: 30, output: 20, cached: 0 },
});
function source() {
  const a = history.admit(
    "authored",
    "Short weekdays because caregiving limits time.",
  );
  history.complete(a.admission, { content: "Acknowledged.", grounding: null });
  noteSummaryActivity(now);
  now += 3000;
}
function engine(generate: SummaryGeneration["generate"], current = () => true) {
  return createSummaryEngine({
    storage,
    generation: { generate },
    now: () => now,
    identity: () => "job",
    current,
    jitter: () => 0,
  });
}
function attempts() {
  return db
    .prepare(
      "select job_id,outcome,reserved,usage_json from summary_attempt order by job_id",
    )
    .all() as {
    job_id: string;
    outcome: string;
    reserved: number;
    usage_json: string | null;
  }[];
}
it.each([5999, 6000, 6578, 6399, 20001])(
  "accepts complete %i-scalar first drafts unchanged with one actual request and no secondary accounting",
  async (n) => {
    source();
    const text = authored(n),
      revision = storage.version().revision;
    const generate = vi.fn(async (system: string, prompt: string) => {
      expect(JSON.parse(prompt).targetCharacters).toBe(6000);
      expect(system).toContain("advisory");
      expect(system).not.toMatch(
        /Hard limit|softTargetCharacters|characterCap/,
      );
      return response(text);
    });
    await engine(generate).tick(new AbortController().signal);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(storage.inspect().text).toBe(text);
    expect(storage.version().revision).toBe(revision + 1);
    expect(attempts()).toEqual([
      {
        job_id: "job",
        outcome: "committed",
        reserved: 1,
        usage_json: JSON.stringify({ input: 30, output: 20, cached: 0 }),
      },
    ]);
    expect(storage.status(now)).toMatchObject({
      characters: n,
      cap: 6000,
      attemptsToday: 1,
    });
  },
);
it.each([
  { summary: "valid", extra: true },
  { summary: 42 },
  { summary: "\ud800" },
  { summary: null },
  null,
])("never repairs malformed/non-scalar output %j", async (patch) => {
  source();
  const generate = vi.fn(async () => ({
    patch,
    usage: { input: 30, output: 20, cached: 0 },
  }));
  await engine(generate).tick(new AbortController().signal);
  expect(generate).toHaveBeenCalledTimes(1);
  expect(attempts()).toHaveLength(1);
  expect(attempts()[0].outcome).toBe("summary_invalid_output");
  expect(storage.inspect().text).toBe("Previous valid publication.");
});
it("preserves the prior publication on the independent serialized envelope limit without a second effect", async () => {
  source();
  const generate = vi.fn(async () => response("x".repeat(1024 * 1024)));
  await engine(generate).tick(new AbortController().signal);
  expect(generate).toHaveBeenCalledTimes(1);
  expect(storage.inspect().text).toBe("Previous valid publication.");
  expect(storage.status(now).reason).toBe("summary_input_capacity");
  expect(attempts()).toHaveLength(1);
  expect(() =>
    storage.editSummary(storage.version(), "x".repeat(1024 * 1024), now),
  ).toThrow("summary_input_capacity");
  expect(storage.inspect().text).toBe("Previous valid publication.");
});
it("does not replay a failed/unknown effect", async () => {
  source();
  const generate = vi.fn(async () => {
    throw Error("untrusted provider detail");
  });
  const worker = engine(generate);
  await worker.tick(new AbortController().signal);
  now += 600000;
  await worker.tick(new AbortController().signal);
  expect(generate).toHaveBeenCalledTimes(1);
  expect(attempts()[0].usage_json).toBeNull();
  expect(storage.status(now).unpricedAttempts).toBe(1);
  expect(storage.inspect().text).toBe("Previous valid publication.");
});
it.each(["abort", "configuration", "manual", "source", "lease"])(
  "does not publish or dispatch again after %s revocation",
  async (mode) => {
    source();
    const priorRevision = storage.version().revision,
      signal = new AbortController();
    let current = true;
    const generate = vi.fn(async () => {
      if (mode === "abort") signal.abort();
      if (mode === "configuration") current = false;
      if (mode === "manual")
        storage.edit(
          storage.version(),
          null,
          "Independent authored preference.",
          now,
        );
      if (mode === "source")
        db.prepare(
          "delete from message where conversation_id='authored' and role='user'",
        ).run();
      if (mode === "lease") now += 31000;
      return response(authored(6578));
    });
    await engine(generate, () => current).tick(signal.signal);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(attempts()).toHaveLength(1);
    expect(storage.version().revision).toBe(
      priorRevision + (mode === "manual" || mode === "source" ? 1 : 0),
    );
    expect(storage.inspect().text).toBe(
      mode === "source" ? "" : "Previous valid publication.",
    );
  },
);
it("preserves unknown effect accounting after cancel and rejects its late result", async () => {
  source();
  const before = storage.inspect(),
    signal = new AbortController();
  let release!: (v: ReturnType<typeof response>) => void, entered!: () => void;
  const started = new Promise<void>((resolve) => (entered = resolve));
  const generate = vi.fn(async () => {
    entered();
    return new Promise<ReturnType<typeof response>>(
      (resolve) => (release = resolve),
    );
  });
  const running = engine(generate).tick(signal.signal);
  await started;
  signal.abort();
  await running;
  release(response(authored(6578)));
  await Promise.resolve();
  expect(storage.inspect()).toEqual(before);
  expect(attempts()).toHaveLength(1);
  expect(attempts()[0]).toMatchObject({
    outcome: "summary_interrupted",
    usage_json: null,
  });
  expect(storage.status(now).unpricedAttempts).toBe(1);
});
it("refuses obsolete live secondary reservation even with historical size-only rejection data", () => {
  source();
  const job = storage.admit(now, "job")!;
  expect(storage.reserve(job, now)).toBe(true);
  storage.usage(job, { input: 1, output: 1, cached: 0 }, "value", {
    invariant: "character-cap",
    actual: 6578,
    limit: 6000,
  });
  // Emulate an obsolete JS caller, outside the new two-argument TS port.
  expect(Reflect.apply(storage.reserve, storage, [job, now, "condense"])).toBe(
    false,
  );
  expect(storage.reserve(job, now)).toBe(false);
  expect(attempts()).toHaveLength(1);
  expect(JSON.parse(attempts()[0].usage_json!).diagnostic.invariant).toBe(
    "character-cap",
  );
});
it("serializes concurrent engines while the single effect is pending", async () => {
  source();
  let release!: (v: ReturnType<typeof response>) => void, entered!: () => void;
  const started = new Promise<void>((resolve) => (entered = resolve));
  const generate = vi.fn(async () => {
    entered();
    return new Promise<ReturnType<typeof response>>(
      (resolve) => (release = resolve),
    );
  });
  const first = engine(generate).tick(new AbortController().signal);
  await started;
  await engine(generate).tick(new AbortController().signal);
  expect(generate).toHaveBeenCalledTimes(1);
  release(response(authored(6399)));
  await first;
  expect(attempts()).toHaveLength(1);
});
it("carries whole6578/6399 drafts through all184 sources and atomically publishes once with five effects", async () => {
  db.prepare(
    "insert into conversation(id,title,created_at,updated_at) values('originals','Authored',1,1)",
  ).run();
  for (let n = 0; n < 184; n++)
    db.prepare(
      "insert into message(id,conversation_id,role,content,created_at) values(?,'originals','user',?,?)",
    ).run(`u${n}`, `Authored durable fact ${n}`, 1700000000000 + n);
  const inventory = summaryRebuildInventory("boot");
  startSummaryRebuild("whole", inventory.snapshot, "boot", now);
  const revision = storage.version().revision,
    texts = [
      authored(6578),
      authored(6399),
      authored(20001),
      authored(6578),
      authored(6399),
    ];
  let batches = 0;
  const generate = vi.fn(async (_system: string, prompt: string) => {
    const input = JSON.parse(prompt);
    expect(input.newSources).toHaveLength(batches < 4 ? 40 : 24);
    expect(input.previous).toBe(batches ? texts[batches - 1] : "");
    expect(storage.version().revision).toBe(revision);
    return response(texts[batches++]);
  });
  const worker = createSummaryEngine({
    storage,
    generation: { generate },
    now: () => now,
    identity: () => `batch-${batches}`,
    current: () => true,
    jitter: () => 0,
  });
  for (let n = 0; n < 5; n++) {
    noteSummaryActivity(now);
    now += 3000;
    await worker.tick(new AbortController().signal);
    expect(summaryRebuildStatus()?.processed).toBe(Math.min((n + 1) * 40, 184));
    if (n < 4)
      expect(storage.inspect().text).toBe("Previous valid publication.");
  }
  expect(generate).toHaveBeenCalledTimes(5);
  expect(summaryRebuildStatus()).toMatchObject({
    state: "complete",
    processed: 184,
    total: 184,
    dispositions: { processed: 184 },
  });
  expect(storage.version().revision).toBe(revision + 1);
  expect(storage.inspect().text).toBe(texts[4]);
  expect(attempts().map((a) => a.outcome)).toEqual([
    "staged",
    "staged",
    "staged",
    "staged",
    "committed",
  ]);
  expect(
    db.prepare("select count(*) n from message where role='user'").get(),
  ).toEqual({ n: 184 });
});
