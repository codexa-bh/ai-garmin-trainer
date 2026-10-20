import { trainerCompletionSchema } from "./tool-contracts";
import type { CompletionRejection, TrainerToolStep } from "./tool-types";

export const COMPLETION_TOOL = "completeTrainerTurn";
export const COMPLETION_LIMITATION =
  "I could not validate the model's completion or its declared evidence. No unverified personal metrics are being presented as checked. Please retry.";

type CompletionAssessment =
  | { answer: string; rejection?: never }
  | { answer: null; rejection: CompletionRejection };

/** Validate declared facts, not prose; diagnostics never include claim values. */
export function assessCompletion(
  input: unknown,
  steps: TrainerToolStep[],
): CompletionAssessment {
  const parsed = trainerCompletionSchema.safeParse(input);
  if (!parsed.success) {
    const invalidToolClaim = parsed.error.issues.find(
      (issue) =>
        issue.code === "invalid_value" &&
        issue.path.length === 4 &&
        issue.path[0] === "completion" &&
        issue.path[1] === "claims" &&
        typeof issue.path[2] === "number" &&
        issue.path[3] === "tool",
    );
    if (invalidToolClaim)
      return {
        answer: null,
        rejection: {
          reason: "invalid_tool_claim",
          claimIndex: invalidToolClaim.path[2] as number,
        },
      };
    return {
      answer: null,
      rejection: {
        reason: parsed.error.issues.some(
          (issue) =>
            issue.code === "custom" &&
            issue.path.length === 1 &&
            issue.path[0] === "completion",
        )
          ? "kind_evidence_conflict"
          : "invalid_schema",
      },
    };
  }
  const completion = parsed.data.completion;
  if (completion.kind === "coaching") return { answer: completion.answer };
  const latestMetric = [...steps]
    .reverse()
    .find(
      (step) =>
        step.tool === "runReadOnlySql" || step.tool === "runMathAnalysis",
    );
  for (const [claimIndex, claim] of completion.claims.entries()) {
    const rejected = (
      reason: CompletionRejection["reason"],
    ): CompletionAssessment => ({
      answer: null,
      rejection: { reason, claimIndex },
    });
    const step = steps.find((step) => step.index === claim.stepIndex);
    if (!step || step.status !== "succeeded")
      return rejected("step_not_succeeded");
    if (claim.kind === "tool") {
      if (step.tool !== claim.tool) return rejected("tool_mismatch");
      continue;
    }
    if (step.tool !== "runReadOnlySql" && step.tool !== "runMathAnalysis")
      return rejected("metric_step_required");
    if (completion.kind === "grounded" && latestMetric?.status !== "succeeded")
      return rejected("latest_metric_unsuccessful");
    if (!step.result || typeof step.result !== "object")
      return rejected("result_mismatch");
    const result = step.result as Record<string, unknown>;
    if (
      result.status !== "succeeded" ||
      result.resultName !== claim.resultName ||
      !Array.isArray(result.rows)
    )
      return rejected("result_mismatch");
    const row: unknown = result.rows[claim.rowIndex];
    if (
      !row ||
      typeof row !== "object" ||
      !Object.hasOwn(row, claim.column) ||
      (row as Record<string, unknown>)[claim.column] !== claim.value
    )
      return rejected("cell_mismatch");
  }
  return { answer: completion.answer };
}

export function validatedCompletion(
  input: unknown,
  steps: TrainerToolStep[],
): string | null {
  return assessCompletion(input, steps).answer;
}
