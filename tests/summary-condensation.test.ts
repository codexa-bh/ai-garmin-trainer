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
  storage.configure(true, "gpt-6-luna", 1000);
  storage.editSummary(storage.version(), "Previous valid publication.", now);
});
afterEach(() => db.close());
const oversized = "A complete authored constraint with its rationale. ".repeat(
  25,
);
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
it("uses one request for already bounded complete text", async () => {
  source();
  const generate = vi.fn(async () => response("Complete useful summary."));
  await engine(generate).tick(new AbortController().signal);
  expect(generate).toHaveBeenCalledTimes(1);
  expect(attempts()).toHaveLength(1);
  expect(storage.inspect().text).toBe("Complete useful summary.");
});
it("condenses only a fully known oversize, preserving both distinct effects and the whole draft", async () => {
  source();
  const revision = storage.version().revision;
  let calls = 0;
  const generate = vi.fn(async (system: string, prompt: string) => {
    calls++;
    if (calls === 1) return response(oversized);
    expect(system).toContain("ONLY condenses");
    const input = JSON.parse(prompt);
    expect(input.draft).toBe(oversized);
    expect(input.actualCharacters).toBe([...oversized].length);
    expect(input.characterCap).toBe(1000);
    expect(input).not.toHaveProperty("newSources");
    expect(storage.inspect().text).toBe("Previous valid publication.");
    expect(attempts().map((a) => a.reserved)).toEqual([1, 1]);
    return response(
      "Short weekdays due to caregiving; morning preference remains tentative.",
    );
  });
  await engine(generate).tick(new AbortController().signal);
  expect(calls).toBe(2);
  expect(storage.version().revision).toBe(revision + 1);
  const records = attempts();
  expect(records.map((a) => a.job_id)).toEqual(["job", "job:condense"]);
  expect(records.map((a) => a.outcome)).toEqual(["committed", "committed"]);
  expect(JSON.parse(records[0].usage_json!)).toMatchObject({
    input: 30,
    output: 20,
    rejection: "value",
    diagnostic: { invariant: "character-cap", limit: 1000 },
  });
  expect(JSON.parse(records[1].usage_json!)).toEqual({
    input: 30,
    output: 20,
    cached: 0,
  });
  expect(storage.status(now).attemptsToday).toBe(2);
  expect(JSON.stringify(records)).not.toContain(oversized);
});
it("refuses a second oversize without a third request, keeping old publication", async () => {
  source();
  const before = storage.inspect();
  const generate = vi.fn(async () => response(oversized));
  await engine(generate).tick(new AbortController().signal);
  expect(generate).toHaveBeenCalledTimes(2);
  expect(storage.inspect()).toEqual(before);
  expect(attempts().map((a) => a.outcome)).toEqual([
    "summary_invalid_output",
    "summary_invalid_output",
  ]);
  expect(
    attempts().every(
      (a) => JSON.parse(a.usage_json!).diagnostic.invariant === "character-cap",
    ),
  ).toBe(true);
});
it.each([
  { summary: oversized, extra: true },
  { summary: 42 },
  { summary: "\ud800" },
  { summary: null },
  null,
])("never condenses malformed/non-scalar output %j", async (patch) => {
  source();
  const generate = vi.fn(async () => ({
    patch,
    usage: { input: 30, output: 20, cached: 0 },
  }));
  await engine(generate).tick(new AbortController().signal);
  expect(generate).toHaveBeenCalledTimes(1);
  expect(attempts()).toHaveLength(1);
  expect(storage.inspect().text).toBe("Previous valid publication.");
});
it("does not replay a failed/unknown first effect", async () => {
  source();
  const generate = vi.fn(async () => {
    throw Error("untrusted provider detail");
  });
  await engine(generate).tick(new AbortController().signal);
  expect(generate).toHaveBeenCalledTimes(1);
  expect(attempts()[0].usage_json).toBeNull();
  expect(storage.status(now).unpricedAttempts).toBe(1);
  expect(storage.inspect().text).toBe("Previous valid publication.");
});
it.each(["abort", "configuration", "manual", "source", "lease"])(
  "does not dispatch condensation after %s revocation",
  async (mode) => {
    source();
    const priorRevision = storage.version().revision;
    const signal = new AbortController();
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
      return response(oversized);
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
it("preserves unknown condensation after cancel and rejects its late result", async () => {
  source();
  const before = storage.inspect();
  const signal = new AbortController();
  let release!: (v: ReturnType<typeof response>) => void;
  let entered!: () => void;
  const enteredSecond = new Promise<void>((resolve) => (entered = resolve));
  let calls = 0;
  const generate = vi.fn(async () => {
    if (++calls === 1) return response(oversized);
    entered();
    return new Promise<ReturnType<typeof response>>(
      (resolve) => (release = resolve),
    );
  });
  const running = engine(generate).tick(signal.signal);
  await enteredSecond;
  expect(attempts()).toHaveLength(2);
  signal.abort();
  await running;
  release(response("Late result must not publish."));
  await Promise.resolve();
  expect(storage.inspect()).toEqual(before);
  expect(attempts().map((a) => a.outcome)).toEqual([
    "summary_interrupted",
    "summary_interrupted",
  ]);
  expect(attempts()[1].usage_json).toBeNull();
  expect(storage.status(now).unpricedAttempts).toBe(1);
  expect(calls).toBe(2);
});
it("cannot reserve a condensation before a known size rejection or repeat its reservation", () => {
  source();
  const job = storage.admit(now, "job")!;
  expect(storage.reserve(job, now, "condense")).toBe(false);
  expect(storage.reserve(job, now)).toBe(true);
  expect(storage.reserve(job, now, "condense")).toBe(false);
  storage.usage(job, { input: 1, output: 1, cached: 0 }, "value", {
    invariant: "character-cap",
    actual: 1200,
    limit: 1000,
  });
  expect(storage.reserve(job, now, "condense")).toBe(true);
  expect(storage.reserve(job, now, "condense")).toBe(false);
  expect(attempts()).toHaveLength(2);
});
it("serializes concurrent engines while the first effect is pending", async () => {
  source();
  let release!: (v: ReturnType<typeof response>) => void;
  let entered!: () => void;
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
  release(response("Complete summary."));
  await first;
  expect(attempts()).toHaveLength(1);
});
it("stages every40-source chunk only after condensation and publishes once for the entire81-source pool", async () => {
  db.prepare(
    "insert into conversation(id,title,created_at,updated_at) values('originals','Authored',1,1)",
  ).run();
  for (let n = 0; n < 81; n++)
    db.prepare(
      "insert into message(id,conversation_id,role,content,created_at) values(?,'originals','user',?,?)",
    ).run(`u${n}`, `Authored durable fact ${n}`, 1700000000000 + n);
  const inventory = summaryRebuildInventory("boot");
  startSummaryRebuild("whole", inventory.snapshot, "boot", now);
  const revision = storage.version().revision;
  let effects = 0,
    batches = 0;
  const generate = vi.fn(async (_system: string, prompt: string) => {
    effects++;
    if (effects % 2) {
      const input = JSON.parse(prompt);
      expect(input.newSources).toHaveLength(batches < 2 ? 40 : 1);
      expect(input.previous).toBe(
        batches ? `Complete revised draft ${batches}.` : "",
      );
      return response(oversized);
    }
    expect(summaryRebuildStatus()?.processed).toBe(batches * 40);
    expect(storage.version().revision).toBe(revision);
    return response(`Complete revised draft ${++batches}.`);
  });
  const worker = createSummaryEngine({
    storage,
    generation: { generate },
    now: () => now,
    identity: () => `batch-${batches}`,
    current: () => true,
    jitter: () => 0,
  });
  for (let n = 0; n < 3; n++) {
    noteSummaryActivity(now);
    now += 3000;
    await worker.tick(new AbortController().signal);
  }
  expect(effects).toBe(6);
  expect(summaryRebuildStatus()).toMatchObject({
    state: "complete",
    processed: 81,
    total: 81,
    dispositions: { processed: 81 },
  });
  expect(storage.version().revision).toBe(revision + 1);
  expect(storage.inspect().text).toBe("Complete revised draft 3.");
  expect(attempts().map((a) => a.outcome)).toEqual([
    "staged",
    "staged",
    "staged",
    "staged",
    "committed",
    "committed",
  ]);
  expect(
    db.prepare("select count(*) n from message where role='user'").get(),
  ).toEqual({ n: 81 });
});
