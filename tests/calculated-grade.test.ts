import { describe, expect, it } from "vitest";
import {
  calculateGradeSections,
  GRADE_MAX_POINTS,
  type GradeSample,
} from "../src/lib/ai/analytics/calculated-grade";

function samples(slope = 0.1, seconds = 360): GradeSample[] {
  return Array.from({ length: seconds / 15 + 1 }, (_, i) => ({
    timestamp: new Date(Date.UTC(2026, 0, 1) + i * 15_000).toISOString(),
    distance_meters: i * 30,
    altitude_meters: 100 + i * 30 * slope,
    grade_pct: null,
  }));
}

describe("timestamp-validated calculated grade sections", () => {
  it.each([0.1, -0.1, 0])(
    "derives signed %s slope without mutating source",
    (slope) => {
      const points = samples(slope).map((point) => Object.freeze(point));
      Object.freeze(points);
      const result = calculateGradeSections(points);
      expect(result).toHaveLength(2);
      for (const [i, row] of result.entries()) {
        expect(row).toMatchObject({
          window_index: i,
          start_elapsed_sec: i * 180,
          end_elapsed_sec: (i + 1) * 180,
          calculated_grade_pct: slope * 100,
          grade_method: "altitude_distance_sections_v1",
          target_window_sec: 180,
          support_seconds: 180,
          support_distance_meters: 360,
          sample_count: 13,
          usable_sample_count: 13,
          source_grade_sample_count: 0,
          quality_status: "available",
        });
      }
      expect(points.every((point) => point.grade_pct === null)).toBe(true);
    },
  );

  it("keeps imported grade separate and supports short/final sections only with minimum support", () => {
    const points = samples(0.1, 240).map((point) => ({
      ...point,
      grade_pct: -27,
    }));
    expect(calculateGradeSections(points)).toMatchObject([
      { calculated_grade_pct: 10, source_grade_sample_count: 13 },
      {
        calculated_grade_pct: 10,
        support_seconds: 60,
        source_grade_sample_count: 5,
      },
    ]);
    expect(calculateGradeSections(samples(0.1, 45))[0]).toMatchObject({
      calculated_grade_pct: null,
      quality_status: "insufficient_time",
    });
    expect(
      calculateGradeSections(samples(0.1, 60))[0].calculated_grade_pct,
    ).toBe(10);
  });

  it.each([
    ["missing altitude", { altitude_meters: null }, "missing_values"],
    ["nonfinite altitude", { altitude_meters: Infinity }, "missing_values"],
    ["missing distance", { distance_meters: null }, "missing_values"],
    ["nonfinite distance", { distance_meters: NaN }, "missing_values"],
    ["negative distance", { distance_meters: -1 }, "missing_values"],
    ["distance reset", { distance_meters: 0 }, "distance_reset"],
    ["missing timestamp", { timestamp: null }, "invalid_timing"],
    ["invalid timestamp", { timestamp: "not-a-date" }, "invalid_timing"],
    [
      "timezone-less timestamp",
      { timestamp: "2026-01-01T00:00:30" },
      "invalid_timing",
    ],
    [
      "duplicate timestamp",
      { timestamp: "2026-01-01T00:00:15Z" },
      "invalid_timing",
    ],
    [
      "reversed timestamp",
      { timestamp: "2025-12-31T23:59:59Z" },
      "invalid_timing",
    ],
  ] as const)(
    "rejects %s without hiding partial coverage",
    (_label, patch, reason) => {
      const points = samples();
      points[2] = { ...points[2], ...patch };
      const result = calculateGradeSections(points);
      expect(result[0]).toMatchObject({
        calculated_grade_pct: null,
        quality_status: reason,
      });
      expect(result[1]).toMatchObject({
        calculated_grade_pct: 10,
        quality_status: "available",
      });
    },
  );

  it("rejects internal long gaps even with good endpoints; irregular <=30s sampling works", () => {
    const points = samples();
    points.splice(2, 2);
    expect(calculateGradeSections(points)[0]).toMatchObject({
      calculated_grade_pct: null,
      quality_status: "sampling_gap",
    });
    const irregular = samples();
    irregular.splice(2, 1);
    expect(calculateGradeSections(irregular)[0].calculated_grade_pct).toBe(10);
  });

  it("accepts known Garmin calendar timestamps as relative clock evidence, independently of host timezone", () => {
    const points = samples().map((point) => ({
      ...point,
      timestamp: point.timestamp!.replace("T", " ").replace(".000Z", ""),
    }));
    expect(
      calculateGradeSections(points).map((row) => row.calculated_grade_pct),
    ).toEqual([10, 10]);
    points[2].timestamp = "2026-02-30 00:00:30";
    expect(calculateGradeSections(points)[0].quality_status).toBe(
      "invalid_timing",
    );
    const offset = samples().map((point) => ({
      ...point,
      timestamp: point.timestamp!.replace("Z", "+02:00"),
    }));
    expect(
      calculateGradeSections(offset).map((row) => row.support_seconds),
    ).toEqual([180, 180]);
  });

  it("requires positive net distance but allows stationary internal samples", () => {
    for (const net of [0, 9]) {
      const points = samples().map((point, i) => ({
        ...point,
        distance_meters: (i * net) / 24,
      }));
      expect(calculateGradeSections(points)[0]).toMatchObject({
        calculated_grade_pct: null,
        quality_status: "insufficient_distance",
      });
    }
    const points = samples();
    points[2].distance_meters = points[1].distance_meters;
    expect(calculateGradeSections(points)[0].calculated_grade_pct).toBe(10);
  });

  it("never stretches indexes to time; handles no/sparse streams and timestamp-anchor recovery", () => {
    expect(calculateGradeSections([])[0]).toMatchObject({
      calculated_grade_pct: null,
      quality_status: "no_stream",
      sample_count: 0,
    });
    expect(
      calculateGradeSections(samples().slice(0, 1))[0].calculated_grade_pct,
    ).toBeNull();
    expect(
      calculateGradeSections(
        samples().map((point) => ({ ...point, timestamp: null })),
      )[0],
    ).toMatchObject({
      calculated_grade_pct: null,
      quality_status: "invalid_timing",
    });
    const points = samples();
    points[0].timestamp = null;
    const result = calculateGradeSections(points);
    expect(result[0].quality_status).toBe("invalid_timing");
    expect(result.some((row) => row.quality_status === "available")).toBe(true);
  });

  it("does not extrapolate edges or hide input truncation", () => {
    const points = samples(0.1, 195);
    points[12].timestamp = "2026-01-01T00:03:01Z";
    const result = calculateGradeSections(points);
    expect(result[0].support_seconds).toBe(181);
    expect(result[1].calculated_grade_pct).toBeNull();
    const capped = Array.from(
      { length: GRADE_MAX_POINTS + 1 },
      () => points[0],
    );
    expect(calculateGradeSections(capped)).toMatchObject([
      {
        calculated_grade_pct: null,
        quality_status: "input_limit",
        sample_count: GRADE_MAX_POINTS + 1,
      },
    ]);
  });
});
