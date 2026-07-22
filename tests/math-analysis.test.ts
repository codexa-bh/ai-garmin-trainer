import { describe, expect, it } from "vitest";
import { runMathAnalysis } from "../src/lib/ai/math-analysis";
import type { AnalysisRow } from "../src/lib/ai/sql-analysis";

function rowsByResult(rows: AnalysisRow[]) {
  return new Map<string, AnalysisRow[]>([["activity_rows", rows]]);
}

describe("bounded Garmin math analysis", () => {
  const rows: AnalysisRow[] = [
    {
      garmin_id: "run-1",
      name: "Hill run",
      duration_sec: 3600,
      elevation_gain_meters: 450,
      avg_heart_rate: 142,
    },
    {
      garmin_id: "ride-1",
      name: "Long ride",
      duration_sec: 7200,
      elevation_gain_meters: 900,
      avg_heart_rate: 136,
    },
  ];

  it("computes bounded score formulas and ranks top-N output", () => {
    const result = runMathAnalysis({
      inputResult: "activity_rows",
      operation: "score",
      formula: "duration_sec + elevation_gain_meters * 2 + avg_heart_rate",
      orderBy: [{ field: "score", direction: "desc" }],
      limit: 1,
      outputName: "demand_scores",
      rowsByResult: rowsByResult(rows),
    });

    expect(result.status).toBe("succeeded");
    expect(result.resultName).toBe("demand_scores");
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ garmin_id: "ride-1" });
    expect(result.rows[0].score).toBeGreaterThan(0);
    expect(result.truncated).toBe(true);
  });

  it("treats missing nullable score inputs as zero without rejecting a demand ranking", () => {
    const result = runMathAnalysis({
      inputResult: "activity_rows",
      operation: "score",
      formula:
        "duration_sec + distance_meters + elevation_gain_meters * 2 + avg_heart_rate",
      orderBy: [{ field: "score", direction: "desc" }],
      limit: 2,
      rowsByResult: rowsByResult([
        {
          garmin_id: "complete",
          duration_sec: 3600,
          elevation_gain_meters: 300,
          avg_heart_rate: 140,
        },
        {
          garmin_id: "missing_hr",
          duration_sec: 7200,
          elevation_gain_meters: null,
          avg_heart_rate: null,
        },
      ]),
    });

    expect(result.status).toBe("succeeded");
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toMatchObject({ garmin_id: "missing_hr" });
  });

  it("sport-normalized demand can surface a high-within-sport snowboarding activity", () => {
    const hikingRows = Array.from({ length: 11 }, (_, index) => ({
      garmin_id: `hike-${index + 1}`,
      name: `Absolute hike ${index + 1}`,
      sport: "hiking",
      duration_sec: 9000 - index * 120,
      distance_meters: 18000 - index * 300,
      elevation_gain_meters: 1500 - index * 20,
      calories: 900 - index * 10,
      avg_heart_rate: 135 - index,
      max_heart_rate: 165 - index,
      training_effect: 3.4,
    }));
    const snowboardRows: AnalysisRow[] = [
      {
        garmin_id: "snowboard-low",
        name: "Easy resort snowboarding",
        sport: "snowboarding",
        duration_sec: 1800,
        distance_meters: 4000,
        elevation_loss_meters: 300,
        calories: 200,
        avg_heart_rate: 95,
        max_heart_rate: 120,
        training_effect: 1.1,
      },
      {
        garmin_id: "snowboard-mid",
        name: "Normal resort snowboarding",
        sport: "snowboarding",
        duration_sec: 2400,
        distance_meters: 6000,
        elevation_loss_meters: 600,
        calories: 350,
        avg_heart_rate: 110,
        max_heart_rate: 135,
        training_effect: 1.7,
      },
      {
        garmin_id: "snowboard-high",
        name: "Hard resort snowboarding",
        sport: "snowboarding",
        duration_sec: 3600,
        distance_meters: 9000,
        elevation_loss_meters: 1000,
        calories: 520,
        avg_heart_rate: 128,
        max_heart_rate: 158,
        training_effect: 2.4,
      },
    ];
    const fixtureRows = [...hikingRows, ...snowboardRows];
    const absoluteTop10 = fixtureRows
      .map((row) => ({
        row,
        score:
          ((row.duration_sec as number | undefined) ?? 0) / 60 +
          (((row.distance_meters as number | undefined) ?? 0) / 1000) * 3 +
          ((row.elevation_gain_meters as number | undefined) ?? 0) * 0.8 +
          ((row.calories as number | undefined) ?? 0) * 0.05 +
          ((row.avg_heart_rate as number | undefined) ?? 0) * 0.2 +
          ((row.max_heart_rate as number | undefined) ?? 0) * 0.1 +
          ((row.training_effect as number | undefined) ?? 0) * 40,
      }))
      .sort((left, right) => right.score - left.score)
      .slice(0, 10);

    expect(absoluteTop10.map(({ row }) => row.garmin_id)).not.toContain(
      "snowboard-high",
    );

    const result = runMathAnalysis({
      inputResult: "activity_rows",
      operation: "sportNormalizedDemand",
      limit: 10,
      rowsByResult: rowsByResult(fixtureRows),
    });

    expect(result.status).toBe("succeeded");
    expect(result.rows.map((row) => row.garmin_id)).toContain("snowboard-high");
    expect(
      result.rows.find((row) => row.garmin_id === "snowboard-high"),
    ).toMatchObject({ sport_group: "snowboarding" });
  });

  it("sport-normalized demand excludes missing metrics from the denominator and records limitations", () => {
    const result = runMathAnalysis({
      inputResult: "activity_rows",
      operation: "sportNormalizedDemand",
      limit: 3,
      rowsByResult: rowsByResult([
        {
          garmin_id: "complete-ski",
          sport: "resort_snowboarding",
          duration_sec: 5400,
          distance_meters: 14000,
          elevation_loss_meters: 1400,
          calories: 700,
          avg_heart_rate: 132,
          training_effect: 2.6,
        },
        {
          garmin_id: "missing-hr-ski",
          sport: "resort_snowboarding",
          duration_sec: 5000,
          distance_meters: 12000,
          elevation_loss_meters: 1200,
          calories: null,
          avg_heart_rate: null,
          training_effect: null,
        },
        {
          garmin_id: "easy-ski",
          sport: "resort_snowboarding",
          duration_sec: 3000,
          distance_meters: 6000,
          elevation_loss_meters: 500,
          calories: 300,
          avg_heart_rate: 110,
          training_effect: 1.2,
        },
      ]),
    });

    const missing = result.rows.find(
      (row) => row.garmin_id === "missing-hr-ski",
    );
    expect(result.status).toBe("succeeded");
    expect(missing?.available_metric_count).toBeLessThan(8);
    expect(String(missing?.limitations)).toContain("missing metrics excluded");
    expect(String(missing?.limitations)).toContain("lift-assisted vertical");
  });

  it("sport-normalized demand falls back for sparse sports", () => {
    const result = runMathAnalysis({
      inputResult: "activity_rows",
      operation: "sportNormalizedDemand",
      limit: 4,
      rowsByResult: rowsByResult([
        {
          garmin_id: "hike-1",
          sport: "hiking",
          duration_sec: 7200,
          distance_meters: 12000,
          elevation_gain_meters: 1000,
        },
        {
          garmin_id: "hike-2",
          sport: "hiking",
          duration_sec: 3600,
          distance_meters: 6000,
          elevation_gain_meters: 400,
        },
        {
          garmin_id: "hike-3",
          sport: "hiking",
          duration_sec: 1800,
          distance_meters: 3000,
          elevation_gain_meters: 100,
        },
        {
          garmin_id: "paddle-1",
          sport: "paddling",
          duration_sec: 5400,
          distance_meters: 8000,
        },
      ]),
    });

    const sparse = result.rows.find((row) => row.garmin_id === "paddle-1");
    expect(result.status).toBe("succeeded");
    expect(String(sparse?.limitations)).toContain("sparse sport history");
    expect(sparse?.sport_normalized_demand_score).toEqual(expect.any(Number));
  });

  it("normalizes formulas and summarizes numeric columns", () => {
    const normalized = runMathAnalysis({
      inputResult: "activity_rows",
      operation: "normalize",
      formula: "duration_sec + elevation_gain_meters",
      limit: 2,
      rowsByResult: rowsByResult(rows),
    });
    expect(normalized.status).toBe("succeeded");
    expect(normalized.rows[0].normalizedScore).toBe(1);

    const summary = runMathAnalysis({
      inputResult: "activity_rows",
      operation: "summarize",
      limit: 10,
      rowsByResult: rowsByResult(rows),
    });
    expect(summary.status).toBe("succeeded");
    expect(summary.rows.map((row) => row.column)).toContain("duration_sec");
  });

  it("aggregates by categorical fields", () => {
    const result = runMathAnalysis({
      inputResult: "activity_rows",
      operation: "aggregate",
      groupBy: ["name"],
      limit: 10,
      rowsByResult: rowsByResult(rows),
    });

    expect(result.status).toBe("succeeded");
    expect(result.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Hill run", rowCount: 1 }),
      ]),
    );
  });

  it("rejects unsafe formulas, unknown columns, missing handles, and non-finite math", () => {
    expect(
      runMathAnalysis({
        inputResult: "missing",
        operation: "score",
        formula: "duration_sec",
        rowsByResult: rowsByResult(rows),
      }),
    ).toMatchObject({ status: "rejected", reason: "unknown_result" });
    expect(
      runMathAnalysis({
        inputResult: "activity_rows",
        operation: "score",
        formula: "duration_sec + secret_token",
        rowsByResult: rowsByResult(rows),
      }),
    ).toMatchObject({ status: "rejected", reason: "unknown_column" });
    expect(
      runMathAnalysis({
        inputResult: "activity_rows",
        operation: "score",
        formula: "duration_sec / (duration_sec - duration_sec)",
        rowsByResult: rowsByResult(rows),
      }),
    ).toMatchObject({ status: "rejected", reason: "non_numeric_column" });
  });
});
