import {
  TRAINING_PLAN_CONTENT_MAX_LENGTH,
  TRAINING_PLAN_TITLE_MAX_LENGTH,
} from "./limits";
import { z } from "zod";
import type { TrainingPlan } from "./contracts";

// Preserve the pre-upgrade UTC wire grammar, including minute precision, when
// using patched Zod (whose default datetime now requires seconds). Provider
// metadata and runtime validation deliberately share this exact grammar.
export const utcDateTimeSchema = z
  .string()
  .regex(
    /^(?:(?:\d\d[2468][048]|\d\d[13579][26]|\d\d0[48]|[02468][048]00|[13579][26]00)-02-29|\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\d|30)|(?:02)-(?:0[1-9]|1\d|2[0-8])))T(?:(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z))$/,
  )
  .meta({ format: "date-time" });

export const completeTrainingPlanSchema = z
  .object({
    plan: z
      .object({
        title: z.string().min(1).max(TRAINING_PLAN_TITLE_MAX_LENGTH),
        contentMarkdown: z
          .string()
          .min(1)
          .max(TRAINING_PLAN_CONTENT_MAX_LENGTH),
        revisedAt: utcDateTimeSchema,
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
