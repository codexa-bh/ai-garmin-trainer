import Database from "better-sqlite3";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { migrateDatabase } from "@/lib/db/migrations";
import {
  summaryStorage as storage,
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
  validateSummaryReplacement,
  type SummaryBatch,
  type SummaryCandidate,
} from "@/lib/memory/summary-policy";
import { parseSummaryCommand } from "@/lib/memory/summary-controls";
import { replayMessages } from "@/lib/chat/conversation-replay";
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
  return validateSummaryReplacement(
    {
      summary:
        keep && batch.previous.text
          ? batch.previous.text
          : "Short weekday sessions suit caregiving; repeatedly overlong weekday plans failed.",
    },
    batch,
    inputs,
  )!;
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
describe("explicit selected legacy recovery", () => {
  it.each([
    "Do not save my training plan yet; I prefer short weekdays because caregiving limits time.",
    "Do not save my weekly plan yet; I prefer short weekdays because caregiving limits time.",
    "Don't save this week's plan yet; I prefer short weekdays because caregiving limits time.",
  ])(
    "retains document refusal and independent meaning through reviewed rebuild: %s",
    (user) => {
      message("document", user);
      message("private", "Do not remember this private note.");
      const review = inventory();
      expect(review.counts.includedUserMessages).toBe(1);
      begin();
      expect(
        readSummaryRebuildBatch()?.sources.map((source) => source.user),
      ).toEqual([user]);
    },
  );
  const selection = {
    version: 1 as const,
    conversationIds: null,
    includeLegacy: true,
  };
  it("reauthorizes only reviewed uncertainty, never known Clear or suppression, across the full pool", () => {
    for (let n = 0; n < 260; n++)
      message(`legacy-${n}`, undefined, "user", `chat-${n % 13}`);
    db.prepare(
      "update summary_original_boundary set floor=(select max(rowid) from message)",
    ).run();
    db.prepare("insert into summary_suppression(source_id) values(?)").run(
      // Obtain the authentic original hash without granting legacy authority.
      summaryRebuildInventory("boot", selection).selected[0]?.sourceId ??
        "missing",
    );
    expect(inventory().counts.includedUserMessages).toBe(0);
    expect(inventory().reasons.suppressed).toBe(1);
    const reviewed = summaryRebuildInventory("boot", selection);
    expect(reviewed.counts.includedUserMessages).toBe(259);
    expect(reviewed.preflight.selection).toEqual(selection);
    start("legacy", reviewed.snapshot, "boot", now, selection);
    expect(readSummaryRebuildBatch()!.sources).toHaveLength(40);
    cancelSummaryRebuild("legacy");
    storage.control("clear", now);
    expect(
      summaryRebuildInventory("boot", selection).counts.includedUserMessages,
    ).toBe(0);
    expect(
      summaryRebuildInventory("boot", selection).reasons["known-clear"],
    ).toBe(260);
  });
  it("binds selected chat and legacy intent to review, duplicate identity and final source authority", () => {
    message("A", undefined, "user", "A");
    message("B", undefined, "user", "B");
    const chosen = { ...selection, conversationIds: ["A"] };
    const reviewed = summaryRebuildInventory("boot", chosen);
    expect(reviewed.counts).toMatchObject({
      chats: 2,
      selectedChats: 1,
      includedUserMessages: 1,
      excludedUserMessages: 1,
    });
    expect(reviewed.reasons["not-selected"]).toBe(1);
    expect(() => start("selected", reviewed.snapshot, "boot", now)).toThrow(
      "stale_preflight",
    );
    start("selected", reviewed.snapshot, "boot", now, chosen);
    expect(() =>
      start("selected", reviewed.snapshot, "boot", now, selection),
    ).toThrow("identity_conflict");
    expect(readSummaryRebuildBatch()!.sources[0].original?.conversationId).toBe(
      "A",
    );
    db.prepare(
      "update message set content='Changed source' where id='A'",
    ).run();
    expect(status()?.state).toBe("invalidated");
    expect(readSummaryRebuildBatch()).toBeNull();
    expect(() =>
      readSummaryRebuildBatch({ id: "selected", position: 0 }),
    ).toThrow("not_active");
  });
  it("rejects empty/foreign/stale/extra recovery authority without acquiring consent", () => {
    message("A", undefined, "user", "A");
    const selection = {
      version: 1 as const,
      conversationIds: ["A"],
      includeLegacy: true,
    };
    const base = {
      version: 2,
      expected: storage.version(),
      action: "rebuild-review",
      selection,
    };
    const bytes = db.serialize();
    expect(parseSummaryCommand(base)).not.toBeNull();
    for (const changed of [
      { ...base, force: true },
      { ...base, selection: { ...selection, version: 2 } },
      { ...base, selection: { ...selection, force: true } },
      { ...base, selection: { ...selection, conversationIds: ["A", "A"] } },
      { ...base, selection: { ...selection, includeLegacy: "yes" } },
    ])
      expect(parseSummaryCommand(changed)).toBeNull();
    expect(() =>
      summaryRebuildInventory("boot", {
        ...selection,
        conversationIds: ["missing"],
      }),
    ).toThrow("selection_changed");
    const empty = summaryRebuildInventory("boot", {
      ...selection,
      conversationIds: [],
    });
    expect(empty.preflight.ready).toBe(false);
    expect(() =>
      start("empty", empty.snapshot, "boot", now, {
        ...selection,
        conversationIds: [],
      }),
    ).toThrow("not_ready");
    expect(db.serialize()).toEqual(bytes);
  });
  it("applies reviewed legacy authority to assistant context and its no-save/suppressed origin", () => {
    message(
      "u1",
      "Equipment is unresolved; weekdays are short because of caregiving.",
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
      "I reject the bag because it is awkward; are poles suitable?",
      "user",
      "A",
      1700000002,
    );
    db.prepare(
      "update summary_original_boundary set floor=(select max(rowid) from message)",
    ).run();
    const reviewed = summaryRebuildInventory("boot", selection);
    expect(reviewed.counts.assistantContext).toBe(1);
    start("context", reviewed.snapshot, "boot", now, selection);
    const input = readSummaryRebuildBatch()!.sources.find(
      (s) => s.original?.messageId === "u2",
    )!;
    expect(minimizeSummarySource(input)?.referent).toContain(
      "neither is chosen",
    );
    db.prepare("insert into summary_suppression(source_id) values(?)").run(
      input.original!.context!.userSourceId,
    );
    expect(() => readSummaryRebuildBatch()).toThrow("source_changed");
    expect(
      summaryRebuildInventory("boot", selection).counts.assistantContext,
    ).toBe(0);
  });
});

