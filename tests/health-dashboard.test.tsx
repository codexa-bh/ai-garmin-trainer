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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stubNativeDialog } from "./native-dialog-stub";

beforeEach(stubNativeDialog);
import { TrainerDashboard } from "../src/app/trainer-dashboard";
import { HealthDashboardView } from "../src/app/dashboard/health-metrics";
import type { HealthDashboardDay } from "../src/app/dashboard/contracts";

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

function day(
  date: string,
  overrides: Partial<HealthDashboardDay> = {},
): HealthDashboardDay {
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
    expect(within(panel).queryByText("Loading health data…")).toBeNull(),
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
  const availableBars = Array.from(
    chart.querySelectorAll<HTMLElement>('[data-chart-state="available"]'),
  );
  expect(availableBars.length).toBeGreaterThan(0);
  if (expectUnavailable) {
    expect(
      chart.querySelectorAll('[data-chart-state="unavailable"]').length,
    ).toBeGreaterThan(0);
  }
  expect(within(chart).getByLabelText(`${title} period values`)).toBeTruthy();
  expect(chart.querySelector(".health-rollup-plot")).toBeTruthy();
  const readout = chart.querySelector(".health-rollup-readout");
  expect(readout?.textContent).toMatch(
    /: (Unavailable|[0-9,]+(\.[0-9])? \w+|[0-9]+ h( [0-9]+ m)?\/day|[0-9]+ m\/day)/,
  );
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

  it("associates exact per-day values, including zero/unavailable/source-only semantics, without aggregation", () => {
    render(
      <HealthDashboardView
        days={[
          day("2026-07-21", {
            sleepMinutes: 0,
            sleepScore: null,
            sleepDeepMinutes: 0,
            sleepNapMinutes: null,
            activeCalories: 0,
            restingCalories: 1200,
            totalCalories: 999,
            intensityMinutes: 0,
          }),
          day("2026-07-20", {
            sleepMinutes: Number.NaN,
            hrvMs: Number.POSITIVE_INFINITY,
            hrvStatus: "Low",
            activeCalories: null,
            restingCalories: null,
            totalCalories: null,
            calories: 1500,
            stressAvg: Number.NaN,
          }),
        ]}
        rangeEnd={null}
        onSelectRange={vi.fn()}
        notice=""
      />,
    );
    const values = (title: string) =>
      within(screen.getByLabelText(`${title} daily values`))
        .getAllByRole("button")
        .map((button) => button.querySelector("strong")?.textContent);
    expect(values("Sleep duration").slice(-2)).toEqual(["Unavailable", "0 m"]);
    expect(values("Sleep score").slice(-2)).toEqual(["86", "Unavailable"]);
    expect(values("Deep sleep").slice(-2)).toEqual(["1 h 14 m", "0 m"]);
    expect(values("Light sleep").slice(-2)).toEqual(["4 h 4 m", "4 h 4 m"]);
    expect(values("Awake sleep").slice(-2)).toEqual(["30 m", "30 m"]);
    expect(values("Nap sleep").slice(-2)).toEqual(["0 m", "Unavailable"]);
    expect(values("Total calories").slice(-2)).toEqual([
      "1,500 kcal",
      "999 kcal",
    ]);
    expect(values("Active calories").slice(-2)).toEqual([
      "Unavailable",
      "0 kcal",
    ]);
    expect(values("Resting calories").slice(-2)).toEqual([
      "Unavailable",
      "1,200 kcal",
    ]);
    expect(values("HRV").slice(-2)).toEqual([
      "Unavailable · Low",
      "41.2 ms · Balanced",
    ]);
    expect(values("Stress avg").slice(-2)).toEqual(["Unavailable", "38"]);
    expect(values("Intensity minutes").slice(-2)).toEqual(["38 min", "0 min"]);
    expect(screen.queryByText(/16,824|2,200/)).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getAllByRole("group", { name: /daily chart$/ })).toHaveLength(
      15,
    );
    expect(screen.queryByText(/Period average|Period total/)).toBeNull();
    expect(screen.queryByText("Complete daily health record")).toBeNull();
  });

  it("marks today's values not final even with complete source coverage and supports roving keyboard tabs", () => {
    const today = new Date().toISOString().slice(0, 10);
    render(
      <HealthDashboardView
        days={[day(today)]}
        rangeEnd={null}
        onSelectRange={vi.fn()}
        notice=""
      />,
    );
    expect(screen.getByText("Today · in progress, not final")).toBeTruthy();
    const daily = screen.getByRole("tab", { name: "Daily" });
    const weekly = screen.getByRole("tab", { name: "Weekly" });
    const monthly = screen.getByRole("tab", { name: "Monthly" });
    expect(daily.tabIndex).toBe(0);
    expect(weekly.tabIndex).toBe(-1);
    fireEvent.keyDown(daily, { key: "ArrowRight" });
    expect(document.activeElement).toBe(weekly);
    expect(weekly.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tabpanel").getAttribute("aria-labelledby")).toBe(
      weekly.id,
    );
    fireEvent.keyDown(weekly, { key: "End" });
    expect(document.activeElement).toBe(monthly);
    fireEvent.keyDown(monthly, { key: "Home" });
    expect(document.activeElement).toBe(daily);
    expect(
      screen.getByRole("group", { name: "Sleep duration daily chart" }),
    ).toBeTruthy();
  });

  it("shows a Daily-only empty state for future/invalid rows without hiding rollup tabs", () => {
    render(
      <HealthDashboardView
        days={[day("9999-01-01"), day("2026-02-30")]}
        rangeEnd={null}
        onSelectRange={vi.fn()}
        notice=""
      />,
    );
    expect(screen.getByText(/No eligible Daily records/)).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByRole("button", { name: /Next 7 days/ })).toBeNull();
    expect(screen.getByRole("tab", { name: "Weekly" })).toBeTruthy();
  });

  it("opens from desktop navigation, renders seven-date charts, and never POSTs to /api/sync", async () => {
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

    expect(within(panel).queryByRole("table")).toBeNull();
    const cards = within(panel).getAllByRole("group", { name: /daily chart$/ });
    expect(cards).toHaveLength(15);
    expect(
      Array.from(cards[0].querySelectorAll("[data-source-date]"), (node) =>
        node.getAttribute("data-source-date"),
      ),
    ).toEqual([
      "2026-07-15",
      "2026-07-16",
      "2026-07-17",
      "2026-07-18",
      "2026-07-19",
      "2026-07-20",
      "2026-07-21",
    ]);
    for (const card of cards) {
      expect(within(card).getAllByRole("button")).toHaveLength(7);
      for (const button of within(card).getAllByRole("button"))
        expect(button.tabIndex).toBe(0);
    }
    expect(
      within(panel).getByRole("group", {
        name: "Intensity minutes daily chart",
      }),
    ).toBeTruthy();
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
    fireEvent.click(
      within(screen.getByRole("dialog", { name: "Main menu" })).getByRole(
        "button",
        { name: "Health" },
      ),
    );

    expect(screen.queryByRole("dialog", { name: "Main menu" })).toBeNull();
    expect(
      screen.getByRole("heading", { name: "Health", level: 1 }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Back to chat" })).toBeTruthy();
  });

  it("renders all metric widgets with units and labels for the selected day", async () => {
    renderDashboard(baseFetchMock());

    const panel = await openHealthDashboard();

    for (const [title, value] of [
      ["Sleep duration", "7 h 24 m"],
      ["Sleep score", "86"],
      ["Deep sleep", "1 h 14 m"],
      ["Light sleep", "4 h 4 m"],
      ["REM sleep", "1 h 36 m"],
      ["Awake sleep", "30 m"],
      ["Nap sleep", "0 m"],
      ["Resting HR", "52 bpm"],
      ["HRV", "41.2 ms · balanced"],
      ["Stress avg", "38"],
      ["Steps", "8,412 steps"],
      ["Total calories", "2,310 kcal"],
      ["Active calories", "710 kcal"],
      ["Resting calories", "1,600 kcal"],
      ["Intensity minutes", "38 min"],
    ]) {
      const card = within(panel).getByRole("group", {
        name: `${title} daily chart`,
      });
      expect(
        within(card).getByRole("button", { name: `July 21, 2026: ${value}` }),
      ).toBeTruthy();
    }
    expect(within(panel).queryByText("Body battery morning")).toBeNull();
    expect(within(panel).queryByText("Body battery evening")).toBeNull();
    expect(
      within(panel).getByRole("heading", {
        name: "July 15, 2026 – July 21, 2026",
      }),
    ).toBeTruthy();
  });

  it("browses calendar pages including gaps, preserves range through tabs and away/back, and resets explicitly", async () => {
    const fetch = baseFetchMock();
    fetch.mockImplementation((input) =>
      String(input) === "/api/health-dashboard"
        ? jsonResponse(healthDashboardWithSparseRollups())
        : String(input).startsWith("/api/chat")
          ? jsonResponse(emptyChat)
          : jsonResponse(profile()),
    );
    renderDashboard(fetch);
    let panel = await openHealthDashboard();
    const previous = within(panel).getByRole("button", {
      name: /Previous 7 days/,
    });
    const next = within(panel).getByRole("button", { name: /Next 7 days/ });
    expect(next.hasAttribute("disabled")).toBe(true);
    fireEvent.click(previous);
    expect(
      within(panel).getByText(/No imported records in this range/),
    ).toBeTruthy();
    expect(panel.querySelectorAll("time")).toHaveLength(7);
    expect(panel.querySelector("time")?.dateTime).toBe("2026-07-08");
    expect(next.hasAttribute("disabled")).toBe(false);
    fireEvent.click(within(panel).getByRole("tab", { name: "Weekly" }));
    fireEvent.click(within(panel).getByRole("tab", { name: "Daily" }));
    expect(panel.querySelector("time")?.dateTime).toBe("2026-07-08");
    fireEvent.click(
      within(panel).getByRole("button", { name: "Back to chat" }),
    );
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "Health" }),
      ),
    );
    panel = await openHealthDashboard();
    expect(panel.querySelector("time")?.dateTime).toBe("2026-07-08");
    fireEvent.click(
      within(panel).getByRole("button", { name: /Latest 7 days/ }),
    );
    expect(panel.querySelector("time")?.dateTime).toBe("2026-07-15");
    expect(
      fetch.mock.calls.filter(
        ([url]) => String(url) === "/api/health-dashboard",
      ),
    ).toHaveLength(1);
    expect(fetch.mock.calls.some(([url]) => String(url) === "/api/sync")).toBe(
      false,
    );
  });

  it("renders truthful unavailable copy for null fields and missing days without estimating", async () => {
    renderDashboard(baseFetchMock());

    const panel = await openHealthDashboard();
    expect(
      within(panel)
        .getByRole("button", { name: /Previous 7 days/ })
        .hasAttribute("disabled"),
    ).toBe(true);
    const unavailable = within(panel).getAllByText("Unavailable");
    expect(unavailable.length).toBeGreaterThanOrEqual(2);
    expect(within(panel).getByText("Source marked missing")).toBeTruthy();
    expect(within(panel).getByText("Partial source coverage")).toBeTruthy();
    expect(within(panel).getByText("Recorded coverage")).toBeTruthy();
    expect(within(panel).getAllByText("Outside loaded history")).toHaveLength(
      4,
    );
    expect(
      within(panel).queryByText("Complete daily health record"),
    ).toBeNull();
    expect(
      within(panel).getByText(
        /Unavailable sleep score or stage details may be source-limited/,
      ),
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

  it("shows raw Daily chart graphics and exact pointer/keyboard values without rollup copy", async () => {
    renderDashboard(baseFetchMock());

    const panel = await openHealthDashboard();

    const card = within(panel).getByRole("group", {
      name: "Steps daily chart",
    });
    expect(card.querySelector(".health-rollup-plot")).toBeTruthy();
    expect(
      card.querySelectorAll(".recharts-bar-rectangle").length,
    ).toBeGreaterThan(0);
    const exact = within(card).getByRole("button", {
      name: "July 19, 2026: 10,200 steps",
    });
    for (const action of [
      fireEvent.pointerEnter,
      fireEvent.focus,
      fireEvent.click,
    ]) {
      action(exact);
      expect(card.querySelector(".health-rollup-readout")?.textContent).toBe(
        "July 19, 2026: 10,200 steps",
      );
    }
    expect(
      within(panel).queryByText(/Period average|Period total|\/day/),
    ).toBeNull();
  });

  it("switches to weekly and monthly rollups with source-only visible metric values", async () => {
    renderDashboard(baseFetchMock());

    const panel = await openHealthDashboard();
    fireEvent.click(within(panel).getByRole("tab", { name: "Weekly" }));
    expect(within(panel).getByText("Weekly Health rollups")).toBeTruthy();
    expect(within(panel).getByText("Sleep duration daily avg")).toBeTruthy();
    expect(within(panel).getByText("Sleep score avg")).toBeTruthy();
    expect(within(panel).getByText("Deep sleep daily avg")).toBeTruthy();
    expect(within(panel).getAllByText("6 h 57 m/day").length).toBeGreaterThan(
      0,
    );
    expect(within(panel).getAllByText("82 avg").length).toBeGreaterThan(0);
    expect(within(panel).getAllByText("1 h 7 m/day").length).toBeGreaterThan(0);
    expect(
      within(panel).getByRole("button", {
        name: /Week of July 20, 2026: 6 h 57 m\/day/,
      }),
    ).toBeTruthy();
    expect(within(panel).queryByText("417 min")).toBeNull();
    expect(within(panel).getByText("Total calories")).toBeTruthy();
    expect(within(panel).getByText("Intensity minutes")).toBeTruthy();
    expect(within(panel).getAllByText("16,312 steps").length).toBeGreaterThan(
      0,
    );
    expect(within(panel).getAllByText("4,415 kcal").length).toBeGreaterThan(0);
    expectRollupChartGraphics(panel, "Sleep duration daily avg");
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
    expectRollupChartGraphics(panel, "Sleep duration daily avg");
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

  it("contains Daily chart and source-detail widths without a wide matrix", () => {
    const comparison = appStyleRule(".health-daily-comparison");
    expect(comparison).toContain("min-width: 0;");
    expect(comparison).toContain("max-width: 100%;");
    expect(appStyleRule(".health-daily-coverage ul")).toContain(
      "minmax(min(220px, 100%), 1fr)",
    );
    expect(readFileSync("src/app/style.css", "utf8")).not.toContain(
      ".health-daily-matrix",
    );
  });

  it("keeps weekly and monthly rollup chart CSS contained at responsive card widths", () => {
    const gridRule = appStyleRule(".health-rollup-grid");
    const chartRule = appStyleRule(".health-rollup-chart");
    const plotRule = appStyleRule(".health-rollup-plot");
    const valueRule = appStyleRule(".health-rollup-values button");

    expect(gridRule).toContain("minmax(min(380px, 100%), 1fr)");
    expect(chartRule).toContain("max-width: 100%;");
    expect(chartRule).toContain("overflow: hidden;");
    expect(plotRule).toContain("min-width: 0;");
    expect(plotRule).toContain("max-width: 100%;");
    expect(plotRule).toContain("height: 200px;");
    expect(valueRule).toContain("min-width: 0;");
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

    expectRollupChartGraphics(panel, "Sleep duration daily avg");
    expectRollupChartGraphics(panel, "Steps");
    expectRollupEmptyState(panel, "Sleep score avg");
    expectRollupEmptyState(panel, "Sleep stages");

    fireEvent.click(within(panel).getByRole("tab", { name: "Monthly" }));

    expectRollupChartGraphics(panel, "Sleep duration daily avg");
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
