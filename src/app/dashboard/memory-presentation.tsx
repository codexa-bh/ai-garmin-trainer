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
    return "Choose a supported memory model in native Settings, then quit/reopen.";
  const reasons: Record<string, string> = {
    summary_missing_key:
      "Memory processing needs an available provider key in native Settings.",
    summary_provider_failure: "The provider could not finish a memory update.",
    summary_interrupted:
      "A memory update was interrupted. Previous costs may be unknown.",
    summary_invalid_output: "The update could not be safely saved.",
    summary_input_capacity: "An update exceeds the supported request capacity.",
    summary_impossible_capacity:
      "Memory cannot fit the current request capacity.",
    summary_correction_pending:
      "A conversation correction is waiting to be processed.",
    summary_invalidated:
      "Saved context changed; new eligible updates may be pending.",
    summary_configuration_changed:
      "Configuration changed during an update. Check native Settings.",
    summary_import_review_required:
      "An earlier-source import needs a new review in Manage memory.",
    summary_rebuild_review_required: "The history update needs a new review.",
    summary_rebuild_unavailable: "History update status needs checking.",
  };
  if (memory.reason)
    return (
      reasons[memory.reason] ??
      "Memory needs attention. Check saved state and technical details; no automatic repair is assumed."
    );
  if (memory.pending) return "Recent conversation updates pending";
  return memory.state === "never-produced"
    ? "No automatic memory saved yet"
    : memory.state === "fresh"
      ? "Saved memory up to date"
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
  if (!r) return ["History inspection is unavailable in this build."];
  const reasons: string[] = [];
  if (
    r.operation &&
    !["active", "complete", "cancelled", "interrupted", "invalidated"].includes(
      r.operation.state,
    )
  )
    reasons.push(
      "The previous update state is unsupported. Check status with a compatible build before starting another update.",
    );
  if (!r.enabled) reasons.push("Memory is Off.");
  if (!r.model || r.model === "unselected")
    reasons.push("Select a memory model in native Settings.");
  if (r.capability !== "configured-not-probed")
    reasons.push(
      "Native provider key or app lifetime is unavailable. Check native Settings; this is not a provider probe.",
    );
  if (!r.complete) reasons.push("The history inventory is incomplete.");
  if (r.limitExceeded)
    reasons.push(
      "History exceeds this operation’s limits; no partial selection will be silently processed.",
    );
  if (!r.counts.includedUserMessages)
    reasons.push("No eligible user messages are available.");
  if (
    memory.historical.manifests.some((m) =>
      ["active", "paused"].includes(m.state),
    )
  )
    reasons.push(
      "An earlier-source import is active or paused. Manage it before starting another update.",
    );
  if (!r.ready && !reasons.length && r.operation?.state !== "active")
    reasons.push("History is not ready. Check update status and review again.");
  return reasons;
}

