/** @vitest-environment jsdom */
import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TrainerDashboard } from "../src/app/trainer-dashboard";

const emptyChat = {
  conversationId: "default",
  messages: [],
  contextWindow: 0,
  historyLimit: 12,
};

function jsonResponse(body: unknown, init?: ResponseInit) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status: init?.status ?? 200,
      headers: { "content-type": "application/json" },
    }),
  );
}

function profile() {
  return {
    goals: [],
    sports: [],
    preferences: {},
    constraints: [],
  };
}

function day(date: string, overrides: Record<string, unknown> = {}) {
  return {
    date,
    sleepMinutes: 444,
    restingHeartRate: 52,
    hrvStatus: "Balanced",
    hrvMs: 41.2,
    stressAvg: 38,
    steps: 8412,
    calories: 2310,
    activeCalories: 710,
    restingCalories: 1600,
    totalCalories: 2310,
    intensityMinutes: 38,
    bodyBatteryAvg: 74,
    bodyBatteryMorning: 88,
    bodyBatteryEvening: 42,
    availability: "complete",
    ...overrides,
  };
}

function healthDashboard() {
  return {
    latestDate: "2026-07-21",
    days: [
      day("2026-07-21"),
      day("2026-07-20", {
        sleepMinutes: 390,
        restingHeartRate: 54,
        hrvStatus: null,
        hrvMs: 39.8,
        stressAvg: 42,
        steps: 7900,
        calories: 2105,
        activeCalories: 505,
        restingCalories: 1600,
        totalCalories: 2105,
        intensityMinutes: 22,
        bodyBatteryAvg: 68,
        bodyBatteryMorning: 82,
        bodyBatteryEvening: 39,
        availability: "partial",
      }),
      day("2026-07-19", {
        sleepMinutes: null,
        restingHeartRate: 53,
        hrvStatus: "Low",
        hrvMs: 36.1,
        stressAvg: null,
        steps: 10200,
        calories: 2480,
        activeCalories: null,
        restingCalories: null,
        totalCalories: 2480,
        intensityMinutes: null,
        bodyBatteryAvg: 71,
        bodyBatteryMorning: null,
        bodyBatteryEvening: null,
        availability: "missing",
      }),
    ],
  };
}

function stubViewport(matches: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
}

function renderDashboard(fetchMock: ReturnType<typeof vi.fn>) {
  vi.stubGlobal("fetch", fetchMock);
  render(React.createElement(TrainerDashboard));
  return fetchMock;
}

function baseFetchMock() {
  return vi.fn((input: RequestInfo | URL, _init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("/api/chat")) return jsonResponse(emptyChat);
    if (url === "/api/profile") return jsonResponse(profile());
    if (url === "/api/health-dashboard") return jsonResponse(healthDashboard());
    return jsonResponse({ ok: true });
  });
}

async function openHealthDashboard() {
  fireEvent.click(await screen.findByRole("button", { name: "Health" }));
  const panel = screen.getByRole("region", { name: "Health" });
  await waitFor(() =>
    expect(panel.querySelector('[role="status"]')).toBeNull(),
  );
  return panel;
}

