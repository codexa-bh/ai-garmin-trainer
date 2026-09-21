import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  process.env.DATABASE_PATH = join(
    mkdtempSync(join(tmpdir(), "conversation-wiring-")),
    "test.sqlite",
  );
});
function request(body: string) {
  return new Request("http://localhost/api/conversations", {
    method: "POST",
    body,
  });
}

it("preserves malformed creation defaults, duplicate IDs, blank IDs and date DTOs", async () => {
  const route = await import("@/app/api/conversations/route");
  const malformed = await route.POST(request("{"));
  expect(malformed.status).toBe(200);
  expect((await malformed.json()).conversation).toMatchObject({
    title: "New chat",
    createdAt: expect.any(String),
    updatedAt: expect.any(String),
  });
  const first = await route.POST(
    request(JSON.stringify({ id: "same", title: "Original" })),
  );
  const duplicate = await route.POST(
    request(JSON.stringify({ id: "same", title: "Ignored" })),
  );
  expect((await duplicate.json()).conversation).toEqual(
    (await first.json()).conversation,
  );
  const blank = await route.POST(request(JSON.stringify({ id: " " })));
  expect((await blank.json()).conversation.id).toBe("default");
  expect(
    (await route.POST(request(JSON.stringify({ id: "bad/id" })))).status,
  ).toBe(400);
  expect((await route.POST(request("null"))).status).toBe(400);
  const list = await route.GET(
    new Request("http://localhost/api/conversations?limit=1"),
  );
  expect((await list.json()).conversations).toHaveLength(1);
});

it("preserves page not-found, malformed rename, invalid-ID and history clear/recreate behavior", async () => {
  const route = await import("@/app/api/conversations/[conversationId]/route");
  const missing = { params: { conversationId: "missing" } };
  expect(
    (
      await route.GET(
        new Request("http://localhost/api/conversations/missing"),
        missing,
      )
    ).status,
  ).toBe(404);
  expect((await route.PATCH(request("{"), missing)).status).toBe(400);
  expect(
    (await route.PATCH(request('{"title":"Valid"}'), missing)).status,
  ).toBe(404);
  const invalid = { params: { conversationId: "bad/id" } };
  expect((await route.GET(request("{}"), invalid)).status).toBe(500);
  expect((await route.DELETE(request("{}"), invalid)).status).toBe(500);
  const chat = await import("@/app/api/chat/route");
  const url = "http://localhost/api/chat?conversationId=history";
  expect((await chat.GET(new Request(url))).status).toBe(200);
  expect(
    await (await chat.DELETE(new Request(url, { method: "DELETE" }))).json(),
  ).toEqual({ conversationId: "history", messages: [], cleared: true });
  const repository = await import("@/lib/db/conversation-repository");
  expect(repository.getConversation("history")?.title).toBe("Trainer chat");
});