export function HistoryReview({ memory }: { memory: SummaryInspection }) {
  const r = memory.rebuild;
  if (!r)
    return (
      <p>
        History inspection unavailable. Check again with a compatible build; no
        Start is offered.
      </p>
    );
  const reasons: Record<string, string> = {
    "unproven-legacy-or-cleared-original":
      "Earlier messages excluded: the app cannot prove they are safe to reuse after previous memory clearing.",
    "linked-cutoff": "Messages before the previous memory-clear boundary",
    suppressed: "Forgotten sources",
    "incomplete-linked-turn": "Unfinished turns",
    "oversized-message": "Messages too long to include",
    "unsafe-or-unresolved-context": "Unsafe or unclear context",
    "unsupported-time": "Unsupported message dates",
    "orphan-message": "Source chat unavailable",
  };
  return (
    <>
      <p>
        Replace generated memory after a complete, validated update. Opening
        this review does not send anything.
      </p>
      <div className="memory-coverage">
        <p>
          <strong>
            {r.counts.includedUserMessages} user messages included
          </strong>{" "}
          from {r.counts.includedChats} chats.
        </p>
        <p>
          <strong>
            {r.counts.excludedUserMessages} user messages excluded
          </strong>{" "}
          from the inventoried history.
        </p>
      </div>
      {!!r.counts.excludedUserMessages && (
        <div className="memory-notice">
          <strong>Not all history can be included</strong>
          <ul>
            {Object.entries(r.reasons).map(([reason, count]) => (
              <li key={reason}>
                {count} —{" "}
                {reasons[reason] ??
                  "Some messages cannot be included by this version."}
              </li>
            ))}
          </ul>
        </div>
      )}
      <p>
        {r.counts.assistantContext} assistant context passages are separate from
        user sources, not evidence of user endorsement. Inventory:{" "}
        {r.counts.chats} chats, {r.counts.userMessages} user messages.
      </p>
      <h4>Cost & privacy</h4>
      <p>
        {r.estimatedUsd.conservativeMaximum === null ? (
          "Cost is unknown before generation; no app-imposed spending cap."
        ) : (
          <>
            Estimated range:{" "}
            <strong>
              ${r.estimatedUsd.low.toFixed(4)}–$
              {r.estimatedUsd.conservativeMaximum.toFixed(4)}
            </strong>{" "}
            (historical conservative estimate, not an invoice).
          </>
        )}
      </p>
      <p>
        Eligible minimized originals and screened assistant context will be sent
        to the configured provider/model:{" "}
        <strong>
          {r.configuredProvider} / {r.model || "Unselected"}
        </strong>
        . Configuration is not proof of provider readiness. Automatic summary
        costs have no daily cap.
      </p>
      <h4>What changes</h4>
      <p>
        Old generated memory stays available until successful complete
        replacement. Manual edits, originals and forgotten-source restrictions
        remain. Existing chats are not automatically updated.
      </p>
      <p>
        Keep the app open. Cancellation or interruption cannot recall sent
        content, refund costs or replay unknown requests.
      </p>
      <details>
        <summary>Coverage and processing details</summary>
        <p>
          {r.counts.messages} total messages; {r.counts.excludedMessages}{" "}
          excluded messages across all roles; {r.counts.excludedChats} chats
          with no included user source.
        </p>
        <p>{r.estimatedUsd.uncertainty}</p>
        <p>Price basis: {r.estimatedUsd.priceBasis}</p>
        <ul>
          {Object.entries(r.reasons).map(([reason, count]) => (
            <li key={reason}>
              {reason}: {count}
            </li>
          ))}
        </ul>
      </details>
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
        Processed {op.processed} of {op.total} eligible messages. Processing
        counts do not certify memory quality.
      </p>
      {op.state === "active" ? (
        <p>
          Old saved memory is separate from the staged result. Keep the app
          open.
        </p>
      ) : op.state === "complete" ? (
        <p>
          Manual edits and originals remain. This chat has not automatically
          adopted the update.
        </p>
      ) : (
        <p>
          No successful staged replacement is reported. Independent Off, Clear
          or privacy changes still apply; no rollback or refund is promised.
          Check status, then review anew before any new Start.
        </p>
      )}
    </div>
  );
}

export function MemoryUsage({
  memory,
  onDetails,
}: {
  memory: SummaryInspection;
  onDetails: () => void;
}) {
  return (
    <>
      <p>
        Memory is user-derived continuity, not a source of current measurements
        or instructions. Current corrections, Profile and fresh tool evidence
        take precedence.
      </p>
      <p>
        Eligible minimized context may leave this device for the configured
        memory provider. Reading this panel does not call a model.
      </p>
      <p>
        <strong>Automatic summary costs have no daily cap.</strong> Turn memory
        Off to stop summary use and new processing. Saved items stay; automatic
        titles use the shared model independently. Neither has an app-imposed
        spending or attempt cap.
      </p>
      <dl className="memory-facts">
        <dt>Observed-token estimate today</dt>
        <dd>${memory.estimatedUsdToday.toFixed(4)}</dd>
        <dt>Historical reservations today</dt>
        <dd>${memory.reservedUsdToday.toFixed(4)}</dd>
        <dt>Outstanding unknown / legacy reservations, all days</dt>
        <dd>${memory.unknownReservedUsd.toFixed(4)}</dd>
        <dt>Attempts with unknown cost, all days</dt>
        <dd>{memory.unpricedAttempts ?? 0}</dd>
      </dl>
      <p>
        These are distinct estimates and reservations, not amounts to add into a
        billed total, invoices or cache savings. Unpriced attempts are not zero
        cost; prior reservations remain recorded.
      </p>
      <p>
        Forget and Clear affect memory derivatives, not original transcripts,
        Profile, Garmin, saved plans or older stores. Already exported content,
        provider logs and backups cannot be recalled.
      </p>
      <button type="button" onClick={onDetails}>
        Technical details
      </button>
    </>
  );
}
