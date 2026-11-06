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
      "An earlier update needs attention in Update from chat history.",
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
      ["active", "paused", "review-required"].includes(m.state),
    )
  )
    reasons.push(
      "Cancel the earlier update below before reviewing a new history update.",
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
    "unsafe-or-unresolved-context":
      "Excluded under the earlier content policy or unclear context",
    "no-save-or-unresolved-context": "No-save request or unclear context",
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
              <strong>
                Older conversations may include things once cleared.
              </strong>{" "}
              You allowed their reuse. Known forgotten sources and recorded
              clears stay excluded.
            </p>
          )}
          <p>
            Updates send selected usable text to your selected AI provider (
            {r.configuredProvider}) and may incur charges.{" "}
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
            Existing memory stays until the update succeeds; manual edits and
            conversations are preserved.
          </p>
          <p>
            Keep the app open. Cancelling stops further work, not text already
            sent or charges incurred. Uncertain requests are not automatically
            repeated.
          </p>
        </>
      ) : (
        <p>
          Review is local; nothing is sent until you confirm. Memory keeps
          useful context, not every detail.
        </p>
      )}
    </>
  );
}

export function HistoryProgress({
  memory,
  unavailable = false,
}: {
  memory: SummaryInspection;
  unavailable?: boolean;
}) {
  const op = memory.rebuild?.operation;
  if (!op) return null;
  const failure =
    op.state === "interrupted" &&
    [
      "summary_invalid_output",
      "summary_provider_failure",
      "summary_missing_key",
      "summary_input_capacity",
      "summary_budget_unavailable",
    ].includes(op.reason ?? "");
  const states: Record<string, string> = {
    active: "Updating from history",
    complete: "Saved memory updated",
    cancelled: "History update cancelled",
    interrupted: failure
      ? "History update failed"
      : "History update interrupted",
    invalidated: "History review changed",
  };
  const reasons: Record<string, string> = {
    summary_invalid_output:
      "The AI response did not meet memory's structure, size or source rules. It was not saved.",
    summary_provider_failure: "The AI provider could not finish the request.",
    summary_missing_key:
      "The selected provider is unavailable. Check its key and model in Settings.",
    summary_input_capacity:
      "The selected provider could not accept this request. Review a smaller selection or the model in Settings.",
    summary_budget_unavailable:
      "The request could not be admitted. Review Settings before a new update.",
    summary_interrupted:
      "The app or request stopped before the update finished.",
    summary_configuration_changed:
      "Settings changed during the update. Review the current configuration.",
  };
  const known = Object.hasOwn(states, op.state);
  return (
    <div
      className="memory-notice"
      data-history-state={
        unavailable ? "unreadable" : failure ? "failed" : op.state
      }
    >
      <h4>
        {unavailable
          ? "Update status unavailable"
          : (states[op.state] ?? "History update status unknown")}
      </h4>
      <p role="status" aria-live="polite" aria-atomic="true">
        {unavailable ? "Last known: " : ""}
        {op.processed} of {op.total} included messages processed
        {op.state === "active" && op.processed === op.total
          ? "; finishing — not yet saved"
          : "."}
      </p>
      {op.state === "active" && op.processed < op.total && (
        <progress
          aria-label="Included messages processed"
          value={op.processed}
          max={op.total || 1}
        />
      )}
      {unavailable ? (
        <p>
          Connection lost. Reconnecting automatically to the same operation; no
          work is repeated. Its current outcome is unknown.
        </p>
      ) : op.state === "active" ? (
        <p>
          Previous memory stays available. Keep the app open; progress updates
          automatically.
        </p>
      ) : op.state === "complete" ? (
        <p>
          The complete replacement was saved. Manual edits and conversations
          remain; new chat turns use available valid memory.
        </p>
      ) : (
        <>
          <p>
            {op.state === "cancelled"
              ? "Further work was stopped. Text already sent and charges cannot be recalled."
              : op.state === "invalidated"
                ? "History, memory or permissions changed. Review the current selection before starting again."
                : (reasons[op.reason ?? ""] ??
                  (known
                    ? "The update stopped before a complete result could be saved."
                    : "A compatible build must reconcile this operation before any new update."))}
          </p>
          <p>
            No completed replacement was saved by this update. Previous memory
            was not replaced; independent Clear, Forget or Off changes still
            apply. Earlier request costs may be unknown. Nothing is repeated
            automatically.
          </p>
        </>
      )}
    </div>
  );
}
