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

import type { SplitHeartRate } from "../src/lib/local-data/split-heart-rate";

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

const bucket = (index: number, seconds: number) => ({
  bucket: index,
  kind: index === 0 ? ("below" as const) : ("zone" as const),
  zone: index === 0 ? null : index,
  seconds,
  lowerBpm: index === 0 ? null : 80 + index * 20,
  upperBpm: index === 5 ? null : 99 + index * 20,
});
const derivedHr = (avgHeartRate: number, seconds = [0, 0, 20, 70, 5, 0]) => ({
  avgHeartRate,
  supportSeconds: 95,
  windowSeconds: 95,
  hasLongGap: false,
  unavailableReason: null,
  zones: {
    buckets: seconds.map((value, i) => bucket(i, value)),
    unavailableReason: null,
  },
});
const unavailableHr = (
  reason: NonNullable<SplitHeartRate["unavailableReason"]>,
  zoneReason: "heart-rate-unavailable" = "heart-rate-unavailable",
) => ({
  avgHeartRate: null,
  supportSeconds: null,
  windowSeconds: 95,
  hasLongGap: null,
  unavailableReason: reason,
  zones: { buckets: null, unavailableReason: zoneReason },
});

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
    expect(text).toContain("Cadence158 steps/min");
    expect(text).toContain("Stride length104.5 cm");
    // The list maximum stays stored but is never presented.
    expect(text).not.toMatch(/max cadence|171\.5|Garmin list/i);
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
    rerender(
      view(
        payload({
          supplement: supplement({
            listCadence: { avgSpm: 0, maxSpm: 0, strideLengthCm: 61.54 },
          }),
        }),
      ),
    );
    expect(stats()).toContain("Cadence0 steps/min");
    expect(stats()).toContain("Stride length61.5 cm");
    expect(stats()).not.toMatch(/max cadence/i);
    rerender(
      view(
        payload({
          supplement: supplement({
            listCadence: { avgSpm: null, maxSpm: 231, strideLengthCm: null },
          }),
        }),
      ),
    );
    expect(stats()).not.toMatch(/cadence|stride|231/i);
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
    // One source-labelled compact line replaces the aggregate table; runs
    // precede lifts regardless of read order, from stored per-type totals.
    const line = section.querySelector(".snow-summary-line")!;
    expect(line.textContent).toBe(
      "Garmin totalsRuns 10 · 1h 7m · 51 km|Lifts 9 · 50m · 12 km",
    );
    expect(section.querySelector("table")).toBeNull();
    expect(section.textContent).not.toMatch(
      /Longest single split|Totals over the whole activity|Garmin per-type totals|Snow runs|not been imported/,
    );
    expect(
      within(section).queryByRole("table", { name: /Snow runs/ }),
    ).toBeNull();
  });

  it("omits an absent type and shows missing fields as dashes while keeping true zero", () => {
    const row = (splitType: string, over: object) => ({
      splitType,
      count: 0,
      durationSec: 0,
      distanceMeters: 0,
      bestSplitDistanceMeters: null,
      maxSpeedMps: null,
      ...over,
    });
    const lineFor = (snowTotals: ReturnType<typeof row>[]) => {
      const { unmount } = render(
        view(payload({ supplement: supplement({ snowTotals }) }, "skiing")),
      );
      const text =
        document.querySelector(".snow-summary-line")?.textContent ?? null;
      unmount();
      return text;
    };
    expect(
      lineFor([row("SKI_LIFT_SPLIT", { count: 4, durationSec: 600 })]),
    ).toBe("Garmin totalsLifts 4 · 10m · 0 m");
    expect(
      lineFor([
        row("SKI_RUN_SPLIT", {
          count: null,
          durationSec: null,
          distanceMeters: null,
        }),
      ]),
    ).toBe("Garmin totalsRuns — · — · —");
    // Other stored per-type rows never appear; with none of the two, no section.
    expect(lineFor([row("ASCENT_SPLIT", { count: 3 })])).toBeNull();
    expect(lineFor([])).toBeNull();
  });

  it("lists only measured run fields with nullable metrics and discloses defensive truncation", () => {
    const entries = [
      {
        splitKey: "index:1",
        avgSpeedMps: 10,
        timerSeconds: 95,
        distanceMeters: 1250,
        descentMeters: 210,
        ascentMeters: 3,
        maxSpeedMps: 20,
        heartRate: derivedHr(143.6),
      },
      {
        splitKey: "index:2",
        avgSpeedMps: null,
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
      name: /Snow runs — showing the first 2 of 75/,
    });
    const rows = Array.from(list.querySelectorAll("tbody tr"));
    // Ascent is removed; Avg HR is the derived time-weighted value.
    expect(rows[0].children[6].textContent).toBe("144");
    expect(
      [...rows[0].children].slice(0, 6).map((cell) => cell.textContent),
    ).toEqual(["1", "1m 35s", "1.25 km", "210 m", "36 km/h", "72 km/h"]);
    // Missing metrics are dashes, and a measured zero descent stays zero.
    expect(
      [...rows[1].children].slice(0, 7).map((cell) => cell.textContent),
    ).toEqual(["2", "—", "—", "0 m", "—", "—", "—"]);
    expect(
      within(list).queryByRole("columnheader", { name: "Type" }),
    ).toBeNull();
    expect(
      within(list)
        .getAllByRole("columnheader")
        .map((cell) => cell.textContent),
    ).toEqual([
      "Run",
      "Timer duration",
      "Distance",
      "Descent",
      "Avg speed",
      "Max speed",
      "Avg HR (bpm)",
      "HR zones",
    ]);
    // Visible derived provenance; never the lap-recorded wording.
    const section = screen.getByLabelText("Run and lift summary");
    expect(section.textContent).toMatch(/derived from HR samples/i);
    expect(section.textContent).toMatch(
      /separate from Garmin lap and session totals/,
    );
    expect(section.textContent).not.toContain("Recorded per lap");
  });

  it("renders no snow section for any empty-run coverage state on a snow activity", () => {
    for (const status of [
      "failed",
      "unavailable",
      "empty",
      "populated",
      "not_imported",
    ] as const) {
      for (const relevant of [true, false]) {
        render(
          view(
            payload(
              {
                supplement: supplement({
                  snowRuns: {
                    relevant,
                    total: 0,
                    returned: 0,
                    truncated: false,
                    entries: [],
                  },
                  coverage: {
                    ...supplement().coverage,
                    snowboard_splits: { status, reason: null },
                    snow_run_lift_splits: {
                      status,
                      reason: "unsupported-sport",
                    },
                  },
                }),
              },
              "resort_snowboarding",
            ),
          ),
        );
        expect(screen.queryByLabelText("Run and lift summary")).toBeNull();
        const withoutDisclosure = document.body.cloneNode(true) as HTMLElement;
        withoutDisclosure
          .querySelector(".activity-supplement-coverage")
          ?.remove();
        expect(withoutDisclosure.textContent).not.toMatch(
          /Runs and lifts|Snow runs|per-type totals|not been imported|coverage unknown/i,
        );
        // The separate disclosure still reports the truthful coverage.
        expect(
          document.querySelector(".activity-supplement-coverage"),
        ).toBeTruthy();
        cleanup();
      }
    }
  });

  it.each([
    ["unproven-sample-timezone", "HR sample time zone unproven"],
    ["invalid-sample-time", "HR sample times unavailable"],
    ["no-heart-rate-samples", "No stored HR samples"],
    ["no-window-samples", "No samples in run window"],
    ["no-usable-heart-rate", "No usable HR measurements"],
    ["insufficient-samples", "Too few HR samples"],
    ["insufficient-support", "HR coverage too low"],
  ] as const)(
    "shows closed reason %s without raw diagnostics or a zero HR",
    (reason, text) => {
      render(
        view(
          payload(
            {
              supplement: supplement({
                snowRuns: {
                  total: 1,
                  returned: 1,
                  truncated: false,
                  entries: [
                    {
                      splitKey: "index:8",
                      timerSeconds: 10,
                      distanceMeters: 0,
                      ascentMeters: 0,
                      descentMeters: 0,
                      avgSpeedMps: 0,
                      maxSpeedMps: 0,
                      heartRate: unavailableHr(reason),
                    },
                  ],
                },
              }),
            },
            "alpine_skiing",
          ),
        ),
      );
      const cells = screen
        .getByRole("table", { name: "Snow runs" })
        .querySelector("tbody tr")!.children;
      expect(cells[6].textContent).toBe("—");
      expect(cells[7].textContent).toBe(text);
    },
  );

  it.each([
    [0, "0s"],
    [0.4, "0.4s"],
    [12.5, "12.5s"],
    [59.96, "1m 0s"],
    [3599.96, "1h 0m 0s"],
    [3661.2, "1h 1m 1.2s"],
    [null, "—"],
    [Infinity, "—"],
  ])(
    "shows one run and rounds timer %s with correct carry",
    (timerSeconds, expected) => {
      const entry = {
        splitKey: "index:8",
        timerSeconds,
        distanceMeters: 0,
        ascentMeters: 0.5,
        descentMeters: null,
        avgSpeedMps: null,
        maxSpeedMps: 0,
        heartRate: unavailableHr("no-heart-rate-samples"),
      };
      render(
        view(
          payload(
            {
              supplement: supplement({
                snowRuns: {
                  total: 1,
                  returned: 1,
                  truncated: false,
                  entries: [entry],
                },
              }),
            },
            "alpine_skiing",
          ),
        ),
      );
      const table = screen.getByRole("table", { name: "Snow runs" });
      const row = table.querySelector("tbody tr")!;
      expect([...row.children].map((cell) => cell.textContent)).toEqual([
        "1",
        expected,
        "0 km",
        "—",
        "—",
        "0 km/h",
        "—",
        "No stored HR samples",
      ]);
      expect(screen.getByRole("status").textContent).toContain(
        "Showing preserved runs",
      );
    },
  );

  it.each([
    "not_imported",
    "failed",
    "empty",
    "unavailable",
    "populated",
  ] as const)(
    "keeps preserved rows inspectable without upgrading latest %s coverage",
    (status) => {
      const entry = {
        splitKey: "index:1",
        timerSeconds: 20,
        distanceMeters: 900,
        ascentMeters: null,
        descentMeters: null,
        avgSpeedMps: null,
        maxSpeedMps: null,
      };
      render(
        view(
          payload(
            {
              supplement: supplement({
                snowRuns: {
                  total: 1,
                  returned: 1,
                  truncated: false,
                  entries: [entry],
                },
                coverage: {
                  ...supplement().coverage,
                  snow_run_lift_splits: {
                    status,
                    reason: "/private/untrusted-text",
                  },
                },
              }),
            },
            "skate_skiing",
          ),
        ),
      );
      // Runs-only: no empty per-type totals heading or helper.
      expect(
        screen.queryByRole("heading", { name: "Runs and lifts" }),
      ).toBeNull();
      expect(document.querySelector(".snow-summary-line")).toBeNull();
      expect(
        screen
          .getByRole("table", { name: "Snow runs" })
          .querySelectorAll("tbody tr"),
      ).toHaveLength(1);
      expect(!!screen.queryByRole("status")).toBe(status !== "populated");
      expect(document.body.textContent).not.toContain(
        "/private/untrusted-text",
      );
    },
  );

  it("admits snow by normalized sport only and follows selection snow→non-snow→snow", () => {
    const totalRow = {
      splitType: "SKI_LIFT_SPLIT",
      count: 0,
      durationSec: 0,
      distanceMeters: null,
      bestSplitDistanceMeters: null,
      maxSpeedMps: null,
    };
    const runEntry = {
      splitKey: "index:1",
      timerSeconds: 30,
      distanceMeters: 400,
      ascentMeters: null,
      descentMeters: null,
      avgSpeedMps: null,
      maxSpeedMps: null,
    };
    const populated = (sport: string, name: string | null = null) =>
      view(
        payload(
          {
            supplement: supplement({
              snowTotals: [totalRow],
              snowRuns: {
                relevant: true,
                total: 1,
                returned: 1,
                truncated: false,
                entries: [runEntry],
              },
              coverage: {
                ...supplement().coverage,
                snowboard_splits: { status: "populated", reason: null },
                snow_run_lift_splits: { status: "populated", reason: null },
              },
            }),
            ...(name
              ? { activity: { ...payload().activity, sport, name } }
              : {}),
          },
          sport,
        ),
      );
    const { rerender } = render(populated("resort_skiing"));
    // Both parts render; a lifts-only aggregate with zero values is real data.
    expect(document.querySelector(".snow-summary-line")).toBeTruthy();
    expect(screen.getByRole("table", { name: "Snow runs" })).toBeTruthy();
    for (const sport of [
      "hiking",
      "walking",
      "running",
      "cycling",
      "strength_training",
    ]) {
      rerender(populated(sport));
      expect(screen.queryByLabelText("Run and lift summary")).toBeNull();
    }
    // A snow-looking title does not admit an unrecognized sport.
    rerender(populated("hiking", "Powder day snowboard"));
    expect(screen.queryByLabelText("Run and lift summary")).toBeNull();
    rerender(populated("backcountry_snowboarding"));
    expect(screen.getByRole("table", { name: "Snow runs" })).toBeTruthy();
  });

  it("shows derived HR zones with exact Times, honest unavailable states and a valid all-zero bucket distinct", () => {
    const entry = (key: string, heartRate: object | undefined) => ({
      splitKey: key,
      timerSeconds: 95,
      distanceMeters: 1000,
      ascentMeters: 1,
      descentMeters: 200,
      avgSpeedMps: 10,
      maxSpeedMps: 20,
      heartRate: heartRate as never,
    });
    render(
      view(
        payload(
          {
            supplement: supplement({
              snowRuns: {
                total: 4,
                returned: 4,
                truncated: false,
                entries: [
                  entry("index:1", {
                    ...derivedHr(150),
                    windowSeconds: 118.75,
                    hasLongGap: true,
                  }),
                  entry("index:2", unavailableHr("insufficient-support")),
                  entry("index:3", {
                    ...derivedHr(120),
                    windowSeconds: 118.75,
                    hasLongGap: true,
                    zones: {
                      buckets: null,
                      unavailableReason: "missing-zone-boundaries",
                    },
                  }),
                  entry("index:4", undefined),
                ],
              },
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
    const rows = Array.from(
      screen
        .getByRole("table", { name: /Snow runs/ })
        .querySelectorAll("tbody tr"),
    );
    const hr = (i: number) => rows[i].children[6].textContent;
    const zones = (i: number) => rows[i].children[7];
    expect(hr(0)).toBe("150");
    const group = zones(0).querySelector(".lap-zone-cell[role=group]")!;
    expect(group.getAttribute("aria-label")).toContain("Run HR zones");
    expect(group.getAttribute("aria-label")).toContain(
      "Zone 2 (120–139 bpm): 20s · Zone 3 (140–159 bpm): 1m 10s · Zone 4 (160–179 bpm): 5s · Zone 5 (180–max bpm): 0s",
    );
    expect(zones(0).querySelector("details summary")!.textContent).toBe(
      "Times",
    );
    expect(zones(0).textContent).toContain(
      "Derived from HR samples in this run",
    );
    expect(zones(0).textContent).not.toContain("Recorded per lap");
    expect(hr(1)).toBe("—");
    expect(zones(1).textContent).toBe("HR coverage too low");
    // Avg HR can survive when only the zone limits are unavailable.
    expect(hr(2)).toBe("120");
    expect(zones(2).textContent).toContain("Activity zone limits unavailable");
    for (const i of [0, 2]) {
      expect(zones(i).textContent).toContain(
        "HR measured 1m 35s of 1m 58.8s · partial",
      );
      expect(zones(i).textContent).toContain("HR gaps; supported time only");
      expect(
        zones(i).querySelector('[aria-label="Run HR support"]'),
      ).toBeTruthy();
    }
    expect(zones(0).querySelector("details")!.textContent).toContain(
      "supported HR time only, not the full run",
    );
    expect(hr(3)).toBe("—");
    expect(zones(3).textContent).toBe("Unavailable");
    // A supported all-zero derivation is a labelled bucket set, not a reason.
    cleanup();
    render(
      view(
        payload(
          {
            supplement: supplement({
              snowRuns: {
                total: 1,
                returned: 1,
                truncated: false,
                entries: [entry("index:1", derivedHr(0, [0, 0, 0, 0, 0, 0]))],
              },
            }),
          },
          "resort_snowboarding",
        ),
      ),
    );
    expect(
      document
        .querySelector(".snow-runs tbody tr")!
        .children[7].querySelector("summary")!.textContent,
    ).toBe("All zero");
  });

  describe("conditional lap details", () => {
    const lapTable = () => screen.queryByRole("table", { name: "Lap details" });
    const runs = {
      total: 1,
      returned: 1,
      truncated: false,
      entries: [
        {
          splitKey: "index:1",
          timerSeconds: 30,
          distanceMeters: 400,
          ascentMeters: null,
          descentMeters: null,
          avgSpeedMps: null,
          maxSpeedMps: null,
        },
      ],
    };

    it.each([
      "populated",
      "failed",
      "empty",
      "unavailable",
      "not_imported",
    ] as const)(
      "hides redundant laps for normalized snow with stored runs under %s coverage",
      (status) => {
        render(
          view(
            payload(
              {
                supplement: supplement({
                  snowRuns: runs,
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
        expect(lapTable()).toBeNull();
        expect(screen.getByRole("table", { name: "Snow runs" })).toBeTruthy();
        expect(!!screen.queryByRole("status")).toBe(status !== "populated");
      },
    );

    it("keeps laps for snow without runs, totals-only, non-snow with stray runs and strength", () => {
      const total = {
        splitType: "SKI_RUN_SPLIT",
        count: 3,
        durationSec: 600,
        distanceMeters: 3000,
        bestSplitDistanceMeters: null,
        maxSpeedMps: null,
      };
      for (const [sport, sup] of [
        ["resort_snowboarding", supplement()],
        ["resort_snowboarding", supplement({ snowTotals: [total] })],
        [
          "resort_snowboarding",
          supplement({
            snowRuns: { ...runs, entries: [], returned: 0, relevant: true },
          }),
        ],
        ["running", supplement({ snowRuns: runs })],
        ["strength_training", supplement({ snowRuns: runs })],
      ] as const) {
        render(view(payload({ supplement: sup }, sport)));
        expect(lapTable(), `${sport}`).toBeTruthy();
        cleanup();
      }
    });
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
