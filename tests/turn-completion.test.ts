import { expect, it, vi } from "vitest";
import { orchestrateTrainerChat } from "../src/lib/ai/orchestrator";
import {
  assessCompletion,
  validatedCompletion,
} from "../src/lib/ai/turn-completion";
import type {
  TrainerGenerationRequest,
  TrainerGenerationResult,
} from "../src/lib/ai/orchestration-ports";
import type { TrainerToolStep } from "../src/lib/ai/tool-types";
import {
  completion,
  coaching,
  grounded,
  incomplete,
  metric,
  toolClaim,
} from "./completion-fixtures";

import { debugProviderCall } from "../src/lib/ai/debug-trace";

it("retains terminal kind/count diagnostics without retaining answer/document arguments", () => {
  const result = coaching(
    "Private complete weekly content must not leak through native response arguments.",
  );
  const trace = debugProviderCall({
    index: 1,
    purpose: "direct_answer",
    toolCalls: result.toolCalls as Array<{ toolName: string; input: unknown }>,
  });
  expect(trace.toolCalls?.[0].input).toEqual({
    schemaValid: true,
    schemaIssues: [],
    completionKind: "coaching",
    declaredClaims: 0,
    missingEvidenceCount: 0,
    answerContent: "omitted",
  });
  expect(JSON.stringify(trace)).not.toContain(
    "Private complete weekly content",
  );
});

const breathing =
  "I'll explain how to check your breathing on hikes. First review your effort and HR in Z3; ventilation rises with CO2 production. Slow your pace if speaking becomes difficult; do not force a fixed breathing ratio.";
const run = (
  result: TrainerGenerationResult,
  userRequest = "How should I breathe on steep hikes while staying in Z3?",
) => {
  const executeTool = vi.fn();
  const generate = vi.fn(async () => result);
  return {
    executeTool,
    generate,
    result: orchestrateTrainerChat(
      { system: "context", userRequest },
      { generate, executeTool },
    ),
  };
};

it.each([
  "How should I breathe on steep hikes while staying in Z3?",
  "Kako disati na strmom usponu?",
  "Do not check my Garmin totals; explain physiology, compare breathing patterns.",
  "I hike in Z3 and want general guidance, not yesterday's recovery metrics.",
])(
  "retains substantive no-tool breathing coaching independently of request wording: %s",
  async (request) => {
    const test = run(coaching(breathing), request);
    const result = await test.result;
    expect(result.text).toBe(breathing);
    expect(result.toolSteps).toEqual([]);
    expect(result.providerCalls).toBe(1);
    expect(test.executeTool).not.toHaveBeenCalled();
  },
);

it.each([
  '"I will check Garmin" is a quoted example, not an action.',
  '```json\n{"example":"review your hikes"}\n```\nThis is an example of formatting.',
  "Evidence step 1: is just a label in this explanation, not execution.",
  "Privacy: check your breathing, not a database. General ventilation may double as effort rises.",
])("does not classify completed answer prose: %s", async (answer) => {
  expect((await run(coaching(answer)).result).text).toBe(answer);
});

it("retains an explicitly incomplete check without treating it as verified evidence", async () => {
  const result = await run(
    incomplete(
      "Your imported recovery has not been checked. General breathing advice is still available.",
    ),
  ).result;
  expect(result.text).toContain("has not been checked");
  expect(result.grounding).toBeNull();
  expect(result.providerCalls).toBe(1);
});

