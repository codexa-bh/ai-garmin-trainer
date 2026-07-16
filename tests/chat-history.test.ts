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
        tool: "analyzeActivity",
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
    expect(recentTwo[0].grounding?.tool).toBe("analyzeActivity");
    expect(recentTwo[0].grounding?.activityName).toBe("Vrh Zakotja");

    repository.clearConversationHistory();
    expect(repository.listRecentChatMessages()).toEqual([]);
  });
});
