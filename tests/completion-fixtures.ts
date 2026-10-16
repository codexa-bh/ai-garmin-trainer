import type { TrainerGenerationResult } from "../src/lib/ai/orchestration-ports";

export const finalToolChoice = {
  type: "tool",
  toolName: "completeTrainerTurn",
};
export function completion(completion: unknown): TrainerGenerationResult {
  return {
    toolCalls: [{ toolName: "completeTrainerTurn", input: { completion } }],
  };
}
export const coaching = (answer: string) =>
  completion({ kind: "coaching", answer });
export const incomplete = (answer: string) =>
  completion({
    kind: "incomplete",
    answer,
    missingEvidence: ["requested evidence remains unavailable"],
  });
export const grounded = (answer: string, claims: unknown[]) =>
  completion({ kind: "grounded", answer, claims });
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