it.each([
  { kind: "coaching", answer: "", extra: true },
  {
    kind: "coaching",
    answer: "text",
    claims: [],
    missingEvidence: [],
    extra: true,
  },
  {
    kind: "coaching",
    answer: "text",
    claims: [toolClaim(1, "getSyncStatus")],
    missingEvidence: [],
  },
  {
    kind: "coaching",
    answer: "text",
    claims: [],
    missingEvidence: ["unfinished"],
  },
  { kind: "grounded", answer: "text", claims: [], missingEvidence: [] },
  { kind: "incomplete", answer: "text", claims: [], missingEvidence: [] },
  {
    kind: "incomplete",
    answer: "text",
    claims: [toolClaim(1, "getSyncStatus")],
    missingEvidence: ["unfinished"],
  },
  { kind: "coaching", answer: "valid text", extra: true },
  { kind: "complete", answer: "unknown enum" },
  { kind: "grounded", answer: "verified", claims: [] },
  { kind: "incomplete", answer: "pending", missingEvidence: [] },
  { kind: "coaching", answer: "pending", claims: [] },
  { kind: "incomplete", answer: "pending" },
  { kind: "coaching", answer: 42 },
])(
  "rejects malformed/missing contract state without prose inference: %j",
  async (input) => {
    const test = run(completion(input));
    const result = await test.result;
    expect(result.text).toContain("could not validate");
    expect(test.executeTool).not.toHaveBeenCalled();
    expect(result.providerCalls).toBe(2); // one bounded final synthesis, no retry loop
  },
);

it.each([
  { text: "I verified all your imported totals." },
  { toolCalls: [null, { toolName: "runGarminSync", input: {} }] },
  {
    toolCalls: [
      {
        toolName: "completeTrainerTurn",
        input: { completion: { kind: "coaching", answer: "Done" } },
      },
      { toolName: "runGarminSync", input: {} },
    ],
  },
  { toolCalls: [{ toolName: "completeTrainerTurn", input: "bad JSON" }] },
])(
  "rejects raw text, malformed entries and conflicting terminal/actions: %j",
  async (input) => {
    const test = run(input);
    expect((await test.result).text).toContain("could not validate");
    expect(test.executeTool).not.toHaveBeenCalled();
  },
);

function sqlStep(index = 1): TrainerToolStep {
  return {
    index,
    tool: "runReadOnlySql",
    status: "succeeded",
    summary: "Returned aggregate",
    privacy: "bounded",
    result: {
      status: "succeeded",
      resultName: "monthly",
      rows: [
        { month: "2026-07", total_km: 84 },
        { month: "2026-08", total_km: 42 },
      ],
    },
  };
}
const checked = (result: TrainerGenerationResult, steps: TrainerToolStep[]) =>
  validatedCompletion(
    (result.toolCalls?.[0] as { input: unknown }).input,
    steps,
  );

it("accepts exact current-turn aggregate/correction evidence, not a boolean or any successful query", () => {
  const result = grounded(
    "July 84 km; August 42 km. This corrects the earlier count.",
    [
      metric(1, "monthly", "total_km", 84),
      metric(1, "monthly", "total_km", 42, 1),
    ],
  );
  expect(checked(result, [sqlStep()])).toContain("July 84");
  expect(checked(result, [])).toBeNull();
  expect(checked(result, [sqlStep(2)])).toBeNull();
  expect(checked(result, [{ ...sqlStep(), tool: "getSyncStatus" }])).toBeNull();
  expect(checked(result, [{ ...sqlStep(), status: "failed" }])).toBeNull();
  expect(checked(result, [{ ...sqlStep(), status: "rejected" }])).toBeNull();
});

it.each([
  metric(1, "forged-or-stale", "total_km", 84),
  metric(99, "monthly", "total_km", 84),
  metric(1, "monthly", "calories", 84),
  metric(1, "monthly", "total_km", 85),
  metric(1, "monthly", "total_km", 84, 5),
  metric(1, "monthly", "total_km", "84"),
  { ...metric(1, "monthly", "total_km", 84), value: null },
  { kind: "tool", stepIndex: 1, tool: "runReadOnlySql" },
])(
  "rejects forged, irrelevant, stale, out-of-range or wrongly typed metric evidence: %j",
  (claim) => {
    expect(
      checked(grounded("Do not display this claim", [claim]), [sqlStep()]),
    ).toBeNull();
  },
);

