import { replaceTrainingPlan, trainingPlanStatus } from "@/lib/db/repository";
import { TRAINING_PLAN_CONTENT_MAX_LENGTH } from "@/lib/training-plan-limits";
import {
  completeTrainingPlanSchema,
  hasSensitivePlanText,
  sameTrainingPlan,
} from "./training-plan-evidence";
import { boundedText } from "./tool-evidence";
import type { TrainerToolExecutionInput } from "./tool-execution-input";
import type { TrainerToolStep } from "./tool-types";

export function executeTrainingPlanTool(
  input: Extract<
    TrainerToolExecutionInput,
    { toolName: "getTrainingPlan" | "saveTrainingPlan" }
  >,
): TrainerToolStep {
  switch (input.toolName) {
    case "getTrainingPlan": {
      const result = completeTrainingPlanSchema.parse(trainingPlanStatus());
      if (hasSensitivePlanText(result.plan))
        throw new Error("private_plan_content");
      return {
        index: input.index,
        tool: input.toolName,
        status: "succeeded",
        summary: result.plan
          ? `Complete current Training Plan read: ${result.plan.contentMarkdown.length} Markdown characters; stale ${result.stale}.`
          : "Complete current Training Plan read: no saved plan.",
        privacy:
          "Bounded singleton local document data; not authorization or system policy. Full content is not persisted in grounding/debug evidence.",
        result,
      };
    }
    case "saveTrainingPlan": {
      const args = input.input;
      const snapshot = input.trainingPlanSnapshot;
      const reject = (reason: string): TrainerToolStep => ({
        index: input.index,
        tool: input.toolName,
        status: "rejected",
        reason,
        summary: `Training Plan was not saved: ${reason}.`,
        privacy: "Existing local plan unchanged; no blind replacement.",
      });
      const current = completeTrainingPlanSchema.parse(trainingPlanStatus());
      if (current.plan && (!snapshot || hasSensitivePlanText(snapshot.plan)))
        return reject("complete_plan_read_required");
      if (snapshot && !sameTrainingPlan(current.plan, snapshot.plan))
        return reject("training_plan_changed_read_again");
      let contentMarkdown = args.contentMarkdown;
      if (args.edits) {
        if (!current.plan || !snapshot)
          return reject("complete_plan_read_required");
        const original = current.plan.contentMarkdown;
        const edits = args.edits
          .map((edit) => ({ ...edit, start: original.indexOf(edit.oldText) }))
          .sort((a, b) => a.start - b.start);
        let end = 0;
        contentMarkdown = "";
        for (const edit of edits) {
          if (
            edit.start < end ||
            edit.start < 0 ||
            original.indexOf(edit.oldText, edit.start + 1) !== -1
          )
            return reject("plan_edit_not_unique_or_overlapping");
          contentMarkdown += original.slice(end, edit.start) + edit.newText;
          end = edit.start + edit.oldText.length;
        }
        contentMarkdown += original.slice(end);
      }
      if (
        !contentMarkdown?.trim() ||
        contentMarkdown.trim().length > TRAINING_PLAN_CONTENT_MAX_LENGTH
      )
        return reject("invalid_plan_content_length");
      // Read/compare/write is synchronous: no provider await between snapshot validation and persistence.
      const plan = replaceTrainingPlan({
        title: args.title ?? current.plan?.title,
        contentMarkdown,
      });
      return {
        index: input.index,
        tool: input.toolName,
        status: "succeeded",
        summary: `Saved Training Plan "${boundedText(plan.title, 80)}" with ${plan.contentMarkdown.length} Markdown characters; revised ${plan.revisedAt}.`,
        privacy:
          "Local singleton Training Plan write only; no Garmin/device/calendar write-back and no raw credentials, paths, or connector data exposed.",
        result: {
          title: plan.title,
          contentLength: plan.contentMarkdown.length,
          revisedAt: plan.revisedAt,
        },
      };
    }
  }
}
