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

  it("lists conversations by recent activity with deterministic first-message titles", async () => {
    const repository = await import("../src/lib/db/repository");

    repository.createConversation({ id: "empty-chat", title: "New chat" });
    repository.appendChatMessage({
      conversationId: "first-chat",
      role: "user",
      content: "   Plan    a low intensity recovery ride after yesterday   ",
    });
    repository.appendChatMessage({
      conversationId: "second-chat",
      role: "user",
      content: "What was my most demanding hike this month?",
    });

    const summaries = repository.listConversations();
    expect(summaries.map((item) => item.id).slice(0, 3)).toEqual([
      "second-chat",
      "first-chat",
      "empty-chat",
    ]);
    expect(summaries.find((item) => item.id === "first-chat")?.title).toBe(
      "Plan a low intensity recovery ride after yester…",
    );
  });

  it("paginates display transcript history independently from recent grounding", async () => {
    const repository = await import("../src/lib/db/repository");

    for (let index = 1; index <= 7; index += 1) {
      repository.appendChatMessage({
        conversationId: "paged-chat",
        role: index % 2 === 0 ? "assistant" : "user",
        content: `message ${index}`,
      });
    }

    const firstPage = repository.listChatMessagePage({
      conversationId: "paged-chat",
      limit: 3,
    });
    const secondPage = repository.listChatMessagePage({
      conversationId: "paged-chat",
      cursor: firstPage.nextCursor,
      limit: 3,
    });

    expect(firstPage.messages.map((message) => message.content)).toEqual([
      "message 5",
      "message 6",
      "message 7",
    ]);
    expect(secondPage.messages.map((message) => message.content)).toEqual([
      "message 2",
      "message 3",
      "message 4",
    ]);
    expect(repository.listRecentChatMessages("paged-chat", 2)).toHaveLength(2);
  });
});
