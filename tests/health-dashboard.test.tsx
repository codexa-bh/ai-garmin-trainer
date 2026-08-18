/** @vitest-environment jsdom */
import { readFileSync } from "node:fs";
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

function healthDashboardWithManyRollups() {
  const latest = Date.UTC(2026, 6, 21);
  return {
    latestDate: "2026-07-21",
    days: Array.from({ length: 366 }, (_, offset) => {
      const date = new Date(latest - offset * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);
      return day(date, {
        sleepMinutes: 360 + (offset % 60),
        sleepScore: 70 + (offset % 20),
        sleepDeepMinutes: 50 + (offset % 12),
        sleepLightMinutes: 205 + (offset % 30),
        sleepRemMinutes: 80 + (offset % 18),
        sleepAwakeMinutes: 20 + (offset % 10),
        steps: 4000 + offset * 17,
        calories: 2100 + offset * 3,
        activeCalories: 500 + offset,
        restingCalories: 1600,
        totalCalories: 2100 + offset * 3,
        intensityMinutes: 20 + (offset % 25),
      });
    }),
  };
}

function healthDashboardWithoutSleepScoreStages() {
  return {
    latestDate: "2026-07-21",
    days: healthDashboard().days.map((item) => ({
      ...item,
      sleepScore: null,
      sleepDeepMinutes: null,
      sleepLightMinutes: null,
      sleepRemMinutes: null,
      sleepAwakeMinutes: null,
      sleepNapMinutes: null,
    })),
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

function appStyleRule(selector: string) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = readFileSync("src/app/style.css", "utf8").match(
    new RegExp(`${escapedSelector}\\s*\\{([\\s\\S]*?)\\}`),
  );
  expect(match, `missing ${selector} rule`).toBeTruthy();
  return match?.[1] ?? "";
}

function expectRollupEmptyState(panel: HTMLElement, title: string) {
  const heading = within(panel).getByText(title);
  const card = heading.closest<HTMLElement>(".health-rollup-chart");
  expect(card).toBeTruthy();
  expect(card?.classList.contains("empty-state")).toBe(true);
  expect(within(card as HTMLElement).queryByRole("img")).toBeNull();
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
  const graphics = within(chart).getByRole("group", {
    name: `${title} chart marks`,
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
  expect(chart.querySelector(".health-rollup-scale")).toBeTruthy();
  const readout = chart.querySelector(".health-rollup-readout");
  expect(readout?.textContent).toMatch(/: (Unavailable|[0-9,]+(\.[0-9])? \w+)/);
  fireEvent.pointerEnter(availableBars[0]);
  expect(readout?.textContent).toContain(
    availableBars[0].getAttribute("aria-label")?.split(": ")[0] ?? "",
  );
  fireEvent.focus(availableBars[0]);
  expect(readout?.textContent).toContain(
    availableBars[0].getAttribute("aria-label")?.split(": ")[0] ?? "",
  );
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
      "Calories",
      "Resting HR",
      "HRV",
      "Stress avg",
      "Steps",
      "Intensity minutes",
    ]);
    const richMetrics = within(
      panel.querySelector(".health-widget-rich-grid") as HTMLElement,
    );
    const compactMetrics = within(
      panel.querySelector(".health-widget-compact-grid") as HTMLElement,
    );
    expect(richMetrics.getByText("Sleep")).toBeTruthy();
    expect(richMetrics.getByText("Calories")).toBeTruthy();
    expect(compactMetrics.getByText("Resting HR")).toBeTruthy();
    expect(compactMetrics.getByText("Intensity minutes")).toBeTruthy();
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
      within(panel).getByText(/Sleep score or stage details are unavailable/),
    ).toBeTruthy();
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

  it("omits daily sparklines and trend-chart copy while preserving metric values", async () => {
    renderDashboard(baseFetchMock());

    const panel = await openHealthDashboard();

    expect(within(panel).queryAllByRole("img")).toHaveLength(0);
    expect(within(panel).queryByText("No trend — not enough data")).toBeNull();
    expect(within(panel).getByText("7 h 24 m")).toBeTruthy();
    expect(within(panel).getByText("8,412")).toBeTruthy();

    const previous = within(panel).getByRole("button", {
      name: "Previous day",
    });
    fireEvent.click(previous);
    fireEvent.click(previous);

    expect(within(panel).queryAllByRole("img")).toHaveLength(0);
    expect(within(panel).queryByText("No trend — not enough data")).toBeNull();
    expect(within(panel).getByText("10,200")).toBeTruthy();
  });

  it("switches to weekly and monthly rollups with source-only visible metric values", async () => {
    renderDashboard(baseFetchMock());

    const panel = await openHealthDashboard();
    fireEvent.click(within(panel).getByRole("tab", { name: "Weekly" }));
    expect(within(panel).getByText("Weekly Health rollups")).toBeTruthy();
    expect(within(panel).getByText("Sleep duration avg")).toBeTruthy();
    expect(within(panel).getByText("Sleep score avg")).toBeTruthy();
    expect(within(panel).getByText("Deep sleep avg")).toBeTruthy();
    expect(within(panel).getAllByText("417 min").length).toBeGreaterThan(0);
    expect(within(panel).getAllByText("82 avg").length).toBeGreaterThan(0);
    expect(within(panel).getAllByText("67 min").length).toBeGreaterThan(0);
    expect(within(panel).getByText("Total calories")).toBeTruthy();
    expect(within(panel).getByText("Intensity minutes")).toBeTruthy();
    expect(within(panel).getAllByText("16,312 steps").length).toBeGreaterThan(
      0,
    );
    expect(within(panel).getAllByText("4,415 kcal").length).toBeGreaterThan(0);
    expectRollupChartGraphics(panel, "Sleep duration avg");
    expectRollupChartGraphics(panel, "Steps");
    expectRollupChartGraphics(panel, "Total calories");
    expectRollupChartGraphics(panel, "Intensity minutes");
    expect(within(panel).queryByText("Body battery morning avg")).toBeNull();
    expect(within(panel).queryByText("Body battery evening avg")).toBeNull();

    expect(
      within(panel).queryByText(/Sleep duration and sleep stages are averages/),
    ).toBeNull();
    expect(
      within(panel)
        .getByRole("button", { name: /Older periods/ })
        .hasAttribute("disabled"),
    ).toBe(true);
    expect(
      within(panel)
        .getByRole("button", { name: /Newer periods/ })
        .hasAttribute("disabled"),
    ).toBe(true);

    fireEvent.click(within(panel).getByRole("tab", { name: "Monthly" }));
    expect(within(panel).getByText("Monthly Health rollups")).toBeTruthy();
    expect(
      within(panel).queryByText(/Sleep duration and sleep stages are averages/),
    ).toBeNull();
    expect(
      within(panel)
        .getByRole("button", { name: /Older periods/ })
        .hasAttribute("disabled"),
    ).toBe(true);
    expect(
      within(panel)
        .getByRole("button", { name: /Newer periods/ })
        .hasAttribute("disabled"),
    ).toBe(true);
    expect(within(panel).getAllByText("26,512 steps").length).toBeGreaterThan(
      0,
    );
    expect(within(panel).getAllByText("6,895 kcal").length).toBeGreaterThan(0);
    expectRollupChartGraphics(panel, "Sleep duration avg");
    expectRollupChartGraphics(panel, "Steps");
    expectRollupChartGraphics(panel, "Total calories");
    expectRollupChartGraphics(panel, "Intensity minutes");
  });

  it("browses older and newer weekly and monthly rollup windows", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("/api/chat")) return jsonResponse(emptyChat);
      if (url === "/api/profile") return jsonResponse(profile());
      if (url === "/api/health-dashboard")
        return jsonResponse(healthDashboardWithManyRollups());
      return jsonResponse({ ok: true });
    });
    renderDashboard(fetchMock);

    const panel = await openHealthDashboard();
    fireEvent.click(within(panel).getByRole("tab", { name: "Weekly" }));

    const weeklyValues = within(panel).getByLabelText("Steps period values");
    const newestWeeklyText = weeklyValues.textContent;
    const olderWeekly = within(panel).getByRole("button", {
      name: /Older periods/,
    });
    const newerWeekly = within(panel).getByRole("button", {
      name: /Newer periods/,
    });
    expect(olderWeekly.hasAttribute("disabled")).toBe(false);
    expect(newerWeekly.hasAttribute("disabled")).toBe(true);

    fireEvent.click(olderWeekly);
    expect(weeklyValues.textContent).not.toBe(newestWeeklyText);
    expect(newerWeekly.hasAttribute("disabled")).toBe(false);

    fireEvent.click(newerWeekly);
    expect(weeklyValues.textContent).toBe(newestWeeklyText);
    expect(newerWeekly.hasAttribute("disabled")).toBe(true);

    fireEvent.click(within(panel).getByRole("tab", { name: "Monthly" }));
    const monthlyValues = within(panel).getByLabelText("Steps period values");
    const newestMonthlyText = monthlyValues.textContent;
    const olderMonthly = within(panel).getByRole("button", {
      name: /Older periods/,
    });
    const newerMonthly = within(panel).getByRole("button", {
      name: /Newer periods/,
    });
    expect(olderMonthly.hasAttribute("disabled")).toBe(false);
    expect(newerMonthly.hasAttribute("disabled")).toBe(true);

    fireEvent.click(olderMonthly);
    expect(monthlyValues.textContent).not.toBe(newestMonthlyText);
    expect(newerMonthly.hasAttribute("disabled")).toBe(false);

    fireEvent.click(newerMonthly);
    expect(monthlyValues.textContent).toBe(newestMonthlyText);
    expect(newerMonthly.hasAttribute("disabled")).toBe(true);
  });

  it("keeps daily rich and compact widget grids responsive", () => {
    const layoutRule = appStyleRule(".health-widget-layout");
    const richRule = appStyleRule(".health-widget-rich-grid");
    const compactRule = appStyleRule(".health-widget-compact-grid");
    const richCardRule = appStyleRule(
      ".health-widget-rich-grid .health-widget",
    );

    expect(layoutRule).toContain("min-width: 0;");
    expect(richRule).toContain("minmax(min(280px, 100%), 1fr)");
    expect(compactRule).toContain("minmax(min(180px, 100%), 1fr)");
    expect(richCardRule).toContain("min-height: 168px;");
  });

  it("keeps weekly and monthly rollup chart CSS contained at responsive card widths", () => {
    const gridRule = appStyleRule(".health-rollup-grid");
    const chartRule = appStyleRule(".health-rollup-chart");
    const barsRule = appStyleRule(".health-rollup-bars");
    const barRule = appStyleRule(".health-rollup-bar");
    const periodCount = 8;
    const cardMinWidth = 340;
    const cardHorizontalPadding = 24;
    const maxResponsiveGap = 8;
    const fixedBarRowWidth = (periodCount - 1) * maxResponsiveGap;

    expect(gridRule).toContain("minmax(min(340px, 100%), 1fr)");
    expect(chartRule).toContain("max-width: 100%;");
    expect(chartRule).toContain("overflow: hidden;");
    expect(barsRule).toContain("min-width: 0;");
    expect(barsRule).toContain("max-width: 100%;");
    expect(barsRule).toContain("overflow: hidden;");
    expect(barsRule).toContain("gap: clamp(4px, 1.2vw, 8px);");
    expect(barRule).toContain("min-width: 0;");
    expect(fixedBarRowWidth).toBeLessThanOrEqual(
      cardMinWidth - cardHorizontalPadding,
    );
  });

  it("keeps unsupported sleep rollup empty states separate from visible charts", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("/api/chat")) return jsonResponse(emptyChat);
      if (url === "/api/profile") return jsonResponse(profile());
      if (url === "/api/health-dashboard")
        return jsonResponse(healthDashboardWithoutSleepScoreStages());
      return jsonResponse({ ok: true });
    });
    renderDashboard(fetchMock);

    const panel = await openHealthDashboard();
    fireEvent.click(within(panel).getByRole("tab", { name: "Weekly" }));

    expectRollupChartGraphics(panel, "Sleep duration avg");
    expectRollupChartGraphics(panel, "Steps");
    expectRollupEmptyState(panel, "Sleep score avg");
    expectRollupEmptyState(panel, "Sleep stages");

    fireEvent.click(within(panel).getByRole("tab", { name: "Monthly" }));

    expectRollupChartGraphics(panel, "Sleep duration avg");
    expectRollupChartGraphics(panel, "Steps");
    expectRollupEmptyState(panel, "Sleep score avg");
    expectRollupEmptyState(panel, "Sleep stages");
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

    expect(within(panel).getAllByText("16,312 steps").length).toBeGreaterThan(
      0,
    );
    expect(within(panel).getAllByText("4,415 kcal").length).toBeGreaterThan(0);
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