it("does not certify partial metric success after an unresolved later failure; allows honest incomplete advice", () => {
  const steps: TrainerToolStep[] = [
    sqlStep(),
    {
      index: 2,
      tool: "runMathAnalysis",
      status: "failed",
      reason: "invalid_formula",
      summary: "Calculation failed",
      privacy: "bounded",
    },
  ];
  expect(
    checked(
      grounded("All verified", [metric(1, "monthly", "total_km", 84)]),
      steps,
    ),
  ).toBeNull();
  expect(
    checked(
      incomplete(
        "The retrieved distance does not establish the requested total; calculation failed.",
      ),
      steps,
    ),
  ).toContain("calculation failed");
  const partial = (value: number) =>
    completion({
      kind: "incomplete",
      answer: "Available July distance is 84 km; requested calculation failed.",
      claims: [metric(1, "monthly", "total_km", value)],
      missingEvidence: ["failed calculation"],
    });
  expect(checked(partial(84), steps)).toContain("calculation failed");
  expect(checked(partial(85), steps)).toBeNull();
  expect(
    checked(grounded("Corrected", [metric(3, "monthly", "total_km", 84)]), [
      ...steps,
      sqlStep(3),
    ]),
  ).toBe("Corrected");
});

it("allows schema observations for missing-field explanations but never for metric verification", () => {
  const step: TrainerToolStep = {
    index: 1,
    tool: "describeGarminDatabase",
    status: "succeeded",
    summary: "Schema inspected",
    privacy: "bounded",
  };
  const output = completion({
    kind: "incomplete",
    answer: "Pack weight is not recorded in the schema; it remains unknown.",
    claims: [toolClaim(1, "describeGarminDatabase")],
    missingEvidence: ["backpack weight"],
  });
  expect(checked(output, [step])).toContain("remains unknown");
  expect(checked(output, [{ ...step, status: "failed" }])).toBeNull();
  expect(
    checked(grounded("Weight 5 kg", [metric(1, "schema", "weight", 5)]), [
      step,
    ]),
  ).toBeNull();
});

it("validates non-analytical claims against actual successful tool identity", () => {
  const claim = grounded("Status checked", [toolClaim(1, "getSyncStatus")]);
  const step: TrainerToolStep = {
    index: 1,
    tool: "getSyncStatus",
    status: "succeeded",
    summary: "status",
    privacy: "bounded",
  };
  expect(checked(claim, [step])).toBe("Status checked");
  expect(
    checked(claim, [{ ...step, tool: "describeGarminDatabase" }]),
  ).toBeNull();
  expect(checked(claim, [{ ...step, status: "failed" }])).toBeNull();
});

it("explains a rejected late-step declaration to the existing reserved synthesis without replaying tools", async () => {
  const steps: TrainerToolStep[] = [
    {
      index: 1,
      tool: "describeGarminDatabase",
      status: "succeeded",
      summary: "Schema available",
      privacy: "bounded",
      result: { tables: [], examples: [], forbiddenDataClasses: [] },
    },
    ...Array.from({ length: 8 }, (_, offset): TrainerToolStep => ({
      index: offset + 2,
      tool: offset % 2 === 0 ? "runReadOnlySql" : "runMathAnalysis",
      status: "succeeded",
      summary: "Synthetic bounded evidence",
      privacy: "bounded",
      result: {
        status: "succeeded",
        resultName: `facts_${offset + 2}`,
        operation: "score",
        inputResult: `facts_${offset + 1}`,
        rows: [{ value: offset + 0.123456789 }],
        returnedRows: 1,
        rowCount: 1,
      },
    })),
  ];
  const invalid = grounded("Unverified rounded value", [
    metric(9, "facts_9", "value", 7.12),
  ]);
  expect(checked(invalid, steps)).toBeNull();
  const executeTool = vi.fn(
    async ({ index }: { index: number }) => steps[index - 1],
  );
  const generate = vi.fn(
    async ({ purpose, system }: TrainerGenerationRequest) => {
      const next = steps[executeTool.mock.calls.length];
      if (next)
        return {
          toolCalls: [
            {
              toolName: next.tool,
              input:
                next.tool === "describeGarminDatabase"
                  ? {}
                  : next.tool === "runReadOnlySql"
                    ? { sql: "select 7 as value" }
                    : {
                        inputResult: `facts_${next.index - 1}`,
                        operation: "score",
                        formula: "value",
                        outputName: `facts_${next.index}`,
                      },
            },
          ],
        };
      if (purpose === "planner") return invalid;
      expect(system).toContain('"reason":"cell_mismatch"');
      expect(system).toContain('"claimIndex":0');
      expect(system).not.toContain("Unverified rounded value");
      return grounded(
        "The exact available value is supported; the correction is acknowledged without asserting identical routes.",
        [metric(9, "facts_9", "value", 7.123456789)],
      );
    },
  );
  const result = await orchestrateTrainerChat(
    {
      system: "Earlier assistant comparison is not measurement authority.",
      userRequest:
        "Just because activity is called Vrh Zakotja, does not mean the route was the same every time",
    },
    { generate, executeTool },
  );
  expect(result.text).toContain("exact available value is supported");
  expect(result.toolSteps).toEqual(steps);
  expect(executeTool).toHaveBeenCalledTimes(9);
  expect(result.providerCalls).toBe(11);
  expect(result.progressCounters.toolsUnsuccessful).toBe(0);
});

