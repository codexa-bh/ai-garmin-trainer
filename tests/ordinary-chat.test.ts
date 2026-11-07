import { expect, it, vi } from "vitest";
import { orchestrateTrainerChat } from "../src/lib/ai/orchestrator";
import type { TrainerToolStep } from "../src/lib/ai/tool-types";

const answer =
  "Your authored weekday hike covered 6543 m in 4321 s with 321 m ascent and mean HR 123. The supported climbing section averaged 8% over 1000 m. For shorter weekday sessions, keep the climbing practice manageable; surface and technicality remain unknown.";
const lookup = {
  reference: { garminId: "weekdayHike", suppliedName: null, date: null },
  importedCoverage: {
    activityCount: 1,
    earliestDate: "2026-11-01",
    latestDate: "2026-11-01",
  },
  outcome: "found",
  matches: [
    {
      garminId: "weekdayHike",
      label: "Authored weekday hike",
      date: "2026-11-01",
      sport: "hiking",
      distanceMeters: 6543,
      durationSec: 4321,
      elevationGainMeters: 321,
      avgHeartRate: 123,
    },
  ],
};
const terrain = {
  status: "succeeded",
  resultName: "weekdayHike",
  analysis: { status: "available", method: "terrain-v2" },
  rows: [{ gradePct: 8, distanceMeters: 1000 }],
  truncated: false,
};

it("preserves ordinary lookup/terrain coaching without a certificate, repair or extra SQL", async () => {
  const generate = vi
    .fn()
    .mockResolvedValueOnce({
      toolCalls: [
        {
          toolName: "verifyActivityReference",
          input: { garminId: "weekdayHike" },
        },
      ],
    })
    .mockResolvedValueOnce({
      toolCalls: [
        {
          toolName: "analyzeActivityTerrain",
          input: { garminId: "weekdayHike", resultName: "weekdayHike" },
        },
      ],
    })
    .mockResolvedValueOnce({ text: answer, toolCalls: [] });
  const executeTool = vi.fn(
    async ({ index, toolName }): Promise<TrainerToolStep> => ({
      index,
      tool: toolName,
      status: "succeeded",
      summary: "Authored evidence",
      privacy: "synthetic only",
      result: toolName === "verifyActivityReference" ? lookup : terrain,
    }),
  );
  const result = await orchestrateTrainerChat(
    {
      system: "Coach",
      userRequest: "Feedback on my weekday hike",
      debug: { enabled: true },
    },
    { generate, executeTool },
  );
  expect(result.text).toBe(answer);
  expect(result.toolSteps.map(({ tool, status }) => [tool, status])).toEqual([
    ["verifyActivityReference", "succeeded"],
    ["analyzeActivityTerrain", "succeeded"],
  ]);
  expect(result.providerCalls).toBe(3);
  expect(generate.mock.calls.map(([request]) => request.purpose)).toEqual([
    "planner",
    "planner",
    "planner",
  ]);
  expect(executeTool).toHaveBeenCalledTimes(2);
  expect(JSON.stringify(result.debugTrace)).not.toMatch(
    /completionRejection|declaredClaims|completeTrainerTurn/,
  );
});

it("does not use ordinary text to skip selected effects", async () => {
  const generate = vi
    .fn()
    .mockResolvedValueOnce({
      text: "Premature text",
      toolCalls: [{ toolName: "getSyncStatus", input: {} }],
    })
    .mockResolvedValueOnce({ text: "Status reviewed." });
  const executeTool = vi.fn(async (): Promise<TrainerToolStep> => ({
    index: 1,
    tool: "getSyncStatus",
    status: "succeeded",
    summary: "bounded status",
    privacy: "no secrets",
  }));
  const result = await orchestrateTrainerChat(
    { system: "Coach", userRequest: "Check status" },
    { generate, executeTool },
  );
  expect(executeTool).toHaveBeenCalledOnce();
  expect(result.text).toBe("Status reviewed.");
});

it.each([
  {},
  { text: "   " },
  { text: "no", toolCalls: [null] },
  { text: "no", toolCalls: "malformed" },
])(
  "retains an honest empty/malformed provider failure without a repair call: %j",
  async (response) => {
    const generate = vi.fn().mockResolvedValue(response);
    const executeTool = vi.fn();
    const result = await orchestrateTrainerChat(
      { system: "Coach", userRequest: "Advice" },
      { generate, executeTool },
    );
    expect(result.text).toMatch(/valid response|empty|invalid/i);
    expect(result.text).not.toMatch(/validate.*completion|declared evidence/i);
    expect(generate).toHaveBeenCalledOnce();
    expect(executeTool).not.toHaveBeenCalled();
  },
);

it.each([{}, { text: " " }, { text: "no", toolCalls: [null] }])(
  "discloses independently saved effects on malformed/empty exits: %j",
  async (response) => {
    const generate = vi
      .fn()
      .mockResolvedValueOnce({
        toolCalls: [
          {
            toolName: "saveTrainingPlan",
            input: { contentMarkdown: "Authored plan" },
          },
        ],
      })
      .mockResolvedValueOnce(response);
    const executeTool = vi.fn(async (): Promise<TrainerToolStep> => ({
      index: 1,
      tool: "saveTrainingPlan",
      status: "succeeded",
      summary: "General Plan strength update",
      privacy: "document omitted",
    }));
    const result = await orchestrateTrainerChat(
      {
        system: "Coach",
        userRequest: "Save the plan",
        debug: { enabled: true },
      },
      { generate, executeTool },
    );
    expect(generate).toHaveBeenCalledTimes(2);
    expect(executeTool).toHaveBeenCalledOnce();
    expect(result.text).toContain(
      "Already saved: saveTrainingPlan: General Plan strength update",
    );
    expect(result.text.match(/Already saved:/g)).toHaveLength(1);
    expect(result.debugTrace?.finalAnswer).toBe(result.text);
  },
);
