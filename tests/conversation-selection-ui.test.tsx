/** @vitest-environment jsdom */
import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { TrainerDashboard } from "../src/app/trainer-dashboard";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
function deferred() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const date = "2026-11-01T10:00:00Z";
const rows = ["a", "b", "c"].map((id) => ({
  id,
  title: `Chat ${id}`,
  createdAt: date,
  updatedAt: date,
}));
function history(id: string, nextCursor: string | null = null) {
  return {
    messages: [
      {
        id: `message-${id}`,
        role: "assistant",
        content: `Transcript ${id}`,
        createdAt: date,
      },
    ],
    nextCursor,
  };
}
type Intercept = (
  url: string,
  init?: RequestInit,
) => Promise<Response> | undefined;
function setup(
  intercept: Intercept = () => undefined,
  initial: string | null = "a",
) {
  let saved = initial;
  const writes: string[] = [];
  const fetcher = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const override = intercept(url, init);
      if (override) return override;
      if (url === "/api/conversations/selection") {
        if (init?.method === "PUT") {
          const body = JSON.parse(String(init.body)) as {
            conversationId: string;
          };
          saved = body.conversationId;
          writes.push(saved);
        }
        return json({ conversationId: saved });
      }
      if (url === "/api/conversations")
        return json({ conversations: initial === null ? [] : rows });
      const page = /^\/api\/conversations\/([abc])\?/.exec(url);
      if (page) return json(history(page[1]));
      return json({});
    },
  );
  vi.stubGlobal("fetch", fetcher);
  render(<TrainerDashboard />);
  return { fetcher, saved: () => saved, writes };
}
async function choose(id: string) {
  fireEvent.click(
    await screen.findByRole("button", { name: new RegExp(`^Chat ${id}`) }),
  );
}
async function remove(id: string) {
  fireEvent.click(
    await screen.findByRole("button", {
      name: `Conversation options for "Chat ${id}"`,
    }),
  );
  fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
}
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("serializes rapid selection writes while old history cannot replace the latest transcript", async () => {
  const firstWrite = deferred();
  const oldHistory = deferred();
  const started: string[] = [];
  let saved = "a";
  setup((url, init) => {
    if (url.includes("/b?")) return oldHistory.promise;
    if (url === "/api/conversations/selection" && init?.method === "PUT") {
      const id = (JSON.parse(String(init.body)) as { conversationId: string })
        .conversationId;
      started.push(id);
      if (id === "b")
        return firstWrite.promise.then((value) => {
          saved = "b";
          return value;
        });
      saved = id;
      return Promise.resolve(json({ conversationId: id }));
    }
  });
  await screen.findByText("Transcript a");
  await choose("b");
  await waitFor(() => expect(started).toEqual(["b"]));
  await choose("c");
  await screen.findByText("Transcript c");
  expect(started).toEqual(["b"]);
  await act(async () => {
    firstWrite.resolve(json({ conversationId: "b" }));
    oldHistory.resolve(json(history("b")));
  });
  await waitFor(() => expect(started).toEqual(["b", "c"]));
  expect(saved).toBe("c");
  expect(screen.queryByText("Transcript b")).toBeNull();
  expect(screen.getByText("Transcript c")).toBeTruthy();
  await choose("c");
  expect(screen.getByText("Transcript c")).toBeTruthy();
});

it("a delayed bootstrap cannot undo an explicit selection made from the independently loaded sidebar", async () => {
  const bootstrap = deferred();
  const state = setup((url, init) =>
    url === "/api/conversations/selection" && init?.method === "GET"
      ? bootstrap.promise
      : undefined,
  );
  await choose("b");
  await screen.findByText("Transcript b");
  expect(state.writes).toEqual([]);
  await act(async () => bootstrap.resolve(json({ conversationId: "a" })));
  await waitFor(() => expect(state.saved()).toBe("b"));
  expect(screen.queryByText("Transcript a")).toBeNull();
});

