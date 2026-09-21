import { generateText } from "ai";
import { trainerToolDefinitions } from "./provider-tool-definitions";
import {
  TRAINER_PROVIDER_CALL_TIMEOUT_MS,
  type TrainerGeneration,
  type TrainerGenerationResult,
} from "./orchestration-ports";

/** Bind the already-selected model; no selection, retries or disconnect signal. */
export function createTrainerGeneration(model: unknown): TrainerGeneration {
  return async (request) => {
    const controller = new AbortController();
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        controller.abort();
        reject(new Error("provider_timeout"));
      }, TRAINER_PROVIDER_CALL_TIMEOUT_MS);
    });
    try {
      const options = {
        model,
        system: request.system,
        prompt: request.prompt,
        ...(request.purpose === "planner"
          ? {
              tools: trainerToolDefinitions,
              toolChoice: "auto",
              parallelToolCalls: false,
              providerOptions: {
                openai: { parallelToolCalls: false },
                deepseek: { parallelToolCalls: false },
              },
            }
          : { toolChoice: "none" }),
        abortSignal: controller.signal,
      };
      // Preserve the existing SDK compatibility boundary and raw call shapes.
      const result = (
        generateText as unknown as (
          options: Record<string, unknown>,
        ) => Promise<TrainerGenerationResult>
      )(options);
      return await Promise.race([result, timeout]);
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  };
}
