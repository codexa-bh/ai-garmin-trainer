import {
  orchestrateTrainerChat as orchestrate,
  type OrchestrateTrainerChatInput,
} from "./orchestrator";
import { createTrainerGeneration } from "./provider-generation";
import { executeTrainerTool } from "./tool-composition";

export type ComposedTrainerChatInput = OrchestrateTrainerChatInput & {
  model: unknown;
};

/** Outer entry point: selected SDK model never crosses into application policy. */
export function orchestrateTrainerChat(input: ComposedTrainerChatInput) {
  const { model, ...turn } = input;
  return orchestrate(turn, {
    generate: createTrainerGeneration(model),
    executeTool: executeTrainerTool,
  });
}
