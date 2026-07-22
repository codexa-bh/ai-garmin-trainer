import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  process.env.DATABASE_PATH = join(
    mkdtempSync(join(tmpdir(), "trainer-chat-history-")),
    "test.sqlite",
  );
});

describe("local chat history repository", () => {
  it("persists, bounds, and clears chronological chat messages", async () => {
    const repository = await import("../src/lib/db/repository");

    repository.ensureConversation();
    repository.appendChatMessage({
      role: "user",
      content: "Analyze latest hike",
    });
    repository.appendChatMessage({
      role: "assistant",
      content: "Tool-grounded answer",
      grounding: {
        tool: "runMathAnalysis",
        activityId: "123456",
        activityName: "Vrh Zakotja",
        privacy: "normalized local analytics only",
      },
    });
    repository.appendChatMessage({
      role: "user",
      content: "What should I do tomorrow based on that?",
    });

    const recentTwo = repository.listRecentChatMessages(
      repository.DEFAULT_CONVERSATION_ID,
      2,
    );
    expect(recentTwo.map((message) => message.role)).toEqual([
      "assistant",
      "user",
    ]);
    expect(recentTwo[0].grounding?.tool).toBe("runMathAnalysis");
    expect(recentTwo[0].grounding?.activityName).toBe("Vrh Zakotja");

    repository.clearConversationHistory();
    expect(repository.listRecentChatMessages()).toEqual([]);
  });

  it("keeps manual new-chat conversations separate without deleting existing transcript", async () => {
    const repository = await import("../src/lib/db/repository");

    repository.appendChatMessage({
      conversationId: repository.DEFAULT_CONVERSATION_ID,
      role: "user",
      content: "Old transcript phrase from the default conversation",
    });
    repository.appendChatMessage({
      conversationId: "local-new-chat-test",
      role: "user",
      content: "Fresh conversation question",
    });

    expect(
      repository
        .listRecentChatMessages("local-new-chat-test")
        .map((message) => message.content),
    ).toEqual(["Fresh conversation question"]);
    expect(
      repository
        .listRecentChatMessages(repository.DEFAULT_CONVERSATION_ID)
        .map((message) => message.content),
    ).toEqual(["Old transcript phrase from the default conversation"]);
  });
});
