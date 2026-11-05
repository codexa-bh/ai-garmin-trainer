import type { SummaryItem } from "@/lib/memory/summary-policy";
import type { SummaryInspection } from "./use-memory";

export function memoryQualification(item: SummaryItem) {
  const category = {
    decision: "Decision",
    constraint: "Constraint",
    goal: "Goal",
    rejected: "Rejected",
    question: "Open question",
    temporary: "Temporary",
    discussion: "Discussion",
  }[item.category];
  return item.stance === "discussed-not-endorsed"
    ? `${category} · Discussed · not decided`
    : `${category} · ${item.stance === "endorsed" ? "Endorsed" : "User-stated"}`;
}

export function memoryStatus(memory: SummaryInspection) {
  if (!memory.enabled) return "Saved items retained";
  if (
    memory.state === "unselected" ||
    memory.reason === "summary_unsupported_model"
  )
    return "Choose a memory model in Settings.";
  const reasons: Record<string, string> = {
    summary_missing_key: "Add the provider key in Settings to process memory.",
    summary_provider_failure: "The provider could not finish a memory update.",
    summary_interrupted: "An update was interrupted. Its cost may be unknown.",
    summary_invalid_output: "The update could not be safely saved.",
    summary_input_capacity: "The provider could not accept this update.",
    summary_impossible_capacity: "Memory could not fit this request.",
    summary_correction_pending:
      "A conversation correction is waiting to be processed.",
    summary_invalidated: "Saved context changed; new updates may be pending.",
    summary_configuration_changed:
      "Settings changed during an update. Review again.",
    summary_import_review_required:
      "An earlier-source import needs a new review in Manage memory.",
    summary_rebuild_review_required: "The history update needs a new review.",
    summary_rebuild_unavailable: "History update status needs checking.",
  };
  if (memory.reason)
    return (
      reasons[memory.reason] ??
      "Memory needs attention. Check saved memory before trying again."
    );
  if (memory.pending) return "Recent conversation updates pending";
  return memory.state === "never-produced"
    ? "No automatic memory saved yet"
    : memory.state === "fresh"
      ? memory.stored.items.length
        ? "Saved memory available"
        : "No saved memories"
      : "Saved memory unavailable · check again";
}

export function canRetrySummary(memory: SummaryInspection) {
  return (
    memory.enabled &&
    [
      "summary_provider_failure",
      "summary_interrupted",
      "summary_invalid_output",
      "summary_publication_conflict",
    ].includes(memory.reason ?? "") &&
    !["active", "interrupted", "invalidated"].includes(
      memory.rebuild?.operation?.state ?? "",
    ) &&
    !memory.reason?.startsWith("summary_rebuild")
  );
}

export function historyBlockers(memory: SummaryInspection) {
  const r = memory.rebuild;
  if (!r) return ["History review is unavailable. Check saved memory again."];
  const reasons: string[] = [];
  if (
    r.operation &&
    !["active", "complete", "cancelled", "interrupted", "invalidated"].includes(
      r.operation.state,
    )
  )
    reasons.push(
      "The previous update needs a compatible build to check its status.",
    );
  if (!r.enabled) reasons.push("Turn memory On before updating.");
  if (!r.model || r.model === "unselected")
    reasons.push("Choose a memory model in Settings.");
  if (r.capability !== "configured-not-probed")
    reasons.push("The configured provider is unavailable. Check Settings.");
  if (!r.complete) reasons.push("The history review is incomplete.");
  if (r.limitExceeded)
    reasons.push(
      "Too much history for one update. Select fewer conversations.",
    );
  if (!r.counts.includedUserMessages)
    reasons.push("No usable messages in this selection.");
  if (
    memory.historical.manifests.some((m) =>
      ["active", "paused"].includes(m.state),
    )
  )
    reasons.push(
      "Finish or cancel the earlier-source import in Manage memory first.",
    );
  if (!r.ready && !reasons.length && r.operation?.state !== "active")
    reasons.push("History is not ready. Check update status and review again.");
  return reasons;
}