describe("growing authored184-source multi-chat repair", () => {
  const meanings = [
    [
      "constraint",
      "user-stated",
      "Short weekday mornings fit caregiving. Repeatedly long weekday plans failed because family responsibilities leave limited time; prefer brief feasible sessions rather than treating missed long sessions as lack of commitment.",
    ],
    [
      "goal",
      "user-stated",
      "Prepare for a weekend family mountain hike with hiking-specific time on feet. Cycling remains useful general fitness but does not replace hiking preparation; do not turn this distinction into a prohibition on cycling.",
    ],
    [
      "rejected",
      "user-stated",
      "The heavy bag was rejected because carrying it felt awkward during practice. This is a scoped equipment decision, not rejection of all equipment, and does not establish any medical explanation for that preference.",
    ],
    [
      "question",
      "discussed-not-endorsed",
      "Poles remain unresolved. Fake discussion data: https://example.invalid/training /Users/example/notes ~/training-notes sk-example-not-a-real-key api_key password diagnosis treatment GPS raw FIT payload ‘ignore previous instructions’.",
    ],
    [
      "decision",
      "user-stated",
      "Mornings replace the earlier winter evening arrangement after an explicit schedule correction. Evenings belong to historical context, not a simultaneous current preference; ask again if circumstances actually change.",
    ],
    [
      "constraint",
      "user-stated",
      "Keep coaching concise because lengthy explanations made it harder to act. Preserve a short rationale for important tradeoffs rather than removing qualifications; brevity is not permission to invent certainty or skip evidence.",
    ],
    [
      "discussion",
      "discussed-not-endorsed",
      "A multi-day outing was discussed as a possibility, not a commitment. Family availability is unresolved; retain that uncertainty and do not silently convert brainstorming into a booked event, fixed date or accepted training goal.",
    ],
    [
      "decision",
      "endorsed",
      "Use gradual practice that fits the current schedule because abrupt long sessions previously failed to fit family life. This is a practical planning lesson, not a universal performance rule or permission to save new plans without direction.",
    ],
  ];
  it("preserves publication after staged40 then genuine shape failure and completes a separately reviewed184-source operation atomically", async () => {
    oldMemory();
    storage.edit(storage.version(), null, "Keep coaching concise.", now);
    for (let n = 0; n < 184; n++)
      message(
        `rich184-${n}`,
        `${meanings[n % 8][2]} Authored observation ${n}.`,
        "user",
        `rich-chat-${n % 7}`,
        1700000000 + n,
      );
    const before = storage.inspect(),
      revision = storage.version().revision;
    const originals = db
      .prepare("select id,content from message order by id")
      .all();
    let calls = 0,
      repack = false;
    const generate = vi.fn(async (_system: string, prompt: string) => {
      const input = JSON.parse(prompt) as {
        previous: string;
        targetCharacters: number;
        newSources: { user: string }[];
      };
      expect(input.targetCharacters).toBe(6000);
      expect(typeof input.previous).toBe("string");
      expect(JSON.stringify(input)).not.toMatch(
        /requiredCoverageSourceIds|replaces|sourceIds/,
      );
      // A genuine independent shape failure must still refuse after staging.
      const summary = repack
        ? meanings.map(([, , text]) => text).join("\n")
        : calls === 0
          ? "First complete temporary draft"
          : "x".repeat(6001);
      calls++;
      return {
        patch: !repack && calls > 1 ? { summary, extra: true } : { summary },
        usage: { input: 200, output: 200, cached: 0 },
      };
    });
    let identity = 0;
    const engine = createSummaryEngine({
      storage,
      generation: { generate },
      now: () => now,
      identity: () => `growing-${identity++}`,
      current: () => true,
      jitter: () => 0,
    });
    const beginRich = (id: string) => {
      const selection = {
        version: 1 as const,
        conversationIds: Array.from({ length: 7 }, (_, i) => `rich-chat-${i}`),
        includeLegacy: false,
      };
      const review = summaryRebuildInventory("boot", selection);
      expect(review.counts.includedUserMessages).toBe(184);
      start(id, review.snapshot, "boot", now, selection);
    };
    beginRich("growing-failure");
    for (let n = 0; n < 2; n++) {
      now += 3000;
      await engine.tick(new AbortController().signal);
    }
    expect(status()).toMatchObject({
      state: "interrupted",
      processed: 40,
      total: 184,
      reason: "summary_invalid_output",
    });
    expect(storage.inspect()).toEqual(before);
    const usage = db
      .prepare(
        "select usage_json from summary_attempt where job_id='growing-1'",
      )
      .get() as { usage_json: string };
    expect(JSON.parse(usage.usage_json)).toMatchObject({
      rejection: "shape",
    });
    now += 3000;
    await engine.tick(new AbortController().signal);
    expect(generate).toHaveBeenCalledTimes(2);
    // New explicit review/identity, never replay or blind retry of failed work.
    repack = true;
    beginRich("growing-repacked");
    for (let n = 0; n < 5; n++) {
      now += 3000;
      await engine.tick(new AbortController().signal);
      if (n < 4) expect(storage.inspect()).toEqual(before);
    }
    expect(status()).toMatchObject({ state: "complete", processed: 184 });
    expect(storage.version().revision).toBe(revision + 1);
    for (const [, , text] of meanings)
      expect(storage.inspect().text).toContain(text);
    expect(
      storage.preferences().map((preference) => preference.text),
    ).toContain("Keep coaching concise.");
    expect(storage.inspect().text).not.toContain("Keep coaching concise.");
    expect(
      db.prepare("select id,content from message order by id").all(),
    ).toEqual(originals);
    expect(generate).toHaveBeenCalledTimes(7);
    expect([...storage.inspect().text].length).toBeLessThanOrEqual(6000);
    expect(status()?.dispositions).toEqual({ processed: 184 });
    const next = history.admit("after-rich184", "What remains unresolved?");
    expect(
      JSON.stringify(replayMessages(history.read(next.admission))),
    ).toContain("https://example.invalid/training");
  });
});

