import { describe, expect, it, vi } from "vitest";

vi.mock("ai", () => ({ tool: (definition: unknown) => definition }));
vi.mock("@/lib/db/repository", () => ({
  activityDetailCoverage: vi.fn(),
  dataCounts: vi.fn(),
  getActivityByGarminId: vi.fn(),
  getActivityDetailForAnalytics: vi.fn(),
  getGarminAthleteBaseline: vi.fn(),
  listActivityDetailAvailability: vi.fn(),
  verifyActivityReference: vi.fn(),
}));
vi.mock("@/lib/garmin/importer", () => ({
  backfillActivityDetail: vi.fn(),
  runGarminSync: vi.fn(),
}));
vi.mock("@/lib/ai/generated-analysis", () => ({
  runGeneratedGarminAnalysis: vi.fn(),
}));
vi.mock("@/lib/ai/sql-analysis", () => ({
  describeGarminDatabase: vi.fn(),
  runReadOnlySql: vi.fn(),
}));
vi.mock("@/lib/ai/math-analysis", () => ({
  runMathAnalysis: vi.fn(),
}));

describe("trainer tool registry schemas", async () => {
  const {
    trainerToolDefinitions,
    trainerToolInputSchemas,
    validateTrainerToolCall,
  } = await import("../src/lib/ai/tools");

  it("exposes guarded SQL/math analysis plus data plumbing", () => {
    expect(Object.keys(trainerToolDefinitions).sort()).toEqual(
      [
        "forceRefreshActivityDetail",
        "getActivityDetailAvailability",
        "describeGarminDatabase",
        "getActivityDetailSlice",
        "getSyncStatus",
        "runGarminSync",
        "runGeneratedGarminAnalysis",
        "runMathAnalysis",
        "runReadOnlySql",
        "verifyActivityReference",
      ].sort(),
    );
    expect(trainerToolDefinitions).not.toHaveProperty("rankActivities");
    expect(trainerToolDefinitions).not.toHaveProperty("analyzeActivity");
    expect(
      Object.values(trainerToolDefinitions).every(
        (definition) => !("execute" in (definition as object)),
      ),
    ).toBe(true);
  });

  it("accepts bounded SQL/math and gated generated-analysis inputs", () => {
    expect(
      trainerToolInputSchemas.getActivityDetailSlice.safeParse({
        garminId: "123456",
        pointOffset: 0,
        pointLimit: 120,
      }).success,
    ).toBe(true);
    expect(
      trainerToolInputSchemas.runReadOnlySql.safeParse({
        sql: "select garmin_id, duration_sec from activity order by duration_sec desc",
        maxRows: 10,
        resultName: "top_activities",
      }).success,
    ).toBe(true);
    expect(
      trainerToolInputSchemas.runMathAnalysis.safeParse({
        inputResult: "top_activities",
        operation: "score",
        formula: "duration_sec + elevation_gain_meters * 2",
        orderBy: [{ field: "score", direction: "desc" }],
        limit: 10,
      }).success,
    ).toBe(true);
    expect(
      trainerToolInputSchemas.runGeneratedGarminAnalysis.safeParse({
        request: "top 10 longest activities",
        datasets: ["activities", "dailyHealth"],
        requestedCount: 10,
        script:
          "activities = bundle['datasets']['activities']\nRESULT = {'kind': 'ranking', 'rows': [], 'limitations': []}",
      }).success,
    ).toBe(true);
  });

  it("rejects removed fixed-analysis tools and malformed generic scripts", () => {
    expect(
      validateTrainerToolCall({ toolName: "rankActivities", input: {} }),
    ).toEqual({ ok: false, reason: "unknown_tool" });
    expect(
      validateTrainerToolCall({ toolName: "analyzeActivity", input: {} }),
    ).toEqual({ ok: false, reason: "unknown_tool" });
    expect(
      validateTrainerToolCall({ toolName: "deleteEverything", input: {} }),
    ).toEqual({ ok: false, reason: "unknown_tool" });
    expect(
      validateTrainerToolCall({
        toolName: "runReadOnlySql",
        input: { sql: "x" },
      }),
    ).toEqual({ ok: false, reason: "malformed_input" });
    expect(
      validateTrainerToolCall({
        toolName: "runMathAnalysis",
        input: { inputResult: "x", operation: "score", formula: "process.env" },
      }),
    ).toEqual({ ok: false, reason: "malformed_input" });
    expect(
      validateTrainerToolCall({
        toolName: "verifyActivityReference",
        input: {},
      }),
    ).toEqual({ ok: false, reason: "malformed_input" });
    expect(
      validateTrainerToolCall({
        toolName: "runGeneratedGarminAnalysis",
        input: {
          request: "rank hiking activities",
          criterion: "demand_score",
          script: "RESULT = {'kind': 'ranking', 'rows': [], 'limitations': []}",
        },
      }),
    ).toEqual({ ok: false, reason: "malformed_input" });
    expect(
      validateTrainerToolCall({
        toolName: "runGeneratedGarminAnalysis",
        input: {
          request: "rank hiking activities",
          datasets: ["activities"],
          activitySelection: { includeText: ["../secrets"] },
          script: "RESULT = {'kind': 'ranking', 'rows': [], 'limitations': []}",
        },
      }),
    ).toEqual({ ok: false, reason: "malformed_input" });
  });
});

