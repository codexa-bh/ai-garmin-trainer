import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const f = vi.hoisted(() => ({ generate: vi.fn(), select: vi.fn() }));
vi.mock("ai", () => ({ generateText: f.generate }));
vi.mock("@/lib/ai/providers", () => ({
  selectedMemoryExtractionModel: f.select,
}));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  process.env.DATABASE_PATH = join(
    mkdtempSync(join(tmpdir(), "trainer-title-")),
    "test.sqlite",
  );
  f.select.mockReturnValue({ model: "memory-model" });
  f.generate.mockResolvedValue({ text: '{"title":"  Načrt   teka  "}' });
});
afterEach(() => vi.useRealTimers());

describe("first title provider adapter", () => {
  it("uses only the extraction selector and bounded untrusted first prompt, independently of memory flags", async () => {
    vi.stubEnv("MEMORY_ENABLED", "false");
    vi.stubEnv("MEMORY_EXTRACTION_MODE", "off");
    const { generateConversationTitle } =
      await import("@/lib/chat/title-adapter");
    expect(await generateConversationTitle("x".repeat(3000))).toBe(
      "Načrt teka",
    );
    expect(f.select).toHaveBeenCalledTimes(1);
    const options = f.generate.mock.calls[0][0];
    expect(options).toMatchObject({
      model: "memory-model",
      toolChoice: "none",
      maxRetries: 0,
      maxOutputTokens: 120,
    });
    expect(options).not.toHaveProperty("tools");
    expect(JSON.parse(options.prompt)).toEqual({
      firstPrompt: "x".repeat(2000),
    });
    expect(options.system).toContain("same language");
    expect(options.system).toContain("untrusted data");
    expect(options.abortSignal.aborted).toBe(false);
    vi.unstubAllEnvs();
  });

  it.each([
    "",
    "prose",
    '```json\n{"title":"name"}\n```',
    '{"title":""}',
    '{"title":"   "}',
    '{"title":23}',
    '{"title":"name","extra":true}',
    "[]",
    "null",
  ])("rejects wrong shape %j", async (text) => {
    f.generate.mockResolvedValue({ text });
    const { generateConversationTitle } =
      await import("@/lib/chat/title-adapter");
    expect(await generateConversationTitle("request")).toBeNull();
    expect(f.generate).toHaveBeenCalledTimes(1);
  });

  it("normalizes and bounds accepted titles", async () => {
    f.generate.mockResolvedValue({
      text: JSON.stringify({ title: "A".repeat(90) }),
    });
    const { generateConversationTitle } =
      await import("@/lib/chat/title-adapter");
    expect(await generateConversationTitle("request")).toBe(
      `${"A".repeat(47)}…`,
    );
  });

  it("skips missing selection and contains rejection without exposing upstream content", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    const { generateConversationTitle } =
      await import("@/lib/chat/title-adapter");
    f.select.mockReturnValue(null);
    expect(await generateConversationTitle("request")).toBeNull();
    expect(f.generate).not.toHaveBeenCalled();
    f.select.mockReturnValue({ model: "memory-model" });
    f.generate.mockRejectedValue(new Error("private-upstream-body"));
    expect(await generateConversationTitle("private-prompt")).toBeNull();
    expect(log.mock.calls.flat().join(" ")).not.toMatch(/private-/);
    log.mockRestore();
  });

  it("aborts once at the deadline even if the provider ignores cancellation, without retry", async () => {
    vi.useFakeTimers();
    f.generate.mockReturnValue(new Promise(() => {}));
    const { generateConversationTitle } =
      await import("@/lib/chat/title-adapter");
    const result = generateConversationTitle("request");
    await vi.advanceTimersByTimeAsync(3000);
    expect(await result).toBeNull();
    expect(f.generate.mock.calls[0][0].abortSignal.aborted).toBe(true);
    expect(f.generate).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("durable title admission and guarded storage", () => {
  async function first(id = "title-chat", title = "New chat") {
    const repo = await import("@/lib/db/conversation-repository");
    repo.createConversation({ id, title });
    const message = repo.appendChatMessage({
      conversationId: id,
      role: "user",
      content: "Help me plan a long trail run this weekend",
    });
    return { repo, message };
  }

  it("keeps immediate excerpt, claims once, permits later messages, and never changes recency on apply", async () => {
    const { repo, message } = await first();
    expect(repo.getConversation(message.conversationId)?.title).toBe(
      message.content,
    );
    expect(repo.claimConversationTitle(message)).toBe(true);
    expect(repo.claimConversationTitle(message)).toBe(false);
    const later = repo.appendChatMessage({
      conversationId: message.conversationId,
      role: "user",
      content: "Later request",
    });
    expect(repo.claimConversationTitle(later)).toBe(false);
    const recency = repo.getConversation(message.conversationId)?.updatedAt;
    expect(repo.listConversations()[0].titlePending).toBe(true);
    repo.finishConversationTitle(message, "Weekend trail plan");
    expect(repo.getConversation(message.conversationId)).toMatchObject({
      title: "Weekend trail plan",
      updatedAt: recency,
    });
    expect(repo.listConversations()[0].titlePending).toBe(false);
    repo.finishConversationTitle(message, "Duplicate completion");
    expect(repo.getConversation(message.conversationId)?.title).toBe(
      "Weekend trail plan",
    );
  });

  it.each(["New chat", "My manual title"])(
    "preserves pending manual rename to %s",
    async (name) => {
      const { repo, message } = await first();
      expect(repo.claimConversationTitle(message)).toBe(true);
      repo.renameConversation(message.conversationId, name);
      repo.finishConversationTitle(message, "Generated");
      expect(repo.getConversation(message.conversationId)?.title).toBe(name);
    },
  );

  it("does not admit custom create or manually generic titles, assistant-first history or later prompts", async () => {
    const { repo, message } = await first("custom", "Custom title");
    expect(repo.claimConversationTitle(message)).toBe(false);
    repo.createConversation({ id: "manual" });
    repo.renameConversation("manual", "New chat");
    expect(
      repo.claimConversationTitle(
        repo.appendChatMessage({
          conversationId: "manual",
          role: "user",
          content: "hello",
        }),
      ),
    ).toBe(false);
    repo.appendChatMessage({
      conversationId: "old",
      role: "assistant",
      content: "history",
    });
    expect(
      repo.claimConversationTitle(
        repo.appendChatMessage({
          conversationId: "old",
          role: "user",
          content: "hello",
        }),
      ),
    ).toBe(false);
  });

  it.each(["delete", "clear", "bulk"])(
    "rejects stale completion and new attempts after %s/recreate",
    async (kind) => {
      const { repo, message } = await first();
      expect(repo.claimConversationTitle(message)).toBe(true);
      const lifecycle = await import("@/lib/db/conversation-lifecycle");
      if (kind === "bulk")
        (await import("@/lib/db/local-data-lifecycle")).clearChatAndProfile();
      else if (kind === "clear")
        lifecycle.clearConversationHistory(message.conversationId);
      else lifecycle.deleteConversation(message.conversationId);
      repo.finishConversationTitle(message, "Stale");
      expect(repo.getConversation(message.conversationId)).toBeNull();
      const next = repo.appendChatMessage({
        conversationId: message.conversationId,
        role: "user",
        content: "A new lifecycle",
      });
      expect(repo.claimConversationTitle(next)).toBe(false);
      repo.finishConversationTitle(message, "Stale again");
      expect(repo.getConversation(message.conversationId)?.title).toBe(
        "A new lifecycle",
      );
    },
  );

  it("settles failure without changing fallback or transcript", async () => {
    const { repo, message } = await first();
    repo.claimConversationTitle(message);
    repo.finishConversationTitle(message, null);
    expect(repo.listConversations()[0]).toMatchObject({
      title: message.content,
      titlePending: false,
    });
    expect(repo.listRecentChatMessages(message.conversationId)).toEqual([
      message,
    ]);
    expect(repo.claimConversationTitle(message)).toBe(false);
  });
});
