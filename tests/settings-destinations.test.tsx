/** @vitest-environment jsdom */
import React from "react";
import { readFileSync } from "node:fs";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TrainerDashboard } from "@/app/trainer-dashboard";
import { stubNativeDialog } from "./native-dialog-stub";
import type { ModelSettingsSnapshot } from "@/lib/model-settings/contracts";

const model: ModelSettingsSnapshot = {
  options: [{ id: "gpt-6-luna", label: "GPT-6 Luna" }],
  selected: null,
  effective: {
    source: "env",
    provider: "openai",
    modelName: "gpt-6-luna",
    available: true,
  },
};
const profile = {
  goals: ["Saved goal"],
  sports: [],
  constraints: [],
  preferences: {},
};
function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}
function setup(
  action?: (
    url: string,
    init?: RequestInit,
  ) => Response | Promise<Response> | undefined,
) {
  const fetcher = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const result = action?.(url, init);
    if (result) return Promise.resolve(result);
    if (url === "/api/model-settings") return Promise.resolve(response(model));
    if (url === "/api/profile") return Promise.resolve(response(profile));
    if (url.startsWith("/api/chat"))
      return Promise.resolve(
        response({ conversationId: "default", messages: [] }),
      );
    return Promise.resolve(response({ ok: true }));
  });
  vi.stubGlobal("fetch", fetcher);
  render(<TrainerDashboard />);
  return fetcher;
}
function openModel() {
  fireEvent.click(screen.getByText("Trainer model", { selector: "summary" }));
}
function openProfile() {
  fireEvent.click(screen.getByRole("button", { name: "Profile & data" }));
  return screen.getByRole("dialog", { name: "Profile & data" });
}
function closeProfile() {
  fireEvent.click(
    within(screen.getByRole("dialog", { name: "Profile & data" })).getByRole(
      "button",
      { name: "Close Profile & data" },
    ),
  );
}
beforeEach(stubNativeDialog);
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("bounds expanded chat model content above shared card overflow rules", () => {
  const css = readFileSync("src/app/style.css", "utf8");
  // The compound selector must outrank the later shared .settings-card rule.
  // Otherwise actual WebKit paints the bounded card's children over chat.
  expect(css).toMatch(
    /\.settings-card\.chat-model-control\s*\{[^}]*max-height:\s*35vh;[^}]*overflow-x:\s*hidden;[^}]*overflow-y:\s*auto;/,
  );
  expect(css).toMatch(
    /\.settings-card\.chat-model-control\s*>\s*label\s*\{[^}]*margin:\s*12px 16px;/,
  );
});

it("keeps relocated Sync groups content-sized inside the outer scroll region", () => {
  const css = readFileSync("src/app/style.css", "utf8");
  expect(css).toMatch(
    /\.sync-view-content\s*\{[^}]*grid-auto-rows:\s*max-content;[^}]*align-content:\s*start;/,
  );
  expect(css).toMatch(
    /\.sync-metrics-card\s*\{[^}]*grid-column:\s*1\s*\/\s*-1;/,
  );
});

