import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  StoredChatMessage,
  ChatGrounding,
} from "@/lib/db/conversation-repository";
import type {
  OrchestrateTrainerChatInput,
  OrchestrateTrainerChatResult,
} from "@/lib/ai/orchestrator";
import { fallbackLlmDebugTrace } from "@/lib/ai/debug-trace";

const f = vi.hoisted(() => ({
  messages: [] as StoredChatMessage[],
  order: [] as string[],
  debug: true,
  selected: vi.fn(),
  context: vi.fn(),
  search: vi.fn(),
  memory: vi.fn(),
  counts: vi.fn(),
  details: vi.fn(),
  orchestrate:
    vi.fn<
      (
        input: OrchestrateTrainerChatInput,
      ) => Promise<OrchestrateTrainerChatResult>
    >(),
}));
vi.mock("@/lib/env", () => ({ isLlmDebugTraceEnabled: () => f.debug }));
vi.mock("@/lib/ai/providers", () => ({ selectedModel: f.selected }));
vi.mock("@/lib/ai/orchestrator", () => ({
  orchestrateTrainerChat: f.orchestrate,
}));
vi.mock("@/lib/ai/context", async (original) => ({
  ...(await original<typeof import("@/lib/ai/context")>()),
  buildTrainerContext: f.context,
}));
vi.mock("@/lib/db/repository", () => ({
  dataCounts: f.counts,
  listActivityDetailAvailability: f.details,
  listRecentActivities: () => [],
  listRecentDailyHealth: () => [],
  getTrainerProfile: () => null,
  getGarminAthleteBaseline: () => null,
  getGarminBodyMetrics: () => null,
}));
vi.mock("@/lib/db/training-plan-repository", () => ({
  trainingPlanStatus: () => null,
}));
vi.mock("@/lib/memory/sqlite-adapter", () => ({
  trainerMemoryStore: () => ({ search: f.search, addCompletedTurn: f.memory }),
}));
vi.mock("@/lib/db/conversation-lifecycle", () => ({
  clearConversationHistory: vi.fn(),
}));
vi.mock("@/lib/db/conversation-repository", () => ({
  safeConversationId: (value?: string) => value?.trim() || "default",
  ensureConversation: () => {
    f.order.push("ensure");
  },
  listRecentChatMessages: (id: string, limit: number) => {
    f.order.push(`history:${limit}`);
    return f.messages.filter((m) => m.conversationId === id).slice(-limit);
  },
  appendChatMessage: (
    input: Omit<StoredChatMessage, "id" | "createdAt" | "grounding"> & {
      grounding?: ChatGrounding | null;
    },
  ) => {
    f.order.push(`save:${input.role}`);
    const message = {
      ...input,
      grounding: input.grounding ?? null,
      id: String(f.messages.length),
      createdAt: new Date("2026-09-21T10:00:00Z"),
    };
    f.messages.push(message);
    return message;
  },
}));

const counters = { modelCalls: 2, toolsSucceeded: 1, toolsUnsuccessful: 0 };
const debugTrace = fallbackLlmDebugTrace({
  userRequest: "hello",
  finalAnswer: "answer",
  reason: "characterization",
  provider: "deepseek",
  model: "deepseek-chat",
});
const result = (): OrchestrateTrainerChatResult => ({
  text: "Answer  with\nwhitespace. ",
  grounding: { summary: "local facts" },
  toolSteps: [],
  providerCalls: 2,
  progressCounters: counters,
  debugTrace,
});
function seedFailure() {
  f.messages.push({
    id: "previous",
    conversationId: "default",
    role: "assistant",
    content: "old answer",
    createdAt: new Date("2026-09-20T10:00:00Z"),
    grounding: {
      debugTrace,
      toolSteps: [
        {
          index: 1,
          tool: "providerToolSelection",
          status: "rejected",
          reason: "multiple_tool_calls",
          summary: "multiple",
          privacy: "no tools",
        },
      ],
    },
  });
}
async function post(body: object, signal?: AbortSignal) {
  const { POST } = await import("@/app/api/chat/route");
  return POST(
    new Request("http://localhost/api/chat", {
      method: "POST",
      body: JSON.stringify(body),
      signal,
    }),
  );
}
type Event = { type: string; textDelta?: string; [key: string]: unknown };
async function events(response: Response): Promise<Event[]> {
  return (await response.text())
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as Event);
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.clearAllMocks();
  f.messages = [];
  f.order = [];
  f.debug = true;
  f.selected.mockImplementation(() => {
    f.order.push("select");
    return { model: "model", provider: "deepseek", modelName: "deepseek-chat" };
  });
  f.counts.mockImplementation(() => {
    f.order.push("counts");
    return {
      activities: 3,
      healthDays: 4,
      detailCoverage: {
        terminal: 1,
        total: 3,
        available: 1,
        partial: 0,
        unsupported: 0,
        pending: 2,
        retryableFailures: 0,
      },
    };
  });
  f.details.mockReturnValue([]);
  f.search.mockImplementation(async () => {
    f.order.push("search");
    return [];
  });
  f.context.mockImplementation(() => {
    f.order.push("context");
    return "bounded context";
  });
  f.memory.mockImplementation(async () => {
    f.order.push("memory");
  });
  f.orchestrate.mockImplementation(async (input) => {
    f.order.push("generate");
    input.onStatus?.("Working", counters);
    return result();
  });
});

