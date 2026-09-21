import {
  TRAINING_PLAN_CONTENT_MAX_LENGTH,
  TRAINING_PLAN_TITLE_MAX_LENGTH,
} from "./limits";
import { z } from "zod";
import type { TrainingPlan } from "./contracts";

export const completeTrainingPlanSchema = z
  .object({
    plan: z
      .object({
        title: z.string().min(1).max(TRAINING_PLAN_TITLE_MAX_LENGTH),
        contentMarkdown: z
          .string()
          .min(1)
          .max(TRAINING_PLAN_CONTENT_MAX_LENGTH),
        revisedAt: z.string().datetime(),
      })
      .strict()
      .nullable(),
    stale: z.boolean(),
    staleAfterDays: z.number().int().positive(),
  })
  .strict();

export type CompleteTrainingPlan = z.infer<typeof completeTrainingPlanSchema>;
export function sameTrainingPlan(
  a: TrainingPlan | null,
  b: TrainingPlan | null,
): boolean {
  return a === null || b === null
    ? a === b
    : a.title === b.title &&
        a.contentMarkdown === b.contentMarkdown &&
        a.revisedAt === b.revisedAt;
}

// Refuse rather than silently redact a document and later overwrite it from incomplete evidence.
export function hasSensitivePlanText(plan: TrainingPlan | null): boolean {
  return (
    !!plan &&
    /(\/Users\/|[A-Z0-9._%+-]+_API_KEY\s*=|(?:refresh|access)_token\s*[=:]|token data from directory|tokens will be saved to:)/i.test(
      `${plan.title}\n${plan.contentMarkdown}`,
    )
  );
}
