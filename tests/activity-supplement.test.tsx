/** @vitest-environment jsdom */
import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ActivityView } from "../src/app/dashboard/activity-view";
import type { ActivityDashboardPayload } from "../src/app/dashboard/contracts";
import type {
  ActivitySupplement,
  SupplementCoverage,
} from "../src/lib/local-data/supplement-contracts";

const unknown: SupplementCoverage = { status: "not_imported", reason: null };

function supplement(
  overrides: Partial<ActivitySupplement> = {},
): ActivitySupplement {
  return {
    bodyBatteryDelta: null,
    listCadence: { avgSpm: null, maxSpm: null, strideLengthCm: null },
    fitCadence: { avgCpm: null, stepLengthM: null },
    lapZones: [],
    snowTotals: [],
    snowRuns: { total: 0, returned: 0, truncated: false, entries: [] },
    coverage: {
      activity_body_battery: unknown,
      running_dynamics: unknown,
      lap_hr_zones: unknown,
      snowboard_splits: unknown,
      snow_run_lift_splits: unknown,
    },
    ...overrides,
  };
}

const lap = (lapNumber: number, avgHeartRate: number | null = 140) => ({
  lapNumber,
  durationSec: 600,
  distanceMeters: 1500,
  avgSpeedMps: 2.5,
  avgHeartRate,
  maxHeartRate: 160,
  elevationGainMeters: 10,
  elevationLossMeters: 12,
  avgPowerWatts: null,
  normalizedPowerWatts: null,
});

function payload(
  extra: Partial<ActivityDashboardPayload> = {},
  sport = "running",
): ActivityDashboardPayload {
  return {
    activity: {
      garminId: "act-1",
      name: null,
      label: "Authored run",
      sport,
      date: "2026-10-13",
      startedAt: "2026-10-13T07:00:00Z",
      detailStatus: null,
      durationSec: 3600,
      distanceMeters: 8000,
      elevationGainMeters: 100,
      elevationLossMeters: 90,
      calories: 500,
      avgHeartRate: 140,
      maxHeartRate: 170,
      steps: 9000,
      trainingEffect: 3,
      anaerobicTrainingEffect: 1,
      trainingEffectLabel: null,
      trainingLoad: 80,
      moderateIntensityMinutes: 10,
      vigorousIntensityMinutes: 5,
      totalIntensityMinutes: 20,
    },
    detail: {
      status: "available",
      hasHeartRate: false,
      hasElevation: false,
      hasLaps: true,
      recordCount: 0,
      lapCount: 3,
    },
    charts: {
      downsampled: false,
      sourcePointCount: 0,
      pointCount: 0,
      maxPoints: 400,
      domainStartSec: 0,
      domainEndSec: 60,
      timeScaleStatus: "elapsed",
      timeScaleMessage: null,
      points: [],
      speed: {
        status: "missing_speed",
        sourcePointCount: 0,
        pointCount: 0,
        message: "Speed unavailable",
      },
    },
    route: {
      status: "missing_gps",
      sourcePointCount: 0,
      pointCount: 0,
      maxPoints: 400,
      simplified: false,
      bounds: null,
      points: [],
      message: "Route unavailable",
    },
    heartRateZones: {
      status: "missing_zones",
      timeSource: null,
      zoneSource: null,
      zoneStatus: "unavailable",
      formula: null,
      classifiedSeconds: 0,
      unclassifiedSeconds: 0,
      noHeartRateSeconds: 0,
      activityDurationSec: null,
      sourceTotalSeconds: null,
      message: "Zones unavailable",
      buckets: [],
    },
    laps: [lap(1), lap(2), lap(3)],
    ...extra,
  };
}

function view(dashboard: ActivityDashboardPayload) {
  return (
    <ActivityView
      activitySelectorCollapsed={false}
      closeActivityDashboard={() => {}}
      activityDashboardCloseRef={{ current: null }}
      setActivitySelectorCollapsed={() => {}}
      activitySearchQuery=""
      setActivitySearchQuery={() => {}}
      activityListMessage=""
      handleActivityListScroll={() => {}}
      activityListState="loaded"
      activities={[dashboard.activity]}
      selectedActivityId={dashboard.activity.garminId}
      runInBackground={() => {}}
      selectActivityDashboard={() => Promise.resolve()}
      isActivityListLoadingMore={false}
      activityListNextOffset={null}
      activityListTotalApprox={1}
      activityDashboardState="loaded"
      activityDashboard={dashboard}
    />
  );
}

const stats = () =>
  screen.getByLabelText("Selected activity summary stats").textContent ?? "";

afterEach(cleanup);

