import { expect, it, vi } from "vitest";
import {
  readPlanningPreload,
  currentPlanningPreload,
  type PlanningPreload,
} from "../src/lib/ai/planning-preload";
import { orchestrateTrainerChat } from "../src/lib/ai/orchestrator";
import { createTrainingPlan } from "../src/lib/training-plan/application";
import { executeTrainingPlanTool } from "../src/lib/ai/tool-training-plan";
import type { CompleteTrainingPlan } from "../src/lib/training-plan/snapshot";
import type { WeeklyTurn } from "../src/lib/weekly/contracts";
import type { KpiRead } from "../src/lib/weekly/kpi-contracts";
import type { TrainerToolStep } from "../src/lib/ai/tool-types";
import type {
  TrainerGenerationRequest,
  TrainerGenerationResult,
} from "../src/lib/ai/orchestration-ports";

const turn: WeeklyTurn = {
  conversationId: "authored",
  turnId: "u1",
  previousAssistantId: null,
  timeZone: "UTC",
};
const plan: CompleteTrainingPlan = {
  plan: {
    title: "Authored plan",
    contentMarkdown: "Walk twice. Preserve strength.",
    revisedAt: "2026-11-23T00:00:00Z",
  },
  stale: false,
  staleAfterDays: 60,
};
const kpis = (weekStart: string): KpiRead => ({
  weekStart,
  revision: null,
  timeZone: null,
  originalId: null,
  latestId: null,
  reviewDefinedId: null,
  complete: true,
  sets: [],
  assessments: [],
  availableSets: [],
});
function preparation(now = "2026-11-26T12:00:00Z") {
  return {
    now: () => new Date(now),
    trainingPlan: vi.fn(() => plan),
    readWeek: vi.fn((weekStart: string) => ({ weekStart, record: null })),
    readKpis: vi.fn(kpis),
  };
}
const step = (
  tool: TrainerToolStep["tool"],
  result?: unknown,
  status: TrainerToolStep["status"] = "succeeded",
): TrainerToolStep => ({
  index: 1,
  tool,
  status,
  summary: "Authored result",
  privacy: "local",
  result,
});
function run(
  preload: PlanningPreload | undefined,
  generate: (
    request: TrainerGenerationRequest,
  ) => Promise<TrainerGenerationResult>,
  executeTool = vi.fn(async (input) => step(input.toolName)),
) {
  return orchestrateTrainerChat(
    {
      system: { policy: "stable", context: "fresh" },
      userRequest: "Authored request",
      weeklyTurn: turn,
      planningPreload: preload,
      debug: { enabled: true },
    },
    { generate, executeTool },
  );
}

it("preloads full General Plan and canonical current/previous weeks, without effects or invented executions", async () => {
  const ports = preparation();
  const preload = readPlanningPreload(ports, turn);
  expect(ports.readWeek.mock.calls).toEqual([["2026-11-23"], ["2026-11-16"]]);
  expect(ports.readKpis.mock.calls).toEqual(ports.readWeek.mock.calls);
  expect(preload.trainingPlan).toEqual({ status: "complete", value: plan });
  expect(preload.weeks.map((w) => w.kpis.status)).toEqual([
    "complete",
    "complete",
  ]);
  const generate = vi.fn(async (request: TrainerGenerationRequest) => {
    expect(JSON.stringify(request.system)).toContain(
      plan.plan!.contentMarkdown,
    );
    expect(
      typeof request.system === "string"
        ? request.system
        : request.system.context,
    ).toContain('"record":null');
    return { text: "Ordinary answer quoting Walk twice. Preserve strength." };
  });
  const result = await run(preload, generate);
  expect(result.providerCalls).toBe(1);
  expect(result.toolSteps).toEqual([]);
  expect(result.progressCounters).toEqual({
    modelCalls: 1,
    toolsSucceeded: 0,
    toolsUnsuccessful: 0,
  });
  expect(JSON.stringify(result.grounding)).not.toContain("Walk twice");
  expect(JSON.stringify(result.debugTrace)).not.toContain("Walk twice");
  expect(result.debugTrace!.providerCalls[0]).toMatchObject({
    elapsedMs: expect.any(Number),
    outcome: "returned",
  });
});

