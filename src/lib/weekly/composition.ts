import { randomUUID } from "node:crypto";
import { weeklyStore } from "../db/weekly-repository";
import { createKpiRecipeExecution } from "../ai/analytics/recipe-execution";
import { createWeekly } from "./application";
import { createKpiMeasurements } from "./measurements";
export const weekly = createWeekly(weeklyStore, () => new Date(), randomUUID);
// Binding is inert: no DB opening or child process until a refresh is requested.
export const kpiMeasurements = createKpiMeasurements(
  weeklyStore,
  createKpiRecipeExecution(),
  () => new Date(),
  randomUUID,
);
