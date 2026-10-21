import { describe, expect, it, vi } from "vitest";
import { createChatTurns } from "@/lib/chat/turn";
import { createChatContext } from "@/lib/chat/context";
import { createConversationUseCases } from "@/lib/chat/conversations";
import type { ConversationPorts } from "@/lib/chat/conversations";
import type { ChatTurnPorts } from "@/lib/chat/ports";
import type { ChatContextPorts } from "@/lib/chat/context-ports";
import type { StoredChatMessage } from "@/lib/chat/contracts";

const now = new Date("2026-09-21T10:00:00Z");
const conversation = {
  id: "c",
  title: "New chat",
  createdAt: now,
  updatedAt: now,
};
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
function turnFixture() {
  const order: string[] = [];
  const messages: StoredChatMessage[] = [];
  const ports: ChatTurnPorts = {
    ensureConversation: vi.fn(() => {
      order.push("ensure");
    }),
    listRecentChatMessages: vi.fn(() => {
      order.push("history");
      return [...messages];
    }),
    appendChatMessage: vi.fn((input) => {
      order.push(`save:${input.role}`);
      const message = {
        ...input,
        id: String(messages.length),
        createdAt: now,
        grounding: input.grounding ?? null,
      };
      messages.push(message);
      return message;
    }),
    selectGeneration: vi.fn<ChatTurnPorts["selectGeneration"]>(() => {
      order.push("select");
      return vi.fn(async (input) => {
        order.push("generate");
        input.onStatus?.("working");
        return {
          text: "answer",
          grounding: null,
          toolSteps: [],
          progressCounters: {
            modelCalls: 1,
            toolsSucceeded: 0,
            toolsUnsuccessful: 0,
          },
        };
      });
    }),
    buildSystemContext: vi.fn(async () => {
      order.push("context");
      return "context";
    }),
    addCompletedTurn: vi.fn(async () => {
      order.push("memory");
    }),
    fallbackDebugTrace: vi.fn<ChatTurnPorts["fallbackDebugTrace"]>(() => ({
      schemaVersion: 1,
      capturedAt: now.toISOString(),
      providerCalls: [],
      toolSteps: [],
      finalAnswer: "explanation",
      caps: {},
    })),
  };
  return { ports, order, messages, app: createChatTurns(ports) };
}

describe("chat turn factories with supplied ports, no infrastructure mocks", () => {
  it("is lazy; preserves synchronous preparation and assistant save before awaiting memory", async () => {
    const { ports, order, messages, app } = turnFixture();
    expect(order).toEqual([]);
    const turn = app.prepareChatTurn("c", "hello");
    expect(order).toEqual(["ensure", "history", "save:user"]);
    expect(ports.listRecentChatMessages).toHaveBeenCalledWith("c", 40);
    const progress = vi.fn();
    const answer = await app.generateChatTurn(turn, {
      debugTraceEnabled: false,
      onStatus: progress,
    });
    expect(progress).toHaveBeenCalledWith("working");
    expect(messages).toHaveLength(1);
    expect(order).toEqual([
      "ensure",
      "history",
      "save:user",
      "select",
      "context",
      "generate",
    ]);
    const gate = deferred();
    vi.mocked(ports.addCompletedTurn).mockImplementationOnce(
      () => gate.promise,
    );
    const completion = app.completeChatTurn(turn, answer);
    expect(messages).toHaveLength(2);
    expect(order.at(-1)).toBe("save:assistant");
    expect(ports.addCompletedTurn).toHaveBeenCalledWith({
      conversationId: "c",
      userMessageId: "0",
      assistantMessageId: "1",
      userText: "hello",
      assistantText: "answer",
      completedAt: now,
    });
    gate.resolve();
    expect((await completion).messages).toEqual(messages);
    expect(order.at(-1)).toBe("history");
  });

  it("passes recorded prior failures to generation without keyword routing", async () => {
    const { app, ports, messages } = turnFixture();
    messages.push({
      id: "old",
      conversationId: "c",
      role: "assistant",
      content: "failed",
      createdAt: now,
      grounding: {
        toolSteps: [
          {
            index: 1,
            tool: "runReadOnlySql",
            status: "failed",
            summary: "unavailable",
            privacy: "safe",
          },
        ],
      },
    });
    const turn = app.prepareChatTurn("c", "why?");
    const answer = await app.generateChatTurn(turn, {
      debugTraceEnabled: true,
    });
    expect(answer).toMatchObject({
      kind: "generated",
      text: "answer",
    });
    expect(ports.selectGeneration).toHaveBeenCalledOnce();
    expect(ports.buildSystemContext).toHaveBeenCalledOnce();
    const generation = vi.mocked(ports.selectGeneration).mock.results[0].value;
    expect(generation).toHaveBeenCalledWith(
      expect.objectContaining({
        turnContext: expect.objectContaining({
          previousFailures: [
            {
              tool: "runReadOnlySql",
              status: "failed",
              summary: "unavailable",
            },
          ],
        }),
      }),
    );
    vi.mocked(ports.addCompletedTurn).mockRejectedValueOnce(
      new Error("offline"),
    );
    const result = await app.completeChatTurn(turn, answer, {
      failureDebugTraceEnabled: true,
    });
    expect(result.messages).toHaveLength(3);
    expect(result.assistantRecord.grounding).toBeNull();
    expect(ports.fallbackDebugTrace).not.toHaveBeenCalled();
  });

  it.each(["select", "context", "save"])(
    "propagates %s failures without later side effects",
    async (stage) => {
      const { app, ports, messages } = turnFixture();
      const turn = app.prepareChatTurn("c", "hello");
      const fail = () => {
        throw new Error("failure");
      };
      if (stage === "select")
        vi.mocked(ports.selectGeneration).mockImplementationOnce(fail);
      if (stage === "context")
        vi.mocked(ports.buildSystemContext).mockRejectedValueOnce(
          new Error("failure"),
        );
      if (stage === "save") {
        const answer = await app.generateChatTurn(turn, {
          debugTraceEnabled: false,
        });
        vi.mocked(ports.appendChatMessage).mockImplementationOnce(fail);
        await expect(app.completeChatTurn(turn, answer)).rejects.toThrow(
          "failure",
        );
      } else {
        await expect(
          app.generateChatTurn(turn, { debugTraceEnabled: false }),
        ).rejects.toThrow("failure");
      }
      expect(messages).toHaveLength(1);
      expect(ports.addCompletedTurn).not.toHaveBeenCalled();
      if (stage === "select")
        expect(ports.buildSystemContext).not.toHaveBeenCalled();
    },
  );
});

