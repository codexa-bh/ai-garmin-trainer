import { describe, expect, it } from "vitest";
import {
  ACTIVITY_DASHBOARD_GRADE_READOUT_WINDOW_SEC,
  ACTIVITY_DASHBOARD_SPEED_AVERAGE_WINDOW_SEC,
  buildActivityDashboardCharts,
  buildActivityDashboardRoute,
} from "../src/lib/analytics/activity-dashboard-calculations";
import type {
  ActivityDashboardChartRow,
  ActivityDashboardRoutePoint,
} from "../src/lib/analytics/activity-dashboard-calculations";

function row(
  elapsedSec: number,
  overrides: Partial<ActivityDashboardChartRow> = {},
): ActivityDashboardChartRow {
  return {
    elapsedSec,
    timestamp: null,
    distanceMeters: elapsedSec * 2,
    heartRate: 120,
    altitudeMeters: 100 + elapsedSec / 10,
    gradePct: 99,
    ...overrides,
  };
}

function routePoint(index: number): ActivityDashboardRoutePoint {
  return {
    elapsedSec: index,
    lat: index / 1000,
    lon: -index / 1000,
    altitudeMeters: index,
    gradePct: -3,
  };
}

function timestamp(seconds: number): string {
  return new Date(Date.UTC(2026, 0, 1, 0, 0, seconds)).toISOString();
}

