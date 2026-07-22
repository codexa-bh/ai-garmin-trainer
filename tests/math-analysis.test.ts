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
