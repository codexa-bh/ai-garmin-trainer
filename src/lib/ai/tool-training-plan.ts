import {
  readCompleteTrainingPlan,
  saveGuardedTrainingPlan,
} from "@/lib/training-plan/composition";
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
      const result = readCompleteTrainingPlan();
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
      const outcome = saveGuardedTrainingPlan(
        input.input,
        input.trainingPlanSnapshot,
      );
      if (!outcome.ok)
        return {
          index: input.index,
          tool: input.toolName,
          status: "rejected",
          reason: outcome.reason,
          summary: `Training Plan was not saved: ${outcome.reason}.`,
          privacy: "Existing local plan unchanged; no blind replacement.",
        };
      const plan = outcome.plan;
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
