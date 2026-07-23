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

  it("deletes one conversation through the route while preserving other local data", async () => {
    const repository = await import("../src/lib/db/repository");
    const route =
      await import("../src/app/api/conversations/[conversationId]/route");

    repository.saveTrainerProfile({
      goals: ["Preserve this profile"],
      sports: ["hiking"],
      preferences: { coachingStyle: "direct" },
      constraints: ["no racing"],
    });
    repository.upsertActivities([
      {
        garminId: "garmin-preserved-1",
        name: "Preserved local activity",
        sport: "hiking",
        startedAt: new Date("2026-07-16T06:00:00Z"),
        durationSec: 3600,
        distanceMeters: 8000,
        calories: 500,
        avgHeartRate: 140,
        maxHeartRate: 170,
        steps: 9000,
        elevationGainMeters: 700,
        elevationLossMeters: 700,
        trainingEffect: 3.1,
      },
    ]);
    const memory = repository.createTrainerMemoryProposal({
      category: "learned_preference",
      value: "Prefers morning hikes",
      sourceType: "chat",
      sourceRef: "keep-chat",
      provenanceText: "User asked to remember this preference.",
    });
    repository.confirmTrainerMemory(memory.id);
    repository.appendChatMessage({
      conversationId: "delete-chat",
      role: "user",
      content: "Delete only this transcript",
    });
    repository.appendChatMessage({
      conversationId: "keep-chat",
      role: "user",
      content: "Keep this transcript",
    });

    const response = await route.DELETE(
      new Request("http://local.test/api/conversations/delete-chat", {
        method: "DELETE",
      }),
      { params: { conversationId: "delete-chat" } },
    );
    const payload = (await response.json()) as {
      deleted: boolean;
      conversationId: string;
      nextConversationId: string;
      conversations: Array<{ id: string }>;
    };

    expect(payload).toMatchObject({
      deleted: true,
      conversationId: "delete-chat",
      nextConversationId: "keep-chat",
    });
    expect(payload.conversations.map((item) => item.id)).toEqual(["keep-chat"]);
    expect(repository.listRecentChatMessages("delete-chat")).toEqual([]);
    expect(
      repository
        .listRecentChatMessages("keep-chat")
        .map((message) => message.content),
    ).toEqual(["Keep this transcript"]);
    expect(repository.getTrainerProfile().goals).toEqual([
      "Preserve this profile",
    ]);
    expect(repository.listActiveTrainerMemories()).toHaveLength(1);
    expect(repository.dataCounts().activities).toBe(1);
  });
});
