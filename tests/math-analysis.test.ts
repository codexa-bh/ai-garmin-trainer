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

  it.each([
    {
      operation: "score",
      formula: "absent_metric",
      stage: "formula",
      fields: "duration_sec",
    },
    {
      operation: "normalize",
      formula: "absent_metric",
      stage: "formula",
      fields: "duration_sec",
    },
    {
      operation: "aggregate",
      groupBy: ["absent_group"],
      stage: "grouping",
      fields: "name",
    },
    {
      operation: "summarize",
      orderBy: [{ field: "duration_sec", direction: "desc" }],
      stage: "ordering",
      fields: "avg, column, count, max, min, sum",
    },
    {
      operation: "aggregate",
      groupBy: ["name"],
      orderBy: [{ field: "duration_sec", direction: "desc" }],
      stage: "ordering",
      fields: "name, numericColumns, rowCount",
    },
    {
      operation: "normalize",
      formula: "duration_sec",
      orderBy: [{ field: "absent_order", direction: "desc" }],
      stage: "ordering",
      fields: "normalizedScore",
    },
  ] as const)(
    "offers actual stage-specific columns: $operation/$stage",
    (scenario) => {
      const result = runMathAnalysis({
        inputResult: "activity_rows",
        rowsByResult: rowsByResult(rows),
        operation: scenario.operation,
        formula: scenario.formula,
        groupBy: scenario.groupBy ? [...scenario.groupBy] : undefined,
        orderBy: scenario.orderBy ? [...scenario.orderBy] : undefined,
      });
      expect(result).toMatchObject({
        status: "rejected",
        reason: "unknown_column",
        correctionAllowed: true,
        rows: [],
      });
      expect(result.correctionHint).toContain(scenario.stage);
      expect(result.correctionHint).toContain(scenario.fields);
      expect(result.correctionHint).not.toContain("absent_");
      expect(result.correctionHint).not.toContain("Hill run");
      if (scenario.stage === "ordering" && scenario.operation !== "normalize")
        expect(result.correctionHint).not.toContain("duration_sec");
    },
  );

  it("bounds diagnostics and omits unsafe identifiers and values", () => {
    const wide = Object.fromEntries(
      Array.from({ length: 100 }, (_, i) => [
        `field_${String(i).padStart(3, "0")}`,
        i,
      ]),
    );
    Object.assign(wide, {
      "/Users/private": "private",
      secret_token: "private",
      ["x".repeat(49)]: "private",
    });
    const result = runMathAnalysis({
      inputResult: "activity_rows",
      operation: "score",
      formula: "absent",
      rowsByResult: rowsByResult([wide]),
    });
    expect(result.correctionAllowed).toBe(true);
    expect(result.correctionHint).toContain("field_015");
    expect(result.correctionHint).not.toContain("field_016");
    expect(result.correctionHint).not.toMatch(/private|secret|xxx/);
    expect(new TextEncoder().encode(result.correctionHint).length).toBeLessThan(
      1100,
    );
  });

  it.each([
    { formula: "absent + (" },
    { formula: "absent +" },
    { formula: "absent()" },
    { formula: "fetch('private')" },
    { formula: "x".repeat(801) },
    { formula: "absent", rows: [] },
    { formula: "absent", rows: [{ secret_token: 1 }] },
    { formula: "absent", inputResult: "foreign_turn" },
    {
      formula: "absent",
      rows: Array.from({ length: 201 }, () => ({ value: 1 })),
    },
    { formula: "name" },
    { formula: "duration_sec / 0" },
  ])(
    "does not admit unsafe, unavailable or non-column failures: %j",
    (scenario) => {
      const result = runMathAnalysis({
        inputResult: scenario.inputResult ?? "activity_rows",
        operation: "score",
        formula: scenario.formula,
        rowsByResult: rowsByResult(scenario.rows ?? rows),
      });
      expect(result.status).toBe("rejected");
      expect(result.correctionAllowed).not.toBe(true);
      expect(result.correctionHint).toBeUndefined();
    },
  );

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
