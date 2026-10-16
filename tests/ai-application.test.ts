import { describe, expect, it } from "vitest";
import { coaching, grounded, incomplete, metric } from "./completion-fixtures";
import { orchestrateTrainerChat } from "../src/lib/ai/orchestrator";
import { executeTrainerTool } from "../src/lib/ai/tool-execution";
import type { TrainerToolPorts } from "../src/lib/ai/tool-ports";
import type { TrainerToolExecutionInput } from "../src/lib/ai/tool-execution-input";
import type {
  TrainerGenerationResult,
  TrainerGenerationRequest,
} from "../src/lib/ai/orchestration-ports";
import type { AnalysisResult } from "../src/lib/ai/analytics/contracts";
import type { CompleteTrainingPlan } from "../src/lib/training-plan/snapshot";

const unused = () => {
  throw new Error("unexpected capability");
};
function capabilities(): TrainerToolPorts {
  return {
    analytics: { describeGarminDatabase: unused, runReadOnlySql: unused },
    localData: {
      getActivityByGarminId: unused,
      getActivityDetailForAnalytics: unused,
      listActivityDetailAvailability: unused,
      verifyActivityReference: unused,
      summarizeSyncStatus: unused,
      runGarminSync: unused,
      backfillActivityDetail: unused,
    },
    trainingPlan: { readComplete: unused, saveGuarded: unused },
  };
}
function rows(value: number): AnalysisResult {
  return {
    status: "succeeded",
    resultName: "facts",
    columns: [{ name: "value" }],
    rows: [{ value }],
    rowCount: 1,
    returnedRows: 1,
    truncated: false,
    privacy: "bounded",
  };
}
const call = (toolName: string, input: unknown = {}) => ({
  toolCalls: [{ toolName, input }],
});
function scripted(results: TrainerGenerationResult[], ports = capabilities()) {
  const requests: TrainerGenerationRequest[] = [];
  const executions: TrainerToolExecutionInput[] = [];
  const run = () =>
    orchestrateTrainerChat(
      {
        system: "system",
        userRequest: "Explain evidence",
        debug: { enabled: true },
      },
      {
        generate: (request) => {
          requests.push(request);
          const next = results.shift();
          if (!next) throw new Error("unexpected generation");
          return Promise.resolve(next);
        },
        executeTool: (input) => {
          executions.push(input);
          return executeTrainerTool(input, ports);
        },
      },
    );
  return { run, requests, executions };
}

