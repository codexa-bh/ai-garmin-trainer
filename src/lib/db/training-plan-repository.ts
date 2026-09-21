import type { TrainingPlan } from "../training-plan/contracts";
import { createTrainingPlan } from "../training-plan/application";
import { getDatabase } from "./connection";

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

export function persistTrainingPlan(input: {
  title: string;
  contentMarkdown: string;
  nowMs: number;
}): void {
  const { title, contentMarkdown, nowMs } = input;
  getDatabase()
    .prepare(
      `insert into training_plan (id, title, content_markdown, revised_at, updated_at)
       values ('default', ?, ?, ?, ?)
       on conflict(id) do update set title = excluded.title, content_markdown = excluded.content_markdown, revised_at = excluded.revised_at, updated_at = excluded.updated_at`,
    )
    .run(title, contentMarkdown, nowMs, nowMs);
}

// Compatibility entry points for existing repository consumers; policy is feature-owned.
const application = createTrainingPlan(
  { read: getTrainingPlan, persist: persistTrainingPlan },
  () => new Date(),
);
export const trainingPlanStatus = application.status;
export const replaceTrainingPlan = application.saveManual;