describe("chat application without HTTP or stream objects", () => {
  it("loads bounded context and generates without completion, then commits once", async () => {
    const { prepareChatTurn, generateChatTurn, completeChatTurn } =
      await import("@/lib/chat/turn");
    const turn = prepareChatTurn("default", "hello");
    const progress = vi.fn();
    const answer = await generateChatTurn(turn, {
      debugTraceEnabled: true,
      onStatus: progress,
    });
    expect(answer).toMatchObject({
      kind: "generated",
      text: result().text,
      toolEvidence: result().grounding,
      progressCounters: counters,
    });
    expect(progress).toHaveBeenCalledWith("Working", counters);
    expect(f.messages.map((m) => m.role)).toEqual(["user"]);
    expect(f.memory).not.toHaveBeenCalled();
    expect(f.orchestrate).toHaveBeenCalledWith(
      expect.objectContaining({
        userRequest: "hello",
        debug: { enabled: true, provider: "deepseek", model: "deepseek-chat" },
        system: expect.stringContaining(
          "Imported data counts: 3 activities, 4 daily health records",
        ),
      }),
    );
    expect(f.context).toHaveBeenCalledWith(
      expect.objectContaining({
        recentMessages: ["user: hello"],
        currentDate: expect.any(Date),
        retrievedMemories: [],
      }),
    );
    f.memory.mockRejectedValueOnce(new Error("memory offline"));
    const completed = await completeChatTurn(turn, answer);
    expect(completed.assistantRecord).toBe(f.messages[1]);
    expect(completed.messages).toEqual(f.messages);
    expect(f.order.slice(-2)).toEqual(["save:assistant", "history:40"]);
  });

  it("returns prior-failure reasoning without provider/context work and leaves decoration to completion", async () => {
    const { prepareChatTurn, generateChatTurn, completeChatTurn } =
      await import("@/lib/chat/turn");
    seedFailure();
    const previous = f.messages[0].grounding;
    const turn = prepareChatTurn("default", "what happened");
    const answer = await generateChatTurn(turn, { debugTraceEnabled: true });
    expect(answer.kind).toBe("previous-failure");
    expect(answer.grounding).toBe(previous);
    expect(f.selected).not.toHaveBeenCalled();
    expect(f.counts).not.toHaveBeenCalled();
    expect(f.messages).toHaveLength(2);
    const { assistantRecord } = await completeChatTurn(turn, answer, {
      failureDebugTraceEnabled: true,
    });
    expect(assistantRecord.grounding?.debugTrace).not.toEqual(
      previous?.debugTrace,
    );
    expect(assistantRecord.grounding?.toolSteps).toEqual(previous?.toolSteps);
  });

  it("propagates generation failure without committing or swallowing it", async () => {
    const { prepareChatTurn, generateChatTurn } =
      await import("@/lib/chat/turn");
    const turn = prepareChatTurn("default", "hello");
    f.orchestrate.mockRejectedValueOnce(new Error("generation failed"));
    await expect(
      generateChatTurn(turn, { debugTraceEnabled: false }),
    ).rejects.toThrow("generation failed");
    expect(f.messages).toHaveLength(1);
    expect(f.memory).not.toHaveBeenCalled();
  });
});

