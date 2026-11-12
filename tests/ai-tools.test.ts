import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { asSchema } from "ai";
import { authoredWeeklyKpis } from "../scripts/ci/kpi-fixture";

vi.mock("ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("ai")>()),
  tool: (definition: unknown) => definition,
}));
vi.mock("@/lib/db/repository", () => ({
  activityDetailCoverage: vi.fn(),
  dataCounts: vi.fn(),
  getActivityByGarminId: vi.fn(),
  getActivityDetailForAnalytics: vi.fn(),
  getGarminAthleteBaseline: vi.fn(),
  listActivityDetailAvailability: vi.fn(),
  TRAINING_PLAN_CONTENT_MAX_LENGTH: 32000,
  TRAINING_PLAN_TITLE_MAX_LENGTH: 120,
  verifyActivityReference: vi.fn(),
}));
vi.mock("@/lib/db/training-plan-repository", () => ({
  getTrainingPlan: vi.fn(),
  persistTrainingPlan: vi.fn(),
}));
vi.mock("@/lib/garmin/composition", () => ({
  backfillActivityDetail: vi.fn(),
  runGarminSync: vi.fn(),
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
    trainerToolContracts,
    trainerToolInputSchemas,
    validateTrainerToolCall,
  } = await import("../src/lib/ai/tool-contracts");
  const { trainerToolDefinitions } =
    await import("../src/lib/ai/provider-tool-definitions");

  it("preserves every provider description and input schema", () => {
    expect(
      Object.fromEntries(
        Object.entries(trainerToolDefinitions).map(([name, definition]) => [
          name,
          {
            description: definition.description,
            schema: z.toJSONSchema(
              trainerToolContracts[name as keyof typeof trainerToolContracts]
                .inputSchema,
            ),
          },
        ]),
      ),
    ).toMatchSnapshot();
  });

  it("keeps actual SDK legacy parsing separate from minimal advertised weekly shapes", async () => {
    const { origin, provenance, items } = authoredWeeklyKpis().sets[0];
    const rich = {
      weekStart: "2026-11-09",
      commitment: { origin, provenance, items },
    };
    for (const name of ["saveWeeklyKpis", "saveWeeklyDocuments"] as const) {
      const schema = asSchema(trainerToolDefinitions[name].inputSchema);
      const input =
        name === "saveWeeklyKpis" ? rich : { changes: [], kpiChanges: [rich] };
      const parsed = await schema.validate!(input);
      expect(parsed.success).toBe(true);
      if (parsed.success) expect(parsed.value).toEqual(input);
      expect(JSON.stringify(await schema.jsonSchema)).not.toContain(
        '"definition":',
      );
      expect(
        (await schema.validate!({ ...input, arbitrary: "refused" })).success,
      ).toBe(false);
    }
  });

  it("exposes guarded SQL/math analysis plus data plumbing", () => {
    expect(Object.keys(trainerToolDefinitions).sort()).toEqual(
      [
        "getActivityDashboard",
        "analyzeActivityTerrain",
        "getWeeklyPlan",
        "saveWeeklyDocuments",
        "getWeeklyKpis",
        "saveWeeklyKpis",
        "getKpiProgress",
        "forceRefreshActivityDetail",
        "getActivityDetailAvailability",
        "describeGarminDatabase",
        "getActivityDetailSlice",
        "getSyncStatus",
        "runGarminSync",
        "runMathAnalysis",
        "runReadOnlySql",
        "getTrainingPlan",
        "saveTrainingPlan",
        "verifyActivityReference",
      ].sort(),
    );
    expect(trainerToolDefinitions).not.toHaveProperty("rankActivities");
    expect(trainerToolDefinitions).not.toHaveProperty("analyzeActivity");
    expect(trainerToolDefinitions).not.toHaveProperty(
      "runGeneratedGarminAnalysis",
    );
    expect(
      Object.values(trainerToolDefinitions).every(
        (definition) => !("execute" in (definition as object)),
      ),
    ).toBe(true);
  });

  it("accepts bounded SQL/math inputs without demand-specific operations", () => {
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
      trainerToolInputSchemas.runMathAnalysis.safeParse({
        inputResult: "top_activities",
        operation: "sportNormalizedDemand",
      }).success,
    ).toBe(false);
    expect(
      trainerToolInputSchemas.saveTrainingPlan.safeParse({
        title: "Base plan",
        contentMarkdown: "# Week 1\n- Easy hike",
      }).success,
    ).toBe(true);
    expect(
      trainerToolInputSchemas.saveTrainingPlan.safeParse({
        contentMarkdown: " ",
      }).success,
    ).toBe(false);
  });

  it("rejects removed fixed-analysis and generated-script tools", () => {
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
        toolName: "runGeneratedGarminAnalysis",
        input: {
          request: "rank hiking activities",
          script: "RESULT = {'kind': 'ranking', 'rows': [], 'limitations': []}",
        },
      }),
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
  });
});

describe("trainer SQL/math renderer", async () => {
  const { renderToolSteps } = await import("../src/lib/ai/tool-evidence");

  it("renders bounded math evidence without fixed demand rubric fields", () => {
    const text = renderToolSteps([
      {
        index: 1,
        tool: "runMathAnalysis",
        status: "succeeded",
        summary: "Math score criteria_scores; returned 1/2 rows; truncated.",
        privacy: "Bounded TypeScript math over same-turn SQL result rows only.",
        result: {
          status: "succeeded",
          resultName: "criteria_scores",
          inputResult: "activity_rows",
          operation: "score",
          rows: [
            {
              garmin_id: "activity-1",
              label: "Long run",
              score: 7200,
            },
          ],
          rowCount: 2,
          returnedRows: 1,
          truncated: true,
          privacy:
            "Bounded TypeScript math over same-turn SQL result rows only.",
        },
      },
    ]);

    expect(text).toContain("Math result handle criteria_scores: score");
    expect(text).toContain("Long run");
    expect(text).not.toContain("sport_normalized_demand_score");
    expect(text).not.toContain("demand_score");
    expect(text).not.toContain("Generated dataset script");
  });

  it("preserves rejected tool reasons and privacy wording", () => {
    const text = renderToolSteps([
      {
        index: 1,
        tool: "runMathAnalysis",
        status: "rejected",
        summary: "Math analysis rejected: unknown_column.",
        privacy:
          "No Garmin connector action or local analytics tool was executed for the rejected provider response.",
        reason: "unknown_column",
      },
    ]);

    expect(text).toContain("Reason: unknown_column.");
    expect(text).toContain(
      "Privacy: No Garmin connector action or local analytics tool was executed",
    );
  });
});
