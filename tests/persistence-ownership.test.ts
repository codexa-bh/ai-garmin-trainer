import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  process.env.DATABASE_PATH = join(
    mkdtempSync(join(tmpdir(), "persistence-ownership-")),
    "test.sqlite",
  );
});
afterEach(() => vi.restoreAllMocks());

async function owners() {
  const remaining = await import("../src/lib/db/repository");
  const conversations = await import("../src/lib/db/conversation-repository");
  const plans = await import("../src/lib/db/training-plan-repository");
  const lifecycle = await import("../src/lib/db/conversation-lifecycle");
  const connection = await import("../src/lib/db/connection");
  return { remaining, conversations, plans, lifecycle, connection };
}

async function deletionFixture() {
  const ownersInUse = await owners();
  const { conversations, plans, remaining, connection } = ownersInUse;
  const db = connection.getDatabase();
  conversations.appendChatMessage({
    conversationId: "target",
    role: "user",
    content: "Task-created target",
  });
  conversations.appendChatMessage({
    conversationId: "other",
    role: "user",
    content: "Preserve other",
  });
  plans.replaceTrainingPlan({ contentMarkdown: "Preserve plan" });
  remaining.saveTrainerProfile({
    goals: ["Preserve profile"],
    sports: [],
    preferences: {},
    constraints: [],
  });
  db.prepare(
    "insert into activity (id, garmin_id, sport, started_at, duration_sec) values (?, ?, ?, ?, ?)",
  ).run("activity", "activity", "hiking", 1, 60);
  const insert = db.prepare(
    "insert into semantic_memory (id, user_id, kind, text, status, embedding_json, embedding_model, source_conversation_id, source, created_at, updated_at) values (?, 'local', ?, 'fixture', 'confirmed', '[]', 'test', ?, 'chat', 1, 1)",
  );
  insert.run("derived", "conversation", "target");
  insert.run("saved", "saved", "target");
  insert.run("other-memory", "conversation", "other");
  insert.run("orphan", "conversation", "absent");
  return { ...ownersInUse, db };
}

