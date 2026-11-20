/** @vitest-environment jsdom */
import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HealthDashboardView } from "../src/app/dashboard/health-metrics";
import type { HealthDashboardDay } from "../src/app/dashboard/contracts";
import type {
  HealthSupplementDay,
  HealthSupplements,
  SupplementCoverage,
} from "../src/lib/local-data/supplement-contracts";

function day(date: string): HealthDashboardDay {
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
  };
}

const unknown: SupplementCoverage = { status: "not_imported", reason: null };
function supplementDay(
  date: string,
  overrides: Partial<HealthSupplementDay> = {},
): HealthSupplementDay {
  return {
    date,
    hrv: null,
    sleep: null,
    stress: null,
    bodyBattery: null,
    coverage: {
      sleep: unknown,
      hrv: unknown,
      stress: unknown,
      body_battery: unknown,
      vo2_max: unknown,
    },
    ...overrides,
  };
}

const DATES = [
  "2026-07-15",
  "2026-07-16",
  "2026-07-17",
  "2026-07-18",
  "2026-07-19",
  "2026-07-20",
  "2026-07-21",
];

function authored(): HealthSupplements {
  return {
    from: DATES[0],
    to: DATES[6],
    vo2: [
      {
        date: "2026-07-16",
        branch: "generic",
        vo2Max: 51,
        vo2MaxPrecise: 51.4,
        sport: "RUNNING",
        subSport: null,
      },
      {
        date: "2026-07-16",
        branch: "cycling",
        vo2Max: 58,
        vo2MaxPrecise: null,
        sport: "CYCLING",
        subSport: "ROAD",
      },
      {
        date: "2026-07-19",
        branch: "generic",
        vo2Max: null,
        vo2MaxPrecise: null,
        sport: null,
        subSport: null,
      },
    ],
    days: [
      supplementDay("2026-07-20", {
        hrv: {
          weeklyAvgMs: 44,
          balancedLowMs: 38,
          balancedUpperMs: 52,
          feedbackCode: "BALANCED",
        },
        sleep: {
          overallQualifier: "GOOD",
          components: [
            { component: "overall", value: 81, qualifier: "GOOD" },
            { component: "deep", value: 0, qualifier: "POOR" },
            { component: "stress", value: null, qualifier: "FAIR" },
            { component: "awake_count", value: null, qualifier: null },
          ],
        },
        stress: {
          totalSeconds: 86400,
          restSeconds: 36000,
          lowSeconds: 18000,
          mediumSeconds: 0,
          highSeconds: 3600,
          activitySeconds: 7200,
          uncategorizedSeconds: 21600,
        },
        bodyBattery: { charged: 0, drained: null },
        coverage: {
          sleep: { status: "populated", reason: null },
          hrv: { status: "populated", reason: null },
          stress: { status: "populated", reason: null },
          body_battery: { status: "populated", reason: null },
          vo2_max: unknown,
        },
      }),
      supplementDay("2026-07-21", {
        stress: {
          totalSeconds: null,
          restSeconds: 100,
          lowSeconds: null,
          mediumSeconds: null,
          highSeconds: null,
          activitySeconds: null,
          uncategorizedSeconds: null,
        },
        coverage: {
          sleep: { status: "empty", reason: null },
          hrv: { status: "failed", reason: "http_429" },
          stress: { status: "populated", reason: null },
          body_battery: { status: "unavailable", reason: null },
          vo2_max: unknown,
        },
      }),
    ],
  };
}

function renderDaily(supplements: HealthSupplements | null | undefined) {
  return render(
    <HealthDashboardView
      days={DATES.map(day)}
      supplements={supplements}
      rangeEnd={null}
      onSelectRange={vi.fn()}
      notice=""
    />,
  );
}

const card = (name: string) =>
  screen.getByRole("group", { name: `${name} daily chart` });
const button = (name: string, date: string) =>
  card(name).querySelector<HTMLButtonElement>(
    `button[data-source-date="${date}"]`,
  )!;

