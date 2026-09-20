import {
  TRAINING_PLAN_CONTENT_MAX_LENGTH,
  TRAINING_PLAN_TITLE_MAX_LENGTH,
} from "@/lib/training-plan-limits";
import { getDatabase } from "./connection";

export const TRAINING_PLAN_STALE_AFTER_DAYS = 14;

export type TrainingPlan = {
  title: string;
  contentMarkdown: string;
  revisedAt: string;
};

export type TrainingPlanStatus = {
  plan: TrainingPlan | null;
  stale: boolean;
  staleAfterDays: number;
};

function normalizeTrainingPlanTitle(title: string | null | undefined): string {
  const compact = String(title ?? "")
    .replace(/\s+/g, " ")
    .trim();
  return compact
    ? compact.slice(0, TRAINING_PLAN_TITLE_MAX_LENGTH)
    : "Training Plan";
}

function rowToTrainingPlan(row: {
  title: string;
  content_markdown: string;
  revised_at: number;
}): TrainingPlan {
  return {
    title: row.title,
    contentMarkdown: row.content_markdown,
    revisedAt: new Date(row.revised_at).toISOString(),
  };
}

export function getTrainingPlan(): TrainingPlan | null {
  const row = getDatabase()
    .prepare(
      "select title, content_markdown, revised_at from training_plan where id = 'default'",
    )
    .get() as
    { title: string; content_markdown: string; revised_at: number } | undefined;
  return row ? rowToTrainingPlan(row) : null;
}

export function trainingPlanStatus(now = Date.now()): TrainingPlanStatus {
  const plan = getTrainingPlan();
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

export function replaceTrainingPlan(input: {
  title?: string | null;
  contentMarkdown: string;
  now?: Date;
}): TrainingPlan {
  const contentMarkdown = input.contentMarkdown.trim();
  if (!contentMarkdown) throw new Error("training_plan_content_required");
  if (contentMarkdown.length > TRAINING_PLAN_CONTENT_MAX_LENGTH)
    throw new Error("training_plan_content_too_large");
  const title = normalizeTrainingPlanTitle(input.title);
  const nowMs = (input.now ?? new Date()).getTime();
  getDatabase()
    .prepare(
      `insert into training_plan (id, title, content_markdown, revised_at, updated_at)
       values ('default', ?, ?, ?, ?)
       on conflict(id) do update set title = excluded.title, content_markdown = excluded.content_markdown, revised_at = excluded.revised_at, updated_at = excluded.updated_at`,
    )
    .run(title, contentMarkdown, nowMs, nowMs);
  const saved = getTrainingPlan();
  if (!saved) throw new Error("training_plan_save_failed");
  return saved;
}
