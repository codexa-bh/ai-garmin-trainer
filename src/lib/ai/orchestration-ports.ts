import type { TrainerTokenUsage } from "./debug-types";
import type { TrainerSystemPrompt } from "./trainer-instructions";
import type { TrainerToolExecutionInput } from "./tool-execution-input";
import type { TrainerToolStep } from "./tool-types";

export type TrainerGenerationRequest = {
  purpose: "planner" | "final_synthesis";
  system: TrainerSystemPrompt;
  prompt: string;
};

// Raw call aliases and malformed inputs remain application-validated. Do not
// normalize/filter SDK results here: synthesis rejects even unrecognized calls.
export type TrainerGenerationResult = {
  text?: string;
  toolCalls?: unknown[];
  tokenUsage?: TrainerTokenUsage;
};
export type TrainerGeneration = (
  request: TrainerGenerationRequest,
) => Promise<TrainerGenerationResult>;

export type TrainerOrchestrationPorts = {
  generate: TrainerGeneration;
  executeTool(input: TrainerToolExecutionInput): Promise<TrainerToolStep>;
};

export const TRAINER_PROVIDER_CALL_TIMEOUT_MS = 180_000;
