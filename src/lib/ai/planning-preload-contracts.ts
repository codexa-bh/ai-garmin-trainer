import type { TrainingPlanStatus } from "../training-plan/contracts";
import type { WeeklyRead } from "../weekly/contracts";
import type { KpiRead } from "../weekly/kpi-contracts";

export type Preloaded<T> =
  | { status: "complete"; value: T }
  | {
      status: "unavailable";
      reason: "read_failed" | "incomplete" | "superseded_or_invalidated";
    };
export type PlanningWeek = {
  weekStart: string;
  document: Preloaded<WeeklyRead>;
  kpis: Preloaded<KpiRead>;
};
export type PlanningPreload = {
  source: "foreground_preload";
  trainingPlan: Preloaded<TrainingPlanStatus>;
  weeks: PlanningWeek[];
};
