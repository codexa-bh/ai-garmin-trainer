import { beforeEach, expect, it, vi } from "vitest";
import type { ChatTurnAnswer, PreparedChatTurn } from "@/lib/chat/turn";
import type { StoredChatMessage } from "@/lib/chat/contracts";

const f = vi.hoisted(() => ({
  generate: vi.fn(),
  complete: vi.fn(),
  order: [] as string[],
}));
vi.mock("@/lib/chat/composition", () => ({
  generateChatTurn: f.generate,
  completeChatTurn: f.complete,
}));
vi.mock("@/lib/chat/context", () => ({
  activeTranscriptContext: (messages: StoredChatMessage[]) =>
    messages.map((m) => m.content),
}));
import { jsonResponse, streamingResponse } from "@/app/api/chat/delivery";

const userRecord: StoredChatMessage = {
  id: "u",
  conversationId: "c",
  role: "user",
  content: "hello",
  grounding: null,
  createdAt: new Date("2026-09-21T10:00:00Z"),
};
const turn: PreparedChatTurn = {
  conversationId: "c",
  latestMessage: "hello",
  previousMessages: [],
  userRecord,
};
const answer: ChatTurnAnswer = {
  kind: "generated",
  text: "first second",
  grounding: { summary: "safe" },
  toolEvidence: { summary: "safe" },
  toolSteps: [],
  progressCounters: { modelCalls: 1, toolsSucceeded: 0, toolsUnsuccessful: 0 },
};
const assistantRecord: StoredChatMessage = {
  ...userRecord,
  id: "a",
  role: "assistant",
  content: answer.text,
  grounding: answer.grounding,
};

beforeEach(() => {
  vi.clearAllMocks();
  f.order = [];
  f.generate.mockImplementation(async () => {
    f.order.push("generate");
    return answer;
  });
  f.complete.mockImplementation(async () => {
    f.order.push("complete");
    return { assistantRecord, messages: [userRecord, assistantRecord] };
  });
});

it("emits all final deltas before requesting completion and done after completion", async () => {
  const encode = TextEncoder.prototype.encode;
  const spy = vi
    .spyOn(TextEncoder.prototype, "encode")
    .mockImplementation(function (this: TextEncoder, text) {
      if (text?.startsWith('{"type":'))
        f.order.push((JSON.parse(text) as { type: string }).type);
      return encode.call(this, text);
    });
  try {
    const response = streamingResponse({
      ...turn,
      debugTraceEnabled: true,
      memoryProposal: { status: "none" },
      requestSignal: new AbortController().signal,
    });
    await response.text();
    expect(f.order).toEqual([
      "start",
      "status",
      "generate",
      "metadata",
      "status",
      "delta",
      "delta",
      "complete",
      "done",
    ]);
    expect(f.complete).toHaveBeenCalledOnce();
    expect(f.complete).toHaveBeenCalledWith(
      expect.objectContaining(turn),
      answer,
    );
  } finally {
    spy.mockRestore();
  }
});

it("JSON requests failure debug decoration, but counts normal pre-answer context", async () => {
  const response = await jsonResponse(turn, true);
  expect(await response.json()).toMatchObject({
    contextWindow: 1,
    assistant: { id: "a" },
    toolSteps: [],
  });
  expect(f.complete).toHaveBeenCalledWith(turn, answer, {
    failureDebugTraceEnabled: true,
  });
});

it("does not complete when enqueue/encoding fails during delta delivery", async () => {
  const encode = TextEncoder.prototype.encode;
  const spy = vi
    .spyOn(TextEncoder.prototype, "encode")
    .mockImplementation(function (this: TextEncoder, text) {
      if (text?.startsWith('{"type":"delta"'))
        throw new Error("delivery failed");
      return encode.call(this, text);
    });
  try {
    const response = streamingResponse({
      ...turn,
      debugTraceEnabled: false,
      memoryProposal: { status: "none" },
      requestSignal: new AbortController().signal,
    });
    const body = await response.text();
    expect(body).toContain('"code":"chat_failed"');
    expect(body).not.toContain("delivery failed");
    expect(f.complete).not.toHaveBeenCalled();
  } finally {
    spy.mockRestore();
  }
});

it("suppresses invalidated undelivered prose while reporting only actual completed effect names", async () => {
  const abandon = vi.fn();
  f.generate.mockResolvedValue({
    ...answer,
    text: "PRIVATE DELETED CONTENT",
    toolSteps: [
      {
        index: 1,
        tool: "saveTrainingPlan",
        status: "succeeded",
        result: { private: "must not be in error" },
      },
      { index: 2, tool: "saveWeeklyDocuments", status: "failed" },
    ],
  });
  let checks = 0;
  const response = streamingResponse({
    ...turn,
    assertCurrent: () => {
      if (++checks > 1) throw new Error("conversation_context_invalidated");
    },
    abandon,
    debugTraceEnabled: false,
    memoryProposal: { status: "none" },
    requestSignal: new AbortController().signal,
  });
  const text = await response.text();
  expect(text).not.toContain("PRIVATE DELETED CONTENT");
  expect(text).not.toContain("must not be in error");
  expect(text).toContain("saveTrainingPlan");
  expect(text).not.toContain("saveWeeklyDocuments");
  expect(text).not.toContain('"type":"done"');
  expect(f.complete).not.toHaveBeenCalled();
  expect(abandon).toHaveBeenCalledOnce();
});

it("does not commit an aborted JSON request and releases only its own admission", async () => {
  const controller = new AbortController();
  controller.abort();
  const abandon = vi.fn();
  await expect(
    jsonResponse({ ...turn, abandon }, false, controller.signal),
  ).rejects.toThrow("conversation_delivery_aborted");
  expect(f.complete).not.toHaveBeenCalled();
  expect(abandon).toHaveBeenCalledOnce();
});
