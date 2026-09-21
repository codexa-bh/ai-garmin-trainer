import {
  getTrainingPlan,
  persistTrainingPlan,
} from "../db/training-plan-repository";
import { createTrainingPlan } from "./application";

// Bind lazily: importing composition does not open SQLite or read environment.
const trainingPlan = createTrainingPlan(
  { read: getTrainingPlan, persist: persistTrainingPlan },
  () => new Date(),
);
export const trainingPlanStatus = trainingPlan.status;
export const replaceTrainingPlan = trainingPlan.saveManual;
export const readCompleteTrainingPlan = trainingPlan.readComplete;
export const saveGuardedTrainingPlan = trainingPlan.saveGuarded;