it.each([
  [metric(1, "monthly", "total_km", "84"), "cell_mismatch"],
  [metric(1, "monthly", "total_km", 84, 2), "cell_mismatch"],
  [metric(1, "monthly", "absent", 84), "cell_mismatch"],
  [metric(1, "stale", "total_km", 84), "result_mismatch"],
  [metric(99, "monthly", "total_km", 84), "step_not_succeeded"],
  [toolClaim(1, "getSyncStatus"), "tool_mismatch"],
])(
  "keeps invalid recovery rejected and reports structural feedback only: %j",
  async (claim, reason) => {
    const invalid = grounded(
      "Private rejected answer must not enter feedback",
      [claim],
    );
    const requests: Array<{ purpose: string; system: string }> = [];
    const executeTool = vi.fn(async () => sqlStep());
    const generate = vi.fn(async (request: TrainerGenerationRequest) => {
      expect(typeof request.system).toBe("string");
      requests.push({
        purpose: request.purpose,
        system: request.system as string,
      });
      return requests.length === 1
        ? {
            toolCalls: [
              {
                toolName: "runReadOnlySql",
                input: { sql: "select 84 as total_km" },
              },
            ],
          }
        : invalid;
    });
    const result = await orchestrateTrainerChat(
      {
        system: "context",
        userRequest: "Correct the comparison",
        debug: { enabled: true },
      },
      { generate, executeTool },
    );
    expect(result.text).toContain("could not validate");
    expect(result.providerCalls).toBe(3);
    expect(executeTool).toHaveBeenCalledTimes(1);
    expect(requests[2].purpose).toBe("final_synthesis");
    expect(requests[2].system).toContain(
      JSON.stringify({ reason, claimIndex: 0 }),
    );
    expect(requests[2].system).not.toContain("Private rejected answer");
    const metadata = result.debugTrace?.providerCalls[2].toolCalls?.[0].input;
    expect(metadata).toMatchObject({
      rejection: { reason, claimIndex: 0 },
      answerContent: "omitted",
    });
    expect(JSON.stringify(metadata)).not.toContain("Private rejected answer");
  },
);

