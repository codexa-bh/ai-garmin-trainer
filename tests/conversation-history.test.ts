import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { migrateDatabase } from "@/lib/db/migrations";
import { conversationHistory as history } from "@/lib/db/conversation-history";
import { appendChatMessage } from "@/lib/db/conversation-repository";
import { deleteConversation } from "@/lib/db/conversation-lifecycle";
import { saveTrainerProfile } from "@/lib/db/profile-repository";
import { compactConversation } from "@/lib/chat/conversation-compaction";
import { createChatTurns } from "@/lib/chat/turn";
import type { ChatGenerationInput, ChatGenerator } from "@/lib/chat/ports";
import {
  ensureConversation,
  listRecentChatMessages,
} from "@/lib/db/conversation-repository";
import { fallbackLlmDebugTrace } from "@/lib/ai/debug-trace";
import { ConversationCapacityError } from "@/lib/chat/conversation-replay";
import {
  replayMessages,
  unsafeCompactionSource,
  type ConversationCompactionGeneration,
} from "@/lib/chat/conversation-replay";

let db: Database.Database;
vi.mock("@/lib/db/connection", () => ({ getDatabase: () => db }));
beforeEach(() => {
  db = new Database(":memory:");
  migrateDatabase(db);
});
afterEach(() => {
  db.close();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
function complete(
  conversationId: string,
  user = "Use option two for weekday time.",
  assistant = "Short weekdays and longer weekend hike, not measured fitness.",
) {
  const admitted = history.admit(conversationId, user);
  const answer = history.complete(admitted.admission, {
    content: assistant,
    grounding: null,
  });
  return { ...admitted, answer };
}
function seed() {
  for (let index = 0; index < 5; index++)
    complete(
      "T0269-M01",
      `Round ${index}: keep option two for weekday time; long weekdays rejected.`,
      `Round ${index}: short weekdays, weekend hike; choice is not a measured fitness fact.`,
    );
  const current = history.admit("T0269-M01", "Why did we choose that option?");
  return { current, replay: history.read(current.admission) };
}
const generation = (): ConversationCompactionGeneration => ({
  count: vi.fn(async () => 100),
  generate: vi.fn(async (_system, prompt) => {
    const input = JSON.parse(prompt) as {
      previous: unknown;
      sources: { turnId: string }[];
    };
    return JSON.stringify({
      version: 1,
      items: [
        {
          speaker: "user",
          text: "Chose option two for weekday time; long weekdays rejected, not measured fitness.",
          sourceTurnIds: [
            ...input.sources.map((source) => source.turnId),
            ...(input.previous ? ["previous-compaction"] : []),
          ],
        },
      ],
    });
  }),
});

describe("actual SQLite completion journal, segments and privacy", () => {
  it("orders equal-time interleaved completion commits and makes duplicate completion idempotent", () => {
    vi.spyOn(Date, "now").mockReturnValue(1);
    const a = history.admit("A", "Morning, not a measurement.");
    const b = history.admit("B", "Considering evening, not chosen.");
    const first = history.complete(b.admission, {
      content: "Undecided.",
      grounding: null,
    });
    history.complete(a.admission, {
      content: "User chose morning.",
      grounding: null,
    });
    expect(
      history.complete(b.admission, { content: "Undecided.", grounding: null }),
    ).toEqual(first);
    expect(
      db
        .prepare(
          "select t.conversation_id as conversation,e.event_seq as seq from conversation_completion e join conversation_turn t on t.turn_id=e.turn_id order by seq",
        )
        .all(),
    ).toEqual([
      { conversation: "B", seq: 1 },
      { conversation: "A", seq: 2 },
    ]);
    expect(() =>
      history.complete(b.admission, {
        content: "Different answer.",
        grounding: null,
      }),
    ).toThrow("conflict");
  });

  it("rejects same-chat overlap, never promotes aborted/unlinked legacy pairs, and preserves exact Unicode", () => {
    const current = history.admit("A", "週末は長く 🥾 é");
    expect(() => history.admit("A", "Overlap")).toThrow("busy");
    history.abandon(current.admission);
    const next = history.admit("A", "New complete turn");
    expect(history.read(next.admission).turns).toEqual([]);
    history.complete(next.admission, {
      content: "Exact answer 🥾",
      grounding: null,
    });
    expect(history.read(next.admission).turns[0]!.assistant).toBe(
      "Exact answer 🥾",
    );
    appendChatMessage({
      conversationId: "legacy",
      role: "user",
      content: "Old unproven source",
    });
    appendChatMessage({
      conversationId: "legacy",
      role: "assistant",
      content: "Not proof of a completed journal turn",
    });
    const legacy = history.admit("legacy", "Follow up");
    expect(history.read(legacy.admission).legacyUnlinked).toBe(true);
  });

  it("rolls back assistant and completion together on an injected commit fault", () => {
    const current = history.admit("A", "Preserve source");
    db.exec(
      "create trigger crash_completion before insert on conversation_completion begin select raise(abort,'injected crash'); end",
    );
    expect(() =>
      history.complete(current.admission, {
        content: "Must not partially commit",
        grounding: null,
      }),
    ).toThrow("injected crash");
    expect(
      db
        .prepare("select count(*) as n from message where role='assistant'")
        .get(),
    ).toEqual({ n: 0 });
    expect(
      db.prepare("select count(*) as n from conversation_completion").get(),
    ).toEqual({ n: 0 });
    expect(history.read(current.admission).turns).toEqual([]);
  });

  it("compacts a contiguous prefix once, preserves two exact recent pairs, and reopens a consistent revision", async () => {
    const { current, replay } = seed();
    const before = replay.turns.slice(-2);
    expect(await compactConversation(history, replay, generation())).toBe(true);
    const result = history.read(current.admission);
    expect(result.segment).toMatchObject({
      revision: 1,
      coveredThrough: 3,
      pinnedSummary: null,
    });
    expect(result.turns).toEqual(before);
    expect(replayMessages(result).slice(1)).toEqual(
      before.flatMap((turn) => [
        { role: "user", content: turn.user },
        { role: "assistant", content: turn.assistant },
      ]),
    );
    const compact = result.segment.compact;
    expect(history.publish(replay, replay.turns.slice(0, -2), compact)).toBe(
      true,
    );
    expect(history.read(current.admission).segment.revision).toBe(1);
    const reopened = new Database(db.serialize());
    db.close();
    db = reopened;
    expect(history.read(current.admission).segment).toEqual(result.segment);
    expect(db.prepare("pragma integrity_check").get()).toEqual({
      integrity_check: "ok",
    });
  });

  it("rejects a competing revision, unknown format and any attempt to cover the recent tail", () => {
    const { replay } = seed();
    expect(history.publish(replay, replay.turns, "unsafe coverage")).toBe(
      false,
    );
    expect(
      history.publish(replay, replay.turns.slice(0, 1), "first valid compact"),
    ).toBe(true);
    expect(
      history.publish(
        replay,
        replay.turns.slice(0, 1),
        "stale different candidate",
      ),
    ).toBe(false);
    db.prepare("update conversation_segment set format_version=99").run();
    expect(() => history.read(replay.admission)).toThrow("unavailable");
    expect(
      db.prepare("select compact from conversation_segment").get(),
    ).toEqual({ compact: "first valid compact" });
  });

  it("deletion invalidates derived text and late completion/publication without recreating the chat", async () => {
    const { current, replay } = seed();
    expect(await compactConversation(history, replay, generation())).toBe(true);
    expect(deleteConversation("T0269-M01")).toBe(true);
    expect(() =>
      history.complete(current.admission, {
        content: "Late resurrected answer",
        grounding: null,
      }),
    ).toThrow("invalidated");
    expect(() =>
      history.publish(replay, replay.turns.slice(0, 1), "Late compact"),
    ).toThrow("invalidated");
    expect(db.prepare("select count(*) as n from conversation").get()).toEqual({
      n: 0,
    });
    expect(
      db
        .prepare(
          "select count(*) as n from conversation_segment where compact<>''",
        )
        .get(),
    ).toEqual({ n: 0 });
  });

  it("source edits and Profile corrections invalidate active work and increment durable source version", () => {
    const { current, replay } = seed();
    db.prepare(
      "update message set content='Lunchtime correction' where id=?",
    ).run(replay.turns[0]!.userId);
    expect(() => history.assertCurrent(current.admission)).toThrow(
      "invalidated",
    );
    expect(
      db
        .prepare(
          "select source_version as version from conversation_turn where turn_id=?",
        )
        .get(replay.turns[0]!.turnId),
    ).toEqual({ version: 2 });
    const fresh = history.admit("B", "Current Profile please");
    saveTrainerProfile({
      goals: [],
      sports: [],
      preferences: { time: "lunchtime" },
      constraints: [],
    });
    expect(() => history.assertCurrent(fresh.admission)).toThrow("invalidated");
  });

  it("retains unknown-outcome spend across reopen and refuses clock rollback or an eleventh attempt", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-03T12:00:00Z"));
    const current = history.admit("A", "Budget");
    for (let index = 0; index < 10; index++)
      expect(history.reserveCompaction(current.admission)).toBe(true);
    expect(history.reserveCompaction(current.admission)).toBe(false);
    const reopened = new Database(db.serialize());
    db.close();
    db = reopened;
    vi.setSystemTime(new Date("2026-11-02T12:00:00Z"));
    expect(history.reserveCompaction(current.admission)).toBe(false);
    expect(
      db
        .prepare(
          "select sum(attempts) as attempts from conversation_compaction_spend",
        )
        .get(),
    ).toEqual({ attempts: 10 });
  });

  it("does not run a model for unsafe sources, invalid output, timeout or stale publication", async () => {
    const { replay } = seed();
    const invalid = generation();
    invalid.generate = vi.fn(async () => '{"version":1,"items":[]}');
    expect(await compactConversation(history, replay, invalid)).toBe(false);
    expect(history.read(replay.admission).segment.revision).toBe(0);
    vi.useFakeTimers();
    let release!: (text: string) => void;
    const late = generation();
    late.generate = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          release = resolve;
        }),
    );
    const work = compactConversation(history, replay, late);
    await vi.advanceTimersByTimeAsync(5001);
    expect(await work).toBe(false);
    release(
      JSON.stringify({
        version: 1,
        items: [
          {
            speaker: "user",
            text: "Late valid choice",
            sourceTurnIds: replay.turns.slice(0, -2).map((turn) => turn.turnId),
          },
        ],
      }),
    );
    await vi.runAllTimersAsync();
    expect(history.read(replay.admission).segment.revision).toBe(0);
  });

  it("retains meaning slots and exact source boundaries across ten synthetic compactions (M09), then invalidates descendants", async () => {
    const original = complete(
      "M09",
      "We chose weekend hiking for available time, not for a diagnosed condition. Evening sessions were rejected.",
      "Weekend hiking fits time; evenings were rejected, not measured fitness.",
    );
    expect(unsafeCompactionSource(original.userRecord.content)).toBe(false);
    expect(
      unsafeCompactionSource("My diagnosis is a named synthetic condition"),
    ).toBe(true);
    expect(
      unsafeCompactionSource(
        "not for a diagnosed condition; my prescription is synthetic",
      ),
    ).toBe(true);
    const scripted = generation();
    scripted.generate = vi.fn(async (_system, prompt) => {
      const input = JSON.parse(prompt) as {
        previous: unknown;
        sources: { turnId: string }[];
      };
      return JSON.stringify({
        version: 1,
        items: [
          {
            speaker: "user",
            text: "Chose weekend hiking for time availability; evening sessions were rejected, not because of measured fitness.",
            sourceTurnIds: [
              ...input.sources.map((source) => source.turnId),
              ...(input.previous ? ["previous-compaction"] : []),
            ],
          },
        ],
      });
    });
    let covered = 0;
    for (let round = 1; round <= 10; round++) {
      complete(
        "M09",
        `Round ${round}: keep our choice, reason and rejected approach.`,
        "Weekend hiking fits time; evenings remain rejected.",
      );
      complete(
        "M09",
        `Round ${round}: keep the rationale without measurements.`,
        "Time availability is a user constraint, not a measurement.",
      );
      const current = history.admit(
        "M09",
        `Checkpoint ${round}: what did we choose and reject?`,
      );
      const before = history.read(current.admission);
      expect(await compactConversation(history, before, scripted)).toBe(true);
      const after = history.read(current.admission);
      expect(after.segment.revision).toBe(round);
      expect(after.segment.coveredThrough).toBeGreaterThan(covered);
      expect(after.segment.compact).toContain("weekend hiking");
      expect(after.segment.compact).toContain("time availability");
      expect(after.segment.compact).toContain("evening sessions were rejected");
      expect(after.turns).toEqual(before.turns.slice(-2));
      covered = after.segment.coveredThrough;
      history.complete(current.admission, {
        content: "Weekend hiking for time; evenings rejected.",
        grounding: null,
      });
    }
    db.prepare("delete from message where id=?").run(original.userRecord.id);
    expect(
      db
        .prepare(
          "select count(*) as n from conversation_segment where compact<>''",
        )
        .get(),
    ).toEqual({ n: 0 });
  });

  it("never starts generation after an ignored token-count abort expires", async () => {
    const { replay } = seed();
    vi.useFakeTimers();
    let release!: (tokens: number) => void;
    const late = generation();
    late.count = vi.fn(
      () =>
        new Promise<number>((resolve) => {
          release = resolve;
        }),
    );
    const work = compactConversation(history, replay, late);
    await vi.advanceTimersByTimeAsync(5001);
    expect(await work).toBe(false);
    release(100);
    await vi.runAllTimersAsync();
    expect(late.generate).not.toHaveBeenCalled();
    expect(history.read(replay.admission).segment.revision).toBe(0);
  });

  it("wires complete ordered replay beyond forty displayed messages through one bounded compaction without duplicating the current user", async () => {
    for (let index = 0; index < 50; index++)
      complete(
        "M01-long",
        `Explain pacing ${index} without changing option two or weekday time.`,
        "Option two: short weekdays plus a longer weekend hike for available time.",
      );
    const calls: ChatGenerationInput[] = [];
    const generate: ChatGenerator = async (input) => {
      calls.push(input);
      if (calls.length === 1) throw new ConversationCapacityError();
      return {
        text: "We chose option two for weekday time.",
        grounding: null,
        toolSteps: [],
        progressCounters: {
          modelCalls: 1,
          toolsSucceeded: 0,
          toolsUnsuccessful: 0,
        },
      };
    };
    generate.compaction = generation();
    const build = vi.fn(async () => ({
      policy: "Stable policy",
      context: "Fresh server date and current Profile; no stale measurements.",
    }));
    const app = createChatTurns({
      history,
      ensureConversation,
      listRecentChatMessages,
      appendChatMessage,
      buildSystemContext: build,
      selectGeneration: () => generate,
      addCompletedTurn: async () => {},
      fallbackDebugTrace: fallbackLlmDebugTrace,
    });
    const prepared = app.prepareChatTurn(
      "M01-long",
      "Why did we choose that one?",
    );
    expect(prepared.previousMessages).toHaveLength(40);
    const answer = await app.generateChatTurn(prepared, {
      debugTraceEnabled: false,
    });
    expect(calls).toHaveLength(2);
    expect(calls[0]!.conversation!.history).toHaveLength(101);
    expect(calls[1]!.conversation!.history).toHaveLength(61);
    expect(calls[1]!.conversation!.history[0]!.content).toContain(
      "weekday time",
    );
    expect(
      calls[1]!.conversation!.history.some(
        (message) => message.content === prepared.latestMessage,
      ),
    ).toBe(false);
    expect(build).toHaveBeenCalledWith(prepared.latestMessage, [], "M01-long");
    const completed = await app.completeChatTurn(prepared, answer);
    expect(completed.assistantRecord.content).toBe(answer.text);
    expect(
      db.prepare("select count(*) as n from conversation_completion").get(),
    ).toEqual({ n: 51 });
    expect(history.read(prepared.admission!).segment.coveredThrough).toBe(20);
  });

  it("refuses unknown-newer schema without modifying its version", () => {
    db.prepare(
      "update app_metadata set value='999' where key='schema_version'",
    ).run();
    expect(() => migrateDatabase(db)).toThrow("Unsupported");
    expect(
      db
        .prepare("select value from app_metadata where key='schema_version'")
        .get(),
    ).toEqual({ value: "999" });
  });
});
