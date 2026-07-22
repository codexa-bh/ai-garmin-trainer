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

  it("computes model-selected bounded score formulas and ranks top-N output", () => {
    const result = runMathAnalysis({
      inputResult: "activity_rows",
      operation: "score",
      formula: "duration_sec + elevation_gain_meters * 2 + avg_heart_rate",
      orderBy: [{ field: "score", direction: "desc" }],
      limit: 1,
      outputName: "criteria_scores",
      rowsByResult: rowsByResult(rows),
    });

    expect(result.status).toBe("succeeded");
    expect(result.resultName).toBe("criteria_scores");
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ garmin_id: "ride-1" });
    expect(result.rows[0].score).toBeGreaterThan(0);
    expect(result.truncated).toBe(true);
  });

  it("treats missing nullable score inputs as zero for model-selected criteria", () => {
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

  it("accepts common model-selected result and column aliases without adding demand-specific fields", () => {
    const result = runMathAnalysis({
      inputResult: "activityRows",
      operation: "normalize",
      formula: "duration + elevation_gain + avg_hr",
      orderBy: [{ field: "normalized_score", direction: "desc" }],
      limit: 2,
      rowsByResult: rowsByResult(rows),
    });

    expect(result.status).toBe("succeeded");
    expect(result.rows[0].normalizedScore).toBe(1);
    expect(JSON.stringify(result.rows)).not.toContain(
      "sport_normalized_demand_score",
    );
    expect(JSON.stringify(result.rows)).not.toContain("demand_score");
  });

  it("summarizes numeric columns and aggregates by categorical fields", () => {
    const summary = runMathAnalysis({
      inputResult: "activity_rows",
      operation: "summarize",
      limit: 10,
      rowsByResult: rowsByResult(rows),
    });
    expect(summary.status).toBe("succeeded");
    expect(summary.rows.map((row) => row.column)).toContain("duration_sec");

    const aggregate = runMathAnalysis({
      inputResult: "activity_rows",
      operation: "aggregate",
      groupBy: ["name"],
      limit: 10,
      rowsByResult: rowsByResult(rows),
    });
    expect(aggregate.status).toBe("succeeded");
    expect(aggregate.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Hill run", rowCount: 1 }),
      ]),
    );
  });

  it("rejects unsafe formulas, unknown columns, missing handles, non-finite math, and removed rubric operations", () => {
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
    expect(
      runMathAnalysis({
        inputResult: "activity_rows",
        operation: "sportNormalizedDemand" as never,
        rowsByResult: rowsByResult(rows),
      }),
    ).toMatchObject({ status: "rejected", reason: "unsupported_operation" });
  });
});
