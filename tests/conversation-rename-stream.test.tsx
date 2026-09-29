/** @vitest-environment jsdom */
import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TrainerDashboard } from "../src/app/trainer-dashboard";
import { stubNativeDialog } from "./native-dialog-stub";

beforeEach(stubNativeDialog);
afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
const date = "2026-09-29T12:00:00.000Z";
const initial = ["default", "other"].map((id) => ({
  id,
  title: `${id} plan`,
  createdAt: date,
  updatedAt: date,
}));
const oldMessage = {
  id: "old",
  role: "assistant",
  content: "Existing transcript",
  createdAt: date,
};

async function setup() {
  const post = deferred<Response>();
  const patch = deferred<Response>();
  const list = deferred<Response>();
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new Response(
    new ReadableStream<Uint8Array>({
      start(value) {
        controller = value;
      },
    }),
    {
      headers: { "content-type": "application/x-ndjson" },
    },
  );
  let listCount = 0;
  let signal: AbortSignal | null | undefined;
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/conversations") {
        listCount += 1;
        return listCount === 1
          ? json({ conversations: initial })
          : list.promise;
      }
      if (init?.method === "PATCH") return patch.promise;
      if (url.startsWith("/api/conversations/default"))
        return json({ messages: [oldMessage] });
      if (url === "/api/chat" && init?.method === "POST") {
        signal = init.signal;
        return post.promise;
      }
      if (url === "/api/profile")
        return json({
          goals: [],
          sports: [],
          constraints: [],
          preferences: {},
        });
      if (url === "/api/memory")
        return json({ memories: [], pending: [], confirmed: [] });
      return json({ ok: true });
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  render(<TrainerDashboard />);
  await screen.findByText(oldMessage.content);
  fireEvent.change(screen.getByLabelText("Message"), {
    target: { value: "Plan tomorrow" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await screen.findByRole("button", { name: "Streaming…" });
  const push = async (event: unknown) => {
    await act(async () => {
      controller.enqueue(
        new TextEncoder().encode(`${JSON.stringify(event)}\n`),
      );
    });
  };
  return {
    fetchMock,
    patch,
    list,
    signal: () => signal,
    listCount: () => listCount,
    async beginStream() {
      await act(async () => {
        post.resolve(stream);
      });
      await push({
        type: "start",
        userMessage: {
          id: "user",
          role: "user",
          content: "Plan tomorrow",
          createdAt: date,
        },
      });
      await push({ type: "status", message: "Preparing answer" });
    },
    push,
    async finish() {
      await push({
        type: "done",
        assistantMessage: {
          id: "answer",
          role: "assistant",
          content: "Keep tomorrow easy.",
          createdAt: date,
        },
        memoryProposal: { status: "skipped", reason: "test" },
      });
      await act(async () => {
        controller.close();
      });
      await screen.findByRole("button", { name: "Send" });
    },
    async fail(code: string) {
      await push({ type: "error", code, message: "Generation interrupted" });
      await act(async () => {
        controller.close();
      });
      await screen.findByRole("button", { name: "Send" });
    },
  };
}
async function openRename(title: string) {
  fireEvent.click(
    await screen.findByRole("button", {
      name: `Conversation options for "${title}"`,
    }),
  );
  fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
  return screen.getByLabelText<HTMLInputElement>("Conversation title");
}
function save(title: string) {
  fireEvent.change(screen.getByLabelText("Conversation title"), {
    target: { value: title },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
}

describe("rename independently of the active turn", () => {
  it.each([
    ["default", "patch-first"],
    ["other", "patch-first"],
    ["default", "list-first"],
    ["other", "list-first"],
    ["default", "stale-list-last"],
    ["other", "stale-list-last"],
  ])(
    "renames %s with %s ordering without changing stream ownership",
    async (id, order) => {
      const app = await setup();
      const input = await openRename(`${id} plan`);
      expect(input.disabled).toBe(false); // POST still pending, before any stream event.
      save("  Recovery   notes  ");
      await waitFor(() =>
        expect(app.fetchMock).toHaveBeenCalledWith(
          `/api/conversations/${id}`,
          expect.objectContaining({
            method: "PATCH",
            body: JSON.stringify({ title: "Recovery   notes" }),
          }),
        ),
      );
      expect(
        screen.getByLabelText<HTMLInputElement>("Conversation title").disabled,
      ).toBe(true);
      fireEvent.keyDown(document, { key: "Escape" });
      fireEvent.click(screen.getByRole("button", { name: "Cancel rename" }));
      expect(
        screen.getByRole("dialog", { name: "Rename conversation" }),
      ).toBeTruthy();
      await app.beginStream();
      await app.push({ type: "delta", textDelta: "Keep tomorrow " });
      expect(screen.getByText("Keep tomorrow")).toBeTruthy();
      const renamed = {
        ...initial.find((item) => item.id === id)!,
        title: "Recovery notes",
      };
      const acknowledge = async () => {
        await act(async () => {
          app.patch.resolve(json({ conversation: renamed }));
        });
        await screen.findByRole("button", {
          name: 'Conversation options for "Recovery notes"',
        });
        expect(
          screen.queryByRole("dialog", { name: "Rename conversation" }),
        ).toBeNull();
      };
      if (order === "patch-first") await acknowledge();
      await app.push({ type: "delta", textDelta: "easy." });
      expect(screen.getByText("Keep tomorrow easy.")).toBeTruthy();
      await app.finish();
      expect(app.listCount()).toBe(2);
      const listRows = initial.map((item) =>
        item.id === id && order === "patch-first" ? renamed : item,
      );
      // Unrelated metadata proves reconciliation does not discard the entire list.
      listRows.push({
        id: "fresh",
        title: "Fresh unrelated chat",
        createdAt: date,
        updatedAt: date,
      });
      if (order === "stale-list-last") await acknowledge();
      await act(async () => {
        app.list.resolve(json({ conversations: listRows }));
      });
      if (order === "list-first") await acknowledge();
      expect(
        screen.getByRole("button", {
          name: 'Conversation options for "Recovery notes"',
        }),
      ).toBeTruthy();
      expect(
        screen.getByRole("button", {
          name: 'Conversation options for "Fresh unrelated chat"',
        }),
      ).toBeTruthy();
      expect(screen.getAllByText("Keep tomorrow easy.")).toHaveLength(1);
      expect(screen.getByText(oldMessage.content)).toBeTruthy();
      expect(app.signal()?.aborted).toBe(false);
      expect(
        app.fetchMock.mock.calls.filter(
          ([url, init]) => url === "/api/chat" && init?.method === "POST",
        ),
      ).toHaveLength(1);
      expect(
        app.fetchMock.mock.calls.filter(
          ([url, init]) =>
            String(url).startsWith("/api/conversations/default?") &&
            init?.method === "GET",
        ),
      ).toHaveLength(1);
      expect(
        app.fetchMock.mock.calls.some(([url]) =>
          String(url).startsWith("/api/conversations/other?"),
        ),
      ).toBe(false);
      expect(
        window.localStorage.getItem("trainer.activeConversationId"),
      ).not.toBe("other");
    },
  );

  it.each([404, 500])(
    "keeps PATCH %s feedback visible through chat progress and completion",
    async (status) => {
      const app = await setup();
      await app.beginStream();
      await openRename("default plan");
      save("Rejected title");
      await act(async () => {
        app.patch.resolve(json({ error: "Rename unavailable" }, status));
      });
      const dialog = screen.getByRole("dialog", {
        name: "Rename conversation",
      });
      expect(within(dialog).getByRole("alert").textContent).toContain(
        "Rename unavailable",
      );
      await app.push({ type: "status", message: "Still preparing" });
      await app.finish();
      await act(async () => {
        app.list.resolve(json({ conversations: initial }));
      });
      expect(within(dialog).getByRole("alert").textContent).toContain(
        "Rename unavailable",
      );
      expect(
        screen.getByLabelText<HTMLInputElement>("Conversation title").disabled,
      ).toBe(false);
      expect(app.signal()?.aborted).toBe(false);
      expect(
        screen.getByRole("button", {
          name: 'Conversation options for "default plan"',
        }),
      ).toBeTruthy();
      fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    },
  );

  it("cancels, rejects blank input and treats unchanged input as a no-op during progress", async () => {
    const app = await setup();
    await app.beginStream();
    await openRename("other plan");
    fireEvent.change(screen.getByLabelText("Conversation title"), {
      target: { value: "  " },
    });
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Save" }).disabled,
    ).toBe(true);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(
      screen.queryByRole("dialog", { name: "Rename conversation" }),
    ).toBeNull();
    await openRename("other plan");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(
      screen.queryByRole("dialog", { name: "Rename conversation" }),
    ).toBeNull();
    expect(
      app.fetchMock.mock.calls.some(([, init]) => init?.method === "PATCH"),
    ).toBe(false);
    expect(app.signal()?.aborted).toBe(false);
    await app.finish();
    await act(async () => {
      app.list.resolve(json({ conversations: initial }));
    });
  });

  it.each(["aborted", "provider_error"])(
    "settles rename after chat %s without losing retry",
    async (code) => {
      const app = await setup();
      await app.beginStream();
      await openRename("other plan");
      save("Independent title");
      await app.fail(code);
      await act(async () => {
        app.patch.resolve(
          json({ conversation: { ...initial[1], title: "Independent title" } }),
        );
      });
      expect(
        screen.getByRole("button", {
          name: 'Conversation options for "Independent title"',
        }),
      ).toBeTruthy();
      expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
      expect(screen.getByText(oldMessage.content)).toBeTruthy();
    },
  );
});
