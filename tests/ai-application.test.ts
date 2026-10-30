import { describe, expect, it } from "vitest";
import {
  coaching,
  completion,
  grounded,
  incomplete,
  metric,
} from "./completion-fixtures";
import { orchestrateTrainerChat } from "../src/lib/ai/orchestrator";
import { executeTrainerTool } from "../src/lib/ai/tool-execution";
import type { TrainerToolPorts } from "../src/lib/ai/tool-ports";
import type { TrainerToolExecutionInput } from "../src/lib/ai/tool-execution-input";
import type {
  TrainerGenerationResult,
  TrainerGenerationRequest,
} from "../src/lib/ai/orchestration-ports";
import type { AnalysisResult } from "../src/lib/ai/analytics/contracts";
import {
  ANALYTICAL_SCHEMA,
  describeAnalyticalSchema,
} from "../src/lib/ai/analytics/schema";
import { interpretActivityReference } from "../src/lib/local-data/activity-policy";
import { TRAINER_SYSTEM_PROMPT } from "../src/lib/ai/trainer-instructions";
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
function scripted(
  results: (TrainerGenerationResult | Error)[],
  ports = capabilities(),
  currentDate = "2026-10-19",
) {
  const requests: TrainerGenerationRequest[] = [];
  const executions: TrainerToolExecutionInput[] = [];
  const run = () =>
    orchestrateTrainerChat(
      {
        system: "system",
        userRequest: "Explain evidence",
        turnContext: { currentDate },
        debug: { enabled: true },
      },
      {
        generate: (request) => {
          requests.push(request);
          const next = results.shift();
          if (!next) throw new Error("unexpected generation");
          if (next instanceof Error) return Promise.reject(next);
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
  it("hands the complete supported schema to fresh planning and reserved synthesis", async () => {
    const ports = capabilities();
    ports.analytics.describeGarminDatabase = () =>
      describeAnalyticalSchema(
        Object.fromEntries(
          Object.keys(ANALYTICAL_SCHEMA).map((name) => [name, { rowCount: 0 }]),
        ),
      );
    const test = scripted(
      [
        call("describeGarminDatabase"),
        new Error("synthetic failure after schema read"),
        incomplete(
          "No personal records were retrieved; section availability is not established.",
        ),
      ],
      ports,
    );
    const result = await test.run();
    expect(result.toolSteps.map((s) => s.tool)).toEqual([
      "describeGarminDatabase",
    ]);
    for (const request of test.requests.slice(1)) {
      expect(request.system).toContain("activity_calculated_grade columns:");
      expect(request.system).toContain("target_window_sec");
      expect(request.system).toContain("Parameterized grade relation:");
      expect(request.system).toContain("daily_health columns:");
      expect(request.system).toContain("body_battery");
      expect(request.system).toContain("Safe SQL examples:");
    }
    expect(test.requests.at(-1)?.purpose).toBe("final_synthesis");
  });

  it("keeps bounded detail coverage and omitted evidence explicit on a steepness correction", async () => {
    const requests: TrainerGenerationRequest[] = [];
    const result = await orchestrateTrainerChat(
      {
        system: TRAINER_SYSTEM_PROMPT,
        userRequest:
          "That was climbing density, not slope. Check the available sections rather than promising another analysis.",
      },
      {
        generate: (request) => {
          requests.push(request);
          if (requests.length === 1)
            return Promise.resolve(
              call("getActivityDetailSlice", {
                garminId: "synthetic",
                pointLimit: 3,
              }),
            );
          return Promise.resolve(
            incomplete(
              "Only a bounded slice is available; it is not whole-route evidence.",
            ),
          );
        },
        executeTool: (input) =>
          Promise.resolve({
            index: input.index,
            tool: "getActivityDetailSlice",
            status: "succeeded",
            summary:
              "Returned 3 normalized points and 0 bounded laps for synthetic.",
            privacy: "bounded",
            result: {
              totalPoints: 900,
              nextPointOffset: 3,
              availability: { hasGrade: false },
              laps: [],
              points: Array.from({ length: 3 }, (_, elapsedSec) => ({
                elapsedSec,
                distanceMeters: elapsedSec * 10,
                altitudeMeters: 100 + elapsedSec,
                label: "x".repeat(900),
              })),
            },
          }),
      },
    );
    expect(result.toolSteps).toHaveLength(1);
    expect(requests[1].system).toContain('"totalPoints":900');
    expect(requests[1].system).toContain('"nextPointOffset":3');
    expect(requests[1].system).toContain("Evidence text truncated");
    expect(requests[1].system).toContain("bounded slice");
  });

  it.each(["initial", "first challenge", "steepness correction"])(
    "executes event-relative summary/recovery and calculated-section evidence before %s completion",
    async (turn) => {
      const ports = capabilities();
      const evidence = [
        {
          resultName: "outings",
          rows: [
            {
              garmin_id: "synthetic-target",
              date: "2026-04-12",
              sport: "hiking",
              duration_sec: 7200,
            },
            {
              garmin_id: "synthetic-prior-1",
              date: "2026-04-11",
              sport: "cycling",
              duration_sec: 1800,
            },
            {
              garmin_id: "synthetic-prior-2",
              date: "2026-04-09",
              sport: "walking",
              duration_sec: 2400,
            },
          ],
        },
        {
          resultName: "recovery",
          rows: [
            {
              date: "2026-04-11",
              sleep_minutes: 410,
              hrv_ms: null,
              body_battery_avg: 0,
              availability: "partial",
            },
            {
              date: "2026-04-12",
              sleep_minutes: null,
              hrv_ms: null,
              body_battery_avg: null,
              availability: "missing",
            },
          ],
        },
        {
          resultName: "sections",
          rows: [
            {
              grade_method: "timestamp_altitude_distance_v1",
              target_window_sec: 180,
              valid_sections: 4,
              total_sections: 6,
              max_section_grade_pct: 12,
              source_grade_samples: 0,
            },
          ],
        },
      ];
      const queries: string[] = [];
      ports.analytics.runReadOnlySql = (input) => {
        queries.push(input.sql);
        const next = evidence.shift()!;
        return {
          status: "succeeded",
          ...next,
          columns: Object.keys(next.rows[0]).map((name) => ({ name })),
          rowCount: next.rows.length,
          returnedRows: next.rows.length,
          truncated: false,
          privacy: "synthetic bounded",
        };
      };
      ports.localData.verifyActivityReference = () => ({
        tool: "activityVerification",
        reference: {
          garminId: "synthetic-target",
          suppliedName: null,
          date: null,
        },
        outcome: "found",
        matches: [
          {
            garminId: "synthetic-target",
            label: "Synthetic hill outing",
            labelSource: "garmin",
            date: "2026-04-12",
            sport: "hiking",
            durationSec: 7200,
            distanceMeters: 8000,
            elevationGainMeters: 500,
            avgHeartRate: 135,
          },
        ],
        importedCoverage: {
          activityCount: 3,
          earliestDate: "2026-04-09",
          latestDate: "2026-04-12",
        },
        privacy: "synthetic bounded",
      });
      const responses = [
        call("verifyActivityReference", { garminId: "synthetic-target" }),
        call("runReadOnlySql", {
          sql: "select garmin_id, date(started_at/1000, 'unixepoch') as date, sport, duration_sec from activity where started_at <= unixepoch('2026-04-12T23:59:59Z')*1000 order by started_at desc limit 3",
        }),
        call("runReadOnlySql", {
          sql: "select date, sleep_minutes, hrv_ms, body_battery_avg, availability from daily_health where date between '2026-04-09' and '2026-04-12' order by date",
        }),
        call("runReadOnlySql", {
          sql: "select grade_method, target_window_sec, count(calculated_grade_pct) as valid_sections, count(*) as total_sections, max(calculated_grade_pct) as max_section_grade_pct from activity_calculated_grade('synthetic-target') group by grade_method, target_window_sec",
        }),
        completion({
          kind: "incomplete",
          answer:
            "The target and two preceding outings were checked across sports. Sleep is partial; estimated sections are not terrain or a measured fatigue/nutrition explanation. Enrichment is unavailable; pacing and recovery remain useful coaching options.",
          claims: [
            metric(2, "outings", "duration_sec", 7200),
            metric(3, "recovery", "sleep_minutes", 410),
            metric(4, "sections", "valid_sections", 4),
          ],
          missingEvidence: [
            "pre-event HRV",
            "complete section support",
            "terrain enrichment",
            "causation",
          ],
        }),
      ];
      const requests: TrainerGenerationRequest[] = [];
      const result = await orchestrateTrainerChat(
        {
          system: TRAINER_SYSTEM_PROMPT,
          userRequest:
            turn === "initial"
              ? "Why did synthetic-target feel unusually hard after my two previous outings? I had a small meal beforehand."
              : `${turn}: check the same event and preceding outings again; density is not slope.`,
          turnContext: { currentDate: "2026-10-30" },
        },
        {
          generate: (request) => {
            requests.push(request);
            return Promise.resolve(responses.shift()!);
          },
          executeTool: (input) => executeTrainerTool(input, ports),
        },
      );
      expect(result.toolSteps.map((s) => [s.tool, s.status])).toEqual([
        ["verifyActivityReference", "succeeded"],
        ...Array.from({ length: 3 }, () => ["runReadOnlySql", "succeeded"]),
      ]);
      expect(queries).toHaveLength(3);
      expect(queries[1]).toContain("2026-04-09");
      expect(queries[2]).toContain(
        "activity_calculated_grade('synthetic-target')",
      );
      expect(requests.at(-1)?.system).toContain('"sport":"cycling"');
      expect(requests.at(-1)?.system).toContain('"hrv_ms":null');
      expect(requests.at(-1)?.system).toContain('"body_battery_avg":0');
      expect(requests.at(-1)?.system).toContain('"valid_sections":4');
      expect(result.text).toContain("Enrichment is unavailable");
      expect(result.providerCalls).toBe(5);
    },
  );

  it("hands mismatched reference constraints back for a fresh ID-only verification", async () => {
    const ports = capabilities();
    const activity = {
      garminId: "synthetic-target",
      name: "Synthetic outing",
      sport: "hiking",
      startedAt: new Date("2026-04-12T10:00:00Z"),
      durationSec: 7200,
      distanceMeters: 8000,
      calories: null,
      avgHeartRate: null,
      maxHeartRate: null,
      steps: null,
      elevationGainMeters: 500,
      elevationLossMeters: null,
      trainingEffect: null,
    };
    ports.localData.verifyActivityReference = (input) =>
      interpretActivityReference([activity], input);
    const test = scripted(
      [
        call("verifyActivityReference", {
          garminId: activity.garminId,
          date: "2026-10-30",
          suppliedName: "Unrelated preview",
        }),
        call("verifyActivityReference", { garminId: activity.garminId }),
        incomplete(
          "The ID is imported; unsupported extra filters caused the first no-match. Detail/recovery analysis remains incomplete.",
        ),
      ],
      ports,
    );
    const result = await test.run();
    expect(
      result.toolSteps.map((s) => (s.result as { outcome: string }).outcome),
    ).toEqual(["not_found", "found"]);
    expect(test.requests[1].system).toContain(
      '"suppliedName":"Unrelated preview"',
    );
    expect(test.requests[1].system).toContain('"date":"2026-10-30"');
    expect(test.requests[1].system).toContain(
      "combined no-match does not prove the ID alone is absent",
    );
    expect(test.requests[2].system).toContain(
      "Found one local match: 2026-04-12",
    );
    expect(result.providerCalls).toBe(3);
  });

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

  it("recovers math on a fresh pass, drops stale batch work and grounds only corrected cells", async () => {
    const ports = capabilities();
    ports.analytics.runReadOnlySql = () => rows(7);
    const badMath = {
      toolName: "runMathAnalysis",
      input: {
        inputResult: "facts",
        operation: "score",
        formula: "missing_metric",
        outputName: "facts",
      },
    };
    const test = scripted(
      [
        call("runReadOnlySql", { sql: "select 7 as value" }),
        {
          toolCalls: [
            badMath,
            {
              toolName: "saveTrainingPlan",
              input: { contentMarkdown: "Must not execute stale batch" },
            },
          ],
        },
        call("runMathAnalysis", {
          inputResult: "facts",
          operation: "score",
          formula: "value * 2",
          outputName: "scores",
        }),
        grounded(
          "The transformed value is fourteen; stops are reported, not measured.",
          [metric(3, "scores", "score", 14)],
        ),
      ],
      ports,
    );
    const result = await test.run();
    expect(result.toolSteps.map((s) => s.status)).toEqual([
      "succeeded",
      "rejected",
      "succeeded",
    ]);
    expect(result.toolSteps[1]).toMatchObject({
      correctionAllowed: true,
      reason: "unknown_column",
      failureMessage: expect.any(String),
    });
    expect(test.requests.map((r) => r.purpose)).toEqual([
      "planner",
      "planner",
      "planner",
      "planner",
    ]);
    expect(test.requests[2].system).toContain('"currentDate":"2026-10-19"');
    expect(test.requests[2].system).toContain("Correction guidance:");
    expect(test.requests[2].system).toContain("value");
    expect(test.requests[2].system).not.toContain("missing_metric");
    expect(test.executions.map((e) => e.toolName)).toEqual([
      "runReadOnlySql",
      "runMathAnalysis",
      "runMathAnalysis",
    ]);
    expect(result.progressCounters).toEqual({
      modelCalls: 4,
      toolsSucceeded: 2,
      toolsUnsuccessful: 1,
    });
    expect(result.text).toContain("fourteen");
  });

  it.each([false, true])(
    "completes after rejected math and successful detail (corrected math: %s)",
    async (corrected) => {
      const ports = capabilities();
      ports.analytics.runReadOnlySql = () => rows(7);
      ports.localData.getActivityByGarminId = () => ({
        garminId: "synthetic",
        name: "Synthetic activity",
        sport: "hiking",
        startedAt: new Date("2026-10-22T10:00:00Z"),
        durationSec: 3600,
        distanceMeters: 6000,
        calories: null,
        avgHeartRate: 130,
        maxHeartRate: null,
        steps: null,
        elevationGainMeters: null,
        elevationLossMeters: null,
        trainingEffect: null,
      });
      ports.localData.getActivityDetailForAnalytics = () => ({
        activity: null,
        availability: null,
        session: null,
        derived: null,
        laps: [],
        stream: [],
      });
      const test = scripted(
        [
          call("runReadOnlySql", { sql: "select 7 as value" }),
          call("runMathAnalysis", {
            inputResult: "facts",
            operation: "score",
            formula: "missing_metric",
          }),
          call("getActivityDetailSlice", { garminId: "synthetic" }),
          corrected
            ? call("runMathAnalysis", {
                inputResult: "facts",
                operation: "score",
                formula: "value * 2",
                outputName: "scores",
              })
            : new Error("synthetic planner failure"),
          corrected
            ? grounded("The calculated value is fourteen.", [
                metric(4, "scores", "score", 14),
              ])
            : completion({
                kind: "incomplete",
                answer:
                  "The recorded value is seven; moving-time analysis is unavailable.",
                claims: [metric(1, "facts", "value", 7)],
                missingEvidence: ["moving time"],
              }),
        ],
        ports,
        "2026-10-22",
      );
      const result = await test.run();
      expect(test.requests[0].system).toContain('"currentDate":"2026-10-22"');
      expect(result.text).toBe(
        corrected
          ? "The calculated value is fourteen."
          : "The recorded value is seven; moving-time analysis is unavailable.",
      );
      expect(result.toolSteps.map((s) => [s.tool, s.status])).toEqual([
        ["runReadOnlySql", "succeeded"],
        ["runMathAnalysis", "rejected"],
        ["getActivityDetailSlice", "succeeded"],
        ...(corrected ? [["runMathAnalysis", "succeeded"]] : []),
      ]);
      expect(result.toolSteps[1].correctionAllowed).toBe(true);
      expect(test.requests.map((r) => r.purpose)).toEqual([
        "planner",
        "planner",
        "planner",
        "planner",
        corrected ? "planner" : "final_synthesis",
      ]);
      expect(test.requests.at(-1)?.system).toContain("unknown_column");
      expect(test.requests.at(-1)?.system).toContain('"value":7');
      expect(result.progressCounters).toEqual({
        modelCalls: 5,
        toolsSucceeded: corrected ? 3 : 2,
        toolsUnsuccessful: 1,
      });
      expect(result.debugTrace?.finalAnswerSource).toBe("provider");
      expect(result.debugTrace?.providerCalls.some((c) => c.error)).toBe(
        !corrected,
      );
      expect(test.executions[0].context.analysisResults.size).toBe(0);
    },
  );

  it.each([
    new Error("synthetic completion timeout"),
    { text: "unvalidated plain prose" },
    {
      toolCalls: [{ toolName: "runReadOnlySql", input: { sql: "select 99" } }],
    },
    grounded("Must not certify failed math", [metric(1, "facts", "value", 7)]),
    completion({
      kind: "incomplete",
      answer: "Wrong cell",
      claims: [metric(1, "facts", "value", 99)],
      missingEvidence: ["moving time"],
    }),
  ])(
    "keeps planner-error synthesis fail closed and never retries: %j",
    async (final) => {
      const ports = capabilities();
      ports.analytics.runReadOnlySql = () => rows(7);
      const test = scripted(
        [
          call("runReadOnlySql", { sql: "select 7 as value" }),
          call("runMathAnalysis", {
            inputResult: "facts",
            operation: "score",
            formula: "missing_metric",
          }),
          new Error("synthetic planner timeout"),
          final,
        ],
        ports,
      );
      const result = await test.run();
      expect(result.text).toContain("unknown_column");
      expect(result.debugTrace?.finalAnswerSource).toBe(
        "deterministic_fallback",
      );
      expect(result.providerCalls).toBe(4);
      expect(test.executions.map((e) => e.toolName)).toEqual([
        "runReadOnlySql",
        "runMathAnalysis",
      ]);
      expect(test.requests.at(-1)?.purpose).toBe("final_synthesis");
    },
  );

  it("uses only the last reserved execution when exploration throws at the hard boundary", async () => {
    const ports = capabilities();
    ports.analytics.runReadOnlySql = () => rows(7);
    const test = scripted(
      [
        ...Array.from({ length: 14 }, () =>
          call("runReadOnlySql", { sql: "select 7 as value" }),
        ),
        new Error("synthetic last planner failure"),
        grounded("The value is seven.", [metric(14, "facts", "value", 7)]),
      ],
      ports,
    );
    const result = await test.run();
    expect(result.text).toBe("The value is seven.");
    expect(result.providerCalls + test.executions.length).toBe(30);
    expect(test.requests.at(-1)?.purpose).toBe("final_synthesis");
  });

  it("does not retry a first-call provider failure with no executed evidence", async () => {
    const test = scripted([new Error("synthetic unavailable provider")]);
    const result = await test.run();
    expect(result.providerCalls).toBe(1);
    expect(test.executions).toEqual([]);
    expect(result.text).toContain("No Garmin tool was executed");
  });

  it("ends unchanged math failures with supported partial incomplete synthesis", async () => {
    const ports = capabilities();
    ports.analytics.runReadOnlySql = () => rows(7);
    const bad = call("runMathAnalysis", {
      inputResult: "facts",
      operation: "score",
      formula: "missing_metric",
    });
    const test = scripted(
      [
        call("runReadOnlySql", { sql: "select 7 as value" }),
        bad,
        bad,
        completion({
          kind: "incomplete",
          answer:
            "The observed value is seven; adjusted moving time remains unavailable.",
          claims: [metric(1, "facts", "value", 7)],
          missingEvidence: ["moving time"],
        }),
      ],
      ports,
    );
    const result = await test.run();
    expect(test.requests.map((r) => r.purpose)).toEqual([
      "planner",
      "planner",
      "planner",
      "final_synthesis",
    ]);
    expect(result.toolSteps.map((s) => s.status)).toEqual([
      "succeeded",
      "rejected",
      "rejected",
    ]);
    expect(result.text).toContain("unavailable");
    expect(result.providerCalls + test.executions.length).toBe(7);
  });

  it("keeps changed math failures within the shared budget and reserves final synthesis", async () => {
    const ports = capabilities();
    ports.analytics.runReadOnlySql = () => rows(7);
    const results = [
      call("runReadOnlySql", { sql: "select 7 as value" }),
      ...Array.from({ length: 14 }, (_, i) =>
        call("runMathAnalysis", {
          inputResult: "facts",
          operation: "score",
          formula: `missing_${i}`,
        }),
      ),
      incomplete("Missing fields prevent the calculation."),
    ];
    const test = scripted(results, ports);
    const result = await test.run();
    expect(test.requests.at(-1)?.purpose).toBe("final_synthesis");
    expect(result.providerCalls + test.executions.length).toBe(30);
    expect(result.progressCounters.toolsSucceeded).toBe(1);
    expect(result.progressCounters.toolsUnsuccessful).toBe(13);
    expect(result.toolSteps.at(-1)?.reason).toBe("tool_budget_exceeded");
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

  it("preserves successful handles on math rejection and never publishes failed or foreign-turn handles", async () => {
    const { TrainerToolExecutionContext } =
      await import("../src/lib/ai/tool-execution-context");
    const { validatedCompletion } =
      await import("../src/lib/ai/turn-completion");
    const ports = capabilities();
    const context = new TrainerToolExecutionContext();
    context.analysisResults.set("facts", [{ value: 7 }]);
    const reject = (outputName: string, activeContext = context) =>
      executeTrainerTool(
        {
          context: activeContext,
          index: 1,
          toolName: "runMathAnalysis",
          input: {
            inputResult: "facts",
            operation: "score",
            formula: "missing_metric",
            outputName,
            limit: 10,
          },
        },
        ports,
      );
    const failed = await reject("failed_output");
    await reject("facts");
    expect(context.analysisResults.get("facts")).toEqual([{ value: 7 }]);
    expect(context.analysisResults.has("failed_output")).toBe(false);
    const otherTurn = new TrainerToolExecutionContext();
    expect(await reject("scores", otherTurn)).toMatchObject({
      reason: "unknown_result",
      correctionAllowed: undefined,
    });
    expect(
      validatedCompletion(
        {
          completion: {
            kind: "grounded",
            answer: "Not evidence",
            claims: [metric(1, "failed_output", "score", 7)],
            missingEvidence: [],
          },
        },
        [failed],
      ),
    ).toBeNull();
    context.dispose();
    otherTurn.dispose();
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

  it.each([false, true])(
    "never replays an attempted plan side effect (planner failure: %s)",
    async (plannerFailure) => {
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
      const test = scripted(
        plannerFailure
          ? [save, new Error("synthetic planner failure after save"), save]
          : [save, save],
        ports,
      );
      const result = await test.run();
      expect(writes).toBe(1);
      if (plannerFailure) {
        expect(test.requests.map((r) => r.purpose)).toEqual([
          "planner",
          "planner",
          "final_synthesis",
        ]);
        expect(result.toolSteps).toHaveLength(1);
        expect(result.text).toContain("Already saved: saveTrainingPlan");
      } else {
        expect(result.toolSteps.at(-1)?.reason).toBe("duplicate_side_effect");
      }
      expect(result.progressCounters.toolsSucceeded).toBe(1);
    },
  );

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
