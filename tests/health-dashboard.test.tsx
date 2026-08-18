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
    sleepScore: 86,
    sleepDeepMinutes: 74,
    sleepLightMinutes: 244,
    sleepRemMinutes: 96,
    sleepAwakeMinutes: 30,
    sleepNapMinutes: 0,
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
        sleepScore: 78,
        sleepDeepMinutes: 60,
        sleepLightMinutes: 210,
        sleepRemMinutes: 85,
        sleepAwakeMinutes: 35,
        sleepNapMinutes: null,
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
        sleepScore: null,
        sleepDeepMinutes: null,
        sleepLightMinutes: null,
        sleepRemMinutes: null,
        sleepAwakeMinutes: null,
        sleepNapMinutes: null,
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

function sourceUnavailableDay(date: string) {
  return day(date, {
    sleepMinutes: null,
    restingHeartRate: null,
    hrvStatus: null,
    hrvMs: null,
    stressAvg: null,
    steps: null,
    calories: null,
    activeCalories: null,
    restingCalories: null,
    totalCalories: null,
    intensityMinutes: null,
    bodyBatteryAvg: null,
    bodyBatteryMorning: null,
    bodyBatteryEvening: null,
    availability: "missing",
  });
}

function healthDashboardWithSparseRollups() {
  return {
    latestDate: "2026-07-21",
    days: [
      ...healthDashboard().days,
      sourceUnavailableDay("2026-06-30"),
      day("2026-06-23", {
        steps: 1200,
        calories: 1780,
        activeCalories: 180,
        restingCalories: 1600,
        totalCalories: 1780,
        intensityMinutes: 0,
      }),
      sourceUnavailableDay("2026-05-28"),
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

function expectRollupChartGraphics(
  panel: HTMLElement,
  title: string,
  { expectUnavailable = false }: { expectUnavailable?: boolean } = {},
) {
  const chart = within(panel).getByRole("group", {
    name: `${title} rollup chart`,
  });
  const graphics = within(chart).getByRole("img", {
    name: `${title} chart graphics`,
  });
  const availableBars = Array.from(
    graphics.querySelectorAll<HTMLElement>('[data-chart-state="available"]'),
  );
  const fills = Array.from(
    graphics.querySelectorAll<HTMLElement>(".health-rollup-bar-fill"),
  );

  expect(availableBars.length).toBeGreaterThan(0);
  expect(fills.length).toBe(availableBars.length);
  for (const fill of fills) {
    expect(Number.parseFloat(fill.style.height)).toBeGreaterThan(0);
  }
  if (expectUnavailable) {
    expect(
      graphics.querySelectorAll('[data-chart-state="unavailable"]').length,
    ).toBeGreaterThan(0);
    expect(graphics.querySelector(".health-rollup-bar-missing")).toBeTruthy();
  }
  expect(within(chart).getByLabelText(`${title} period values`)).toBeTruthy();
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
      "Body battery morning",
      "Body battery evening",
    ]);

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
    expect(within(panel).getByText("Score")).toBeTruthy();
    expect(within(panel).getByText("Deep")).toBeTruthy();
    expect(within(panel).getByText("1 h 14 m")).toBeTruthy();
    expect(within(panel).getByText("REM")).toBeTruthy();
    expect(within(panel).getByText("1 h 36 m")).toBeTruthy();
    expect(within(panel).getAllByText("86").length).toBeGreaterThanOrEqual(1);
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
    expect(within(panel).getByText("88")).toBeTruthy();
    expect(within(panel).getByText("42")).toBeTruthy();
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
      within(panel).getByText(/Sleep score or stage details are unavailable/),
    ).toBeTruthy();
    expect(
      within(panel).getAllByText(/Numeric morning\/evening readings/).length,
    ).toBe(2);
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
    expect(within(panel).getByText("Sleep duration")).toBeTruthy();
    expect(within(panel).getByText("Sleep score avg")).toBeTruthy();
    expect(within(panel).getByText("Deep sleep")).toBeTruthy();
    expect(within(panel).getByText("834 min")).toBeTruthy();
    expect(within(panel).getByText("82 avg")).toBeTruthy();
    expect(within(panel).getByText("134 min")).toBeTruthy();
    expect(within(panel).getByText("Total calories")).toBeTruthy();
    expect(within(panel).getByText("Intensity minutes")).toBeTruthy();
    expect(within(panel).getByText("16,312 steps")).toBeTruthy();
    expect(within(panel).getByText("4,415 kcal")).toBeTruthy();
    expectRollupChartGraphics(panel, "Steps");
    expectRollupChartGraphics(panel, "Total calories");
    expectRollupChartGraphics(panel, "Intensity minutes");
    expect(within(panel).getByText("Body battery morning avg")).toBeTruthy();
    expect(within(panel).getByText("Body battery evening avg")).toBeTruthy();
    expect(within(panel).getByText("85 avg")).toBeTruthy();
    expect(within(panel).getByText("40.5 avg")).toBeTruthy();

    fireEvent.click(within(panel).getByRole("tab", { name: "Monthly" }));
    expect(within(panel).getByText("Monthly Health rollups")).toBeTruthy();
    expect(
      within(panel).getByText(/Sums for sleep duration, sleep stages/),
    ).toBeTruthy();
    expect(within(panel).getByText("26,512 steps")).toBeTruthy();
    expect(within(panel).getByText("6,895 kcal")).toBeTruthy();
    expectRollupChartGraphics(panel, "Steps");
    expectRollupChartGraphics(panel, "Total calories");
    expectRollupChartGraphics(panel, "Intensity minutes");
  });

  it("renders weekly and monthly chart marks separately from sparse unavailable periods", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("/api/chat")) return jsonResponse(emptyChat);
      if (url === "/api/profile") return jsonResponse(profile());
      if (url === "/api/health-dashboard")
        return jsonResponse(healthDashboardWithSparseRollups());
      return jsonResponse({ ok: true });
    });
    renderDashboard(fetchMock);

    const panel = await openHealthDashboard();
    fireEvent.click(within(panel).getByRole("tab", { name: "Weekly" }));

    expectRollupChartGraphics(panel, "Steps", { expectUnavailable: true });
    expectRollupChartGraphics(panel, "Total calories", {
      expectUnavailable: true,
    });
    expectRollupChartGraphics(panel, "Intensity minutes", {
      expectUnavailable: true,
    });
    expect(within(panel).getAllByText("Unavailable").length).toBeGreaterThan(0);
    expect(within(panel).getAllByText("0 min").length).toBeGreaterThan(0);

    fireEvent.click(within(panel).getByRole("tab", { name: "Monthly" }));

    expectRollupChartGraphics(panel, "Steps", { expectUnavailable: true });
    expectRollupChartGraphics(panel, "Total calories", {
      expectUnavailable: true,
    });
    expectRollupChartGraphics(panel, "Intensity minutes", {
      expectUnavailable: true,
    });
    expect(within(panel).getAllByText("Unavailable").length).toBeGreaterThan(0);
  });

  it("hides unsupported body-battery rollups while other sparse period metrics remain visible", async () => {
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

  it("keeps a supported body-battery rollup when the paired metric is unsupported", async () => {
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
          })),
        });
      return jsonResponse({ ok: true });
    });
    renderDashboard(fetchMock);

    const panel = await openHealthDashboard();
    fireEvent.click(within(panel).getByRole("tab", { name: "Weekly" }));

    expect(within(panel).queryByText("Body battery morning avg")).toBeNull();
    expect(within(panel).getByText("Body battery evening avg")).toBeTruthy();
    expect(within(panel).getByText("40.5 avg")).toBeTruthy();
  });

  it("preserves daily source-limited copy for null body-battery readings", async () => {
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

    expect(within(panel).getByText("Body battery morning")).toBeTruthy();
    expect(within(panel).getByText("Body battery evening")).toBeTruthy();
    expect(
      within(panel).getAllByText(/Numeric morning\/evening readings/).length,
    ).toBe(2);
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
