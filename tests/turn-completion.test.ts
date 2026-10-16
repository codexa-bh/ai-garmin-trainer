import { expect, it, vi } from "vitest";
import { orchestrateTrainerChat } from "../src/lib/ai/orchestrator";
import { validatedCompletion } from "../src/lib/ai/turn-completion";
import type { TrainerGenerationResult } from "../src/lib/ai/orchestration-ports";
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
  expect(
    checked(grounded("Corrected", [metric(3, "monthly", "total_km", 84)]), [
      ...steps,
      sqlStep(3),
    ]),
  ).toBe("Corrected");
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