it("does not persist document echoes in provider errors, arguments or debug result payloads", async () => {
  const preload = readPlanningPreload(preparation(), turn);
  const content = plan.plan!.contentMarkdown;
  const failure = await run(preload, async () => {
    throw Error(`Upstream request echo: ${content}`);
  });
  expect(JSON.stringify(failure.debugTrace)).not.toContain(content);
  expect(failure.debugTrace!.providerCalls[0]).toMatchObject({
    outcome: "failed",
    error: "provider_generation_unavailable",
    elapsedMs: expect.any(Number),
  });
  const generate = vi
    .fn()
    .mockResolvedValueOnce({
      toolCalls: [
        {
          toolName: "runReadOnlySql",
          input: { sql: `select '${content}' as value` },
        },
      ],
    })
    .mockResolvedValueOnce({ text: content });
  const execute = vi.fn(async (input) =>
    step(input.toolName, { rows: [{ value: content }] }),
  );
  const returned = await run(preload, generate, execute);
  expect(JSON.stringify(returned.debugTrace)).not.toContain(content);
  expect(returned.debugTrace!.providerCalls[0].toolCalls?.[0]).toEqual({
    toolName: "runReadOnlySql",
    input: "omitted for planning context",
  });
});

it("distinguishes complete absence, read failure, invalid General Plan and oversized/incomplete weekly data", () => {
  const absent = preparation();
  absent.trainingPlan.mockReturnValue({ ...plan, plan: null });
  expect(readPlanningPreload(absent, turn).trainingPlan).toEqual({
    status: "complete",
    value: { ...plan, plan: null },
  });
  const failed = preparation();
  failed.trainingPlan.mockImplementation(() => {
    throw Error("private source error");
  });
  failed.readWeek.mockImplementation(() => {
    throw Error("private DB error");
  });
  const unavailable = readPlanningPreload(failed, turn);
  expect(unavailable.trainingPlan).toEqual({
    status: "unavailable",
    reason: "read_failed",
  });
  expect(
    unavailable.weeks.every((w) => w.document.status === "unavailable"),
  ).toBe(true);
  expect(JSON.stringify(unavailable)).not.toContain("private");
  const invalid = preparation();
  invalid.trainingPlan.mockReturnValue({
    ...plan,
    plan: { ...plan.plan!, contentMarkdown: "x".repeat(32001) },
  });
  invalid.readKpis.mockImplementation((weekStart) => ({
    ...kpis(weekStart),
    complete: false,
  }));
  expect(readPlanningPreload(invalid, turn).trainingPlan.status).toBe(
    "unavailable",
  );
  expect(readPlanningPreload(invalid, turn).weeks[0].kpis.status).toBe(
    "unavailable",
  );
  invalid.readKpis.mockImplementation((weekStart) => ({
    ...kpis(weekStart),
    narrowToSetIds: ["x".repeat(60000)],
  }));
  expect(readPlanningPreload(invalid, turn).weeks[0].kpis).toEqual({
    status: "unavailable",
    reason: "incomplete",
  });
});

it("rebuilds device-local weeks across Monday rollover, with no cross-turn cache", () => {
  const ports = preparation("2026-11-23T00:30:00Z");
  expect(
    readPlanningPreload(ports, { ...turn, timeZone: "America/Los_Angeles" })
      .weeks[0].weekStart,
  ).toBe("2026-11-16");
  expect(readPlanningPreload(ports, turn).weeks[0].weekStart).toBe(
    "2026-11-23",
  );
  ports.now = () => new Date("2026-11-30T00:00:00Z");
  ports.trainingPlan.mockReturnValue({ ...plan, plan: null });
  expect(readPlanningPreload(ports, turn).weeks[0].weekStart).toBe(
    "2026-11-30",
  );
  expect(ports.trainingPlan).toHaveBeenCalledTimes(3);
  expect(readPlanningPreload(ports, turn).trainingPlan).toMatchObject({
    value: { plan: null },
  });
});

