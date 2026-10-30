import { describe, expect, it, vi } from "vitest";
import {
  analyzeTerrainSections,
  type TerrainPoint,
} from "../src/lib/analytics/terrain-sections";
import { executeAnalyticsTool } from "../src/lib/ai/tool-analytics";
import { TrainerToolExecutionContext } from "../src/lib/ai/tool-execution-context";
import { assessCompletion } from "../src/lib/ai/turn-completion";
import { renderToolSteps } from "../src/lib/ai/tool-evidence";
import { TRAINER_EXECUTION_POLICY } from "../src/lib/ai/execution-budget";
import { canToolRunWithinBudget } from "../src/lib/ai/tool-selection";
import { validateTrainerToolCall } from "../src/lib/ai/tool-contracts";
const points: TerrainPoint[] = Array.from({ length: 101 }, (_, i) => ({
  timestamp: new Date(Date.UTC(2026, 0, 1) + i * 10000).toISOString(),
  elapsedSec: i,
  distanceMeters: i * 10,
  altitudeMeters: i,
  heartRate: 120,
}));
const ports = {
  describeGarminDatabase: vi.fn(),
  runReadOnlySql: vi.fn(),
  analyzeActivityTerrain: (id: string, limit?: number) =>
    analyzeTerrainSections(id, "walking", points, limit),
};
const run = (context = new TrainerToolExecutionContext(), overrides = ports) =>
  executeAnalyticsTool(
    {
      toolName: "analyzeActivityTerrain",
      index: 1,
      input: { garminId: "synthetic", maxRows: 20 },
      context,
    },
    overrides,
  );
const declaration = (kind = "grounded", value = 10) => ({
  completion: {
    kind,
    answer: "Estimated signed grade with method and coverage.",
    claims: [
      {
        kind: "metric",
        stepIndex: 1,
        resultName: "terrain_sections",
        rowIndex: 0,
        column: "meanGradePct",
        value,
      },
    ],
    missingEvidence: kind === "incomplete" ? ["Unsupported ranges"] : [],
  },
});
describe("terrain analytical tool", () => {
  it("registers canonical exact cells and permits bounded same-turn math only", () => {
    const context = new TrainerToolExecutionContext(),
      step = run(context);
    expect(step.status).toBe("succeeded");
    expect(assessCompletion(declaration(), [step]).answer).not.toBeNull();
    expect(
      assessCompletion(declaration("grounded", 11), [step]).rejection?.reason,
    ).toBe("cell_mismatch");
    const math = executeAnalyticsTool(
      {
        toolName: "runMathAnalysis",
        index: 2,
        context,
        input: {
          inputResult: "terrain_sections",
          operation: "customFormula",
          formula: "distanceMeters * meanGradePct / 100",
          limit: 10,
        },
      },
      ports,
    );
    expect(math.status).toBe("succeeded");
    expect(context.analysisResults.get("terrain_sections")?.[0]).toEqual(
      analyzeTerrainSections("synthetic", "walking", points).sections[0],
    );
    const other = new TrainerToolExecutionContext();
    expect(other.analysisResults.has("terrain_sections")).toBe(false);
    context.dispose();
    expect(context.analysisResults.size).toBe(0);
    const text = renderToolSteps([step]);
    expect(text).toContain("rowIndex 0:");
    expect(text).toContain('"meanGradePct":10');
    expect(text).toContain("not surface/technicality");
    expect(text).not.toMatch(/"lat"|"lon"|raw_payload|\/Users\//);
  });
  it("retains supported partial cells without certifying full evidence", () => {
    const partial = {
      ...ports,
      analyzeActivityTerrain: () =>
        analyzeTerrainSections(
          "synthetic",
          "walking",
          points.map((p) => ({ ...p, timestamp: null })),
        ),
    };
    const step = run(undefined, partial);
    expect(step.status).toBe("succeeded");
    expect(assessCompletion(declaration(), [step]).rejection?.reason).toBe(
      "incomplete_analysis",
    );
    expect(
      assessCompletion(declaration("incomplete"), [step]).answer,
    ).not.toBeNull();
    const truncated = run(undefined, {
      ...ports,
      analyzeActivityTerrain: () => ({
        ...ports.analyzeActivityTerrain("synthetic"),
        truncated: true,
      }),
    });
    expect(assessCompletion(declaration(), [truncated]).rejection?.reason).toBe(
      "incomplete_analysis",
    );
  });
  it("rejects unavailable evidence without handles or numeric tool claims", () => {
    const context = new TrainerToolExecutionContext();
    const step = run(context, {
      ...ports,
      analyzeActivityTerrain: () =>
        analyzeTerrainSections("synthetic", null, []),
    });
    expect(step.status).toBe("rejected");
    expect(context.analysisResults.size).toBe(0);
    expect(assessCompletion(declaration(), [step]).rejection?.reason).toBe(
      "step_not_succeeded",
    );
    expect(
      assessCompletion(
        {
          completion: {
            kind: "grounded",
            answer: "x",
            claims: [
              { kind: "tool", stepIndex: 1, tool: "analyzeActivityTerrain" },
            ],
            missingEvidence: [],
          },
        },
        [run()],
      ).rejection?.reason,
    ).toBe("invalid_tool_claim");
    expect(
      assessCompletion(declaration(), [run(), { ...step, index: 2 }]).rejection
        ?.reason,
    ).toBe("latest_metric_unsuccessful");
  });
  it("strictly validates bounded single activity input and preserves success budgets", () => {
    for (const input of [
      { garminId: "id", maxRows: 21 },
      { garminId: "../db" },
      { garminId: "id", sql: "select *" },
    ])
      expect(
        validateTrainerToolCall({ toolName: "analyzeActivityTerrain", input })
          .ok,
      ).toBe(false);
    expect(
      canToolRunWithinBudget(
        "analyzeActivityTerrain",
        new Map([
          [
            "analyzeActivityTerrain",
            TRAINER_EXECUTION_POLICY.analyticalSuccessLimit,
          ],
        ]),
      ),
    ).toBe(false);
  });
});
