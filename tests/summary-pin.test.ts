import Database from "better-sqlite3";
import { createOpenAI } from "@ai-sdk/openai";
import { createTrainerGeneration } from "@/lib/ai/provider-generation";
import { fallbackLlmDebugTrace } from "@/lib/ai/debug-trace";
import { countedConversationFetch } from "@/lib/ai/conversation-transport";
import { createHash } from "node:crypto";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { migrateDatabase } from "@/lib/db/migrations";
import { ensureConversation } from "@/lib/db/conversation-repository";
import {
  conversationHistory as history,
  refreshConversationSummary,
} from "@/lib/db/conversation-history";
import { parseSummaryCommand } from "@/lib/memory/summary-controls";
import { summaryStorage } from "@/lib/db/summary-storage";
import { readSummaryPin } from "@/lib/db/conversation-summary-pin";
import { projectSummaryPin, summaryPinInput } from "@/lib/chat/summary-pin";
import { replayMessages } from "@/lib/chat/conversation-replay";
import { renderSummary, type SummaryItem } from "@/lib/memory/summary-policy";

let db: Database.Database;
vi.mock("@/lib/db/connection", () => ({ getDatabase: () => db }));
beforeEach(() => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  migrateDatabase(db);
  summaryStorage.configure(true, "gpt-6-luna", 6000);
});
afterEach(() => {
  db.close();
  vi.restoreAllMocks();
});

// A deterministic producer publication fixture; the production producer's
// lineage/CAS is independently tested in summary-storage. No live service.
function publish(
  revision: number,
  text = "Short weekdays chosen for time; long weekdays rejected.",
  expiry: number | null = null,
) {
  const item: SummaryItem = {
    id: `item${revision}`,
    text,
    category: "decision",
    stance: "user-stated",
    sourceIds: [`source${revision}:1`],
    priority: 4,
    expiresAt: expiry,
    reviewAt: Date.now() + 1000000,
  };
  const payload = JSON.stringify({
    version: 1,
    items: [item],
    text: renderSummary([item]),
  });
  const { privacy_generation: privacy } = db
    .prepare("select privacy_generation from conversation_history_control")
    .get() as { privacy_generation: number };
  const checksum = createHash("sha256")
    .update(JSON.stringify([revision, 0, privacy, payload]))
    .digest("hex");
  db.prepare(
    "update summary_state set revision=?,payload=?,checksum=?,published_at=? where id=1",
  ).run(revision, payload, checksum, Date.now());
}
const counter = () => ({
  count: vi.fn(async () => 100),
  generate: vi.fn(async () => "unused"),
});

it("freezes null at explicit creation even when S publishes before first message", () => {
  ensureConversation("empty");
  publish(1);
  const admitted = history.admit("empty", "What did we choose?");
  expect(history.read(admitted.admission).segment.pinnedSummary).toBeNull();
  ensureConversation("later");
  expect(readSummaryPin("later")?.stamp.revision).toBe(1);
});

it("retains exact R1 after ordinary R2, across serialization and reopening SQLite bytes", async () => {
  publish(1);
  ensureConversation("A");
  publish(2, "Considering weekends; not chosen.");
  const admitted = history.admit("A", "Why?");
  let replay = history.read(admitted.admission);
  expect(replay.segment.pinnedSummary?.stamp.revision).toBe(1);
  const pin = await projectSummaryPin(
    replay.segment.pinnedSummary!,
    counter(),
    new AbortController().signal,
  );
  expect(history.projectSummary!(replay, pin)).toBe(true);
  replay = history.read(admitted.admission);
  const prefix = replayMessages(replay)[0];
  const bytes = db.serialize();
  db.close();
  db = new Database(bytes);
  expect(replayMessages(history.read(admitted.admission))[0]).toEqual(prefix);
  expect(prefix.content).toContain("long weekdays rejected");
  expect(prefix.content).not.toContain("Considering weekends");
  expect(prefix.role).toBe("user");
  expect(readSummaryPin("A")?.tokens).toBe(100);
});