describe("trainer generated dataset-script renderer", async () => {
  const { renderToolSteps } = await import("../src/lib/ai/tools");

  it("renders generic rows and dataset evidence without fixed criteria", () => {
    const text = renderToolSteps([
      {
        index: 1,
        tool: "runGeneratedGarminAnalysis",
        status: "succeeded",
        summary:
          "Generated Garmin dataset script ranking; 1/5 rows; script abcdef123456.",
        privacy:
          "Generated Python ran locally against explicit read-only Garmin datasets.",
        result: {
          tool: "generatedGarminAnalysis",
          status: "succeeded",
          requestedCount: 5,
          scriptHash: "abcdef1234567890",
          manifest: {
            generatedAt: "2026-07-21T12:00:00.000Z",
            request: "top activities",
            selectedDatasets: ["activities"],
            datasets: [{ name: "activities", rowCount: 1, description: "" }],
            tables: [{ name: "activities", rowCount: 1 }],
            rawPayloads: [],
            limits: {
              maxRowsPerTable: 1000,
              maxRawPayloads: 100,
              maxRawPayloadBytes: 200000,
              maxOutputBytes: 12000,
            },
            scriptContract: {
              resultVariable: "RESULT",
              allowedImports: ["math"],
              forbiddenAccess: ["filesystem"],
            },
          },
          result: {
            kind: "ranking",
            title: "Longest activities",
            requestedCount: 5,
            returnedCount: 1,
            rows: [
              {
                rank: 1,
                garminId: "activity-1",
                label: "Long run",
                date: "2026-07-03",
                sport: "running",
                value: 7200,
                units: "s",
                notes: "computed by script",
              },
            ],
            limitations: ["Only imported local activities were considered."],
          },
          warnings: [],
          privacy:
            "Generated Python ran locally against explicit read-only Garmin datasets.",
        },
      },
    ]);

    expect(text).toContain(
      "Generated dataset script result: Longest activities",
    );
    expect(text).toContain("1. Long run — 7200 s");
    expect(text).toContain("Garmin ID activity-1");
    expect(text).toContain("Data bundle: activities 1");
    expect(text).toContain("Only imported local activities were considered.");
    expect(text).not.toContain("demand_score");
  });

  it("preserves rejected tool reasons and privacy wording", () => {
    const text = renderToolSteps([
      {
        index: 1,
        tool: "runGeneratedGarminAnalysis",
        status: "rejected",
        summary: "Generated Garmin analysis blocked: denied_import.",
        privacy:
          "No Garmin connector action or local analytics tool was executed for the rejected provider response.",
        reason: "denied_import",
      },
    ]);

    expect(text).toContain("Reason: denied_import.");
    expect(text).toContain(
      "Privacy: No Garmin connector action or local analytics tool was executed",
    );
  });

  it("renders bounded generated-analysis failure feedback without raw scripts or private data", () => {
    const text = renderToolSteps([
      {
        index: 1,
        tool: "runGeneratedGarminAnalysis",
        status: "failed",
        summary:
          "Generated Garmin analysis blocked: runtime_error; script abcdef123456; correction feedback may be offered.",
        privacy:
          "Generated Python ran locally against explicit read-only Garmin datasets; no credentials, environment, filesystem paths, connector handles, SQL, or unrestricted raw streams were exposed.",
        reason: "runtime_error",
        correctionAllowed: true,
        failureMessage: "NameError: name 'durationSec' is not defined",
        correctionHint:
          "Fix the Python exception by using only fields present in the selected bundle datasets and setting RESULT to bounded JSON.",
        result: {
          tool: "generatedGarminAnalysis",
          status: "failed",
          requestedCount: 5,
          scriptHash: "abcdef1234567890",
          manifest: {
            generatedAt: "2026-07-21T12:00:00.000Z",
            request: "rank activities",
            selectedDatasets: ["activities"],
            datasets: [{ name: "activities", rowCount: 1, description: "" }],
            tables: [{ name: "activities", rowCount: 1 }],
            rawPayloads: [],
            limits: {
              maxRowsPerTable: 1000,
              maxRawPayloads: 100,
              maxRawPayloadBytes: 200000,
              maxOutputBytes: 12000,
            },
            scriptContract: {
              resultVariable: "RESULT",
              allowedImports: ["math"],
              forbiddenAccess: ["filesystem"],
            },
          },
          reason: "runtime_error",
          message: "NameError: name 'durationSec' is not defined",
          correctionAllowed: true,
          correctionHint:
            "Fix the Python exception by using only fields present in the selected bundle datasets and setting RESULT to bounded JSON.",
          warnings: [],
          privacy:
            "Generated Python ran locally against explicit read-only Garmin datasets.",
        },
      },
    ]);

    expect(text).toContain("Bounded failure detail");
    expect(text).toContain("Correction guidance");
    expect(text).toContain(
      "Correction context: selected datasets activities:1",
    );
    expect(text).toContain("allowed imports math");
    expect(text).toContain("common activities fields garminId");
    expect(text).toContain("RESULT must be JSON");
    expect(text).toContain(
      "Correction feedback: the model may choose a corrected",
    );
    expect(text).not.toContain("RESULT =");
    expect(text).not.toContain("/Users/");
    expect(text).not.toContain("GARMIN_");
    expect(text).not.toContain("DATABASE_URL");
  });
});
