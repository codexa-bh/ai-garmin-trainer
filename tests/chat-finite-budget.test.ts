import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ prepare: vi.fn() }));
vi.mock("@/lib/chat/composition", () => ({
  prepareChatTurn: mocks.prepare,
  completeConversationTitle: vi.fn(),
}));
vi.mock("@/lib/chat/conversation-composition", () => ({
  conversations: { isDebugTraceEnabled: () => false },
}));
vi.mock("@/app/api/chat/delivery", () => ({
  apiMessage: vi.fn(),
  safeChatFailureMessage: () => "Fixed failure",
  jsonResponse: async (input: { executionLimit?: 3 }) =>
    Response.json({ limit: input.executionLimit ?? null }),
  streamingResponse: (input: { executionLimit?: 3 }) =>
    Response.json({ limit: input.executionLimit ?? null }),
}));
import { POST } from "@/app/api/chat/route";

beforeEach(() =>
  mocks.prepare.mockReset().mockImplementation(() => ({ userRecord: {} })),
);
describe("finite live-smoke budget HTTP boundary", () => {
  it("refuses arbitrary budget selectors before persistence or generation", async () => {
    for (const value of ["arbitrary", "30", "raise-limit"]) {
      const response = await POST(
        new Request("http://localhost/api/chat", {
          method: "POST",
          headers: { "x-trainer-turn-budget": value },
          body: JSON.stringify({ message: "Synthetic only" }),
        }),
      );
      expect(response.status).toBe(400);
    }
    expect(mocks.prepare).not.toHaveBeenCalled();
  });
  it("keeps default unchanged and carries only fixed3 through JSON and streaming", async () => {
    for (const stream of [false, true]) {
      const normal = await POST(
        new Request("http://localhost/api/chat", {
          method: "POST",
          body: JSON.stringify({ message: "Synthetic only", stream }),
        }),
      );
      expect(await normal.json()).toEqual({ limit: null });
      const finite = await POST(
        new Request("http://localhost/api/chat", {
          method: "POST",
          headers: { "x-trainer-turn-budget": "finite-live-smoke" },
          body: JSON.stringify({ message: "Synthetic only", stream }),
        }),
      );
      expect(await finite.json()).toEqual({ limit: 3 });
    }
  });
});
