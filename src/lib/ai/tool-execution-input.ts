import type { ValidatedTrainerToolCall } from "./tool-contracts";
import type { TrainerToolExecutionContext } from "./tool-execution-context";
import type { CompleteTrainingPlan } from "./training-plan-evidence";

export type TrainerToolExecutionInput = ValidatedTrainerToolCall & {
  index: number;
  context: TrainerToolExecutionContext;
  trainingPlanSnapshot?: CompleteTrainingPlan;
};