describe("TrainerDashboard Health dashboard", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("opens from desktop navigation, renders widgets, and never POSTs to /api/sync", async () => {
    const fetchMock = renderDashboard(baseFetchMock());

    const panel = await openHealthDashboard();

    expect(
      screen.getByRole("heading", { name: "Health", level: 1 }),
    ).toBeTruthy();
    expect(panel).toBeTruthy();
    expect(
      fetchMock.mock.calls.some(
        ([input, init]) =>
          String(input) === "/api/sync" && init?.method === "POST",
      ),
    ).toBe(false);
    expect(fetchMock).toHaveBeenCalledWith("/api/health-dashboard", {
      method: "GET",
    });

    const labels = Array.from(
      panel.querySelectorAll(".health-widget-label"),
      (node) => node.textContent,
    );
    expect(labels).toEqual([
      "Sleep",
      "Resting HR",
      "HRV",
      "Stress avg",
      "Steps",
      "Calories",
      "Intensity minutes",
    ]);
    expect(within(panel).queryByText("Body battery morning")).toBeNull();
    expect(within(panel).queryByText("Body battery evening")).toBeNull();
    expect(
      within(panel).queryByText(/Numeric morning\/evening readings/),
    ).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Back to chat" }));
    expect(
      screen.queryByRole("heading", { name: "Health", level: 1 }),
    ).toBeNull();
  });

  it("opens Health dashboard from the mobile main menu and dismisses the menu", async () => {
    stubViewport(true);
    renderDashboard(baseFetchMock());

    fireEvent.click(screen.getByRole("button", { name: "Menu" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Health" }));

    expect(screen.queryByRole("menu", { name: "Main menu" })).toBeNull();
    expect(
      screen.getByRole("heading", { name: "Health", level: 1 }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Back to chat" })).toBeTruthy();
  });

  it("renders all metric widgets with units and labels for the selected day", async () => {
    renderDashboard(baseFetchMock());

    const panel = await openHealthDashboard();

    expect(within(panel).getByText("7 h 24 m")).toBeTruthy();
    expect(within(panel).getByText("52")).toBeTruthy();
    expect(within(panel).getByText("bpm")).toBeTruthy();
    expect(within(panel).getByText("41.2")).toBeTruthy();
    expect(within(panel).getByText("ms")).toBeTruthy();
    expect(within(panel).getByText("Balanced")).toBeTruthy();
    expect(within(panel).getAllByText("38").length).toBeGreaterThanOrEqual(1);
    expect(within(panel).getAllByText("avg").length).toBeGreaterThanOrEqual(1);
    expect(within(panel).getByText("8,412")).toBeTruthy();
    expect(within(panel).getByText("steps")).toBeTruthy();
    expect(within(panel).getByText("2,310")).toBeTruthy();
    expect(
      within(panel).getByRole("group", { name: "Calories source split" }),
    ).toBeTruthy();
    expect(within(panel).getByText("710")).toBeTruthy();
    expect(within(panel).getByText("1,600")).toBeTruthy();
    expect(within(panel).queryByText("Body battery morning")).toBeNull();
    expect(within(panel).queryByText("Body battery evening")).toBeNull();
    expect(within(panel).getByText(/2026/)).toBeTruthy();
  });

  it("browses previous/next days and disables browse boundaries truthfully", async () => {
    renderDashboard(baseFetchMock());

    const panel = await openHealthDashboard();
    const previous = within(panel).getByRole("button", {
      name: "Previous day",
    });
    const next = within(panel).getByRole("button", { name: "Next day" });

    expect(next.hasAttribute("disabled")).toBe(true);
    expect(previous.hasAttribute("disabled")).toBe(false);

    fireEvent.click(previous);
    expect(within(panel).getByText("6 h 30 m")).toBeTruthy();
    expect(within(panel).getByText("7,900")).toBeTruthy();
    expect(next.hasAttribute("disabled")).toBe(false);

    fireEvent.click(previous);
    expect(previous.hasAttribute("disabled")).toBe(true);
    expect(within(panel).getByText("10,200")).toBeTruthy();

    fireEvent.click(next);
    expect(within(panel).getByText("7,900")).toBeTruthy();
    expect(previous.hasAttribute("disabled")).toBe(false);
  });

  it("renders truthful unavailable copy for null fields and missing days without estimating", async () => {
    renderDashboard(baseFetchMock());

    const panel = await openHealthDashboard();
    const previous = within(panel).getByRole("button", {
      name: "Previous day",
    });
    fireEvent.click(previous);
    fireEvent.click(previous);

    const unavailable = within(panel).getAllByText("Unavailable");
    expect(unavailable.length).toBeGreaterThanOrEqual(2);
    expect(within(panel).getByText(/Source-unavailable day/)).toBeTruthy();
    expect(
      within(panel).queryByText(/Numeric morning\/evening readings/),
    ).toBeNull();
    expect(
      within(panel).queryByText(/unavailable metrics are not estimated/),
    ).toBeNull();
  });

  it("shows a truthful no-data state when no daily health rows exist and never syncs", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("/api/chat")) return jsonResponse(emptyChat);
      if (url === "/api/profile") return jsonResponse(profile());
      if (url === "/api/health-dashboard")
        return jsonResponse({ days: [], latestDate: null });
      return jsonResponse({ ok: true });
    });
    renderDashboard(fetchMock);

    const panel = await openHealthDashboard();

    expect(within(panel).getByText("No health data yet")).toBeTruthy();
    expect(
      within(panel).getByText(/never starts a sync by itself/),
    ).toBeTruthy();
    expect(
      fetchMock.mock.calls.some(
        ([input, init]) =>
          String(input) === "/api/sync" && init?.method === "POST",
      ),
    ).toBe(false);
  });

  it("renders sparklines when enough numeric data exists and omits them when sparse", async () => {
    renderDashboard(baseFetchMock());

    const panel = await openHealthDashboard();

    expect(within(panel).getAllByRole("img").length).toBeGreaterThanOrEqual(6);

    const previous = within(panel).getByRole("button", {
      name: "Previous day",
    });
    fireEvent.click(previous);
    fireEvent.click(previous);

    expect(within(panel).queryAllByRole("img")).toHaveLength(0);
    expect(
      within(panel).getAllByText("No trend — not enough data").length,
    ).toBeGreaterThanOrEqual(3);
  });

  it("switches to weekly and monthly rollups with source-only visible metric values", async () => {
    renderDashboard(baseFetchMock());

    const panel = await openHealthDashboard();
    fireEvent.click(within(panel).getByRole("tab", { name: "Weekly" }));
    expect(within(panel).getByText("Weekly Health rollups")).toBeTruthy();
    expect(within(panel).getByText("Total calories")).toBeTruthy();
    expect(within(panel).getByText("Intensity minutes")).toBeTruthy();
    expect(within(panel).getByText("16,312 steps")).toBeTruthy();
    expect(within(panel).getByText("4,415 kcal")).toBeTruthy();
    expect(within(panel).queryByText("Body battery morning avg")).toBeNull();
    expect(within(panel).queryByText("Body battery evening avg")).toBeNull();

    fireEvent.click(within(panel).getByRole("tab", { name: "Monthly" }));
    expect(within(panel).getByText("Monthly Health rollups")).toBeTruthy();
    expect(
      within(panel).getByText(/Sums for sleep, steps, calories/),
    ).toBeTruthy();
    expect(within(panel).getByText("26,512 steps")).toBeTruthy();
    expect(within(panel).getByText("6,895 kcal")).toBeTruthy();
  });

  it("keeps body-battery rollups hidden while other sparse period metrics remain visible", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("/api/chat")) return jsonResponse(emptyChat);
      if (url === "/api/profile") return jsonResponse(profile());
      if (url === "/api/health-dashboard")
        return jsonResponse({
          latestDate: "2026-07-21",
          days: healthDashboard().days.map((item) => ({
            ...item,
            bodyBatteryMorning: null,
            bodyBatteryEvening: null,
          })),
        });
      return jsonResponse({ ok: true });
    });
    renderDashboard(fetchMock);

    const panel = await openHealthDashboard();
    fireEvent.click(within(panel).getByRole("tab", { name: "Weekly" }));

    expect(within(panel).getByText("16,312 steps")).toBeTruthy();
    expect(within(panel).getByText("4,415 kcal")).toBeTruthy();
    expect(within(panel).queryByText("Body battery morning avg")).toBeNull();
    expect(within(panel).queryByText("Body battery evening avg")).toBeNull();
    expect(
      within(panel).queryByText(/Garmin did not expose numeric/),
    ).toBeNull();
  });

  it("omits daily body-battery indicators for null body-battery readings", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("/api/chat")) return jsonResponse(emptyChat);
      if (url === "/api/profile") return jsonResponse(profile());
      if (url === "/api/health-dashboard")
        return jsonResponse({
          latestDate: "2026-07-21",
          days: healthDashboard().days.map((item) => ({
            ...item,
            bodyBatteryMorning: null,
            bodyBatteryEvening: null,
          })),
        });
      return jsonResponse({ ok: true });
    });
    renderDashboard(fetchMock);

    const panel = await openHealthDashboard();

    expect(within(panel).queryByText("Body battery morning")).toBeNull();
    expect(within(panel).queryByText("Body battery evening")).toBeNull();
    expect(
      within(panel).queryByText(/Numeric morning\/evening readings/),
    ).toBeNull();
  });

  it("shows a truthful error state when the health dashboard request fails", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("/api/chat")) return jsonResponse(emptyChat);
      if (url === "/api/profile") return jsonResponse(profile());
      if (url === "/api/health-dashboard")
        return jsonResponse({ error: "boom" }, { status: 500 });
      return jsonResponse({ ok: true });
    });
    renderDashboard(fetchMock);

    await openHealthDashboard();

    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("Health dashboard failed");
    expect(alert.textContent).toContain("boom");
  });
});