it("delete-active response cannot clear or change a newer selection; deleted IDs are not restored by old history", async () => {
  const deletion = deferred();
  const oldPage = deferred();
  vi.stubGlobal(
    "confirm",
    vi.fn(() => true),
  );
  const state = setup((url, init) => {
    if (init?.method === "DELETE") return deletion.promise;
    if (url.includes("cursor=")) return oldPage.promise;
    if (url.includes("/a?"))
      return Promise.resolve(json(history("a", "older")));
  });
  await screen.findByText("Transcript a");
  fireEvent.click(screen.getByRole("button", { name: "Load older messages" }));
  await remove("a");
  await choose("b");
  await screen.findByText("Transcript b");
  await act(async () => {
    deletion.resolve(
      json({
        deleted: true,
        nextConversationId: "c",
        conversations: rows.slice(1),
      }),
    );
    oldPage.resolve(json(history("old-a")));
  });
  await waitFor(() => expect(state.saved()).toBe("b"));
  expect(screen.queryByText("Transcript old-a")).toBeNull();
  expect(screen.queryByRole("button", { name: /^Chat a/ })).toBeNull();
  expect(screen.getByText("Transcript b")).toBeTruthy();
});

it("non-active deletion preserves selection/history after list hydration", async () => {
  const oldList = deferred();
  let listCount = 0;
  vi.stubGlobal(
    "confirm",
    vi.fn(() => true),
  );
  const state = setup((url, init) => {
    if (url === "/api/conversations") {
      listCount++;
      return oldList.promise;
    }
    if (init?.method === "DELETE")
      return Promise.resolve(
        json({
          deleted: true,
          nextConversationId: "a",
          conversations: rows.filter((row) => row.id !== "b"),
        }),
      );
  });
  await screen.findByText("Transcript a");
  // Populate the initial sidebar, then delete a non-active row.
  await act(async () => oldList.resolve(json({ conversations: rows })));
  await remove("b");
  await waitFor(() =>
    expect(screen.queryByRole("button", { name: /^Chat b/ })).toBeNull(),
  );
  expect(state.saved()).toBe("a");
  expect(screen.getByText("Transcript a")).toBeTruthy();
  expect(listCount).toBe(1);
});

it("empty startup never creates; duplicate New chat intent creates one explicit row and persists it", async () => {
  const creation = deferred();
  const created = { ...rows[0], id: "new", title: "New chat" };
  const state = setup((url, init) => {
    if (url === "/api/conversations" && init?.method === "POST")
      return creation.promise;
    if (url.includes("/new?")) return Promise.resolve(json({ messages: [] }));
  }, null);
  await screen.findByText("No saved conversation. Choose New chat to begin.");
  expect(
    state.fetcher.mock.calls.some(([, init]) => init?.method === "POST"),
  ).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "New chat" }));
  fireEvent.click(screen.getByRole("button", { name: "New chat" }));
  await act(async () => creation.resolve(json({ conversation: created })));
  await waitFor(() => expect(state.saved()).toBe("new"));
  expect(
    state.fetcher.mock.calls.filter(([, init]) => init?.method === "POST"),
  ).toHaveLength(1);
});

it("history 404 re-resolves existing selection without creating or calling legacy creating history", async () => {
  let resolutions = 0;
  const state = setup((url, init) => {
    if (url === "/api/conversations/selection" && init?.method === "GET") {
      return Promise.resolve(
        json({ conversationId: ++resolutions === 1 ? "a" : "b" }),
      );
    }
    if (url.includes("/a?")) return Promise.resolve(json({}, 404));
  });
  await screen.findByText("Transcript b");
  expect(
    state.fetcher.mock.calls.some(
      ([url, init]) =>
        String(url).startsWith("/api/chat") || init?.method === "POST",
    ),
  ).toBe(false);
});

it("persistence failure is visible and explicit retry saves only current selection", async () => {
  let fail = true;
  const state = setup((url, init) => {
    if (
      fail &&
      url === "/api/conversations/selection" &&
      init?.method === "PUT"
    )
      return Promise.resolve(json({}, 500));
  });
  await screen.findByText("Transcript a");
  await choose("b");
  await screen.findByText(
    "Conversation selection is not saved. Retry selection before relaunching.",
  );
  expect(state.saved()).toBe("a");
  fail = false;
  fireEvent.click(screen.getByRole("button", { name: "Retry selection" }));
  await waitFor(() => expect(state.saved()).toBe("b"));
  await waitFor(() =>
    expect(
      screen.queryByText(
        "Conversation selection is not saved. Retry selection before relaunching.",
      ),
    ).toBeNull(),
  );
});