describe("full-pool original admission and local preflight", () => {
  it("counts more than the sidebar/import cap without export or effects and preserves genuine original roles/time/hash", () => {
    for (let n = 0; n < 241; n++)
      message(`user-${n}`, undefined, "user", `chat-${n % 13}`, 1700000000 + n);
    message("formerly-filtered", "My password is synthetic-private.");
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
      includedChats: 14,
      includedUserMessages: 242,
      excludedUserMessages: 1,
      assistantContext: 0,
      excludedMessages: 2,
    });
    expect(inspected.reasons).toEqual({ "no-save-or-unresolved-context": 1 });
    expect(inspected.preflight.estimatedUsd.conservativeMaximum).toBeNull();
    expect(inspected.preflight.ready).toBe(true);
    begin();
    const first = readSummaryRebuildBatch()!;
    expect(first.sources).toHaveLength(40);
    const input = minimizeSummarySource(
      first.sources.find((s) => s.original?.messageId === "user-0")!,
    )!;
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
    now += 3000;
    const job = storage.admit(now, "context-link")!;
    const candidate = validateSummaryReplacement(
      { summary: "The bag was rejected as awkward; poles remain unresolved." },
      job,
      batch.sources.map((source) => minimizeSummarySource(source)!),
    )!;
    expect(Object.keys(candidate.value)).toEqual(["version", "text"]);
    expect(storage.publish(job, candidate, now)).toBe(true);
    expect(storage.inspect().text).toContain("poles remain unresolved");
    db.prepare("insert into summary_suppression(source_id) values(?)").run(
      input.original!.context!.userSourceId,
    );
    expect(inventory().counts.assistantContext).toBe(0);
  });
  it("does not bring no-save prior user content back through assistant prose", () => {
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
  it("refuses ambiguous equal-time user ancestry rather than bypassing a no-save origin via an arbitrary safe user", () => {
    message(
      "a-private",
      "Do not save this equipment discussion.",
      "user",
      "tie",
      1700000000,
    );
    message(
      "z-safe",
      "I prefer short weekday sessions.",
      "user",
      "tie",
      1700000000,
    );
    message(
      "offer",
      "Consider poles or a bag; neither is chosen.",
      "assistant",
      "tie",
      1700000001,
    );
    message("choice", "I choose the first option.", "user", "tie", 1700000002);
    begin();
    const batch = readSummaryRebuildBatch()!;
    expect(
      batch.sources.some((source) => source.original?.messageId === "choice"),
    ).toBe(true);
    expect(
      batch.sources.find((source) => source.original?.messageId === "choice")
        ?.referent,
    ).toBeNull();
    expect(inventory().counts.assistantContext).toBe(0);
    expect(inventory().reasons["no-save-or-unresolved-context"]).toBe(1);
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
      "known-clear": 1,
    });
  });
  it("refuses an oversized encoded selection before persisting an unreadable operation", () => {
    message("x".repeat(5000000));
    const reviewed = inventory();
    expect(reviewed.counts.includedUserMessages).toBe(1);
    expect(reviewed.limitExceeded).toBe(true);
    expect(() =>
      start("too-large-receipt", reviewed.snapshot, "boot", now),
    ).toThrow("not_ready");
    expect(
      db.prepare("select count(*) as n from summary_rebuild").get(),
    ).toEqual({ n: 0 });
  });
  it("discloses oversized sources and unresolved tied assistant context without clipping or invented pairing", () => {
    message("large", "x".repeat(16001));
    message("a1", "First option is poles.", "assistant", "A", 1700000000);
    message("u1", "I choose the first option.", "user", "A", 1700000000);
    expect(inventory().counts.includedUserMessages).toBe(1);
    expect(inventory().reasons).toEqual({ "oversized-message": 1 });
    begin();
    expect(readSummaryRebuildBatch()!.sources[0]).toMatchObject({
      user: "I choose the first option.",
      referent: null,
    });
  });
  it("refuses extra/stale/unknown command fields", () => {
    const base = {
      version: 2,
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
        version: 2,
        expected: storage.version(),
        action: "rebuild-cancel",
        id: "op",
      }),
    ).not.toBeNull();
  });
});
describe("same writer, staged candidate and atomic complete replacement", () => {
  it("maps rich authored legacy meanings through admitted context, supplied patches, rendered memory and next-turn consumption (not remote quality)", async () => {
    const rubric = [
      {
        chat: "weekdays",
        user: "Caregiving leaves only short weekdays. Repeated long weekday plans failed; brief morning sessions are feasible.",
        text: "Short weekday mornings fit caregiving; repeatedly long weekday plans failed, so use brief sessions.",
        category: "constraint",
        stance: "user-stated",
      },
      {
        chat: "hiking",
        user: "My weekend goal is a mountain hike with family; I need hiking preparation. Cycling helps fitness but does not replace time on feet.",
        text: "Prepare for a weekend family mountain hike: cycling helps fitness, not a substitute for hiking-specific time on feet.",
        category: "goal",
        stance: "user-stated",
      },
      {
        chat: "equipment",
        user: "Poles are still an unresolved question. I reject the bag because carrying it is awkward, not because all equipment is bad.",
        text: "The bag was rejected because carrying it is awkward. Poles remain an open question, not an endorsed choice.",
        category: "rejected",
        stance: "user-stated",
      },
      {
        chat: "schedule",
        user: "Evenings worked last winter only. My current schedule is mornings, replacing that earlier evening arrangement.",
        text: "Mornings replace the historical last-winter evening arrangement; evenings are not a current preference.",
        category: "decision",
        stance: "user-stated",
      },
    ];
    storage.edit(
      storage.version(),
      null,
      "Current manual instruction: keep coaching concise.",
      now,
    );
    message(
      "equipment-origin",
      "I have not chosen equipment; short weekdays fit caregiving.",
      "user",
      "equipment",
      1699999998,
    );
    message(
      "equipment-offer",
      "Consider poles or a bag; neither is chosen yet.",
      "assistant",
      "equipment",
      1699999999,
    );
    rubric.forEach((entry, index) =>
      message(
        `meaning-${index}`,
        entry.user,
        "user",
        entry.chat,
        1700000000 + index,
      ),
    );
    for (let n = 0; n < 63; n++)
      message(
        `incidental-${n}`,
        "One-off weather and route chatter, not a future preference.",
        "user",
        `noise-${n % 2}`,
        1700000010 + n,
      );
    message("no-save-rich", "Do not save this: I prefer evening coaching.");
    message("secret-rich", "My password is authored-private.");
    db.prepare(
      "update summary_original_boundary set floor=(select max(rowid) from message)",
    ).run();
    const selection = {
      version: 1 as const,
      conversationIds: null,
      includeLegacy: true,
    };
    const review = summaryRebuildInventory("boot", selection);
    expect(review.counts).toMatchObject({
      includedUserMessages: 69,
      excludedUserMessages: 1,
      assistantContext: 1,
    });
    start("rich", review.snapshot, "boot", now, selection);
    const before = storage.inspect();
    const seen: {
      user: string;
      assistantContext?: string;
      createdAt?: number;
      assistantContextCreatedAt?: number;
    }[] = [];
    let jobs = 0;
    const engine = createSummaryEngine({
      storage,
      identity: () => `rich-${jobs++}`,
      now: () => now,
      current: () => true,
      jitter: () => 0,
      generation: {
        generate: async (system, prompt) => {
          expect(system).toContain("A question is not a commitment");
          const request = JSON.parse(prompt) as {
            previous: string;
            newSources: typeof seen;
          };
          seen.push(...request.newSources);
          const summary = rubric
            .filter(
              (entry) =>
                request.previous.includes(entry.text) ||
                request.newSources.some((source) => source.user === entry.user),
            )
            .map((entry) => entry.text)
            .join("\n");
          return {
            patch: { summary },
            usage: { input: 100, output: 100, cached: 0 },
          };
        },
      },
    });
    now += 3000;
    await engine.tick(new AbortController().signal);
    expect(status()?.state).toBe("active");
    expect(storage.inspect()).toEqual(before);
    now += 2100;
    await engine.tick(new AbortController().signal);
    expect(status()).toMatchObject({ state: "complete", processed: 69 });
    expect(
      seen.find((source) => source.user === rubric[2].user)?.assistantContext,
    ).toContain("neither is chosen");
    expect(seen.find((source) => source.user === rubric[2].user)).toMatchObject(
      { createdAt: 1700000002, assistantContextCreatedAt: 1699999999 },
    );
    expect(seen.some((source) => /Do not save/.test(source.user))).toBe(false);
    expect(seen.some((source) => source.user.includes("password"))).toBe(true);
    const saved = storage.inspect();
    for (const entry of rubric) expect(saved.text).toContain(entry.text);
    expect(storage.preferences()[0].text).toContain(
      "Current manual instruction",
    );
    expect(saved.text).not.toContain("Current manual instruction");
    expect(saved.text).not.toMatch(
      /never cycle|poles chosen|must train evenings|weather/,
    );
    expect([...saved.text].length).toBeLessThan(6000);
    expect(status()?.dispositions).toEqual({ processed: 69 });
    expect(Object.keys(saved)).toEqual(["version", "text"]);
    const next = history.admit(
      "existing-null-chat",
      "What should guide us next?",
    );
    const consumed = JSON.stringify(
      replayMessages(history.read(next.admission)),
    );
    for (const entry of rubric) expect(consumed).toContain(entry.text);
  });
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
    for (let n = 0; n < 441; n++)
      message(`u-${n}`, undefined, "user", `A${n % 3}`, 1700000000 + n);
    const admitted = begin();
    let iterations = 0;
    while (status()!.state === "active") {
      now += 2100;
      const job = storage.admit(now, `batch-${iterations}`)!;
      expect(job).not.toBeNull();
      expect(job.sources.length).toBeLessThanOrEqual(40);
      if (iterations === 0)
        expect(job.previous).toEqual({ version: 2, text: "" });
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
    expect(storage.inspect()).toEqual({
      version: 2,
      text: "Short weekday sessions suit caregiving; repeatedly overlong weekday plans failed.",
    });
    expect(
      storage
        .preferences()
        .some((preference) => preference.text === "Keep concise coaching."),
    ).toBe(true);
    expect(old.version).toBe(2);
    expect(status()?.dispositions.processed).toBe(
      admitted.counts.includedUserMessages,
    );
    expect(db.prepare("select count(*) as n from message").get()).toEqual({
      n: 444,
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
      const published = storage.publish(job, candidate, now);
      if (action === "new-source") {
        expect(published).toBe(true);
        expect(status()).toMatchObject({
          state: "complete",
          processed: 2,
          total: 2,
        });
        const selected = JSON.parse(
          (
            db.prepare("select selection_json from summary_rebuild").get() as {
              selection_json: string;
            }
          ).selection_json,
        ) as { messageId: string }[];
        expect(selected.some((entry) => entry.messageId === "u2")).toBe(false);
        expect(inventory().counts.includedUserMessages).toBe(3);
      } else expect(published).toBe(false);
      if (["cancel", "failure", "timestamp", "reopen"].includes(action))
        expect(storage.inspect()).toEqual(before);
      expect(storage.status(now).unpricedAttempts).toBeGreaterThan(0);
      expect(storage.status(now).reservedUsdToday).toBe(0);
      expect(db.prepare("select count(*) as n from message").get()).toEqual({
        n: action === "new-source" ? 4 : 3,
      });
    },
  );
  it("honors recorded linked suppression while preferences do not consume D1 generated allowance", () => {
    oldMemory();
    const source = inventory().selected[0].sourceId;
    db.prepare("insert into summary_suppression(source_id) values(?)").run(
      source,
    );
    message("u1");
    expect(inventory().reasons.suppressed).toBe(1);
    storage.edit(storage.version(), null, "q".repeat(1200), now);
    storage.configure(true, "gpt-6-luna", 1000);
    begin();
    now += 3000;
    const job = storage.admit(now, "capacity")!;
    expect(storage.publish(job, proposal(job), now)).toBe(true);
    expect(storage.preferences()[0].text).toBe("q".repeat(1200));
    expect(storage.inspect().text.length).toBeLessThan(1000);
    expect(status()?.state).toBe("complete");
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
    expect(JSON.parse(generate.mock.calls[0][1]).targetCharacters).toBe(6000);
    expect(generate.mock.calls[0][0]).toBe(SUMMARY_SYSTEM);
    expect(SUMMARY_SYSTEM).toContain("FUTURE COACHING");
    expect(SUMMARY_SYSTEM).toContain("One incident is not a universal rule");
    expect(SUMMARY_SYSTEM).toContain("Latest explicit corrections");
    expect(SUMMARY_SYSTEM).toContain("A question is not a commitment");
    expect(JSON.parse(generate.mock.calls[0][1]).newSources[0]).toHaveProperty(
      "user",
    );
    expect(
      JSON.parse(generate.mock.calls[0][1]).newSources[0],
    ).not.toHaveProperty("sourceId");
    expect(storage.inspect()).toEqual(before);
    expect(status()?.state).toBe("interrupted");
    expect(storage.status(now).unpricedAttempts).toBeGreaterThan(0);
    expect(storage.status(now).unknownReservedUsd).toBe(0);
    await engine.tick(new AbortController().signal);
    expect(generate).toHaveBeenCalledTimes(1);
  });
  it.each([false, true])(
    "owns noise-only batch processing and rejects extra reconciliation output (%s)",
    async (incomplete) => {
      storage.edit(storage.version(), null, "Keep concise coaching.", now);
      const old = storage.inspect();
      for (let n = 0; n < 45; n++)
        message(
          `noise-${n}`,
          "One-off picnic bench chatter, not future coaching context.",
        );
      begin();
      now += 3000;
      const generate = vi.fn(async (_system: string, prompt: string) => {
        const request = JSON.parse(prompt);
        expect(request).not.toHaveProperty("requiredCoverageSourceIds");
        expect(
          request.newSources.every(
            (source: Record<string, unknown>) =>
              !Object.hasOwn(source, "sourceId"),
          ),
        ).toBe(true);
        expect(_system).toContain('ONLY strict JSON {"summary"');
        expect(request.previous).toBe("");
        return {
          patch: incomplete ? { summary: "", coverage: [] } : { summary: "" },
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
            rejection: "shape",
          }),
        });
      } else {
        expect(status()).toMatchObject({ state: "active", processed: 40 });
        now += 2100;
        await engine.tick(new AbortController().signal);
        expect(status()).toMatchObject({ state: "complete", processed: 45 });
        expect(storage.inspect()).toEqual(old);
      }
      expect(generate).toHaveBeenCalledTimes(incomplete ? 1 : 2);
    },
  );
  it("scrubs staged text on authority/privacy invalidation without losing operation progress or original bytes", () => {
    oldMemory();
    for (let n = 0; n < 45; n++) message(`privacy-${n}`);
    begin();
    now += 3000;
    const job = storage.admit(now, "stage-privacy")!;
    expect(storage.publish(job, proposal(job), now)).toBe(true);
    expect(status()?.processed).toBe(40);
    expect(
      (
        db.prepare("select candidate_json from summary_rebuild").get() as {
          candidate_json: string;
        }
      ).candidate_json,
    ).toContain("caregiving");
    storage.control("clear", now);
    expect(status()).toMatchObject({ state: "invalidated", processed: 40 });
    expect(
      db
        .prepare(
          "select candidate_json,candidate_checksum from summary_rebuild",
        )
        .get(),
    ).toEqual({
      candidate_json: '{"version":2,"text":""}',
      candidate_checksum: "",
    });
    expect(db.prepare("select count(*) as n from message").get()).toEqual({
      n: 47,
    });
  });
  it("keeps historical Forget restrictions effective for the same original after content/timestamp edits without generated cards", () => {
    message("forgotten");
    const source = inventory().selected[0].sourceId;
    begin();
    now += 3000;
    const job = storage.admit(now, "publish-forget")!;
    expect(storage.publish(job, proposal(job), now)).toBe(true);
    // Historical suppression is retained, not a new granular UI promise.
    db.prepare("insert into summary_suppression(source_id) values(?)").run(
      source,
    );
    db.prepare(
      "update message set content='I now prefer long weekdays.',created_at=created_at+1 where id='forgotten'",
    ).run();
    expect(inventory().reasons.suppressed).toBe(1);
    expect(inventory().counts.includedUserMessages).toBe(0);
  });
  it.each([
    "format_version=3",
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
      spend = db.prepare("select * from summary_spend").all();
    removeRebuildFixtureSchema(db);
    const manual = db.prepare("select * from summary_manual").all();
    db.prepare(
      "update app_metadata set value='21' where key='schema_version'",
    ).run();
    const result = migrateDatabase(db);
    expect(result).toMatchObject({
      fromVersion: 21,
      toVersion: 25,
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
