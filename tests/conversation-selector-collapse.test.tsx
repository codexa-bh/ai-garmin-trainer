/** @vitest-environment jsdom */
import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { readFileSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
import { TrainerDashboard } from "../src/app/trainer-dashboard";
import { stubNativeDialog } from "./native-dialog-stub";

const date = "2026-11-01T10:00:00Z";
const rows = ["a", "b"].map((id) => ({
  id,
  title: `Chat ${id}`,
  createdAt: date,
  updatedAt: date,
}));

function json(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function setup(conversations = rows) {
  const fetcher = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/conversations/selection")
        return json({
          conversationId: conversations.length ? "a" : null,
          ...(init?.method === "PUT" ? JSON.parse(String(init.body)) : {}),
        });
      if (url === "/api/conversations") return json({ conversations });
      const page = /^\/api\/conversations\/([ab])\?/.exec(url);
      if (page)
        return json({
          messages: [
            {
              id: `m-${page[1]}`,
              role: "assistant",
              content: `Transcript ${page[1]}`,
              createdAt: date,
            },
          ],
          nextCursor: null,
        });
      return json({});
    },
  );
  vi.stubGlobal("fetch", fetcher);
  const view = render(<TrainerDashboard />);
  return { fetcher, view };
}

const toggle = (name: "Expand" | "Collapse") =>
  screen.getByRole("button", { name: `${name} conversation selector` });

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("starts collapsed with a reachable local arrow and no hidden controls in the tab order", async () => {
  setup();
  await screen.findByText("Transcript a");
  const arrow = toggle("Expand");
  expect(arrow.getAttribute("aria-expanded")).toBe("false");
  expect(arrow.getAttribute("title")).toBe("Expand conversation selector");
  expect(arrow.textContent).toBe("");
  const body = document.getElementById(
    arrow.getAttribute("aria-controls") ?? "",
  );
  expect(body?.hidden).toBe(true);
  // Hidden rows and New chat are neither exposed nor focusable.
  expect(screen.queryByRole("button", { name: "New chat" })).toBeNull();
  expect(screen.queryByRole("button", { name: /^Chat a/ })).toBeNull();
  const rail = document.querySelector(".conversation-selector-rail-label");
  expect(rail?.textContent).toBe("Conversations");
});

it("has no Conversations entry in the main navigation or the mobile menu", async () => {
  stubNativeDialog();
  setup();
  await screen.findByText("Transcript a");
  const nav = screen.getByRole("navigation", { name: "Main navigation" });
  expect(within(nav).queryByText("Conversations")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Menu" }));
  const menu = screen.getByRole("dialog", { name: "Main menu" });
  expect(within(menu).queryByText("Conversations")).toBeNull();
  expect(
    screen.queryByRole("button", { name: "Toggle conversation history" }),
  ).toBeNull();
});

it("collapses and expands without requests, reselection or losing draft, selection and transcript", async () => {
  const { fetcher } = setup();
  await screen.findByText("Transcript a");
  fireEvent.change(screen.getByLabelText("Message"), {
    target: { value: "unsent draft" },
  });
  fireEvent.click(toggle("Expand"));
  const requests = fetcher.mock.calls.length;
  expect(toggle("Collapse").getAttribute("aria-expanded")).toBe("true");
  expect(screen.getByRole("button", { name: /^Chat a/ })).toBeTruthy();
  expect(
    screen
      .getByRole("button", { name: /^Chat a/ })
      .getAttribute("aria-current"),
  ).toBe("true");
  fireEvent.click(toggle("Collapse"));
  fireEvent.click(toggle("Expand"));
  expect(fetcher.mock.calls.length).toBe(requests);
  expect((screen.getByLabelText("Message") as HTMLTextAreaElement).value).toBe(
    "unsent draft",
  );
  expect(screen.getByText("Transcript a")).toBeTruthy();
  expect(
    screen
      .getByRole("button", { name: /^Chat a/ })
      .getAttribute("aria-current"),
  ).toBe("true");
});

it("keeps the selector open after choosing a row and focus on the visible arrow after toggling", async () => {
  setup();
  await screen.findByText("Transcript a");
  fireEvent.click(toggle("Expand"));
  expect(document.activeElement).toBe(toggle("Collapse"));
  fireEvent.click(screen.getByRole("button", { name: /^Chat b/ }));
  await screen.findByText("Transcript b");
  expect(toggle("Collapse").getAttribute("aria-expanded")).toBe("true");
  expect(
    screen
      .getByRole("button", { name: /^Chat b/ })
      .getAttribute("aria-current"),
  ).toBe("true");
  fireEvent.click(toggle("Collapse"));
  expect(document.activeElement).toBe(toggle("Expand"));
});

it("closes an open row menu when collapsing and closes it with Escape while expanded", async () => {
  setup();
  await screen.findByText("Transcript a");
  fireEvent.click(toggle("Expand"));
  const options = screen.getByRole("button", {
    name: 'Conversation options for "Chat b"',
  });
  fireEvent.click(options);
  expect(screen.getByRole("menu")).toBeTruthy();
  fireEvent.keyDown(window, { key: "Escape" });
  expect(screen.queryByRole("menu")).toBeNull();
  expect(toggle("Collapse").getAttribute("aria-expanded")).toBe("true");
  fireEvent.click(options);
  expect(screen.getByRole("menu")).toBeTruthy();
  fireEvent.click(toggle("Collapse"));
  expect(screen.queryByRole("menu")).toBeNull();
});

it("keeps New chat reachable for an empty history", async () => {
  setup([]);
  await screen.findByText("No saved conversation. Choose New chat to begin.");
  fireEvent.click(toggle("Expand"));
  expect(screen.getByRole("button", { name: "New chat" })).toBeTruthy();
  expect(screen.getByText("No saved conversations yet.")).toBeTruthy();
});

it("keeps Activities and return navigation working with the chat selector state preserved", async () => {
  setup();
  await screen.findByText("Transcript a");
  fireEvent.click(toggle("Expand"));
  fireEvent.click(screen.getByRole("button", { name: "Activities" }));
  fireEvent.click(await screen.findByRole("button", { name: "Back to chat" }));
  expect(toggle("Collapse").getAttribute("aria-expanded")).toBe("true");
  expect(screen.getByRole("button", { name: /^Chat a/ })).toBeTruthy();
});

it("styles one in-flow selector for wide rail and narrow band without a drawer", () => {
  const css = readFileSync("src/app/style.css", "utf8");
  expect(css).not.toMatch(/drawer|sidebar-collapsed|translateX\(-110%\)/);
  expect(css).toMatch(
    /\.chat-workspace\.conversation-selector-collapsed\s*\{\s*grid-template-columns: 48px minmax\(0, 1fr\);/,
  );
  const narrow =
    css.match(
      /@media \(max-width: 960px\) \{([\s\S]*?)@media \(max-width: 640px\)/,
    )?.[1] ?? "";
  expect(narrow).toMatch(
    /\.chat-workspace\.conversation-selector-collapsed\s*\{\s*grid-template-columns: 1fr;\s*grid-template-rows: auto minmax\(0, 1fr\);/,
  );
  expect(narrow).not.toMatch(
    /\.conversation-sidebar[^{]*\{[^}]*position: fixed/,
  );
  expect(narrow).toMatch(
    /\.chat-workspace\.conversation-selector-collapsed \.conversation-sidebar\s*\{\s*flex-direction: row;/,
  );
});