describe("pure activity dashboard charts", () => {
  it("preserves the full empty contract and missing-speed message", () => {
    expect(buildActivityDashboardCharts([], null)).toEqual({
      downsampled: false,
      sourcePointCount: 0,
      pointCount: 0,
      maxPoints: 0,
      domainStartSec: 0,
      domainEndSec: 0,
      timeScaleStatus: "elapsed",
      timeScaleMessage: null,
      speed: {
        status: "missing_speed",
        sourcePointCount: 0,
        pointCount: 0,
        message:
          "Speed unavailable because this activity has no normalized cumulative-distance stream samples.",
      },
      points: [],
    });
  });

  it("keeps single-row gaps, duration rounding and input-only field omission", () => {
    const charts = buildActivityDashboardCharts([row(15)], 100.6);
    expect(charts.domainEndSec).toBe(101);
    expect(charts.speed).toEqual({
      status: "insufficient_speed",
      sourcePointCount: 1,
      pointCount: 0,
      message:
        "Speed unavailable because at least two reliable elapsed-time distance windows are needed.",
    });
    expect(charts.points).toEqual([
      {
        elapsedSec: 15,
        heartRate: 120,
        altitudeMeters: 101.5,
        speedKmh: null,
        gradePct: null,
      },
    ]);
  });

  it.each([
    { end: 61, expected: "sample_index_limited", domain: 1 },
    { end: 62, expected: "timestamp_derived", domain: 100 },
    { end: 120, expected: "timestamp_derived", domain: 120 },
  ])(
    "preserves the strict timestamp recovery threshold ($end)",
    ({ end, expected, domain }) => {
      const charts = buildActivityDashboardCharts(
        [
          row(0, { timestamp: timestamp(0) }),
          row(1, { timestamp: timestamp(end) }),
        ],
        100,
      );
      expect(charts.timeScaleStatus).toBe(expected);
      expect(charts.domainEndSec).toBe(domain);
      expect(charts.points[1].elapsedSec).toBe(
        expected === "timestamp_derived" ? end : 1,
      );
    },
  );

  it.each([null, "invalid", timestamp(-1)])(
    "rejects unavailable/invalid/decreasing timestamp evidence (%s)",
    (end) => {
      const charts = buildActivityDashboardCharts(
        [row(0, { timestamp: timestamp(0) }), row(1, { timestamp: end })],
        100,
      );
      expect(charts.timeScaleStatus).toBe("sample_index_limited");
      expect(charts.timeScaleMessage).toBe(
        "Chart timing is limited to the available sample-index stream because no safe elapsed or timestamp evidence is available.",
      );
      expect(charts.points.map((point) => point.elapsedSec)).toEqual([0, 1]);
    },
  );

  it("allows duplicate recovered timestamps but gaps unreliable speed and grade", () => {
    const charts = buildActivityDashboardCharts(
      [
        row(0, { timestamp: timestamp(0) }),
        row(1, { timestamp: timestamp(180) }),
        row(2, { timestamp: timestamp(180) }),
      ],
      null,
    );
    expect(charts.timeScaleMessage).toBe(
      "Chart timing is derived from record timestamps because stored elapsed samples were index-like.",
    );
    expect(charts.points.map((point) => point.elapsedSec)).toEqual([
      0, 180, 180,
    ]);
    expect(charts.points.map((point) => point.speedKmh)).toEqual([
      null,
      null,
      null,
    ]);
    // The original grade window stops at the first matching endpoint; the duplicate
    // outside that window does not invalidate its grade calculation.
    expect(charts.points.map((point) => point.gradePct)).toEqual([
      expect.closeTo(5),
      expect.closeTo(5),
      expect.closeTo(5),
    ]);
  });

  it.each([null, 0, -1, 0.4])(
    "does not stretch sample timing for absent/short duration (%s)",
    (duration) => {
      const charts = buildActivityDashboardCharts([row(0), row(1)], duration);
      expect(charts.timeScaleStatus).toBe("elapsed");
      expect(charts.domainEndSec).toBe(1);
    },
  );

  it("keeps the sample-index duration and density thresholds", () => {
    expect(
      buildActivityDashboardCharts([row(0), row(1)], 2).timeScaleStatus,
    ).toBe("elapsed");
    expect(
      buildActivityDashboardCharts([row(0), row(3)], 100).timeScaleStatus,
    ).toBe("elapsed");
    expect(
      buildActivityDashboardCharts([row(0), row(1)], 3).timeScaleStatus,
    ).toBe("sample_index_limited");
  });

  it("preserves the inclusive trailing 60-second window, true stops and metadata", () => {
    expect(ACTIVITY_DASHBOARD_SPEED_AVERAGE_WINDOW_SEC).toBe(60);
    const charts = buildActivityDashboardCharts(
      [
        row(0),
        row(30, { distanceMeters: 0 }),
        row(60, { distanceMeters: 60 }),
        row(61, { distanceMeters: 62 }),
      ],
      null,
    );
    expect(charts.points.map((point) => point.speedKmh)).toEqual([
      null,
      0,
      3.6,
      7.2,
    ]);
    expect(charts.speed).toEqual({
      status: "available",
      sourcePointCount: 4,
      pointCount: 3,
      message:
        "Speed uses a 60-second moving average derived from normalized cumulative distance and elapsed time.",
    });
  });

  it.each([null, Number.NaN, Infinity, -1])(
    "gaps missing/nonfinite/decreasing distance without fallback (%s)",
    (distanceMeters) => {
      const charts = buildActivityDashboardCharts(
        [row(0), row(30, { distanceMeters }), row(60)],
        null,
      );
      expect(charts.points.map((point) => point.speedKmh)).toEqual([
        null,
        null,
        null,
      ]);
      expect(charts.speed.status).toBe("insufficient_speed");
      expect(charts.speed.sourcePointCount).toBe(distanceMeters === -1 ? 3 : 2);
    },
  );

  it.each([
    [0, 0, 30],
    [0, 30, 20],
    [0, 61, 122],
    [0, Infinity, 30],
  ])(
    "gaps duplicate, reversed, sparse or nonfinite elapsed windows (%s)",
    (...elapsed) => {
      const charts = buildActivityDashboardCharts(
        elapsed.map((time, index) => row(time, { distanceMeters: index * 60 })),
        null,
      );
      expect(charts.points[2].speedKmh).toBeNull();
      expect(charts.speed.status).toBe("insufficient_speed");
    },
  );

  it.each([5, -5, 0])(
    "preserves signed grade and shifted start/end 180-second windows (%s)",
    (grade) => {
      expect(ACTIVITY_DASHBOARD_GRADE_READOUT_WINDOW_SEC).toBe(180);
      const rows = [0, 60, 120, 180, 240].map((time) =>
        row(time, { altitudeMeters: 100 + (time * 2 * grade) / 100 }),
      );
      const charts = buildActivityDashboardCharts(rows, null);
      expect(charts.points.map((point) => point.gradePct)).toEqual(
        Array(5).fill(grade),
      );
    },
  );

  it.each([
    [row(0), row(179)],
    [row(0), row(180, { altitudeMeters: null })],
    [row(0), row(180, { altitudeMeters: Infinity })],
    [row(0), row(180, { distanceMeters: null })],
    [row(0), row(180, { distanceMeters: Number.NaN })],
    [row(0), row(180, { distanceMeters: 0 })],
    [row(0), row(180, { distanceMeters: -1 })],
    [row(0), row(120), row(60), row(180)],
  ])("rejects insufficient or unsafe grade evidence", (...rows) => {
    expect(
      buildActivityDashboardCharts(rows, null).points.every(
        (point) => point.gradePct === null,
      ),
    ).toBe(true);
  });

  it("starts grade at the last point on the window boundary, preserving duplicate-start behavior", () => {
    const charts = buildActivityDashboardCharts(
      [row(0), row(0), row(180)],
      null,
    );
    expect(charts.points.map((point) => point.gradePct)).toEqual([5, 5, 5]);
  });

  it("does not mutate frozen input or downsample charts", () => {
    const rows = Array.from({ length: 401 }, (_, index) => row(index));
    const before = structuredClone(rows);
    rows.forEach(Object.freeze);
    Object.freeze(rows);
    const charts = buildActivityDashboardCharts(rows, null);
    expect(rows).toEqual(before);
    expect(charts).toMatchObject({
      downsampled: false,
      sourcePointCount: 401,
      pointCount: 401,
      maxPoints: 401,
    });
    expect(charts.points[400].elapsedSec).toBe(400);
    for (const point of charts.points) {
      expect(Object.keys(point).sort()).toEqual([
        "altitudeMeters",
        "elapsedSec",
        "gradePct",
        "heartRate",
        "speedKmh",
      ]);
    }
  });
});

