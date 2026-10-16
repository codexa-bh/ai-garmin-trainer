import { trainerCompletionSchema } from "./tool-contracts";
import type { TrainerToolStep } from "./tool-types";

export const COMPLETION_TOOL = "completeTrainerTurn";
export const COMPLETION_LIMITATION =
  "I could not validate the model's completion or its declared evidence. No unverified personal metrics are being presented as checked. Please retry.";

/** Validate declared facts, not the meaning of user or answer prose. */
export function validatedCompletion(
  input: unknown,
  steps: TrainerToolStep[],
): string | null {
  const parsed = trainerCompletionSchema.safeParse(input);
  if (!parsed.success) return null;
  const completion = parsed.data.completion;
  if (completion.kind !== "grounded") return completion.answer;
  const latestMetric = [...steps]
    .reverse()
    .find(
      (step) =>
        step.tool === "runReadOnlySql" || step.tool === "runMathAnalysis",
    );
  for (const claim of completion.claims) {
    const step = steps.find((step) => step.index === claim.stepIndex);
    if (!step || step.status !== "succeeded") return null;
    if (claim.kind === "tool") {
      if (step.tool !== claim.tool) return null;
      continue;
    }
    if (
      (step.tool !== "runReadOnlySql" && step.tool !== "runMathAnalysis") ||
      latestMetric?.status !== "succeeded" ||
      !step.result ||
      typeof step.result !== "object"
    )
      return null;
    const result = step.result as Record<string, unknown>;
    if (
      result.status !== "succeeded" ||
      result.resultName !== claim.resultName ||
      !Array.isArray(result.rows)
    )
      return null;
    const row: unknown = result.rows[claim.rowIndex];
    if (
      !row ||
      typeof row !== "object" ||
      !Object.hasOwn(row, claim.column) ||
      (row as Record<string, unknown>)[claim.column] !== claim.value
    )
      return null;
  }
  return completion.answer;
}