it("supports first-pass guarded exact edits, but still rejects concurrent edits", async () => {
  let saved = plan.plan;
  const app = createTrainingPlan(
    {
      read: () => saved,
      persist: ({ title, contentMarkdown, nowMs }) => {
        saved = {
          title,
          contentMarkdown,
          revisedAt: new Date(nowMs).toISOString(),
        };
      },
    },
    () => new Date("2026-11-26T12:00:00Z"),
  );
  const preload = readPlanningPreload(
    { ...preparation(), trainingPlan: app.readComplete },
    turn,
  );
  const generate = vi
    .fn()
    .mockResolvedValueOnce({
      toolCalls: [
        {
          toolName: "saveTrainingPlan",
          input: {
            edits: [{ oldText: "Walk twice.", newText: "Walk three times." }],
          },
        },
      ],
    })
    .mockResolvedValueOnce({ text: "Saved." });
  const execute = vi.fn(async (input) =>
    executeTrainingPlanTool(input, {
      readComplete: app.readComplete,
      saveGuarded: app.saveGuarded,
    }),
  );
  const result = await run(preload, generate, execute);
  expect(result.toolSteps.map((s) => [s.tool, s.status])).toEqual([
    ["saveTrainingPlan", "succeeded"],
  ]);
  expect(saved!.contentMarkdown).toBe("Walk three times. Preserve strength.");
  expect(execute.mock.calls[0][0].trainingPlanSnapshot).toEqual(
    preload.trainingPlan.status === "complete"
      ? preload.trainingPlan.value
      : undefined,
  );
  // Reuse of an externally changed snapshot is rejected by the existing owner.
  generate.mockReset().mockResolvedValueOnce({
    toolCalls: [
      {
        toolName: "saveTrainingPlan",
        input: {
          edits: [{ oldText: "Walk twice.", newText: "Walk four times." }],
        },
      },
    ],
  });
  const conflict = await run(preload, generate, execute);
  expect(conflict.toolSteps[0].reason).toBe("training_plan_changed_read_again");
  expect(saved!.contentMarkdown).toBe("Walk three times. Preserve strength.");
});

it("passes complete preloaded weekly/KPI snapshots on the first pass, never partial evidence", async () => {
  const preload = readPlanningPreload(preparation(), turn);
  const generate = vi
    .fn()
    .mockResolvedValueOnce({
      toolCalls: [
        {
          toolName: "saveWeeklyDocuments",
          input: {
            changes: [
              {
                kind: "plan",
                weekStart: "2026-11-23",
                title: "Authored",
                contentMarkdown: "Walk.",
              },
            ],
          },
        },
      ],
    })
    .mockResolvedValueOnce({ text: "Saved." });
  const execute = vi.fn(async (input) => {
    expect(
      input.weeklySnapshots.map((s: { weekStart: string }) => s.weekStart),
    ).toEqual(["2026-11-23", "2026-11-16"]);
    expect(input.kpiSnapshots).toEqual([
      kpis("2026-11-23"),
      kpis("2026-11-16"),
    ]);
    return step(input.toolName);
  });
  await run(preload, generate, execute);
  expect(execute).toHaveBeenCalledTimes(1);
  const partial = structuredClone(preload);
  partial.weeks[0].kpis = { status: "unavailable", reason: "incomplete" };
  const capture = vi.fn(async (input) => step(input.toolName));
  generate
    .mockReset()
    .mockResolvedValueOnce({
      toolCalls: [{ toolName: "getSyncStatus", input: {} }],
    })
    .mockResolvedValueOnce({ text: "Done." });
  await run(partial, generate, capture);
  expect(capture.mock.calls[0][0].weeklySnapshots).toHaveLength(2);
  expect(capture.mock.calls[0][0].kpiSnapshots).toHaveLength(1);
});

it.each([
  "runGarminSync",
  "refreshKpiMeasurements",
  "saveKpiRecipes",
  "saveWeeklyDocuments",
  "saveWeeklyKpis",
] as const)(
  "invalidates weekly preloads after %s attempts, including uncertain failures",
  (tool) => {
    const preload = readPlanningPreload(preparation(), turn);
    const current = currentPlanningPreload(preload, [
      step(tool, undefined, "failed"),
    ])!;
    expect(
      current.weeks.every(
        (w) =>
          w.document.status === "unavailable" &&
          w.kpis.status === "unavailable",
      ),
    ).toBe(true);
    expect(current.trainingPlan.status).toBe("complete");
    expect(preload.weeks[0].document.status).toBe("complete");
  },
);

it("supersedes KPI and document carriers independently, including historical reads", () => {
  const preload = readPlanningPreload(preparation(), turn);
  const fresh = currentPlanningPreload(preload, [
    step("getWeeklyKpis", kpis("2026-11-23")),
  ])!;
  expect(fresh.weeks[0].document.status).toBe("complete");
  expect(fresh.weeks[0].kpis.status).toBe("unavailable");
  expect(fresh.weeks[1].kpis.status).toBe("complete");
  const historical = currentPlanningPreload(preload, [
    step("getWeeklyPlan", { weekStart: "2020-01-06", record: null }),
  ])!;
  expect(historical).toEqual(preload);
});

