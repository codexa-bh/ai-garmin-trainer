import { TRAINING_PLAN_TITLE_MAX_LENGTH } from "./limits";
import type { TrainingPlan, TrainingPlanStatus } from "./contracts";

const TRAINING_PLAN_STALE_AFTER_DAYS = 14;

export function normalizeTrainingPlanTitle(
  title: string | null | undefined,
): string {
  const compact = String(title ?? "")
    .replace(/\s+/g, " ")
    .trim();
  return compact
    ? compact.slice(0, TRAINING_PLAN_TITLE_MAX_LENGTH)
    : "Training Plan";
}

export function planStatus(
  plan: TrainingPlan | null,
  now: number,
): TrainingPlanStatus {
  if (!plan)
    return {
      plan: null,
      stale: true,
      staleAfterDays: TRAINING_PLAN_STALE_AFTER_DAYS,
    };
  const revisedAt = Date.parse(plan.revisedAt);
  const stale = Number.isFinite(revisedAt)
    ? now - revisedAt > TRAINING_PLAN_STALE_AFTER_DAYS * 24 * 60 * 60 * 1000
    : true;
  return { plan, stale, staleAfterDays: TRAINING_PLAN_STALE_AFTER_DAYS };
}
