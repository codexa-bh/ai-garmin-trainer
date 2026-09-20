import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TrainerToolExecutionContext } from "../src/lib/ai/tool-execution-context";

const { generateText, runReadOnlySql } = vi.hoisted(() => ({
  generateText: vi.fn(),
  runReadOnlySql: vi.fn(),
}));
vi.mock("ai", () => ({
  generateText,
  tool: (definition: unknown) => definition,
}));
vi.mock("@/lib/db/repository", () => ({
  TRAINING_PLAN_CONTENT_MAX_LENGTH: 32000,
  TRAINING_PLAN_TITLE_MAX_LENGTH: 120,
}));
vi.mock("@/lib/garmin/importer", () => ({}));
vi.mock("@/lib/ai/sql-analysis", () => ({ runReadOnlySql }));

import { orchestrateTrainerChat } from "../src/lib/ai/orchestrator";
import { executeTrainerTool } from "../src/lib/ai/tool-execution";
import { validateTrainerToolCall } from "../src/lib/ai/tool-contracts";

function barrier() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const sql = (name: string, value: number) => ({
  toolCalls: [
    {
      toolName: "runReadOnlySql",
      input: { sql: `select ${value} as value`, resultName: name },
    },
  ],
});
const math = (name: string) => ({
  toolCalls: [
    {
      toolName: "runMathAnalysis",
      input: {
        inputResult: name,
        operation: "score",
        formula: "value",
        outputName: "scores",
      },
    },
  ],
});
const turn = (userRequest: string) =>
  orchestrateTrainerChat({ model: "mock", system: "system", userRequest });

