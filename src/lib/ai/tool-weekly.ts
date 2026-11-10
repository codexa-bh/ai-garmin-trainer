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
        result = {
          ...weekly.read(input.input.weekStart),
          kpis: weekly.readKpis(input.input.weekStart),
        };
        break;
      case "getWeeklyKpis":
        result = weekly.readKpis(input.input.weekStart, input.input.setId);
        break;
      case "getKpiProgress":
        result = weekly.progress(input.input.from, input.input.through);
        break;
      case "saveWeeklyKpis":
        result = weekly.saveKpis(
          input.input,
          input.weeklyTurn,
          input.kpiSnapshots ?? [],
        );
        break;
      case "saveWeeklyDocuments":
        result = weekly.save(
          input.input.changes,
          input.weeklyTurn,
          input.weeklySnapshots ?? [],
          input.input.kpiChanges ?? [],
          input.kpiSnapshots ?? [],
        );
        break;
      default:
        throw new Error("invalid_weekly_tool");
    }
    return {
      ...base,
      status: "succeeded",
      summary:
        input.toolName === "saveWeeklyKpis"
          ? "Structured weekly KPI changes saved atomically; saved claims are not fresh Garmin verification."
          : input.toolName === "saveWeeklyDocuments"
            ? `Weekly bundle saved atomically: ${[...input.input.changes.map(({ weekStart, kind }) => `${kind} ${weekStart}`), ...(input.input.kpiChanges ?? []).map(({ weekStart }) => `KPIs ${weekStart}`)].join(", ")}.`
            : input.toolName === "getWeeklyKpis"
              ? "Canonical KPI read; complete=false requires narrower reads before mutation. Missing is not zero."
              : input.toolName === "getKpiProgress"
                ? "Saved bounded progress only; gaps and unlike baselines remain explicit, never evaluated."
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
        "Weekly operation did not return confirmed success. Re-read current state before a future attempt; no repeated weekly save in this turn.",
    };
  }
}
