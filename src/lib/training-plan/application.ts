import type { TrainingPlan } from "./contracts";
import { applyPlanEdits } from "./edits";
import { TRAINING_PLAN_CONTENT_MAX_LENGTH } from "./limits";
import { normalizeTrainingPlanTitle, planStatus } from "./policy";
import {
  completeTrainingPlanSchema,
  hasSensitivePlanText,
  sameTrainingPlan,
  type CompleteTrainingPlan,
} from "./snapshot";

export type TrainingPlanStore = {
  read(): TrainingPlan | null;
  persist(input: {
    title: string;
    contentMarkdown: string;
    nowMs: number;
  }): void;
};

type ManualSave = {
  title?: string | null;
  contentMarkdown: string;
  now?: Date;
};
type GuardedSave = {
  title?: string;
  contentMarkdown?: string;
  edits?: { oldText: string; newText: string }[];
};
type SaveOutcome =
  { ok: true; plan: TrainingPlan } | { ok: false; reason: string };

export function createTrainingPlan(
  store: TrainingPlanStore,
  clock: () => Date,
) {
  function status(now = clock().getTime()) {
    return planStatus(store.read(), now);
  }

  // Manual saves deliberately do not require a prior complete read.
  function saveManual(input: ManualSave): TrainingPlan {
    const contentMarkdown = input.contentMarkdown.trim();
    if (!contentMarkdown) throw new Error("training_plan_content_required");
    if (contentMarkdown.length > TRAINING_PLAN_CONTENT_MAX_LENGTH)
      throw new Error("training_plan_content_too_large");
    const title = normalizeTrainingPlanTitle(input.title);
    const nowMs = (input.now ?? clock()).getTime();
    store.persist({ title, contentMarkdown, nowMs });
    const saved = store.read();
    if (!saved) throw new Error("training_plan_save_failed");
    return saved;
  }

  function readComplete(): CompleteTrainingPlan {
    const result = completeTrainingPlanSchema.parse(status());
    if (hasSensitivePlanText(result.plan))
      throw new Error("private_plan_content");
    return result;
  }

  function saveGuarded(
    args: GuardedSave,
    snapshot?: CompleteTrainingPlan,
  ): SaveOutcome {
    const reject = (reason: string): SaveOutcome => ({ ok: false, reason });
    const current = completeTrainingPlanSchema.parse(status());
    if (current.plan && (!snapshot || hasSensitivePlanText(snapshot.plan)))
      return reject("complete_plan_read_required");
    if (snapshot && !sameTrainingPlan(current.plan, snapshot.plan))
      return reject("training_plan_changed_read_again");
    let contentMarkdown = args.contentMarkdown;
    if (args.edits) {
      if (!current.plan || !snapshot)
        return reject("complete_plan_read_required");
      const edited = applyPlanEdits(current.plan.contentMarkdown, args.edits);
      if (edited === null) return reject("plan_edit_not_unique_or_overlapping");
      contentMarkdown = edited;
    }
    if (
      !contentMarkdown?.trim() ||
      contentMarkdown.trim().length > TRAINING_PLAN_CONTENT_MAX_LENGTH
    )
      return reject("invalid_plan_content_length");
    // One synchronous read/compare/edit/write operation; no provider yield.
    const plan = saveManual({
      title: args.title ?? current.plan?.title,
      contentMarkdown,
    });
    return { ok: true, plan };
  }

  return { status, saveManual, readComplete, saveGuarded };
}