function contextFixture() {
  const order: string[] = [];
  const ports: ChatContextPorts = {
    dataCounts: () => {
      order.push("counts");
      return {
        activities: 3,
        healthDays: 4,
        detailCoverage: {
          terminal: 0,
          total: 0,
          available: 0,
          partial: 0,
          unsupported: 0,
          pending: 0,
          retryableFailures: 0,
        },
      };
    },
    listActivityDetailAvailability: vi.fn(() => {
      order.push("details");
      return [];
    }),
    searchMemories: vi.fn(async () => []),
    listRecentActivities: () => {
      order.push("activities");
      return [];
    },
    listRecentDailyHealth: () => {
      order.push("health");
      return [];
    },
    getTrainerProfile: () => {
      order.push("profile");
      return { goals: [], sports: [], preferences: {}, constraints: [] };
    },
    getGarminAthleteBaseline: () => {
      order.push("athlete");
      return null;
    },
    getGarminBodyMetrics: () => {
      order.push("body");
      return null;
    },
    trainingPlanStatus: () => {
      order.push("plan");
      return undefined;
    },
    now: () => {
      order.push("clock");
      return now;
    },
  };
  return { ports, order };
}

describe("context factory", () => {
  it("rebuilds date/profile/transcript and deleted memory without changing trusted policy", async () => {
    const { ports } = contextFixture();
    vi.mocked(ports.searchMemories).mockResolvedValueOnce([
      {
        id: "m",
        kind: "saved_preference",
        text: "synthetic remembered preference",
      },
    ]);
    ports.now = () => new Date("2026-10-21T23:59:59Z");
    let goals: string[] = [];
    ports.getTrainerProfile = () => ({
      goals,
      sports: [],
      preferences: {},
      constraints: [],
    });
    const context = createChatContext(ports);
    const before = await context("hello", [], "c");
    ports.now = () => new Date("2026-10-22T00:00:01Z");
    goals = ["synthetic revised goal"];
    const after = await context("changed request", [], "c");
    if (typeof before === "string" || typeof after === "string")
      throw new Error("missing explicit policy/context boundary");
    expect(after.policy).toBe(before.policy);
    expect(before.context).toContain("2026-10-21T23:59:59.000Z");
    expect(after.context).toContain("2026-10-22T00:00:01.000Z");
    expect(before.context).toContain("synthetic remembered preference");
    expect(after.context).not.toContain("synthetic remembered preference");
    expect(after.context).toContain("synthetic revised goal");
    expect(after.policy).not.toContain("synthetic revised goal");
    expect(after.policy).toContain("Deleted, expired, disabled");
    expect(ports.searchMemories).toHaveBeenCalledTimes(2);
  });
  it("keeps bounded retrieval and post-await read/clock order with request-time context", async () => {
    const { ports, order } = contextFixture();
    const gate = deferred();
    vi.mocked(ports.searchMemories).mockImplementationOnce(async () => {
      order.push("search");
      await gate.promise;
      return [{ id: "m", text: "remembered", kind: "saved_preference" }];
    });
    const context = createChatContext(ports);
    expect(order).toEqual([]);
    const result = context("hello", [], "c");
    expect(order).toEqual(["counts", "details", "search"]);
    expect(ports.searchMemories).toHaveBeenCalledWith("hello", "c", 8);
    expect(ports.listActivityDetailAvailability).toHaveBeenCalledWith(12);
    gate.resolve();
    expect(await result).toHaveProperty(
      "context",
      expect.stringContaining("remembered"),
    );
    expect(order).toEqual([
      "counts",
      "details",
      "search",
      "activities",
      "health",
      "profile",
      "athlete",
      "body",
      "plan",
      "clock",
    ]);
    const second = await context("hello", [], "c");
    expect(second).toHaveProperty(
      "context",
      expect.stringContaining(now.toISOString()),
    );
    expect(second).toHaveProperty(
      "context",
      expect.stringContaining("3 activities, 4 daily health records"),
    );
  });
  it("falls back on memory rejection but propagates local read failures", async () => {
    const { ports } = contextFixture();
    vi.mocked(ports.searchMemories).mockRejectedValueOnce(new Error("offline"));
    expect(await createChatContext(ports)("hello", [], "c")).toHaveProperty(
      "context",
      expect.stringContaining("No relevant semantic memories retrieved"),
    );
    ports.listRecentActivities = () => {
      throw new Error("storage failed");
    };
    await expect(createChatContext(ports)("hello", [], "c")).rejects.toThrow(
      "storage failed",
    );
  });
});

