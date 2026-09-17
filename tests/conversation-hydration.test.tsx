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
  const pendingList = new Promise<Response>((resolve) => {
    settleList = resolve;
  });
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url === "/api/conversations") return pendingList;
    if (url.startsWith("/api/conversations/")) {
      return Promise.resolve(response({ messages: [] }));
    }
    return Promise.resolve(response({}));
  });
  vi.stubGlobal("fetch", fetchMock);
  container = document.createElement("div");
  container.innerHTML = renderToString(<TrainerDashboard />);
  document.body.append(container);
  const serverRow = container.querySelector(".conversation-select");
  const serverMarkup = serverRow?.innerHTML;
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
    fetchMock,
    recoverableError,
    consoleError,
    serverRow,
    serverMarkup,
  };
}

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  container?.remove();
  window.localStorage.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("conversation sidebar SSR hydration", () => {
  it.each([
    ["clock drift", "2026-09-18T00:00:02Z", "en-US", "UTC"],
    ["locale/timezone drift", "2026-09-17T23:59:58Z", "en-GB", "Europe/London"],
    ["both", "2026-09-18T00:00:02Z", "en-GB", "Europe/London"],
  ])(
    "keeps the pending fallback deterministic across %s",
    async (_, time, locale, zone) => {
      const evidence = await hydrateConversations(time, locale, zone);
      expect(evidence.recoverableError).not.toHaveBeenCalled();
      expect(evidence.consoleError).not.toHaveBeenCalled();
      const row = container.querySelector(".conversation-select");
      expect(row).toBe(evidence.serverRow);
      expect(row?.innerHTML).toBe(evidence.serverMarkup);
      expect(row?.textContent).toBe("Trainer chatNot available");
      vi.setSystemTime(new Date("2026-09-20T12:00:00Z"));
      await act(async () => root?.render(<TrainerDashboard />));
      expect(row?.innerHTML).toBe(evidence.serverMarkup);
    },
  );

  it.each([200, 500])(
    "retains fallback controls after list status %s",
    async (status) => {
      const evidence = await hydrateConversations();
      await act(async () =>
        evidence.settleList(response({ conversations: [] }, status)),
      );
      const ui = within(container);
      const fallback = ui.getByRole("button", {
        name: /^Trainer chat\s*Not available$/,
      });
      expect(fallback.getAttribute("aria-current")).toBe("true");
      fireEvent.click(fallback);
      fireEvent.click(
        ui.getByRole("button", {
          name: 'Conversation options for "Trainer chat"',
        }),
      );
      expect(ui.getByRole("menuitem", { name: "Rename" })).toBeTruthy();
      expect(
        ui.getByRole("button", { name: "New chat" }).hasAttribute("disabled"),
      ).toBe(false);
      expect(fallback.textContent).toBe("Trainer chatNot available");
      expect(evidence.recoverableError).not.toHaveBeenCalled();
    },
  );

  it("localizes real saved timestamps after loading and preserves navigation and menu targeting", async () => {
    const evidence = await hydrateConversations();
    const saved = {
      id: "saved-hydration-test",
      title: "Saved training discussion",
      createdAt: "2026-09-16T08:00:00Z",
      updatedAt: "2026-09-17T09:00:00Z",
    };
    await act(async () =>
      evidence.settleList(response({ conversations: [saved] })),
    );
    const ui = within(container);
    const row = ui.getByRole("button", { name: /^Saved training discussion/ });
    expect(row.querySelector("small")?.textContent).toBe(
      new Date(saved.updatedAt).toLocaleString(),
    );
    expect(ui.queryByText("Not available")).toBeNull();
    await act(async () => fireEvent.click(row));
    expect(row.getAttribute("aria-current")).toBe("true");
    expect(evidence.fetchMock).toHaveBeenCalledWith(
      `/api/conversations/${saved.id}?limit=30`,
      { method: "GET" },
    );
    fireEvent.click(
      ui.getByRole("button", {
        name: `Conversation options for "${saved.title}"`,
      }),
    );
    fireEvent.click(ui.getByRole("menuitem", { name: "Rename" }));
    expect(
      (ui.getByRole("textbox", { name: /title/i }) as HTMLInputElement).value,
    ).toBe(saved.title);
    expect(ui.getByRole("button", { name: "New chat" })).toBeTruthy();
    expect(evidence.recoverableError).not.toHaveBeenCalled();
  });
});