it("explicit later reads supersede preload and do not lend same-batch authority", async () => {
  const preload = readPlanningPreload(preparation(), turn);
  const fresh = {
    ...plan,
    plan: { ...plan.plan!, contentMarkdown: "Externally revised." },
  };
  const generate = vi
    .fn()
    .mockResolvedValueOnce({
      toolCalls: [{ toolName: "getTrainingPlan", input: {} }],
    })
    .mockResolvedValueOnce({
      toolCalls: [{ toolName: "getSyncStatus", input: {} }],
    })
    .mockResolvedValueOnce({ text: "Done." });
  const execute = vi.fn(async (input) =>
    step(input.toolName, input.toolName === "getTrainingPlan" ? fresh : {}),
  );
  await run(preload, generate, execute);
  expect(execute.mock.calls[1][0].trainingPlanSnapshot).toEqual(fresh);
  expect(JSON.stringify(generate.mock.calls[1][0].system)).not.toContain(
    plan.plan!.contentMarkdown,
  );
  const batchGenerate = vi
    .fn()
    .mockResolvedValueOnce({
      toolCalls: [
        { toolName: "getTrainingPlan", input: {} },
        {
          toolName: "saveTrainingPlan",
          input: { edits: [{ oldText: "old", newText: "new" }] },
        },
      ],
    })
    .mockResolvedValueOnce({ text: "Done." });
  const batchExecute = vi.fn(async (input) =>
    step(input.toolName, input.toolName === "getTrainingPlan" ? plan : {}),
  );
  await run(undefined, batchGenerate, batchExecute);
  expect(
    batchExecute.mock.calls.every(
      ([input]) => input.trainingPlanSnapshot === undefined,
    ),
  ).toBe(true);
});

it("invalidates preloaded snapshots between a sync and a save in the same response", async () => {
  const preload = readPlanningPreload(preparation(), turn);
  const generate = vi
    .fn()
    .mockResolvedValueOnce({
      toolCalls: [
        { toolName: "runGarminSync", input: {} },
        {
          toolName: "saveWeeklyDocuments",
          input: {
            changes: [
              {
                kind: "plan",
                weekStart: "2026-11-23",
                title: "Authored",
                contentMarkdown: "Walk.",
              },
            ],
          },
        },
      ],
    })
    .mockResolvedValueOnce({ text: "Done." });
  const execute = vi.fn(async (input) => step(input.toolName));
  await run(preload, generate, execute);
  expect(execute.mock.calls[0][0].weeklySnapshots).toHaveLength(2);
  expect(execute.mock.calls[1][0].weeklySnapshots).toEqual([]);
  expect(execute.mock.calls[1][0].kpiSnapshots).toEqual([]);
});

it("measures generation only, excluding foreground/tool preparation time", async () => {
  let clock = 0;
  const now = vi.spyOn(performance, "now").mockImplementation(() => clock);
  try {
    let calls = 0;
    const result = await run(
      readPlanningPreload(preparation(), turn),
      async () => {
        clock += 37;
        return ++calls === 1
          ? { toolCalls: [{ toolName: "getSyncStatus", input: {} }] }
          : { text: "Done." };
      },
      vi.fn(async (input) => {
        clock += 2000;
        return step(input.toolName);
      }),
    );
    expect(
      result.debugTrace!.providerCalls.map((call) => call.elapsedMs),
    ).toEqual([37, 37]);
    expect(clock).toBe(2074);
  } finally {
    now.mockRestore();
  }
});

it("times failed generation and tool-disabled fallback separately without tool latency", async () => {
  const generate = vi
    .fn()
    .mockResolvedValueOnce({
      toolCalls: [{ toolName: "getSyncStatus", input: {} }],
    })
    .mockRejectedValueOnce(Error("authored failure"))
    .mockResolvedValueOnce({ text: "Supported fallback" });
  const result = await run(undefined, generate);
  expect(result.debugTrace!.providerCalls).toHaveLength(3);
  expect(result.debugTrace!.providerCalls.map((c) => c.outcome)).toEqual([
    "returned",
    "failed",
    "returned",
  ]);
  expect(
    result.debugTrace!.providerCalls.every(
      (c) => Number.isSafeInteger(c.elapsedMs) && c.elapsedMs! >= 0,
    ),
  ).toBe(true);
  expect(generate.mock.calls[2][0].purpose).toBe("final_synthesis");
});
