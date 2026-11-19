import type { WeeklyProposal } from "../src/lib/weekly/contracts";
import { addDays } from "../src/lib/weekly/calendar";

// Authored display input for the existing confirmation API's legacy regression.
// Rendering stays private; tests do not need a product export to arrange a turn.
export function displayedWeeklyProposal(proposal: WeeklyProposal): string {
  const sections = proposal.changes.map((change) =>
    [
      `### ${change.kind === "plan" ? "Plan" : "Review"}: ${change.weekStart} – ${addDays(change.weekStart, 6)}`,
      ...(change.kind === "review" ? [`As of: ${change.asOf}`] : []),
      `Title: ${change.title}`,
      "",
      change.contentMarkdown,
    ].join("\n"),
  );
  return [
    "## Weekly draft — not saved",
    `Proposal: ${proposal.id}`,
    `Calendar basis: ${proposal.timeZone}`,
    "",
    sections.join("\n\n---\n\n"),
    "",
    `Confirm this exact proposal to save ${proposal.changes.length === 2 ? "both documents together" : "this document"}, or ask for changes. Nothing above has been saved as a weekly artifact.`,
  ].join("\n");
}
