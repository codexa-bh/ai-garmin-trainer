import {
  orchestrateTrainerChat as orchestrate,
  type OrchestrateTrainerChatInput,
} from "./orchestrator";
import { createTrainerGeneration } from "./provider-generation";
import { executeTrainerTool } from "./tool-composition";
import { supportsActivityImages } from "./provider-activity-images";

export type ComposedTrainerChatInput = OrchestrateTrainerChatInput & {
  model: unknown;
};

/** Outer entry point: selected SDK model never crosses into application policy. */
export function orchestrateTrainerChat(input: ComposedTrainerChatInput) {
  const { model, ...turn } = input;
  return orchestrate(turn, {
    activityImagesSupported: supportsActivityImages(model),
    generate: createTrainerGeneration(model),
    executeTool: executeTrainerTool,
  });
}
