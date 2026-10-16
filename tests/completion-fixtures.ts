import type { TrainerGenerationResult } from "../src/lib/ai/orchestration-ports";

export const finalToolChoice = "auto";
export function isFinalSynthesis(options: {
  tools?: Record<string, unknown>;
}): boolean {
  return Boolean(
    options.tools &&
    Object.keys(options.tools).length === 1 &&
    Object.hasOwn(options.tools, "completeTrainerTurn"),
  );
}
export function completion(completion: unknown): TrainerGenerationResult {
  return {
    toolCalls: [{ toolName: "completeTrainerTurn", input: { completion } }],
  };
}
export const coaching = (answer: string) =>
  completion({ kind: "coaching", answer, claims: [], missingEvidence: [] });
export const incomplete = (answer: string) =>
  completion({
    kind: "incomplete",
    answer,
    claims: [],
    missingEvidence: ["requested evidence remains unavailable"],
  });
export const grounded = (answer: string, claims: unknown[]) =>
  completion({ kind: "grounded", answer, claims, missingEvidence: [] });
export const metric = (
  stepIndex: number,
  resultName: string,
  column: string,
  value: string | number | boolean,
  rowIndex = 0,
) => ({ kind: "metric", stepIndex, resultName, rowIndex, column, value });
export const toolClaim = (stepIndex: number, tool: string) => ({
  kind: "tool",
  stepIndex,
  tool,
});
