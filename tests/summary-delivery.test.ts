import Database from "better-sqlite3";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { migrateDatabase } from "@/lib/db/migrations";
import { conversationHistory as history } from "@/lib/db/conversation-history";
import {
  ensureConversation,
  appendChatMessage,
  listRecentChatMessages,
} from "@/lib/db/conversation-repository";
import { createChatTurns } from "@/lib/chat/turn";
import { fallbackLlmDebugTrace } from "@/lib/ai/debug-trace";
import { summaryStorage } from "@/lib/db/summary-storage";
import { createSummaryEngine } from "@/lib/memory/summary-application";
let db: Database.Database;
let app: ReturnType<typeof createChatTurns>;
vi.mock("@/lib/db/connection", () => ({ getDatabase: () => db }));
vi.mock("@/lib/chat/composition", () => ({
  generateChatTurn: (
    ...args: Parameters<ReturnType<typeof createChatTurns>["generateChatTurn"]>
  ) => app.generateChatTurn(...args),
  completeChatTurn: (
    ...args: Parameters<ReturnType<typeof createChatTurns>["completeChatTurn"]>
  ) => app.completeChatTurn(...args),
}));
import { jsonResponse, streamingResponse } from "@/app/api/chat/delivery";
beforeEach(() => {
  db = new Database(":memory:");
  migrateDatabase(db);
  summaryStorage.configure(true, "gpt-6-luna", 6000);
});
afterEach(() => db.close());
it.each(["JSON", "NDJSON"])(
  "actual %s completion commits its source without waiting for a never-settling summary provider",
  async (mode) => {
    let now = Date.UTC(2026, 10, 3, 12);
    const seed = history.admit(
      "seed",
      "Keep weekdays short for available time.",
    );
    history.complete(seed.admission, {
      content: "Authored acknowledgement.",
      grounding: null,
    });
    const summaryGenerate = vi.fn(() => new Promise<never>(() => {}));
    const engine = createSummaryEngine({
      storage: summaryStorage,
      generation: { generate: summaryGenerate },
      now: () => now,
      identity: () => "delivery-job",
      current: () => true,
      jitter: () => 0,
    });
    const abort = new AbortController();
    await engine.tick(abort.signal);
    now += 120001;
    const background = engine.tick(abort.signal);
    await Promise.resolve();
    expect(summaryGenerate).toHaveBeenCalledOnce();
    app = createChatTurns({
      history,
      ensureConversation,
      appendChatMessage,
      listRecentChatMessages,
      buildSystemContext: async () => ({
        policy: "Stable authored policy",
        context: "Fresh context",
      }),
      selectGeneration: () => async () => ({
        text: "Short weekday walks leave time for other commitments.",
        grounding: null,
        toolSteps: [],
        progressCounters: {
          modelCalls: 1,
          toolsSucceeded: 0,
          toolsUnsuccessful: 0,
        },
      }),
      fallbackDebugTrace: fallbackLlmDebugTrace,
    });
    const turn = app.prepareChatTurn(
      `delivery-${mode}`,
      "Can we still discuss a walk?",
    );
    const response =
      mode === "JSON"
        ? await jsonResponse(turn, false)
        : streamingResponse({
            ...turn,
            debugTraceEnabled: false,
            memoryProposal: { status: "none" },
            requestSignal: new AbortController().signal,
          });
    const body = await response.text();
    expect(body).toContain(mode === "JSON" ? '"assistant"' : '"type":"done"');
    expect(summaryStorage.status(now).frontier).toBe(0);
    expect(
      db.prepare("select count(*) as n from conversation_completion").get(),
    ).toEqual({ n: 2 });
    abort.abort();
    await background;
    expect(summaryStorage.status(now).reason).toBe("summary_interrupted");
  },
);
