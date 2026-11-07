import { describe, expect, it, vi } from "vitest";
import {
  analyzeTerrainSections,
  type TerrainPoint,
} from "../src/lib/analytics/terrain-sections";
import { executeAnalyticsTool } from "../src/lib/ai/tool-analytics";
import { TrainerToolExecutionContext } from "../src/lib/ai/tool-execution-context";
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

describe("terrain analytical tool", () => {
  it("registers canonical values and permits bounded same-turn math only", () => {
    const context = new TrainerToolExecutionContext();
    const step = run(context);
    expect(step.status).toBe("succeeded");
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
    expect(text).toContain('"meanGradePct":10');
    expect(text).toContain("not surface/technicality");
    expect(text).not.toMatch(/"lat"|"lon"|raw_payload|\/Users\//);
  });
  it("retains explicit partial and truncated coverage independently of answer text", () => {
    const partial = run(undefined, {
      ...ports,
      analyzeActivityTerrain: () =>
        analyzeTerrainSections(
          "synthetic",
          "walking",
          points.map((p) => ({ ...p, timestamp: null })),
        ),
    });
    expect(partial.status).toBe("succeeded");
    expect(partial.result).toMatchObject({ analysis: { status: "partial" } });
    expect(renderToolSteps([partial])).toContain('"status":"partial"');
    const truncated = run(undefined, {
      ...ports,
      analyzeActivityTerrain: () => ({
        ...ports.analyzeActivityTerrain("synthetic"),
        truncated: true,
      }),
    });
    expect(truncated.result).toMatchObject({ truncated: true });
    expect(renderToolSteps([truncated])).toContain(
      "Disclose partial/truncated support",
    );
  });
  it("rejects unavailable evidence without publishing handles", () => {
    const context = new TrainerToolExecutionContext();
    const step = run(context, {
      ...ports,
      analyzeActivityTerrain: () =>
        analyzeTerrainSections("synthetic", null, []),
    });
    expect(step.status).toBe("rejected");
    expect(context.analysisResults.size).toBe(0);
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