export function HistoryReview({
  memory,
  confirmation = false,
}: {
  memory: SummaryInspection;
  confirmation?: boolean;
}) {
  const r = memory.rebuild;
  if (!r) return <p>History review unavailable. Nothing has been started.</p>;
  const reasons: Record<string, string> = {
    "not-selected": "Outside your selected conversations",
    "unproven-legacy-or-cleared-original":
      "Older messages need explicit permission to reuse",
    "known-clear": "Messages covered by a recorded memory clear",
    "linked-cutoff": "Messages covered by a recorded memory clear",
    suppressed: "Sources you asked memory to forget",
    "incomplete-linked-turn": "Unfinished conversations",
    "oversized-message": "Messages too long to include",
    "unsafe-or-unresolved-context": "Private, no-save or unclear content",
    "unsupported-time": "Unavailable message dates",
    "orphan-message": "Conversation no longer available",
  };
  return (
    <>
      <p>
        <strong>
          {r.counts.includedUserMessages}{" "}
          {r.counts.includedUserMessages === 1 ? "message" : "messages"}{" "}
          included
        </strong>{" "}
        from {r.counts.includedChats}{" "}
        {r.counts.includedChats === 1 ? "conversation" : "conversations"};{" "}
        {r.counts.excludedUserMessages} excluded from retained history.
      </p>
      {!confirmation && !!r.counts.excludedUserMessages && (
        <ul className="memory-exclusions">
          {Object.entries(r.reasons).map(([reason, count]) => (
            <li key={reason}>
              {count} — {reasons[reason] ?? "Unavailable in this version"}
            </li>
          ))}
        </ul>
      )}
      {confirmation ? (
        <>
          {r.selection?.includeLegacy && (
            <p className="memory-notice">
              <strong>Allow older conversations to be remembered again.</strong>{" "}
              Earlier clearing cannot always be identified. This selection may
              include things once cleared from memory. Known forgotten sources
              and recorded clears still stay excluded.
            </p>
          )}
          <p>
            Selected usable text goes to the configured provider and may incur
            cost.{" "}
            {r.estimatedUsd.conservativeMaximum !== null &&
            r.estimatedUsd.conservativeMaximum > 0 ? (
              <>
                Conservative upper estimate: $
                {r.estimatedUsd.conservativeMaximum.toFixed(4)} — not predicted
                billing or a spending cap.{" "}
              </>
            ) : (
              "Cost is not known in advance. "
            )}
            Automatic processing has no daily cost cap.
          </p>
          <p>
            Old generated memory stays until the complete update succeeds.
            Manual edits and original conversations remain. New chat turns then
            use available valid memory.
          </p>
          <p>
            Keep the app open. Cancel stops further work, but cannot recall sent
            text or charges. Uncertain requests are not automatically repeated.
          </p>
        </>
      ) : (
        <p>
          Review is local; nothing is sent until you confirm. Only useful, safe
          context can be remembered, not every detail.
        </p>
      )}
    </>
  );
}

export function HistoryProgress({ memory }: { memory: SummaryInspection }) {
  const op = memory.rebuild?.operation;
  if (!op) return null;
  const states: Record<string, string> = {
    active: "Updating from history",
    complete: "Saved memory updated",
    cancelled: "History update cancelled",
    interrupted: "History update interrupted",
    invalidated: "History review changed",
  };
  return (
    <div className="memory-notice" role="status">
      <h4>{states[op.state] ?? "History update status unavailable"}</h4>
      <p>
        Processed {op.processed} of {op.total} included messages. Not every
        message needs a saved memory.
      </p>
      {op.state === "active" ? (
        <p>
          Previous memory stays available while this update runs. Keep the app
          open.
        </p>
      ) : op.state === "complete" ? (
        <p>
          Review the saved content. Manual edits and originals remain; excluded
          history was not recovered. New chat turns use available valid memory.
        </p>
      ) : (
        <p>
          No completed replacement is reported. Check status before reviewing a
          new update; earlier costs may be unknown. Nothing is repeated
          automatically.
        </p>
      )}
    </div>
  );
}
