/** @vitest-environment jsdom */
import React, { act } from "react";
import { renderToString } from "react-dom/server";
import { hydrateRoot, type Root } from "react-dom/client";
import { fireEvent, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TrainerDashboard } from "../src/app/trainer-dashboard";

let root: Root | undefined;
let container: HTMLDivElement;
function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
async function hydrateConversations(
  clientTime = "2026-09-18T00:00:02Z",
  clientLocale = "en-GB",
  clientZone = "Europe/London",
) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-17T23:59:58Z"));
  let locale = "en-US";
  let timeZone = "UTC";
  vi.spyOn(Date.prototype, "toLocaleString").mockImplementation(function (
    this: Date,
  ) {
    return new Intl.DateTimeFormat(locale, {
      dateStyle: "short",
      timeStyle: "medium",
      timeZone,
    }).format(this);
  });
  let settleList!: (value: Response) => void;
  let settleSelection!: (value: Response) => void;
  const pendingList = new Promise<Response>((resolve) => {
    settleList = resolve;
  });
  const pendingSelection = new Promise<Response>((resolve) => {
    settleSelection = resolve;
  });
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === "/api/conversations/selection")
      return init?.method === "PUT"
        ? Promise.resolve(response(JSON.parse(String(init.body))))
        : pendingSelection;
    if (url === "/api/conversations") return pendingList;
    if (url.startsWith("/api/conversations/"))
      return Promise.resolve(response({ messages: [] }));
    return Promise.resolve(response({}));
  });
  vi.stubGlobal("fetch", fetchMock);
  container = document.createElement("div");
  container.innerHTML = renderToString(<TrainerDashboard />);
  document.body.append(container);
  const serverSidebar =
    container.querySelector(".conversation-list")?.innerHTML;
  vi.setSystemTime(new Date(clientTime));
  locale = clientLocale;
  timeZone = clientZone;
  const recoverableError = vi.fn();
  const consoleError = vi.spyOn(console, "error");
  await act(async () => {
    root = hydrateRoot(container, <TrainerDashboard />, {
      onRecoverableError: recoverableError,
    });
  });
  return {
    settleList,
    settleSelection,
    fetchMock,
    recoverableError,
    consoleError,
    serverSidebar,
  };
}
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  container?.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("conversation sidebar SSR hydration", () => {
  it("resolves DB selection before history without browser storage or repeated startup requests", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("Storage denied");
    });
    const writes = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("Storage denied");
      });
    const evidence = await hydrateConversations();
    expect(
      evidence.fetchMock.mock.calls.some(([url]) =>
        String(url).includes("?limit=30"),
      ),
    ).toBe(false);
    await act(async () =>
      evidence.settleSelection(response({ conversationId: "saved-selection" })),
    );
    expect(evidence.fetchMock).toHaveBeenCalledWith(
      "/api/conversations/saved-selection?limit=30",
      { method: "GET" },
    );
    expect(evidence.recoverableError).not.toHaveBeenCalled();
    expect(evidence.consoleError).not.toHaveBeenCalled();
    expect(writes).not.toHaveBeenCalled();
    const before = evidence.fetchMock.mock.calls.length;
    await act(async () => root?.render(<TrainerDashboard />));
    expect(evidence.fetchMock).toHaveBeenCalledTimes(before);
  });
  it.each([
    ["clock drift", "2026-09-18T00:00:02Z", "en-US", "UTC"],
    ["locale/timezone drift", "2026-09-17T23:59:58Z", "en-GB", "Europe/London"],
    ["both", "2026-09-18T00:00:02Z", "en-GB", "Europe/London"],
  ])(
    "keeps unresolved markup deterministic across %s",
    async (_, time, locale, zone) => {
      const evidence = await hydrateConversations(time, locale, zone);
      expect(evidence.recoverableError).not.toHaveBeenCalled();
      expect(evidence.consoleError).not.toHaveBeenCalled();
      expect(container.querySelector(".conversation-select")).toBeNull();
      expect(container.querySelector(".conversation-list")?.innerHTML).toBe(
        evidence.serverSidebar,
      );
      vi.setSystemTime(new Date("2026-09-20T12:00:00Z"));
      await act(async () => root?.render(<TrainerDashboard />));
      expect(container.querySelector(".conversation-select")).toBeNull();
    },
  );
  it.each([200, 500])(
    "retains explicit New chat and truthful empty/error controls after selection status %s",
    async (status) => {
      const evidence = await hydrateConversations();
      await act(async () => {
        evidence.settleSelection(response({ conversationId: null }, status));
        evidence.settleList(response({ conversations: [] }));
      });
      const ui = within(container);
      expect(
        ui.getByRole("button", { name: "New chat" }).hasAttribute("disabled"),
      ).toBe(false);
      expect(container.querySelector(".conversation-select")).toBeNull();
      expect(
        evidence.fetchMock.mock.calls.some(
          ([, init]) => init?.method === "POST",
        ),
      ).toBe(false);
      if (status === 500)
        expect(
          ui.getByRole("button", { name: "Retry selection" }),
        ).toBeTruthy();
      else
        expect(
          ui.getByText("No saved conversation. Choose New chat to begin."),
        ).toBeTruthy();
      expect(evidence.recoverableError).not.toHaveBeenCalled();
    },
  );
  it("localizes saved timestamps and preserves navigation and rename targeting", async () => {
    const evidence = await hydrateConversations();
    const saved = {
      id: "saved-hydration-test",
      title: "Saved training discussion",
      createdAt: "2026-09-16T08:00:00Z",
      updatedAt: "2026-09-17T09:00:00Z",
    };
    await act(async () => {
      evidence.settleSelection(response({ conversationId: saved.id }));
      evidence.settleList(response({ conversations: [saved] }));
    });
    const ui = within(container);
    const row = ui.getByRole("button", { name: /^Saved training discussion/ });
    expect(row.querySelector("small")?.textContent).toBe(
      new Date(saved.updatedAt).toLocaleString(),
    );
    await act(async () => fireEvent.click(row));
    expect(row.getAttribute("aria-current")).toBe("true");
    fireEvent.click(
      ui.getByRole("button", {
        name: `Conversation options for "${saved.title}"`,
      }),
    );
    fireEvent.click(ui.getByRole("menuitem", { name: "Rename" }));
    expect(
      (ui.getByRole("textbox", { name: /title/i }) as HTMLInputElement).value,
    ).toBe(saved.title);
    expect(evidence.recoverableError).not.toHaveBeenCalled();
  });
});