it("loads the model on initial chat without Profile, retains drafts and returns Profile focus on Escape/backdrop", async () => {
  const fetcher = setup();
  openModel();
  await screen.findByText(/Configured default \(environment\): openai/);
  expect(
    fetcher.mock.calls.filter(([url]) => url === "/api/model-settings"),
  ).toHaveLength(1);
  expect(screen.queryByRole("button", { name: "Data & settings" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Settings" })).toBeNull();
  const dialog = openProfile();
  const goals = within(dialog).getByLabelText("Goals") as HTMLTextAreaElement;
  await waitFor(() => expect(goals.disabled).toBe(false));
  fireEvent.change(goals, { target: { value: "Unsaved T0236 draft" } });
  expect(within(dialog).queryByRole("combobox")).toBeNull();
  for (const name of [
    "Verify connector",
    "Refresh import summary",
    "Force refresh detail",
    "Show detail coverage",
  ]) {
    expect(within(dialog).queryByRole("button", { name })).toBeNull();
  }
  fireEvent.keyDown(window, { key: "Escape" });
  expect(document.activeElement).toBe(
    screen.getByRole("button", { name: "Profile & data" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Sync" }));
  expect(screen.queryByRole("combobox", { name: "Trainer model" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Back to chat" }));
  const reopened = openProfile();
  expect(
    (within(reopened).getByLabelText("Goals") as HTMLTextAreaElement).value,
  ).toBe("Unsaved T0236 draft");
  const backdrop = screen
    .getAllByRole("button", { name: "Close Profile & data" })
    .find((button) => !reopened.contains(button));
  fireEvent.click(backdrop!);
  expect(screen.queryByRole("dialog", { name: "Profile & data" })).toBeNull();
  expect(document.activeElement).toBe(
    screen.getByRole("button", { name: "Profile & data" }),
  );
  expect(
    fetcher.mock.calls.every(
      ([, init]) => !init?.method || init.method === "GET",
    ),
  ).toBe(true);
});

it("keeps model saves alive while chat is hidden, then revalidates its authoritative saved choice", async () => {
  let finish!: (value: Response) => void;
  let saved = model;
  const fetcher = setup((url, init) => {
    if (url !== "/api/model-settings") return;
    if (init?.method === "PATCH")
      return new Promise<Response>((resolve) => {
        finish = resolve;
      });
    return response(saved);
  });
  openModel();
  await screen.findByText(/Configured default \(environment\)/);
  fireEvent.change(screen.getByRole("combobox", { name: "Trainer model" }), {
    target: { value: "gpt-6-luna" },
  });
  await screen.findByText("Saving model setting…");
  fireEvent.click(screen.getByRole("button", { name: "Sync" }));
  saved = {
    ...model,
    selected: "gpt-6-luna",
    effective: { ...model.effective, source: "saved" },
  };
  await act(async () => finish(response(saved)));
  fireEvent.click(screen.getByRole("button", { name: "Back to chat" }));
  openModel();
  await screen.findByText(/Saved preference: openai/);
  await waitFor(() =>
    expect((screen.getByRole("combobox") as HTMLSelectElement).disabled).toBe(
      false,
    ),
  );
  expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe(
    "gpt-6-luna",
  );
  expect(
    fetcher.mock.calls.filter(([, init]) => init?.method === "PATCH"),
  ).toHaveLength(1);
  expect(
    fetcher.mock.calls.find(([, init]) => init?.method === "PATCH")?.[1]?.body,
  ).toBe('{"modelId":"gpt-6-luna"}');
});

it("keeps maintenance requests, blank rejection, failures and late feedback in Sync across navigation", async () => {
  let finish!: (value: Response) => void;
  const fetcher = setup((url, init) => {
    if (url === "/api/activity-detail" && init?.method === "POST")
      return new Promise<Response>((resolve) => {
        finish = resolve;
      });
    if (url === "/api/activity-detail")
      return response({ coverage: "available" });
    if (url === "/api/sync") return response({ connector: "present" });
  });
  fireEvent.click(screen.getByRole("button", { name: "Sync" }));
  expect(
    fetcher.mock.calls.some(
      ([url]) => url === "/api/sync" || url === "/api/activity-detail",
    ),
  ).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Force refresh detail" }));
  await screen.findByRole("alert", { name: "Garmin maintenance feedback" });
  expect(
    screen.getByText("Enter an imported Garmin activity ID first."),
  ).toBeTruthy();
  expect(
    fetcher.mock.calls.some(([url]) => url === "/api/activity-detail"),
  ).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Verify connector" }));
  await screen.findByText(/Verify connector: success/);
  fireEvent.click(screen.getByRole("button", { name: "Show detail coverage" }));
  await screen.findByText(/Activity detail coverage: success/);
  fireEvent.click(
    screen.getByRole("button", { name: "Refresh import summary" }),
  );
  await screen.findByText(/Import summary:/);
  fireEvent.change(screen.getByLabelText("Garmin activity ID"), {
    target: { value: "  12345  " },
  });
  fireEvent.click(screen.getByRole("button", { name: "Force refresh detail" }));
  await screen.findByText("Detailed activity backfill…");
  fireEvent.click(screen.getByRole("button", { name: "Back to chat" }));
  await act(async () => finish(response({ error: "detail unavailable" }, 503)));
  fireEvent.click(screen.getByRole("button", { name: "Sync" }));
  expect(screen.getByRole("alert").textContent).toContain(
    "Detailed activity backfill: failed (503)",
  );
  expect(
    (screen.getByLabelText("Garmin activity ID") as HTMLInputElement).value,
  ).toBe("  12345  ");
  const detail = fetcher.mock.calls.find(
    ([url, init]) => url === "/api/activity-detail" && init?.method === "POST",
  );
  expect(detail?.[1]?.body).toBe('{"garminId":"12345","force":true}');
  expect(
    fetcher.mock.calls.filter(([url]) => url === "/api/sync"),
  ).toHaveLength(1);
});

it("preserves both existing deletion scopes only under Profile & data", async () => {
  const fetcher = setup();
  expect(
    screen.queryByRole("button", { name: "Clear chat/profile" }),
  ).toBeNull();
  const dialog = openProfile();
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Clear chat/profile" }),
  );
  await waitFor(() =>
    expect(fetcher.mock.calls.some(([url]) => url === "/api/delete")).toBe(
      true,
    ),
  );
  fireEvent.click(
    within(dialog).getByRole("button", {
      name: "Disconnect Garmin/delete data",
    }),
  );
  await waitFor(() =>
    expect(
      fetcher.mock.calls.filter(([url]) => url === "/api/delete"),
    ).toHaveLength(2),
  );
  expect(
    fetcher.mock.calls
      .filter(([url]) => url === "/api/delete")
      .map(([, init]) => [init?.method, init?.body]),
  ).toEqual([
    ["POST", '{"scope":"chat-profile"}'],
    ["POST", '{"scope":"garmin-all"}'],
  ]);
  closeProfile();
});
