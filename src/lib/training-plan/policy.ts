import { TRAINING_PLAN_TITLE_MAX_LENGTH } from "./limits";
import type { TrainingPlan, TrainingPlanStatus } from "./contracts";

export const TRAINING_PLAN_REVIEW_AFTER_DAYS = 60;

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
      staleAfterDays: TRAINING_PLAN_REVIEW_AFTER_DAYS,
    };
  const revisedAt = Date.parse(plan.revisedAt);
  const stale = Number.isFinite(revisedAt)
    ? now - revisedAt > TRAINING_PLAN_REVIEW_AFTER_DAYS * 24 * 60 * 60 * 1000
    : true;
  // Legacy wire names represent advisory review timing, never plan validity.
  return { plan, stale, staleAfterDays: TRAINING_PLAN_REVIEW_AFTER_DAYS };
}

export function trainingPlanReviewTiming(status: TrainingPlanStatus): string {
  if (!status.plan) return "No General Plan saved.";
  if (!Number.isFinite(Date.parse(status.plan.revisedAt)))
    return "Revision date unavailable; review when useful.";
  return status.stale
    ? `More than ${status.staleAfterDays} days since revision; review when useful.`
    : `Within the ${status.staleAfterDays}-day review window.`;
}