describe("pure activity dashboard routes", () => {
  it("preserves exact missing and single-point contracts after finite-coordinate filtering", () => {
    const rejected = [
      { ...routePoint(0), lat: Number.NaN },
      { ...routePoint(0), lon: Infinity },
    ];
    expect(buildActivityDashboardRoute(rejected)).toEqual({
      status: "missing_gps",
      sourcePointCount: 0,
      pointCount: 0,
      maxPoints: 400,
      simplified: false,
      bounds: null,
      points: [],
      message:
        "Route unavailable because this activity has no normalized GPS stream points.",
    });
    expect(buildActivityDashboardRoute([...rejected, routePoint(0)])).toEqual({
      status: "insufficient_points",
      sourcePointCount: 1,
      pointCount: 1,
      maxPoints: 400,
      simplified: false,
      bounds: {
        minLat: 0,
        maxLat: 0,
        minLon: -0,
        maxLon: -0,
        minAltitudeMeters: 0,
        maxAltitudeMeters: 0,
      },
      points: [routePoint(0)],
      message:
        "Route unavailable because at least two normalized GPS points are needed to draw a route.",
    });
  });

  it("ignores missing/nonfinite altitudes for bounds without changing route point values", () => {
    const points = [null, Number.NaN, Infinity].map(
      (altitudeMeters, index) => ({ ...routePoint(index), altitudeMeters }),
    );
    const route = buildActivityDashboardRoute(points);
    expect(route.bounds).toMatchObject({
      minAltitudeMeters: null,
      maxAltitudeMeters: null,
    });
    expect(route.points).toEqual(points);
    expect(route.message).toBe("Showing 3 normalized GPS stream points.");
  });

  it.each([400, 401, 1001])(
    "preserves sampling indices, full bounds and endpoints for %s points",
    (count) => {
      const points = Array.from({ length: count }, (_, index) =>
        routePoint(index),
      );
      // At 401 points index 200 is unsampled; bounds must still include it.
      points[200] = { ...points[200], lat: 80, lon: -80, altitudeMeters: -500 };
      const before = structuredClone(points);
      points.forEach(Object.freeze);
      Object.freeze(points);
      const route = buildActivityDashboardRoute(points);
      expect(route).toMatchObject({
        status: "available",
        sourcePointCount: count,
        pointCount: 400,
        maxPoints: 400,
        simplified: count > 400,
      });
      expect(route.points).toEqual(
        Array.from(
          { length: 400 },
          (_, index) => points[Math.round((index / 399) * (count - 1))],
        ),
      );
      expect(route.points[0]).toEqual(points[0]);
      expect(route.points[399]).toEqual(points[count - 1]);
      expect(route.bounds).toEqual({
        minLat: 0,
        maxLat: 80,
        minLon: -80,
        maxLon: -0,
        minAltitudeMeters: -500,
        maxAltitudeMeters: count - 1,
      });
      expect(route.message).toBe(
        count > 400
          ? `Showing ${(400).toLocaleString()} representative route points from ${count.toLocaleString()} normalized GPS stream points.`
          : "Showing 400 normalized GPS stream points.",
      );
      expect(points).toEqual(before);
    },
  );
});
