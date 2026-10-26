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
import { stubNativeDialog } from "./native-dialog-stub";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
const date = "2026-10-26T12:00:00.000Z";
function json(body: unknown, pending = false) {
  return new Response(JSON.stringify(body), {
    headers: {
      "content-type": "application/json",
      ...(pending ? { "x-chat-title-pending": "true" } : {}),
    },
  });
}
async function setup(stream: boolean, waitForReply = true) {
  stubNativeDialog();
  let releaseReply!: () => void;
  const responseReady = new Promise<void>((resolve) => {
    releaseReply = resolve;
  });
  if (waitForReply) releaseReply();
  let listReads = 0;
  let settled = false;
  const assistant = {
    id: "answer",
    role: "assistant",
    content: "A useful answer.",
    createdAt: date,
  };
  const user = {
    id: "user",
    role: "user",
    content: "Plan a trail run",
    createdAt: date,
  };
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/conversations") {
        listReads++;
        return json({
          conversations: [
            {
              id: "default",
              title: settled ? "Weekend trail plan" : "Plan a trail run",
              titlePending: !settled,
              createdAt: date,
              updatedAt: date,
            },
          ],
        });
      }
      if (url.startsWith("/api/conversations/default"))
        return json({ messages: [] });
      if (url === "/api/chat" && init?.method === "POST") {
        await responseReady;
        if (!stream) return json({ messages: [user, assistant] }, true);
        return new Response(
          [
            { type: "start", userMessage: user },
            { type: "delta", textDelta: assistant.content },
            {
              type: "done",
              assistantMessage: assistant,
              memoryProposal: { status: "none" },
            },
          ]
            .map((event) => JSON.stringify(event))
            .join("\n"),
          {
            headers: {
              "content-type": "application/x-ndjson",
              "x-chat-title-pending": "true",
            },
          },
        );
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
  const view = render(<TrainerDashboard />);
  await screen.findByRole("button", {
    name: 'Conversation options for "Plan a trail run"',
  });
  fireEvent.change(screen.getByLabelText("Message"), {
    target: { value: user.content },
  });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  if (waitForReply) {
    await screen.findByText(assistant.content);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Send" })).toBeTruthy(),
    );
  } else {
    await screen.findByRole("button", { name: "Streaming…" });
  }
  return {
    view,
    releaseReply,
    listReads: () => listReads,
    settle: () => {
      settled = true;
    },
  };
}

it.each([false, true])(
  "reconciles a late title after answer completion without replacing transcript/selection (stream=%s)",
  async (stream) => {
    const app = await setup(stream);
    app.settle();
    await screen.findByRole("button", {
      name: 'Conversation options for "Weekend trail plan"',
    });
    expect(screen.getByText("A useful answer.")).toBeTruthy();
    expect(
      window.localStorage.getItem("trainer.activeConversationId") || "default",
    ).toBe("default");
    const reads = app.listReads();
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(app.listReads()).toBe(reads); // settlement cancels further reads
  },
);

it("bounds unresolved title refresh to four reads even after server shutdown", async () => {
  const app = await setup(false);
  const reads = app.listReads();
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 5500));
  });
  expect(app.listReads()).toBe(reads + 4);
}, 10000);

it("does not start a title refresh if the response arrives after unmount", async () => {
  const app = await setup(false, false);
  app.view.unmount();
  await act(async () => {
    app.releaseReply();
  });
  const reads = app.listReads();
  await new Promise((resolve) => setTimeout(resolve, 350));
  expect(app.listReads()).toBe(reads);
});

it("stops pending title refresh after unmount", async () => {
  const app = await setup(false);
  const reads = app.listReads();
  app.view.unmount();
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 350));
  });
  expect(app.listReads()).toBe(reads);
});