describe("chat delivery compatibility (real route/application wiring)", () => {
  it.each([false, true])(
    "preserves completion, counters and context counts: stream=%s",
    async (stream) => {
      const response = await post({ message: "hello", stream });
      expect(response.status).toBe(200);
      expect(f.search).toHaveBeenCalledWith(
        "hello",
        { userId: "local-default", conversationId: "default" },
        8,
      );
      expect(f.details).toHaveBeenCalledWith(12);
      const payload = stream ? await events(response) : await response.json();
      expect(f.order).toEqual([
        "ensure",
        "history:40",
        "save:user",
        "select",
        "counts",
        "search",
        "context",
        "generate",
        "save:assistant",
        "memory",
        "history:40",
      ]);
      expect(f.messages).toHaveLength(2);
      expect(f.memory).toHaveBeenCalledOnce();
      if (stream) {
        expect(response.headers.get("content-type")).toBe(
          "application/x-ndjson; charset=utf-8",
        );
        expect(response.headers.get("cache-control")).toBe("no-store");
        const list = payload as Event[];
        expect(list.map((e) => e.type)).toEqual([
          "start",
          "status",
          "status",
          "metadata",
          "status",
          "delta",
          "delta",
          "delta",
          "done",
        ]);
        expect(
          list
            .filter((e) => e.type === "delta")
            .map((e) => e.textDelta)
            .join(""),
        ).toBe(result().text);
        expect(list[3]).toEqual({
          type: "metadata",
          grounding: { summary: "local facts" },
        });
        expect(list[4]).toMatchObject({ counters });
        expect(list.at(-1)).toMatchObject({
          contextWindow: 2,
          historyLimit: 40,
          memoryProposal: { status: "none" },
          assistantMessage: { grounding: { debugTrace } },
        });
      } else {
        expect(payload).toMatchObject({
          contextWindow: 1,
          historyLimit: 40,
          toolEvidence: { summary: "local facts" },
          toolSteps: [],
          memoryProposal: { status: "none" },
          assistant: {
            content: result().text,
            createdAt: "2026-09-21T10:00:00.000Z",
            grounding: { debugTrace },
          },
        });
      }
    },
  );

  it.each([false, true])(
    "retains prior-failure debug/count differences without a provider: stream=%s",
    async (stream) => {
      seedFailure();
      const previousGrounding = f.messages[0].grounding;
      const response = await post({ message: "why?", stream });
      const payload = stream ? await events(response) : await response.json();
      expect(f.selected).not.toHaveBeenCalled();
      expect(f.search).not.toHaveBeenCalled();
      expect(f.orchestrate).not.toHaveBeenCalled();
      expect(f.messages.at(-1)?.content).toContain(
        "model selected multiple tools",
      );
      expect(f.memory).toHaveBeenCalledOnce();
      if (stream) {
        const list = payload as Event[];
        expect(list.some((e) => e.type === "metadata")).toBe(false);
        expect(list.at(-1)).toMatchObject({
          contextWindow: 3,
          assistantMessage: { grounding: previousGrounding },
        });
        expect(f.messages.at(-1)?.grounding).toBe(previousGrounding);
      } else {
        expect(payload).toMatchObject({
          contextWindow: 3,
          toolEvidence: previousGrounding,
          toolSteps: [],
        });
        expect(f.messages.at(-1)?.grounding?.debugTrace).not.toEqual(
          debugTrace,
        );
      }
    },
  );

  it.each([false, true])(
    "hides serialized traces when disabled without changing tool evidence: stream=%s",
    async (stream) => {
      f.debug = false;
      seedFailure();
      const response = await post({ message: "why?", stream });
      const payload = stream ? await events(response) : await response.json();
      if (stream) {
        expect(JSON.stringify(payload)).not.toContain("debugTrace");
      } else {
        expect(payload.assistant.grounding).not.toHaveProperty("debugTrace");
        expect(
          payload.messages.every(
            (m: { grounding: ChatGrounding | null }) =>
              !m.grounding?.debugTrace,
          ),
        ).toBe(true);
        expect(payload.toolEvidence.debugTrace).toEqual(debugTrace);
      }
    },
  );

  it.each([false, true])(
    "tolerates memory search/ingestion failure: stream=%s",
    async (stream) => {
      f.search.mockRejectedValueOnce(new Error("search failed"));
      f.memory.mockRejectedValueOnce(new Error("memory failed"));
      const response = await post({ message: "hello", stream });
      const payload = stream ? await events(response) : await response.json();
      expect(f.context).toHaveBeenCalledWith(
        expect.objectContaining({ retrievedMemories: [] }),
      );
      expect(f.messages).toHaveLength(2);
      expect(
        stream ? (payload as Event[]).at(-1)?.type : payload.assistant.content,
      ).toBe(stream ? "done" : result().text);
    },
  );

  it.each(["select", "context", "orchestrator"])(
    "preserves %s failures after user persistence in both modes",
    async (stage) => {
      for (const stream of [false, true]) {
        f.messages = [];
        const error = new Error(
          stage === "select"
            ? "Missing provider API key"
            : "private internal detail",
        );
        if (stage === "select")
          f.selected.mockImplementationOnce(() => {
            throw error;
          });
        if (stage === "context")
          f.counts.mockImplementationOnce(() => {
            throw error;
          });
        if (stage === "orchestrator")
          f.orchestrate.mockRejectedValueOnce(error);
        const response = await post({ message: "hello", stream });
        const expected =
          stage === "select"
            ? error.message
            : "Trainer chat failed before a safe answer was persisted. Run npm run doctor to check local provider readiness, then retry.";
        if (stream) {
          const list = await events(response);
          expect(list.map((e) => e.type)).toEqual(["start", "status", "error"]);
          expect(list.at(-1)).toEqual({
            type: "error",
            code: "chat_failed",
            message: expected,
            retryable: true,
          });
        } else {
          expect(response.status).toBe(500);
          expect(await response.json()).toEqual({ error: expected });
        }
        expect(f.messages.map((m) => m.role)).toEqual(["user"]);
        expect(f.memory).not.toHaveBeenCalled();
      }
    },
  );

  it("retains direct-message precedence, SDK text extraction and empty rejection", async () => {
    expect(
      (
        await post({
          message: "  ",
          messages: [{ parts: [{ type: "text", text: "ignored" }] }],
        })
      ).status,
    ).toBe(400);
    expect(f.messages).toEqual([]);
    await post({
      message: " direct ",
      messages: [{ parts: [{ type: "text", text: "ignored" }] }],
    });
    expect(f.messages[0].content).toBe("direct");
    await post({
      messages: [
        { parts: [{ type: "text", text: "old" }] },
        {
          parts: [
            { type: "text", text: "new" },
            { type: "file" },
            { type: "text", text: "text" },
          ],
        },
      ],
    });
    expect(f.messages[2].content).toBe("new  text");
  });

  it("observes abort after generation without cancelling provider work or persisting an assistant", async () => {
    const gate = deferred();
    const started = deferred();
    const abort = new AbortController();
    f.orchestrate.mockImplementationOnce(async () => {
      started.resolve();
      await gate.promise;
      return result();
    });
    const response = await post(
      { message: "hello", stream: true },
      abort.signal,
    );
    await started.promise;
    abort.abort();
    gate.resolve();
    const list = await events(response);
    expect(list.map((e) => e.type)).toEqual([
      "start",
      "status",
      "metadata",
      "status",
      "error",
    ]);
    expect(list.at(-1)).toMatchObject({
      code: "aborted",
      message:
        "Chat stream stopped before a complete assistant answer was persisted.",
      retryable: true,
    });
    expect(f.orchestrate).toHaveBeenCalledOnce();
    expect(f.messages.map((m) => m.role)).toEqual(["user"]);
    expect(f.memory).not.toHaveBeenCalled();
  });

  it.each([1, 3])(
    "checks abort after delta %s, including immediately before persistence",
    async (stopAt) => {
      const abort = new AbortController();
      const encode = TextEncoder.prototype.encode;
      let deltas = 0;
      const spy = vi
        .spyOn(TextEncoder.prototype, "encode")
        .mockImplementation(function (this: TextEncoder, text) {
          if (text?.startsWith('{"type":"delta"') && ++deltas === stopAt)
            abort.abort();
          return encode.call(this, text);
        });
      try {
        const list = await events(
          await post({ message: "hello", stream: true }, abort.signal),
        );
        expect(list.filter((e) => e.type === "delta")).toHaveLength(stopAt);
        expect(list.at(-1)).toMatchObject({ type: "error", code: "aborted" });
        expect(f.messages.map((m) => m.role)).toEqual(["user"]);
        expect(f.memory).not.toHaveBeenCalled();
      } finally {
        spy.mockRestore();
      }
    },
  );

  it.each(["", "   "])(
    "retains empty/whitespace final delta fallback: %j",
    async (text) => {
      f.orchestrate.mockResolvedValueOnce({ ...result(), text });
      const list = await events(await post({ message: "hello", stream: true }));
      expect(list.filter((e) => e.type === "delta")).toEqual([
        { type: "delta", textDelta: text },
      ]);
      expect(f.messages.at(-1)?.content).toBe(text);
    },
  );

  it("does not short-circuit an ordinary follow-up to a failed answer", async () => {
    seedFailure();
    await post({ message: "Please try again" });
    expect(f.orchestrate).toHaveBeenCalledOnce();
  });

  it("awaits memory after saving, with no new abort check after persistence", async () => {
    const gate = deferred();
    const started = deferred();
    const abort = new AbortController();
    f.memory.mockImplementationOnce(async () => {
      started.resolve();
      await gate.promise;
    });
    const response = await post(
      { message: "hello", stream: true },
      abort.signal,
    );
    await started.promise;
    expect(f.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(f.order.at(-1)).toBe("save:assistant");
    abort.abort();
    gate.resolve();
    expect((await events(response)).at(-1)?.type).toBe("done");
    expect(f.order.at(-1)).toBe("history:40");
  });
});
