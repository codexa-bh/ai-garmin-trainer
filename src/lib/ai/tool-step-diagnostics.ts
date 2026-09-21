import type { TrainerToolStep, TrainerToolStepName } from "./tool-types";

export function failedStep(
  index: number,
  reason: string,
  tool: TrainerToolStepName = "providerToolSelection",
  summary?: string,
): TrainerToolStep {
  return {
    index,
    tool,
    status: "rejected",
    summary: summary ?? `Provider tool selection was rejected: ${reason}.`,
    privacy:
      "No Garmin connector action or local analytics tool was executed for the rejected provider response.",
    reason,
  };
}