describe("persistence ownership compatibility", () => {
  it("uses one lazy connection for domain writes and remaining metadata", async () => {
    const { connection, remaining, conversations, plans } = await owners();
    const db = connection.getDatabase();
    expect(remaining.getDatabase()).toBe(db);
    remaining.setAppMetadata("ownership", "shared");
    db.transaction(() => {
      conversations.createConversation({ id: "transaction" });
      plans.replaceTrainingPlan({ contentMarkdown: "Transactional plan" });
      expect(
        db.prepare("select count(*) as count from conversation").get(),
      ).toEqual({ count: 1 });
    })();
    expect(remaining.getAppMetadata("ownership")).toBe("shared");
    expect(
      db.prepare("select content_markdown as content from training_plan").get(),
    ).toEqual({ content: "Transactional plan" });
  });

  it("preserves default/invalid IDs, monotonic timestamps, truncation and cursor tie-breaking", async () => {
    const { conversations, connection } = await owners();
    expect(conversations.getConversation()).toBeNull();
    expect(conversations.safeConversationId("  ")).toBe("default");
    expect(conversations.initialConversationTitle("  ")).toBe("New chat");
    expect(conversations.normalizeConversationTitle("  A   title  ")).toBe(
      "A title",
    );
    expect(conversations.normalizeConversationTitle("x".repeat(49))).toBe(
      "x".repeat(47) + "…",
    );
    expect(() => conversations.safeConversationId("bad/id")).toThrow(
      "Conversation id",
    );
    vi.spyOn(Date, "now").mockReturnValue(1000);
    const first = conversations.appendChatMessage({
      role: "user",
      content: "x".repeat(12001),
    });
    const second = conversations.appendChatMessage({
      role: "assistant",
      content: "second",
    });
    expect(first.content).toHaveLength(12000);
    expect(second.createdAt.getTime()).toBe(first.createdAt.getTime() + 1);
    const db = connection.getDatabase();
    db.prepare("update message set created_at = 10, id = ? where id = ?").run(
      "a",
      first.id,
    );
    db.prepare("update message set created_at = 10, id = ? where id = ?").run(
      "b",
      second.id,
    );
    const page = conversations.listChatMessagePage({
      limit: 0,
      cursor: "invalid",
    });
    expect(page.messages.map((message) => message.id)).toEqual(["b"]);
    expect(
      conversations
        .listChatMessagePage({ limit: 1, cursor: page.nextCursor })
        .messages.map((message) => message.id),
    ).toEqual(["a"]);
    expect(conversations.listRecentChatMessages("default", 0)).toHaveLength(1);
    expect(conversations.listConversations(0)).toHaveLength(1);
  });

  it("keeps plan singleton/title defaults, limits and exact advisory 60-day review threshold", async () => {
    const { plans, connection } = await owners();
    const now = new Date("2026-09-01T00:00:00Z");
    expect(
      plans.replaceTrainingPlan({
        title: "  ",
        contentMarkdown: " first ",
        now,
      }).title,
    ).toBe("Training Plan");
    expect(
      plans.replaceTrainingPlan({
        title: "x".repeat(121),
        contentMarkdown: "x".repeat(32000),
        now,
      }).title,
    ).toHaveLength(120);
    expect(
      connection
        .getDatabase()
        .prepare("select count(*) as count from training_plan")
        .get(),
    ).toEqual({ count: 1 });
    const threshold = now.getTime() + 60 * 86400000;
    expect(plans.trainingPlanStatus(threshold).stale).toBe(false);
    expect(plans.trainingPlanStatus(threshold + 1).stale).toBe(true);
  });

  it("deletes exactly conversation-derived memory and preserves all other domains", async () => {
    const { lifecycle, conversations, plans, remaining, db } =
      await deletionFixture();
    expect(lifecycle.deleteConversation("target")).toBe(true);
    expect(conversations.getConversation("target")).toBeNull();
    expect(conversations.listRecentChatMessages("target")).toEqual([]);
    expect(conversations.listRecentChatMessages("other")).toHaveLength(1);
    expect(
      db.prepare("select id, status from semantic_memory order by id").all(),
    ).toEqual([
      { id: "derived", status: "deleted" },
      { id: "orphan", status: "confirmed" },
      { id: "other-memory", status: "confirmed" },
      { id: "saved", status: "confirmed" },
    ]);
    expect(plans.getTrainingPlan()?.contentMarkdown).toBe("Preserve plan");
    expect(remaining.getTrainerProfile().goals).toEqual(["Preserve profile"]);
    expect(remaining.dataCounts().activities).toBe(1);
    expect(lifecycle.deleteConversation("absent")).toBe(false);
    expect(
      db
        .prepare("select status from semantic_memory where id = 'orphan'")
        .get(),
    ).toEqual({ status: "deleted" });
    lifecycle.clearConversationHistory("other");
    expect(conversations.getConversation("other")).toBeNull();
  });

  it("rolls back messages and semantic memory when the final conversation delete fails", async () => {
    const { lifecycle, conversations, db } = await deletionFixture();
    db.exec(
      "create trigger reject_conversation_delete before delete on conversation begin select raise(abort, 'injected deletion failure'); end",
    );
    expect(() => lifecycle.deleteConversation("target")).toThrow(
      "injected deletion failure",
    );
    expect(conversations.getConversation("target")).not.toBeNull();
    expect(conversations.listRecentChatMessages("target")).toHaveLength(1);
    expect(
      db
        .prepare(
          "select status, updated_at from semantic_memory where id = 'derived'",
        )
        .get(),
    ).toEqual({ status: "confirmed", updated_at: 1 });
  });

  it("preserves route fallback creation after deleting the only conversation", async () => {
    const { conversations } = await owners();
    conversations.createConversation({ id: "only" });
    const route =
      await import("../src/app/api/conversations/[conversationId]/route");
    const response = await route.DELETE(
      new Request("http://local.test/api/conversations/only", {
        method: "DELETE",
      }),
      { params: { conversationId: "only" } },
    );
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload.deleted).toBe(true);
    expect(payload.conversations).toHaveLength(1);
    expect(payload.nextConversationId).toBe(payload.conversations[0].id);
    expect(payload.nextConversationId).not.toBe("only");
  });
});
