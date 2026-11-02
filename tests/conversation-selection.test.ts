import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const key = "chat.active_conversation.v1";
beforeEach(() => {
  vi.resetModules();
  vi.stubEnv(
    "DATABASE_PATH",
    join(mkdtempSync(join(tmpdir(), "selection-")), "test.sqlite"),
  );
});
afterEach(async () => {
  (await import("@/lib/db/connection")).getDatabase().close();
  vi.unstubAllEnvs();
});
function put(body: unknown) {
  return new Request("http://127.0.0.1:1234/api/conversations/selection", {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

it("resolves an empty DB without default creation and only explicit creation selects a row", async () => {
  const route = await import("@/app/api/conversations/selection/route");
  const repo = await import("@/lib/db/conversation-repository");
  expect(await route.GET().json()).toEqual({ conversationId: null });
  expect(repo.listConversations()).toEqual([]);
  expect((await route.PUT(put({ conversationId: "missing" }))).status).toBe(
    404,
  );
  expect(repo.getConversation("missing")).toBeNull();
  const created = repo.createConversation();
  expect(await route.GET().json()).toEqual({ conversationId: created.id });
  expect(repo.getConversation("default")).toBeNull();
});

it.each([null, "", " ", "bad/id", " deleted ", "deleted"])(
  "repairs absent/invalid/stale metadata %s using stable order without retimestamping",
  async (saved) => {
    const repo = await import("@/lib/db/conversation-repository");
    const metadata = await import("@/lib/db/repository");
    const { getDatabase } = await import("@/lib/db/connection");
    repo.createConversation({ id: "a" });
    repo.createConversation({ id: "b" });
    getDatabase().prepare("update conversation set updated_at = 1000").run();
    if (saved !== null) metadata.setAppMetadata(key, saved);
    metadata.setAppMetadata("ai.chat_model.v2", "untouched-model");
    metadata.setAppMetadata("unrelated", "untouched");
    const route = await import("@/app/api/conversations/selection/route");
    expect(await route.GET().json()).toEqual({ conversationId: "b" });
    expect(metadata.getAppMetadata(key)).toBe("b");
    expect(repo.getConversation("b")?.updatedAt.getTime()).toBe(1000);
    expect(metadata.getAppMetadata("ai.chat_model.v2")).toBe("untouched-model");
    expect(metadata.getAppMetadata("unrelated")).toBe("untouched");
    expect(repo.listConversations()).toHaveLength(2);
  },
);

it("restores off-page saved IDs and legitimate default after connection/relaunch and origin change; DBs stay isolated", async () => {
  const repo = await import("@/lib/db/conversation-repository");
  const { getDatabase } = await import("@/lib/db/connection");
  repo.createConversation({ id: "default" });
  getDatabase().prepare("update conversation set updated_at = 1").run();
  for (let index = 0; index < 45; index++)
    repo.createConversation({ id: `other-${index}` });
  expect(repo.listConversations().some((row) => row.id === "default")).toBe(
    false,
  );
  const route = await import("@/app/api/conversations/selection/route");
  expect(
    await (await route.PUT(put({ conversationId: "default" }))).json(),
  ).toEqual({ conversationId: "default" });
  const firstPath = process.env.DATABASE_PATH!;
  getDatabase().close();
  vi.resetModules();
  const reopened = await import("@/app/api/conversations/selection/route");
  expect(await reopened.GET().json()).toEqual({ conversationId: "default" });
  // Origin is intentionally absent from application persistence; HTTP URLs may change.
  expect(
    (
      await reopened.PUT(
        new Request("http://127.0.0.1:54321/api/conversations/selection", {
          method: "PUT",
          body: JSON.stringify({ conversationId: "default" }),
        }),
      )
    ).status,
  ).toBe(200);
  (await import("@/lib/db/connection")).getDatabase().close();
  vi.resetModules();
  vi.stubEnv(
    "DATABASE_PATH",
    join(mkdtempSync(join(tmpdir(), "selection-other-")), "other.sqlite"),
  );
  expect(
    await (
      await import("@/app/api/conversations/selection/route")
    )
      .GET()
      .json(),
  ).toEqual({ conversationId: null });
  expect(process.env.DATABASE_PATH).not.toBe(firstPath);
});

it.each([
  null,
  {},
  [],
  { conversationId: null },
  { conversationId: "" },
  { conversationId: " " },
  { conversationId: " a " },
  { conversationId: "bad/id" },
  { conversationId: 2 },
  { conversationId: "a", extra: true },
])("rejects closed selection DTO %j without creating rows", async (body) => {
  const route = await import("@/app/api/conversations/selection/route");
  expect((await route.PUT(put(body))).status).toBe(400);
  expect(
    (await import("@/lib/db/conversation-repository")).listConversations(),
  ).toEqual([]);
});

it("active deletion repairs preference; non-active/missing deletion preserves it and delete-last creates only the normal replacement", async () => {
  const repo = await import("@/lib/db/conversation-repository");
  const { conversations } = await import("@/lib/chat/conversation-composition");
  const metadata = await import("@/lib/db/repository");
  repo.createConversation({ id: "a" });
  repo.createConversation({ id: "b" });
  conversations.selectConversation("a");
  conversations.deleteConversation("b");
  expect(metadata.getAppMetadata(key)).toBe("a");
  conversations.deleteConversation("missing");
  expect(metadata.getAppMetadata(key)).toBe("a");
  const result = conversations.deleteConversation("a");
  expect(result.nextConversationId).not.toBe("a");
  expect(result.nextConversationId).not.toBe("default");
  expect(metadata.getAppMetadata(key)).toBe(result.nextConversationId);
  expect(repo.listConversations()).toHaveLength(1);
  expect(repo.getConversation("a")).toBeNull();
});