it.each(["kind_evidence_conflict", "invalid_tool_claim"])(
  "identifies live declaration error %s so synthesis preserves gaps and valid partial claims",
  async (reason) => {
    const invalid = completion({
      kind: "grounded",
      answer:
        "July distance is available, but the requested comparison is unverified.",
      claims:
        reason === "invalid_tool_claim"
          ? [
              { kind: "tool", stepIndex: 1, tool: "runReadOnlySql" },
              metric(1, "monthly", "total_km", 84),
            ]
          : [metric(1, "monthly", "total_km", 84)],
      missingEvidence: ["comparison evidence"],
    });
    const fixed = completion({
      kind: "incomplete",
      answer: "July distance is 84 km; the comparison remains unverified.",
      claims: [metric(1, "monthly", "total_km", 84)],
      missingEvidence: ["comparison evidence"],
    });
    const systems: string[] = [];
    const executeTool = vi.fn(async () => sqlStep());
    const generate = vi.fn(
      async ({ purpose, system }: TrainerGenerationRequest) => {
        expect(typeof system).toBe("string");
        systems.push(system as string);
        if (systems.length === 1)
          return {
            toolCalls: [
              {
                toolName: "runReadOnlySql",
                input: { sql: "select 84 as total_km" },
              },
            ],
          };
        if (
          purpose === "final_synthesis" &&
          typeof system === "string" &&
          system.includes(`"reason":"${reason}"`)
        )
          return fixed;
        return invalid;
      },
    );
    const result = await orchestrateTrainerChat(
      { system: "context", userRequest: "Correct the unsupported comparison" },
      { generate, executeTool },
    );
    expect(result.text).toBe(
      "July distance is 84 km; the comparison remains unverified.",
    );
    expect(systems[2]).toContain("Do not discard known gaps");
    if (reason === "invalid_tool_claim")
      expect(systems[2]).toContain(
        "runReadOnlySql and runMathAnalysis are not valid tool claims",
      );
    expect(executeTool).toHaveBeenCalledTimes(1);
    expect(result.providerCalls).toBe(3);
    expect(checked(invalid, [sqlStep()])).toBeNull();
    expect(checked(fixed, [])).toBeNull();
  },
);

it("provides bounded reasons without changing incomplete partial-claim and failure semantics", () => {
  const input = (result: TrainerGenerationResult) =>
    (result.toolCalls?.[0] as { input: unknown }).input;
  const failed: TrainerToolStep = { ...sqlStep(2), status: "failed" };
  const valid = grounded("private", [metric(1, "monthly", "total_km", 84)]);
  expect(assessCompletion({}, [])).toEqual({
    answer: null,
    rejection: { reason: "invalid_schema" },
  });
  expect(
    assessCompletion(input(valid), [{ ...sqlStep(), tool: "getSyncStatus" }]),
  ).toEqual({
    answer: null,
    rejection: { reason: "metric_step_required", claimIndex: 0 },
  });
  expect(assessCompletion(input(valid), [sqlStep(), failed])).toEqual({
    answer: null,
    rejection: { reason: "latest_metric_unsuccessful", claimIndex: 0 },
  });
  const partial = completion({
    kind: "incomplete",
    answer: "Only July distance is available; calculation failed.",
    claims: [metric(1, "monthly", "total_km", 84)],
    missingEvidence: ["calculation"],
  });
  expect(
    assessCompletion(input(partial), [sqlStep(), failed]).answer,
  ).toContain("calculation failed");
  const secondBad = grounded("private", [
    metric(1, "monthly", "total_km", 84),
    metric(1, "monthly", "total_km", 42),
  ]);
  expect(assessCompletion(input(secondBad), [sqlStep()])).toEqual({
    answer: null,
    rejection: { reason: "cell_mismatch", claimIndex: 1 },
  });
});

it("does not extract authoritative dates from system prose or rewrite an explicit model answer", async () => {
  const generate = vi.fn(async () =>
    coaching("No clock assertion is made here."),
  );
  const result = await orchestrateTrainerChat(
    {
      system: "Server current date basis: 1900-01-01",
      userRequest: "what date?",
      turnContext: { currentDate: "2026-10-16" },
    },
    { generate, executeTool: vi.fn() },
  );
  expect(result.text).toBe("No clock assertion is made here.");
  expect(generate).toHaveBeenCalledWith(
    expect.objectContaining({
      system: expect.stringContaining('"currentDate":"2026-10-16"'),
    }),
  );
});