beforeEach(() => {
  generateText.mockReset();
  runReadOnlySql
    .mockReset()
    .mockImplementation((args: { sql: string; resultName: string }) => ({
      status: "succeeded",
      resultName: args.resultName,
      rows: [{ value: Number(args.sql.split(" ")[1]) }],
      rowCount: 1,
      returnedRows: 1,
      truncated: false,
      privacy: "synthetic bounded rows",
    }));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("within-turn analytical compatibility", () => {
  it("retains overwrite, math chaining, success-only registration and evidence after disposal", async () => {
    const context = new TrainerToolExecutionContext();
    const execute = (toolName: string, input: unknown) => {
      const call = validateTrainerToolCall({ toolName, input });
      if (!call.ok) throw new Error(call.reason);
      return executeTrainerTool({ ...call, index: 1, context });
    };
    await execute("runReadOnlySql", {
      sql: "select 11 as value",
      resultName: "shared",
    });
    const original = await execute("runReadOnlySql", {
      sql: "select 22 as value",
      resultName: "shared",
    });
    expect(context.analysisResults.get("shared")).toEqual([{ value: 22 }]);
    await execute("runMathAnalysis", {
      inputResult: "shared",
      operation: "score",
      formula: "value * 2",
      outputName: "double",
    });
    const chained = await execute("runMathAnalysis", {
      inputResult: "double",
      operation: "score",
      formula: "score + 1",
      outputName: "chain",
    });
    expect(chained).toMatchObject({
      status: "succeeded",
      result: { rows: [{ value: 22, score: 45 }] },
    });
    const missing = await execute("runMathAnalysis", {
      inputResult: "foreign",
      operation: "score",
      formula: "value",
      outputName: "shared",
    });
    expect(missing.status).toBe("rejected");
    runReadOnlySql.mockReturnValueOnce({
      status: "rejected",
      reason: "forbidden",
      resultName: "shared",
      rows: [],
      privacy: "safe",
    });
    await execute("runReadOnlySql", {
      sql: "select 33 as value",
      resultName: "shared",
    });
    expect(context.analysisResults.get("shared")).toEqual([{ value: 22 }]);
    context.dispose();
    expect(context.analysisResults.size).toBe(0);
    expect(original.result).toMatchObject({ rows: [{ value: 22 }] });
    expect(chained.result).toMatchObject({ rows: [{ score: 45 }] });
  });
});

describe("terminal context cleanup", () => {
  it.each([
    "success",
    "rejection",
    "provider failure",
    "tool failure",
    "timeout",
    "callback failure",
  ])(
    "releases registered rows on %s without erasing evidence",
    async (exit) => {
      const dispose = vi.spyOn(
        TrainerToolExecutionContext.prototype,
        "dispose",
      );
      generateText.mockResolvedValueOnce(sql("shared", 11));
      if (exit === "rejection")
        generateText.mockResolvedValueOnce({
          toolCalls: [{ toolName: "unknown", input: {} }],
        });
      else if (exit === "provider failure")
        generateText.mockRejectedValueOnce(new Error("provider failed"));
      else if (exit === "tool failure") {
        runReadOnlySql
          .mockImplementationOnce(() => ({
            status: "succeeded",
            resultName: "shared",
            rows: [{ value: 11 }],
            rowCount: 1,
            returnedRows: 1,
            privacy: "synthetic",
          }))
          .mockImplementationOnce(() => {
            throw new Error("private detail");
          });
        generateText.mockResolvedValueOnce(sql("failed", 22));
      } else if (exit === "timeout") {
        vi.useFakeTimers();
        generateText.mockImplementationOnce(() => new Promise(() => {}));
      }
      generateText.mockResolvedValue({ text: "Completed." });
      const pending = orchestrateTrainerChat({
        model: "mock",
        system: "system",
        userRequest: "A",
        onStatus:
          exit === "callback failure"
            ? () => {
                throw new Error("callback");
              }
            : undefined,
      });
      if (exit === "timeout") await vi.advanceTimersByTimeAsync(180_001);
      const result = await pending;
      expect(dispose).toHaveBeenCalledTimes(1);
      expect(dispose.mock.instances[0]).toHaveProperty(
        "analysisResults.size",
        0,
      );
      expect(result.toolSteps[0].result).toMatchObject({
        rows: [{ value: 11 }],
      });
    },
  );

  it("cleans a thrown orchestration exit", async () => {
    const dispose = vi.spyOn(TrainerToolExecutionContext.prototype, "dispose");
    await expect(
      orchestrateTrainerChat({
        model: "mock",
        system: "system",
        get userRequest(): string {
          throw new Error("input failed");
        },
      }),
    ).rejects.toThrow("input failed");
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(dispose.mock.instances[0]).toHaveProperty("analysisResults.size", 0);
  });

  it("allocates and disposes even a direct answer's context", async () => {
    const dispose = vi.spyOn(TrainerToolExecutionContext.prototype, "dispose");
    generateText.mockResolvedValue({ text: "Hello." });
    await turn("A");
    await turn("B");
    expect(dispose).toHaveBeenCalledTimes(2);
    expect(dispose.mock.instances[0]).not.toBe(dispose.mock.instances[1]);
  });
});

describe("real orchestration turn ownership", () => {
  it("starting and finishing B cannot clear paused A handles", async () => {
    const paused = barrier();
    const resume = barrier();
    let aCalls = 0;
    generateText.mockImplementation(async ({ prompt }: { prompt: string }) => {
      if (prompt === "B") return { text: "Ready." };
      aCalls += 1;
      if (aCalls === 1) return sql("shared", 11);
      if (aCalls === 2) {
        paused.resolve();
        await resume.promise;
        return math("shared");
      }
      return { text: "The calculated value is 11." };
    });
    const a = turn("A");
    await paused.promise;
    await turn("B");
    resume.resolve();
    const result = await a;
    expect(result.toolSteps[1]).toMatchObject({
      status: "succeeded",
      result: { rows: [{ value: 11, score: 11 }] },
    });
  });

  it("identical SQL and math names cannot overwrite or cross-read active turns", async () => {
    const aPaused = barrier();
    const bPaused = barrier();
    const resumeA = barrier();
    const resumeB = barrier();
    const calls = new Map<string, number>();
    generateText.mockImplementation(async ({ prompt }: { prompt: string }) => {
      const count = (calls.get(prompt) ?? 0) + 1;
      calls.set(prompt, count);
      if (count === 1) return sql("shared", prompt === "A" ? 11 : 22);
      if (count === 2) {
        if (prompt === "A") {
          aPaused.resolve();
          await resumeA.promise;
        } else {
          bPaused.resolve();
          await resumeB.promise;
        }
        return math("shared");
      }
      return { text: "The calculation is complete." };
    });
    const a = turn("A");
    await aPaused.promise;
    const b = turn("B");
    await bPaused.promise;
    resumeA.resolve();
    const resultA = await a;
    resumeB.resolve();
    const resultB = await b;
    expect(resultA.toolSteps[1]).toMatchObject({
      status: "succeeded",
      result: { rows: [{ value: 11, score: 11 }] },
    });
    expect(resultB.toolSteps[1]).toMatchObject({
      status: "succeeded",
      result: { rows: [{ value: 22, score: 22 }] },
    });
  });

  it("a foreign handle is unavailable even when its owner writes after B starts", async () => {
    const bPaused = barrier();
    const resumeB = barrier();
    let bCalls = 0;
    let aCalls = 0;
    generateText.mockImplementation(async ({ prompt }: { prompt: string }) => {
      if (prompt === "A")
        return ++aCalls === 1 ? sql("privateA", 11) : { text: "Ready." };
      if (++bCalls === 1) {
        bPaused.resolve();
        await resumeB.promise;
        return math("privateA");
      }
      return { text: "No available evidence." };
    });
    const b = turn("B");
    await bPaused.promise;
    await turn("A");
    resumeB.resolve();
    const result = await b;
    expect(result.toolSteps[0]).toMatchObject({
      status: "rejected",
      reason: "unknown_result",
    });
  });
});
