import type { WeeklyRead, WeeklyTurn } from "../weekly/contracts";
import type { ValidatedTrainerToolCall } from "./tool-contracts";
import type { TrainerToolExecutionContext } from "./tool-execution-context";
import type { CompleteTrainingPlan } from "../training-plan/snapshot";

export type TrainerToolExecutionInput = ValidatedTrainerToolCall & {
  index: number;
  context: TrainerToolExecutionContext;
  trainingPlanSnapshot?: CompleteTrainingPlan;
  weeklyTurn?: WeeklyTurn;
  weeklySnapshots?: WeeklyRead[];
};