function conversationFixture() {
  const order: string[] = [];
  const ports: ConversationPorts = {
    createConversation: vi.fn(() => {
      order.push("create");
      return conversation;
    }),
    listConversations: vi.fn((limit) => {
      order.push(`list:${limit}`);
      return [];
    }),
    getConversation: vi.fn(() => {
      order.push("get");
      return conversation;
    }),
    renameConversation: vi.fn(() => conversation),
    ensureConversation: vi.fn(() => {
      order.push("ensure");
    }),
    listRecentChatMessages: vi.fn(() => {
      order.push("history");
      return [];
    }),
    listChatMessagePage: vi.fn(() => {
      order.push("page");
      return { conversationId: "c", messages: [], nextCursor: null };
    }),
    deleteConversation: vi.fn(() => {
      order.push("delete-atomic");
      return false;
    }),
    clearConversationHistory: vi.fn(() => {
      order.push("clear-atomic");
    }),
    isDebugTraceEnabled: () => {
      order.push("debug");
      return true;
    },
  };
  return { ports, order, app: createConversationUseCases(ports) };
}

describe("conversation use cases", () => {
  it("delegates atomic deletion once, even for missing targets, then selects/creates fallback and reloads", () => {
    const { app, ports, order } = conversationFixture();
    expect(order).toEqual([]);
    expect(app.deleteConversation("missing")).toMatchObject({
      deleted: false,
      nextConversationId: "c",
    });
    expect(order).toEqual([
      "delete-atomic",
      "list:1",
      "create",
      "list:undefined",
    ]);
    expect(ports.deleteConversation).toHaveBeenCalledExactlyOnceWith("missing");
    vi.mocked(ports.listConversations).mockReturnValue([conversation]);
    app.deleteConversation("other");
    expect(ports.createConversation).toHaveBeenCalledOnce();
  });
  it("does not create fallback after a storage deletion error", () => {
    const { app, ports } = conversationFixture();
    vi.mocked(ports.deleteConversation).mockImplementation(() => {
      throw new Error("transaction rolled back");
    });
    expect(() => app.deleteConversation("c")).toThrow(
      "transaction rolled back",
    );
    expect(ports.listConversations).not.toHaveBeenCalled();
    expect(ports.createConversation).not.toHaveBeenCalled();
  });
  it("keeps missing-page early return, debug/page ordering, validation and synchronous clear/ensure", () => {
    const { app, ports, order } = conversationFixture();
    vi.mocked(ports.getConversation).mockImplementationOnce(() => {
      order.push("get");
      return null;
    });
    expect(app.loadConversationPage({ conversationId: "missing" })).toBeNull();
    expect(order).toEqual(["get"]);
    expect(
      app.loadConversationPage({
        conversationId: " c ",
        cursor: "cursor",
        limit: 7,
      }),
    ).toMatchObject({ debugTraceEnabled: true });
    expect(order).toEqual(["get", "get", "debug", "page"]);
    expect(ports.listChatMessagePage).toHaveBeenCalledWith({
      conversationId: "c",
      cursor: "cursor",
      limit: 7,
    });
    expect(() => app.deleteConversation("bad/id")).toThrow("Conversation id");
    expect(ports.deleteConversation).not.toHaveBeenCalled();
    app.clearChatHistory("c");
    expect(order.slice(-2)).toEqual(["clear-atomic", "ensure"]);
    app.chatHistory("c");
    expect(ports.listRecentChatMessages).toHaveBeenCalledWith("c", 40);
    app.createConversation({ id: "", title: "title" });
    expect(ports.createConversation).toHaveBeenCalledWith({
      id: undefined,
      title: "title",
    });
    app.renameConversation(" c ", "title");
    expect(ports.renameConversation).toHaveBeenCalledWith("c", "title");
    expect(app.listConversations(5)).toEqual([]);
  });
});