describe("AI application through supplied capabilities (no infrastructure mocks)", () => {
  it("answers directly with a plain request and never asks for tools", async () => {
    const test = scripted([coaching("A conversational answer.")]);
    expect(await test.run()).toMatchObject({
      text: "A conversational answer.",
      providerCalls: 1,
      toolSteps: [],
    });
    expect(test.requests[0]).toMatchObject({
      purpose: "planner",
      prompt: "Explain evidence",
    });
    expect(Object.keys(test.requests[0]).sort()).toEqual([
      "prompt",
      "purpose",
      "system",
    ]);
    expect(test.executions).toEqual([]);
  });

  it("preserves raw call aliases, defaults, sequential SQL/math and context disposal", async () => {
    const ports = capabilities();
    const journal: string[] = [];
    ports.analytics.runReadOnlySql = (input) => {
      journal.push(`sql:${input.maxRows}`);
      return rows(7);
    };
    const test = scripted(
      [
        {
          toolCalls: [
            {
              name: "runReadOnlySql",
              arguments: '{"sql":"select 7 as value"}',
            },
          ],
        },
        {
          toolCalls: [
            {
              tool: "runMathAnalysis",
              args: {
                inputResult: "facts",
                operation: "score",
                formula: "value * 2",
                outputName: "scores",
              },
            },
          ],
        },
        grounded("The transformed value is fourteen.", [
          metric(2, "scores", "score", 14),
        ]),
      ],
      ports,
    );
    const result = await test.run();
    expect(journal).toEqual(["sql:50"]);
    expect(result.toolSteps.map((step) => step.status)).toEqual([
      "succeeded",
      "succeeded",
    ]);
    expect(result.toolSteps[1].result).toMatchObject({
      rows: [{ value: 7, score: 14 }],
    });
    expect(result.progressCounters).toEqual({
      modelCalls: 3,
      toolsSucceeded: 2,
      toolsUnsuccessful: 0,
    });
    expect(test.executions[0].context).toBe(test.executions[1].context);
    expect(test.executions[0].context.analysisResults.size).toBe(0);
    expect(test.requests[2].system).toContain("14");
  });

  it("validates the whole batch before executing and rejects malformed alias input", async () => {
    for (const bad of [
      { toolName: "unknown", input: {} },
      { name: "runReadOnlySql", arguments: "not-json" },
    ]) {
      const test = scripted([
        { toolCalls: [{ toolName: "getTrainingPlan" }, bad] },
      ]);
      const result = await test.run();
      expect(result.toolSteps[0].status).toBe("rejected");
      expect(test.executions).toEqual([]);
    }
  });

  it("sanitizes thrown tool errors and never replaces a handle on rejected SQL", async () => {
    const ports = capabilities();
    let attempt = 0;
    ports.analytics.runReadOnlySql = () => {
      if (++attempt === 1) return rows(7);
      return {
        ...rows(99),
        status: "rejected",
        reason: "invalid_sql",
        correctionAllowed: true,
      };
    };
    const observations: number[] = [];
    // Exercise the real dispatcher directly while retaining a live context.
    const { TrainerToolExecutionContext } =
      await import("../src/lib/ai/tool-execution-context");
    const context = new TrainerToolExecutionContext();
    for (let index = 1; index <= 2; index++) {
      await executeTrainerTool(
        {
          context,
          index,
          toolName: "runReadOnlySql",
          input: { sql: "select value", maxRows: 50 },
        },
        ports,
      );
      observations.push(
        Number(context.analysisResults.get("facts")?.[0].value),
      );
    }
    expect(observations).toEqual([7, 7]);
    ports.analytics.runReadOnlySql = () => {
      throw new Error("credential=private /Users/private");
    };
    const failed = await executeTrainerTool(
      {
        context,
        index: 3,
        toolName: "runReadOnlySql",
        input: { sql: "select value", maxRows: 50 },
      },
      ports,
    );
    expect(failed).toMatchObject({
      status: "failed",
      reason: "tool_exception",
    });
    expect(JSON.stringify(failed)).not.toContain("credential=private");
    context.dispose();
  });

  it("keeps full-plan evidence and supplies only a prior-pass snapshot to synchronous save", async () => {
    const ports = capabilities();
    const snapshot: CompleteTrainingPlan = {
      plan: {
        title: "Plan",
        contentMarkdown: "Long complete evidence. ".repeat(300),
        revisedAt: "2026-09-21T00:00:00.000Z",
      },
      stale: false,
      staleAfterDays: 14,
    };
    const seen: (CompleteTrainingPlan | undefined)[] = [];
    ports.trainingPlan.readComplete = () => snapshot;
    ports.trainingPlan.saveGuarded = (_args, prior) => {
      seen.push(prior);
      return { ok: false, reason: "test_rejection" };
    };
    const samePass = scripted(
      [
        {
          toolCalls: [
            { toolName: "getTrainingPlan" },
            {
              toolName: "saveTrainingPlan",
              input: { contentMarkdown: "Replacement" },
            },
          ],
        },
      ],
      ports,
    );
    await samePass.run();
    expect(seen).toEqual([undefined]);
    const priorPass = scripted(
      [
        call("getTrainingPlan"),
        call("saveTrainingPlan", { contentMarkdown: "Replacement" }),
      ],
      ports,
    );
    const result = await priorPass.run();
    expect(seen[1]).toEqual(snapshot);
    expect(priorPass.requests[1].system).toContain(
      snapshot.plan!.contentMarkdown,
    );
    expect(JSON.stringify(result.grounding)).not.toContain(
      "Long complete evidence",
    );
    expect(JSON.stringify(result.debugTrace)).not.toContain("Replacement");
  });

  it("counts failed attempts and reserves exactly one tool-disabled synthesis without replay", async () => {
    const ports = capabilities();
    ports.analytics.runReadOnlySql = () => ({
      ...rows(0),
      status: "failed",
      reason: "sqlite_error",
      correctionAllowed: true,
    });
    const requests: TrainerGenerationRequest[] = [];
    let tools = 0;
    const result = await orchestrateTrainerChat(
      { system: "system", userRequest: "Explain evidence" },
      {
        generate: (request) => {
          requests.push(request);
          return Promise.resolve(
            request.purpose === "planner"
              ? call("runReadOnlySql", { sql: "select missing" })
              : incomplete("Evidence remains incomplete."),
          );
        },
        executeTool: (input) => {
          tools++;
          return executeTrainerTool(input, ports);
        },
      },
    );
    expect(requests.at(-1)?.purpose).toBe("final_synthesis");
    expect(result.providerCalls + tools).toBe(30);
    expect(result.progressCounters.toolsUnsuccessful).toBe(tools);
    expect(result.toolSteps.at(-1)?.reason).toBe("tool_budget_exceeded");
    expect(result.text).toBe("Evidence remains incomplete.");
  });

  it.each([
    { text: "" },
    { text: "Tool step 1: private" },
    { text: "Answer", toolCalls: [{}] },
  ])(
    "rejects invalid final synthesis without another provider call: %j",
    async (final) => {
      const ports = capabilities();
      ports.analytics.runReadOnlySql = () => ({
        ...rows(0),
        status: "rejected",
        reason: "blocked",
        correctionAllowed: false,
      });
      const test = scripted(
        [call("runReadOnlySql", { sql: "select value" }), final],
        ports,
      );
      const result = await test.run();
      expect(test.requests.map((request) => request.purpose)).toEqual([
        "planner",
        "final_synthesis",
      ]);
      expect(result.text).not.toBe(final.text);
      expect(result.providerCalls).toBe(2);
    },
  );

  it("uses supplied local-data reads and rejects unknown IDs before detail/connector access", async () => {
    const ports = capabilities();
    const journal: string[] = [];
    ports.localData.getActivityByGarminId = (id) => {
      journal.push(`lookup:${id}`);
      return null;
    };
    ports.localData.listActivityDetailAvailability = (limit) => {
      journal.push(`availability:${limit}`);
      return [];
    };
    for (const toolName of [
      "forceRefreshActivityDetail",
      "getActivityDetailSlice",
    ]) {
      const test = scripted([call(toolName, { garminId: "missing" })], ports);
      expect((await test.run()).toolSteps[0].reason).toBe(
        "unknown_activity_id",
      );
    }
    const read = scripted(
      [call("getActivityDetailAvailability"), coaching("No available detail.")],
      ports,
    );
    expect((await read.run()).toolSteps[0]).toMatchObject({
      status: "succeeded",
      result: [],
    });
    expect(journal).toEqual([
      "lookup:missing",
      "lookup:missing",
      "availability:10",
    ]);
  });

  it("awaits and sanitizes a rejected asynchronous connector capability", async () => {
    const ports = capabilities();
    ports.localData.runGarminSync = () =>
      Promise.reject(new Error("secret connector failure"));
    const test = scripted([call("runGarminSync")], ports);
    const result = await test.run();
    expect(result.toolSteps[0]).toMatchObject({
      status: "failed",
      reason: "tool_exception",
    });
    expect(result.progressCounters).toEqual({
      modelCalls: 1,
      toolsSucceeded: 0,
      toolsUnsuccessful: 1,
    });
    expect(JSON.stringify(result)).not.toContain("secret connector failure");
  });

  it("never replays an attempted plan side effect", async () => {
    const ports = capabilities();
    let writes = 0;
    ports.trainingPlan.saveGuarded = () => {
      writes++;
      return {
        ok: true,
        plan: {
          title: "Plan",
          contentMarkdown: "New plan",
          revisedAt: "2026-09-21T00:00:00Z",
        },
      };
    };
    const save = call("saveTrainingPlan", { contentMarkdown: "New plan" });
    const test = scripted([save, save], ports);
    const result = await test.run();
    expect(writes).toBe(1);
    expect(result.toolSteps.at(-1)?.reason).toBe("duplicate_side_effect");
    expect(result.progressCounters.toolsSucceeded).toBe(1);
  });

  it("isolates overlapping turns and disposes handles on an injected thrown exit", async () => {
    let release!: () => void;
    const paused = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered!: () => void;
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let firstContext: TrainerToolExecutionInput["context"] | undefined;
    const first = orchestrateTrainerChat(
      { system: "system", userRequest: "A" },
      {
        generate: () =>
          Promise.resolve(call("runReadOnlySql", { sql: "select 1" })),
        executeTool: async (input) => {
          firstContext = input.context;
          input.context.analysisResults.set("facts", [{ value: 1 }]);
          entered();
          await paused;
          expect(input.context.analysisResults.get("facts")).toEqual([
            { value: 1 },
          ]);
          throw new Error("injected outer exit");
        },
      },
    );
    const rejected = expect(first).rejects.toThrow("injected outer exit");
    await ready;
    const ports = capabilities();
    ports.analytics.runReadOnlySql = () => rows(2);
    const second = scripted(
      [
        call("runReadOnlySql", { sql: "select 2" }),
        coaching("Second completed."),
      ],
      ports,
    );
    await second.run();
    expect(firstContext).not.toBe(second.executions[0].context);
    expect(firstContext?.analysisResults.size).toBe(1);
    release();
    await rejected;
    expect(firstContext?.analysisResults.size).toBe(0);
  });
});