describe("Activity additional Garmin evidence", () => {
  it("adds signed battery change and source-labelled cadence/stride to the existing summary", () => {
    render(
      view(
        payload({
          supplement: supplement({
            bodyBatteryDelta: -12,
            listCadence: { avgSpm: 158, maxSpm: 171.5, strideLengthCm: 104.5 },
            fitCadence: { avgCpm: 79.5, stepLengthM: 1.04 },
          }),
        }),
      ),
    );
    const text = stats();
    expect(text).toContain("Body Battery change−12 points");
    expect(text).toContain("Cadence (Garmin list)158 steps/min");
    expect(text).toContain("Max cadence (Garmin list)171.5 steps/min");
    expect(text).toContain("Stride length (Garmin list)104.5 cm");
    // FIT cadence stays in its own unit and is not doubled or merged with the list value.
    expect(text).toContain("Cadence (FIT file)79.5 cycles/min");
    expect(text).toContain("Step length (FIT file)1.04 m");
  });

  it("signs positive change, shows measured zero, and omits null sensors rather than showing unavailable cells", () => {
    const { rerender } = render(
      view(payload({ supplement: supplement({ bodyBatteryDelta: 7 }) })),
    );
    expect(stats()).toContain("Body Battery change+7 points");
    rerender(
      view(payload({ supplement: supplement({ bodyBatteryDelta: 0 }) })),
    );
    expect(stats()).toContain("Body Battery change0 points");
    expect(stats()).not.toMatch(/cadence|stride/i);
    rerender(view(payload({ supplement: supplement() })));
    expect(stats()).not.toMatch(/Body Battery change|cadence|stride/i);
  });

  it("renders no new column or section when no supplement is present", () => {
    render(view(payload()));
    expect(screen.queryByRole("columnheader", { name: "HR zones" })).toBeNull();
    expect(screen.queryByLabelText("Run and lift summary")).toBeNull();
    expect(document.querySelector(".activity-supplement-coverage")).toBeNull();
  });

  it("aligns lap-zone cells to stored lap numbers and leaves laps without rows blank", () => {
    const zones = (lapNumber: number, seconds: number[]) => ({
      lapNumber,
      calcMethod: "PERCENT_MAX_HR",
      sourceMaxHeartRate: 190,
      sourceRestingHeartRate: 52,
      buckets: seconds.map((value, bucket) => ({
        bucket,
        kind:
          bucket === 0
            ? ("below" as const)
            : bucket === 6
              ? ("above" as const)
              : ("zone" as const),
        zone: bucket >= 1 && bucket <= 5 ? bucket : null,
        seconds: value,
        lowerBpm: bucket >= 1 && bucket <= 5 ? 90 + bucket * 10 : null,
        upperBpm: bucket >= 1 && bucket <= 5 ? 99 + bucket * 10 : null,
      })),
    });
    render(
      view(
        payload({
          supplement: supplement({
            // Lap 2 has no recorded zone data: unknown, not copied from another lap.
            lapZones: [
              zones(1, [12, 0, 90, 300, 150, 30, 18]),
              zones(3, [0, 0, 0, 0, 0, 0, 0]),
            ],
          }),
        }),
      ),
    );
    const table = screen.getByRole("table", { name: "Lap details" });
    const headers = within(table)
      .getAllByRole("columnheader")
      .map((h) => h.textContent);
    expect(headers.at(-1)).toBe("HR zones");
    const rows = Array.from(table.querySelectorAll("tbody tr"));
    expect(rows).toHaveLength(3);
    const zoneCell = (row: Element) => row.querySelector(".lap-zone-column")!;
    expect(zoneCell(rows[0]).textContent).toContain("Below zone 1");
    expect(
      zoneCell(rows[0])
        .querySelector("[role=group]")!
        .getAttribute("aria-label"),
    ).toContain("Below zone 1: 12s · Zone 1 (100–109 bpm): 0s");
    expect(
      zoneCell(rows[0])
        .querySelector("[role=group]")!
        .getAttribute("aria-label"),
    ).toContain("Above zone 5: 18s");
    expect(zoneCell(rows[1]).textContent).toBe("");
    // A recorded all-zero lap is stated as such, not hidden.
    expect(zoneCell(rows[2]).textContent).toContain("All zero");
    // Every row keeps the same cell count so columns stay aligned.
    expect(new Set(rows.map((r) => r.children.length)).size).toBe(1);
    // Method and source boundary detail is reachable without leaving the row.
    fireEvent.click(
      within(zoneCell(rows[0]) as HTMLElement).getByText("Times"),
    );
    expect(zoneCell(rows[0]).textContent).toContain("percent max hr");
    expect(zoneCell(rows[0]).textContent).toContain("max HR 190 bpm");
  });

  it("shows aggregate per-type totals with their labels and never calls them individual runs", () => {
    render(
      view(
        payload(
          {
            supplement: supplement({
              snowTotals: [
                {
                  splitType: "SKI_LIFT_SPLIT",
                  count: 9,
                  durationSec: 3000,
                  distanceMeters: 12000,
                  bestSplitDistanceMeters: 2100,
                  maxSpeedMps: null,
                },
                {
                  splitType: "SKI_RUN_SPLIT",
                  count: 10,
                  durationSec: 4000,
                  distanceMeters: 51000,
                  bestSplitDistanceMeters: 1900,
                  maxSpeedMps: 22.5,
                },
              ],
              coverage: {
                ...supplement().coverage,
                snowboard_splits: { status: "populated", reason: null },
                snow_run_lift_splits: { status: "not_imported", reason: null },
              },
            }),
          },
          "resort_snowboarding",
        ),
      ),
    );
    const section = screen.getByLabelText("Run and lift summary");
    const totals = within(section).getByRole("table", {
      name: /Totals over the whole activity/,
    });
    const rows = Array.from(totals.querySelectorAll("tbody tr"));
    // Runs precede lifts in a stable order regardless of read order.
    expect(rows.map((r) => r.querySelector("th")!.textContent)).toEqual([
      "Runs",
      "Lifts",
    ]);
    expect(rows[0].textContent).toContain("51 km");
    expect(rows[0].textContent).toContain("1.9 km");
    expect(
      within(totals).getByRole("columnheader", {
        name: "Longest single split",
      }),
    ).toBeTruthy();
    expect(section.textContent).toContain(
      "Individual runs and lifts: not imported (unknown). Totals above are not individual entries.",
    );
    expect(
      within(section).queryByRole("table", { name: /Individual runs/ }),
    ).toBeNull();
  });

  it("lists delivered individual runs in start order with nullable metrics and discloses truncation", () => {
    const entries = [
      {
        splitKey: "index:1",
        splitType: "run" as const,
        startTime: "2026-01-01T10:00:00Z",
        timerSeconds: 95,
        distanceMeters: 1250,
        descentMeters: 210,
        ascentMeters: 3,
        maxSpeedMps: 20,
      },
      {
        splitKey: "index:2",
        splitType: "lift" as const,
        startTime: null,
        timerSeconds: null,
        distanceMeters: null,
        descentMeters: 0,
        ascentMeters: 300,
        maxSpeedMps: null,
      },
    ];
    render(
      view(
        payload(
          {
            supplement: supplement({
              snowRuns: { total: 75, returned: 2, truncated: true, entries },
              coverage: {
                ...supplement().coverage,
                snow_run_lift_splits: { status: "populated", reason: null },
              },
            }),
          },
          "resort_snowboarding",
        ),
      ),
    );
    const list = screen.getByRole("table", {
      name: /Individual runs and lifts, in start order — showing the first 2 of 75/,
    });
    const rows = Array.from(list.querySelectorAll("tbody tr"));
    expect(rows[0].textContent).toBe("1Run1m 35s1.25 km210 m72 km/h");
    // Missing metrics are dashes, and a measured zero descent stays zero.
    expect(rows[1].textContent).toBe("2Lift——0 m—");
  });

  it("states unavailable and failed run coverage instead of an empty list", () => {
    for (const status of ["failed", "unavailable", "empty"] as const) {
      render(
        view(
          payload(
            {
              supplement: supplement({
                coverage: {
                  ...supplement().coverage,
                  snow_run_lift_splits: { status, reason: null },
                },
              }),
            },
            "resort_snowboarding",
          ),
        ),
      );
      const text = screen.getByLabelText("Run and lift summary").textContent;
      expect(text).toContain(
        status === "failed"
          ? "read failed"
          : status === "unavailable"
            ? "source unavailable"
            : "Garmin returned none",
      );
      cleanup();
    }
  });

  it("lists coverage per group, with absent rows reading as unknown", () => {
    render(
      view(
        payload({
          supplement: supplement({
            coverage: {
              ...supplement().coverage,
              lap_hr_zones: {
                status: "unavailable",
                reason: "no-original-file",
              },
              running_dynamics: { status: "populated", reason: null },
            },
          }),
        }),
      ),
    );
    const text =
      document.querySelector(".activity-supplement-coverage")!.textContent ??
      "";
    expect(text).toContain("Lap HR zones: source unavailable");
    expect(text).toContain("Cadence and stride: stored");
    expect(text).toContain("Body Battery: not imported (unknown)");
  });

  it("keeps strength-training detail suppression when the only new evidence is absent", () => {
    render(
      view(
        payload(
          {
            supplement: supplement(),
            laps: [lap(1, null), lap(2, null)],
          },
          "strength_training",
        ),
      ),
    );
    expect(screen.queryByRole("columnheader", { name: "HR zones" })).toBeNull();
    expect(stats()).not.toMatch(/Body Battery change|cadence|stride/i);
  });
});