describe("Health additional Garmin evidence", () => {
  afterEach(cleanup);

  it("keeps every card on the seven selected dates and works with no supplements at all", () => {
    for (const supplements of [undefined, null]) {
      renderDaily(supplements);
      for (const name of [
        "Stress breakdown",
        "Body Battery charged and drained",
        "VO2 max",
      ]) {
        const dates = Array.from(
          card(name).querySelectorAll("[data-source-date]"),
          (node) => node.getAttribute("data-source-date"),
        );
        expect(dates).toEqual(DATES);
      }
      // Unknown coverage reads as unknown, never as empty or zero.
      expect(button("Stress breakdown", DATES[6]).title).toMatch(
        /Not imported \(unknown\)/,
      );
      cleanup();
    }
  });

  it("shows HRV with Garmin's same-date baseline and no band for other dates", () => {
    renderDaily(authored());
    expect(card("HRV").textContent).toContain("Garmin baseline range");
    const withBand = button("HRV", "2026-07-20");
    expect(withBand.title).toBe(
      "July 20, 2026: 41.2 ms · Balanced · Garmin baseline 38–52 ms",
    );
    // A neighbouring date without a stored baseline carries none forward.
    expect(button("HRV", "2026-07-19").title).not.toMatch(/baseline/);
    expect(button("HRV", "2026-07-21").title).not.toMatch(/baseline/);
  });

  it("omits the baseline key when no date has a complete band", () => {
    renderDaily({ ...authored(), days: [supplementDay("2026-07-20")] });
    expect(card("HRV").textContent).not.toContain("Garmin baseline range");
  });

  it("places the Garmin sleep qualifier beside the score and lists qualifier-only parts without a number", () => {
    renderDaily(authored());
    expect(button("Sleep score", "2026-07-20").title).toContain("Garmin: Good");
    const detail = document.querySelector('[data-sleep-detail="2026-07-20"]')!;
    expect(detail.textContent).toContain("Overall: 81 · Good");
    expect(detail.textContent).toContain("Deep: 0 · Poor");
    // Qualifier-only components never receive an invented number.
    expect(detail.textContent).toContain("Stress: Fair");
    expect(detail.textContent).not.toMatch(/Stress: \d/);
    expect(detail.textContent).toContain("Awake count: Not reported");
    expect(
      document.querySelector('[data-sleep-detail="2026-07-21"]')!.textContent,
    ).toContain("Garmin returned none");
  });

  it("shows stress durations in minutes with activity and uncategorized time separate from high stress", () => {
    renderDaily(authored());
    const complete = button("Stress breakdown", "2026-07-20");
    expect(complete.title).toBe(
      "July 20, 2026: Rest: 600 min · Low: 300 min · Medium: 0 min · High: 60 min · Activity (not stress): 120 min · Uncategorized: 360 min",
    );
    expect(complete.dataset.chartState).toBe("available");
    // Incomplete buckets are not stacked and not zero-filled.
    const partial = button("Stress breakdown", "2026-07-21");
    expect(partial.dataset.chartState).toBe("unavailable");
    expect(partial.title).toContain("Low: Not reported");
    expect(partial.title).toContain("High: Not reported");
  });

  it("shows Body Battery charged and drained with zero distinct from not reported", () => {
    renderDaily(authored());
    expect(button("Body Battery charged and drained", "2026-07-20").title).toBe(
      "July 20, 2026: Charged: 0 points · Drained: Not reported",
    );
    expect(
      button("Body Battery charged and drained", "2026-07-21").title,
    ).toContain("Source unavailable");
    // The older Body Battery averages in the legacy payload are not relabelled.
    expect(card("Body Battery charged and drained").textContent).not.toMatch(
      /latest|end of day|morning|evening/i,
    );
  });

  it("shows VO2 as dated multisport points, with no values on other dates", () => {
    renderDaily(authored());
    expect(button("VO2 max", "2026-07-16").title).toBe(
      "July 16, 2026: General: 51.4 ml/kg/min (Running) · Cycling: 58 ml/kg/min (Road)",
    );
    expect(button("VO2 max", "2026-07-17").title).toContain(
      "No reading stored for this date",
    );
    expect(button("VO2 max", "2026-07-19").title).toContain("no value");
    expect(card("VO2 max").textContent).toContain("Dated readings only");
  });

  it("states that an empty VO2 window does not prove none exist", () => {
    renderDaily({ ...authored(), vo2: [] });
    expect(card("VO2 max").textContent).toContain(
      "does not show none exist in other dates or in Garmin",
    );
  });

  it("reveals exact values by keyboard focus and click", () => {
    renderDaily(authored());
    const target = button("Stress breakdown", "2026-07-20");
    fireEvent.focus(target);
    const readout = card("Stress breakdown").querySelector(
      ".health-rollup-readout",
    )!;
    expect(readout.textContent).toContain("High: 60 min");
    expect(target.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(button("Stress breakdown", "2026-07-15"));
    expect(readout.textContent).toContain("Not imported (unknown)");
  });

  it("lists per-date per-group coverage including failed and unavailable states", () => {
    renderDaily(authored());
    const coverage = document.querySelector(".health-supplement-coverage")!;
    fireEvent.click(
      within(coverage as HTMLElement).getByText(/coverage by date/),
    );
    const text = coverage.textContent ?? "";
    expect(text).toContain("HRV baseline: read failed");
    expect(text).toContain("Body Battery: source unavailable");
    expect(text).toContain("Sleep detail: none from Garmin");
    expect(text).toContain("VO2 max: not imported");
  });

  it("does not add supplement content to Weekly or Monthly", () => {
    renderDaily(authored());
    for (const tab of ["Weekly", "Monthly"]) {
      fireEvent.click(screen.getByRole("tab", { name: tab }));
      expect(screen.queryByText("VO2 max")).toBeNull();
      expect(screen.queryByText(/Stress breakdown/)).toBeNull();
      expect(
        document.querySelector(".health-supplement-disclosure"),
      ).toBeNull();
    }
  });
});

describe("supplement wording", () => {
  afterEach(cleanup);

  it("renders closed codes readably and unknown codes neutrally without failing", () => {
    const supplements = authored();
    supplements.days[0].sleep!.overallQualifier = "NEEDS_IMPROVEMENT";
    supplements.days[0].sleep!.components = [
      { component: "rem", value: 70, qualifier: "BrandNewCode.v2" },
      { component: "future_part", value: null, qualifier: "___" },
    ];
    renderDaily(supplements);
    expect(button("Sleep score", "2026-07-20").title).toContain(
      "Garmin: Needs improvement",
    );
    const detail = document.querySelector('[data-sleep-detail="2026-07-20"]')!;
    expect(detail.textContent).toContain("REM: 70 · Brandnewcode v2");
    // An unknown component and an unreadable code fall back to neutral text.
    expect(detail.textContent).toContain("Future part: Not reported");
  });

  it("explains each coverage state truthfully when a card has no value", () => {
    const states = [
      ["populated", "Not reported by Garmin"],
      ["empty", "Garmin returned none"],
      ["unavailable", "Source unavailable"],
      ["failed", "Read failed"],
      ["not_imported", "Not imported (unknown)"],
    ] as const;
    const supplements: HealthSupplements = {
      from: DATES[0],
      to: DATES[6],
      vo2: [],
      days: states.map(([status], index) =>
        supplementDay(DATES[index], {
          coverage: {
            ...supplementDay(DATES[index]).coverage,
            stress: { status, reason: null },
          },
        }),
      ),
    };
    renderDaily(supplements);
    states.forEach(([, expected], index) =>
      expect(button("Stress breakdown", DATES[index]).title).toContain(
        expected,
      ),
    );
  });
});