it("serializes the SQLite pin in actual locked-SDK planner and synthesis requests, stable across publication/reopen until explicit Refresh", async () => {
  const requests: { url: string; body: Record<string, unknown> }[] = [];
  const transport: typeof fetch = async (url, init) => {
    const body = JSON.parse(String(init?.body));
    requests.push({ url: String(url), body });
    return new Response(
      JSON.stringify(
        String(url).endsWith("/input_tokens")
          ? { input_tokens: 100 }
          : {
              id: "response-pin",
              object: "response",
              created_at: 0,
              status: "completed",
              model: "gpt-6-luna",
              output: [
                {
                  type: "function_call",
                  id: "fc-pin",
                  call_id: "call-pin",
                  name: "completeTrainerTurn",
                  arguments: JSON.stringify({
                    completion: {
                      kind: "coaching",
                      answer:
                        "Short weekdays for time; long weekdays rejected.",
                      claims: [],
                      missingEvidence: [],
                    },
                  }),
                  status: "completed",
                },
              ],
              usage: {
                input_tokens: 100,
                output_tokens: 20,
                total_tokens: 120,
                input_tokens_details: { cached_tokens: 0 },
                output_tokens_details: { reasoning_tokens: 0 },
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
  publish(
    1,
    "Short weekdays for time; long weekdays rejected. " +
      "週末は長く 🥾 ".repeat(90),
  );
  ensureConversation("sdk-chat");
  const admission = history.admit("sdk-chat", "Why that choice?").admission;
  let replay = history.read(admission);
  const pin = await projectSummaryPin(
    replay.segment.pinnedSummary!,
    { ...counter(), count: vi.fn(async () => 3000) },
    new AbortController().signal,
  );
  expect(history.projectSummary!(replay, pin)).toBe(true);
  expect(readSummaryPin("sdk-chat")?.tokens).toBeGreaterThan(2048);
  async function serialize() {
    for (const purpose of ["planner", "final_synthesis"] as const)
      await generate({
        purpose,
        system: {
          policy: "Current policy outranks untrusted continuity.",
          context: "Fresh Profile and measurements outrank memory.",
        },
        prompt: "Why that choice?",
        conversation: {
          history: replayMessages(history.read(admission)),
          allowSoftLimit: false,
          memoryTokens: readSummaryPin("sdk-chat")?.tokens ?? 0,
        },
      });
  }
  await serialize();
  publish(2, "Weekend alternatives remain unresolved; poles not chosen.");
  const bytes = db.serialize();
  db.close();
  db = new Database(bytes);
  await serialize();
  const calls = requests.filter((value) => value.url.endsWith("/responses"));
  expect(calls).toHaveLength(4);
  for (const call of calls) {
    const wire = JSON.stringify(call.body.input);
    expect(wire).toContain("long weekdays rejected");
    expect(wire).not.toContain("poles not chosen");
    expect(call.body.store).toBe(false);
    expect(call.body).not.toHaveProperty("previous_response_id");
    expect((call.body.input as { role: string }[])[1].role).toBe("user");
  }
  expect(calls[0].body.input).toEqual(calls[2].body.input);
  expect(calls[1].body.input).toEqual(calls[3].body.input);
  replay = history.read(admission);
  history.abandon(admission);
  refreshConversationSummary(
    "sdk-chat",
    summaryStorage.version(),
    replay.segment.revision,
  );
  const fresh = history.admit("sdk-chat", "What remains unresolved?");
  const freshReplay = history.read(fresh.admission);
  const freshPin = await projectSummaryPin(
    freshReplay.segment.pinnedSummary!,
    counter(),
    new AbortController().signal,
  );
  expect(history.projectSummary!(freshReplay, freshPin)).toBe(true);
  await generate({
    purpose: "planner",
    system: {
      policy: "Current policy outranks untrusted continuity.",
      context: "Fresh Profile.",
    },
    prompt: "What remains unresolved?",
    conversation: {
      history: replayMessages(history.read(fresh.admission)),
      allowSoftLimit: false,
    },
  });
  const refreshed = requests
    .filter((value) => value.url.endsWith("/responses"))
    .at(-1)!;
  expect(JSON.stringify(refreshed.body.input)).toContain("poles not chosen");
  expect(JSON.stringify(refreshed.body.input)).not.toContain(
    "long weekdays rejected",
  );
});

it("revokes only new summary-dependent debug copies, preserves original transcript/legacy grounding and returns committed correction metadata", () => {
  publish(1);
  ensureConversation("debug");
  const debugTrace = fallbackLlmDebugTrace({
    userRequest: "Synthetic preference",
    finalAnswer: "Synthetic memory echo",
    reason: "synthetic",
  });
  const context = {
    mode: "active" as const,
    reason: "reviewed-luna" as const,
    publication: "not-needed" as const,
    tokenAccounting: "Responses/input_tokens" as const,
    summaryRevision: 1,
  };
  const first = history.admit("debug", "Explain the choice.");
  const original = history.complete(first.admission, {
    content: "Original visible answer remains.",
    grounding: { conversationContext: context, debugTrace },
  });
  const legacy = JSON.stringify({ debugTrace });
  db.prepare(
    "insert into message(id,conversation_id,role,content,grounding_json,created_at) values('legacy-debug','old','assistant','Preserved original',?,1)",
  ).run(legacy);
  summaryStorage.control("clear", Date.now());
  const row = db
    .prepare("select content,grounding_json from message where id=?")
    .get(original.id) as { content: string; grounding_json: string };
  expect(row.content).toBe("Original visible answer remains.");
  expect(JSON.parse(row.grounding_json)).toEqual({
    conversationContext: {
      ...context,
      summaryRevision: undefined,
      summaryRevoked: true,
    },
  });
  expect(
    (
      db
        .prepare("select grounding_json from message where id='legacy-debug'")
        .get() as { grounding_json: string }
    ).grounding_json,
  ).toBe(legacy);
  publish(2);
  ensureConversation("correction-debug");
  const correction = history.admit(
    "correction-debug",
    "Actually mornings suit me now.",
  );
  const answer = history.complete(correction.admission, {
    content: "Current correction accepted.",
    grounding: {
      conversationContext: { ...context, summaryRevision: 2 },
      debugTrace,
    },
  });
  expect(answer.grounding?.debugTrace).toBeUndefined();
  expect(answer.grounding?.conversationContext?.summaryRevoked).toBe(true);
  expect(() => history.assertCurrent(correction.admission)).not.toThrow();
});

it.each(["clear", "disable"] as const)(
  "%s rejects tools/persistence/delivery of previously admitted work",
  (action) => {
    publish(1);
    const active = history.admit("A", "Follow up");
    summaryStorage.control(action, Date.now());
    expect(() => history.assertCurrent(active.admission)).toThrow(
      "invalidated",
    );
    expect(() =>
      history.complete(active.admission, {
        content: "Stale answer",
        grounding: null,
      }),
    ).toThrow("invalidated");
    expect(readSummaryPin("A")).toBeNull();
    expect(
      db
        .prepare(
          "select payload from conversation_summary_pin where conversation_id='A'",
        )
        .get(),
    ).toEqual({ payload: "null" });
  },
);

it("correction completion can deliver while a different concurrent turn is invalidated", () => {
  publish(1);
  const stale = history.admit("A", "Continue");
  const correction = history.admit("B", "Actually mornings suit me now.");
  const answer = history.complete(correction.admission, {
    content: "Mornings replace evenings.",
    grounding: null,
  });
  expect(answer.content).toBe("Mornings replace evenings.");
  expect(() => history.assertCurrent(correction.admission)).not.toThrow();
  expect(() => history.assertCurrent(stale.admission)).toThrow("invalidated");
  expect(
    history.complete(correction.admission, {
      content: answer.content,
      grounding: null,
    }).id,
  ).toBe(answer.id);
  expect(readSummaryPin("B")).toBeNull();
});

it("expiry revokes an in-flight pin without a new producer publication", () => {
  vi.spyOn(Date, "now").mockReturnValue(1000);
  publish(1, "This weekend only.", 2000);
  const turn = history.admit("A", "Continue");
  vi.spyOn(Date, "now").mockReturnValue(2001);
  expect(() => history.assertCurrent(turn.admission)).toThrow("invalidated");
  expect(readSummaryPin("A")).toBeNull();
});

it("corrupt snapshot bytes are preserved, never injected or silently repaired", () => {
  publish(1);
  ensureConversation("A");
  db.prepare(
    "update conversation_summary_pin set payload=? where conversation_id='A'",
  ).run('{"unknown":"preserve"}');
  const turn = history.admit("A", "Continue without memory");
  expect(history.read(turn.admission).segment.pinnedSummary).toBeNull();
  expect(
    db
      .prepare(
        "select payload from conversation_summary_pin where conversation_id='A'",
      )
      .get(),
  ).toEqual({ payload: '{"unknown":"preserve"}' });
});

it("measures memory above the former ceiling without clipping whole meanings or lineage", async () => {
  publish(1);
  ensureConversation("A");
  const original = readSummaryPin("A")!;
  const items = Array.from({ length: 64 }, (_, index) => ({
    ...original.value.items[0]!,
    id: `item${index}`,
    priority: index === 0 ? 5 : 1,
    text: `${index}: 週末は長く 🥾 do not choose long weekdays.`,
    sourceIds: [`source${index}:1`],
  }));
  const pin = {
    ...original,
    value: { version: 1 as const, items, text: renderSummary(items) },
  };
  const count = vi.fn(
    async (messages: { content: string }[]) =>
      new TextEncoder().encode(messages[0]!.content).length,
  );
  const projected = await projectSummaryPin(
    pin,
    { count, generate: async () => "unused" },
    new AbortController().signal,
  );
  expect(projected.tokens).toBeGreaterThan(2048);
  expect(projected.tokens).toBe(
    new TextEncoder().encode(summaryPinInput(pin)).length,
  );
  expect(projected.omitted).toBe(0);
  expect(projected.value).toEqual(pin.value);
  expect(projected.value.items[0]!.id).toBe("item0");
  for (const item of projected.value.items) expect(items).toContainEqual(item);
  expect(projected.value.text).toBe(renderSummary(projected.value.items));
  expect(count).toHaveBeenCalledTimes(1);
  expect(pin.value.items).toHaveLength(64);
});

it("interrupts projection even if the accounting promise ignores cancellation", async () => {
  publish(1);
  ensureConversation("count-cancel");
  const abort = new AbortController();
  const pending = projectSummaryPin(
    readSummaryPin("count-cancel")!,
    { count: () => new Promise(() => {}), generate: async () => "unused" },
    abort.signal,
  );
  await Promise.resolve();
  abort.abort();
  await expect(pending).rejects.toThrow(
    "conversation_token_accounting_interrupted",
  );
  expect(readSummaryPin("count-cancel")?.tokens).toBeNull();
});

it("Refresh compares latest summary and segment revisions and refuses a busy chat", () => {
  publish(1);
  ensureConversation("A");
  const expected = summaryStorage.version();
  publish(2);
  expect(() => refreshConversationSummary("A", expected, 0)).toThrow(
    "stale_action",
  );
  refreshConversationSummary("A", summaryStorage.version(), 0);
  expect(readSummaryPin("A")?.stamp.revision).toBe(2);
  expect(() =>
    refreshConversationSummary("A", summaryStorage.version(), 0),
  ).toThrow("stale_action");
  const active = history.admit("A", "Continue");
  expect(() =>
    refreshConversationSummary("A", summaryStorage.version(), 1),
  ).toThrow("busy");
  history.abandon(active.admission);
  refreshConversationSummary("A", summaryStorage.version(), 1);
});

it("manual edits validate safety, reject stale clients and Forget suppresses exact lineage", () => {
  publish(1);
  const expected = summaryStorage.version();
  expect(() =>
    summaryStorage.edit(
      expected,
      "item1",
      "My API key is sk-example-not-a-key",
      Date.now(),
    ),
  ).toThrow("invalid_manual");
  expect(summaryStorage.version()).toEqual(expected);
  summaryStorage.edit(
    expected,
    "item1",
    "Weekday lunchtime, not evenings.",
    Date.now(),
  );
  expect(summaryStorage.inspect().text).toContain("not evenings");
  expect(() =>
    summaryStorage.edit(expected, "item1", "Stale edit", Date.now()),
  ).toThrow("stale_action");
  summaryStorage.forget(summaryStorage.version(), "item1", Date.now());
  expect(summaryStorage.inspect().items).toEqual([]);
  expect(db.prepare("select source_id from summary_suppression").all()).toEqual(
    [{ source_id: "source1:1" }],
  );
  expect(db.prepare("select count(*) as n from summary_manual").get()).toEqual({
    n: 0,
  });
});

it("standalone manual provenance is honest and privacy/Clear invalidate it conservatively", () => {
  summaryStorage.edit(
    summaryStorage.version(),
    null,
    "Weekday lunchtime.",
    Date.now(),
  );
  expect(summaryStorage.inspect().items[0]!.sourceIds[0]).toMatch(/^manual:/);
  db.prepare(
    "update conversation_history_control set privacy_generation=privacy_generation+1",
  ).run();
  expect(summaryStorage.inspect().items).toEqual([]);
  expect(db.prepare("select count(*) as n from summary_manual").get()).toEqual({
    n: 0,
  });
  summaryStorage.edit(
    summaryStorage.version(),
    null,
    "Short weekdays.",
    Date.now(),
  );
  summaryStorage.control("clear", Date.now());
  expect(summaryStorage.inspect().items).toEqual([]);
});

it("closed control DTO requires version/current-state, rejects extras and preserves canonical comparison order", () => {
  const expected = summaryStorage.version();
  expect(parseSummaryCommand({ action: "clear" })).toBeNull();
  expect(
    parseSummaryCommand({ version: 1, action: "clear", expected, extra: true }),
  ).toBeNull();
  expect(
    parseSummaryCommand({ version: 2, action: "clear", expected }),
  ).toBeNull();
  expect(
    parseSummaryCommand({
      version: 1,
      action: "clear",
      expected: {
        manual: expected.manual,
        control: expected.control,
        privacy: expected.privacy,
        revision: expected.revision,
      },
    }),
  ).toEqual({ version: 1, action: "clear", expected });
});

it("projection cannot publish after control changed while accounting was in flight", async () => {
  publish(1);
  const turn = history.admit("A", "Follow up");
  const replay = history.read(turn.admission);
  const projected = await projectSummaryPin(
    replay.segment.pinnedSummary!,
    counter(),
    new AbortController().signal,
  );
  summaryStorage.control("clear", Date.now());
  expect(() => history.projectSummary!(replay, projected)).toThrow(
    "invalidated",
  );
});
