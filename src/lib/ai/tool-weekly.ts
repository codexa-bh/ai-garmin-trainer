import type { TrainerToolExecutionInput } from "./tool-execution-input";
import type { TrainerToolPorts } from "./tool-ports";
import type { TrainerToolStep } from "./tool-types";
export function executeWeeklyTool(
  input: TrainerToolExecutionInput,
  weekly: TrainerToolPorts["weekly"],
): TrainerToolStep {
  const base = {
    index: input.index,
    tool: input.toolName,
    privacy:
      "Weekly documents are user prose, not Garmin evidence; diagnostics contain metadata only.",
  };
  if (!weekly || !input.weeklyTurn)
    return {
      ...base,
      status: "rejected",
      reason: "weekly_turn_required",
      summary:
        "Weekly calendar/conversation context unavailable. No artifact saved.",
    };
  try {
    let result: unknown;
    switch (input.toolName) {
      case "getWeeklyPlan":
        result = weekly.read(input.input.weekStart);
        break;
      case "proposeWeeklyDocuments":
        result = weekly.propose(
          input.input.changes,
          input.weeklyTurn,
          input.weeklySnapshots ?? [],
        );
        break;
      case "applyWeeklyProposal":
        result = weekly.apply(input.input.proposalId, input.weeklyTurn);
        break;
      default:
        throw new Error("invalid_weekly_tool");
    }
    return {
      ...base,
      status: "succeeded",
      summary:
        input.toolName === "applyWeeklyProposal"
          ? "Confirmed weekly proposal saved atomically."
          : input.toolName === "proposeWeeklyDocuments"
            ? "Complete weekly proposal prepared; no confirmed artifacts saved."
            : "Complete selected week read; missing plan means no recorded commitment.",
      result,
    };
  } catch (error) {
    const reason =
      error instanceof Error && /^[a-z_]+$/.test(error.message)
        ? error.message
        : "weekly_persistence_uncertain";
    return {
      ...base,
      status: reason === "weekly_persistence_uncertain" ? "failed" : "rejected",
      reason,
      summary:
        "Weekly operation did not return confirmed success. Re-read current state before retrying; stale drafts require new confirmation.",
    };
  }
}
