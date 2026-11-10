import { useId, useLayoutEffect, useRef, useState } from "react";
import type {
  MemoryAction,
  SummaryInspection,
  useMemoryFeature,
} from "./use-memory";
import {
  canRetrySummary,
  historyBlockers,
  HistoryProgress,
  HistoryReview,
  memoryStatus,
} from "./memory-presentation";

type View = "overview" | "history" | "manage";
type Confirmation = {
  action: MemoryAction;
  inspection: SummaryInspection;
  title: string;
  label: string;
  text: string;
  destructive?: boolean;
};

export function MemoryContent({
  memory,
  summaryExpanded,
  setSummaryExpanded,
  memoryMessage,
  isMemoryLoading: isBusy,
  isMemoryReadUnavailable = false,
  pendingMemoryAction,
  densifyReview,
  densifyModel,
  setDensifyModel,
  densifyMemory,
  loadMemories,
  reviewHistory,
  changeMemory,
  editingMemoryId,
  editingMemoryText,
  setEditingMemoryText,
  beginMemoryEdit,
  canDiscardMemoryEdit,
  cancelMemoryEdit,
  runInBackground,
}: ReturnType<typeof useMemoryFeature> & {
  onOpenSource: (conversationId: string) => void;
  runInBackground: (work: Promise<unknown>) => void;
}) {
  const isMemoryLoading = isBusy || isMemoryReadUnavailable;
  const summaryEditing = editingMemoryId === "summary";
  const [view, setView] = useState<View>("overview");
  const [reviewedOperationId, setReviewedOperationId] = useState<string | null>(
    null,
  );
  const [chatIds, setChatIds] = useState<string[] | null>(null);
  const [includeLegacy, setIncludeLegacy] = useState(false);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const summaryId = useId();
  const root = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const invoker = useRef<HTMLElement | null>(null);
  const rowAfterSave = useRef<string | null>(null);
  const beforeAdd = useRef<string[] | null>(null);
  const previousEditing = useRef(editingMemoryId);
  const densifying = densifyReview?.state === "running";
  const reviewingDensify = densifyReview?.state === "review";
  const densifyButton = useRef<HTMLButtonElement>(null);
  const densifyHeading = useRef<HTMLHeadingElement>(null);
  const previousDensify = useRef(densifyReview?.state);
  useLayoutEffect(() => {
    if (densifyReview?.state === previousDensify.current) return;
    if (densifyReview?.state === "review") densifyHeading.current?.focus();
    else if (
      previousDensify.current === "review" ||
      previousDensify.current === "running"
    )
      densifyButton.current?.focus();
    previousDensify.current = densifyReview?.state;
  }, [densifyReview?.state]);
  const models = memory?.densify?.models;
  const selectedModelAvailable =
    densifyModel === undefined
      ? memory?.densify?.available
      : memory?.densify?.sourceAvailable &&
        models?.options.some((option) => option.value === densifyModel);
  const operation = memory?.rebuild?.operation;
  const retainedResult =
    !!operation &&
    operation.state !== "active" &&
    reviewedOperationId !== operation.id;
  const selection = {
    version: 1 as const,
    conversationIds: chatIds === null ? null : [...chatIds].sort(),
    includeLegacy,
  };
  const selectionReviewed =
    JSON.stringify(selection) === JSON.stringify(memory?.rebuild?.selection);
  const titles: Record<View, string> = {
    overview: "What your trainer remembers",
    history: "Update memory from chat history",
    manage: "Manage memory",
  };
  const confirmationCurrent =
    !!confirmation && confirmation.inspection === memory;
  useLayoutEffect(() => {
    if (view !== "overview") heading.current?.focus();
  }, [view]);
  useLayoutEffect(() => {
    if (confirmation)
      root.current
        ?.querySelector<HTMLButtonElement>("[data-confirm-cancel]")
        ?.focus();
  }, [confirmation]);
  useLayoutEffect(() => {
    if (editingMemoryId) {
      if (
        editingMemoryId !== previousEditing.current ||
        !root.current?.contains(document.activeElement)
      )
        root.current?.querySelector("textarea")?.focus();
    } else if (previousEditing.current && memory) {
      const rows = [
        ...(root.current?.querySelectorAll<HTMLElement>("[data-memory-id]") ??
          []),
      ];
      const target = rows.find(
        (r) =>
          r.dataset.memoryId === rowAfterSave.current ||
          (beforeAdd.current !== null &&
            !beforeAdd.current.includes(r.dataset.memoryId ?? "")),
      );
      (
        target ??
        (invoker.current?.isConnected ? invoker.current : heading.current)
      )?.focus();
      rowAfterSave.current = null;
      beforeAdd.current = null;
    }
    // A successful save hides the prior projection until its read completes.
    // Retain the exit transition so that read can return focus to the saved row.
    if (editingMemoryId || memory) previousEditing.current = editingMemoryId;
  }, [editingMemoryId, memory]);
  const go = (next: View) => {
    if (isMemoryLoading || !canDiscardMemoryEdit()) return;
    if (editingMemoryId) cancelMemoryEdit();
    invoker.current = document.activeElement as HTMLElement;
    setConfirmation(null);
    setView(next);
  };
  const back = () => {
    if (!canDiscardMemoryEdit()) return;
    cancelMemoryEdit();
    setConfirmation(null);
    setView("overview");
    queueMicrotask(() => {
      if (invoker.current?.isConnected) invoker.current.focus();
      else heading.current?.focus();
    });
  };
  const edit = (id: string, text: string) => {
    if (!canDiscardMemoryEdit()) return;
    invoker.current = document.activeElement as HTMLElement;
    beginMemoryEdit(id, text);
  };
  const confirm = (
    action: MemoryAction,
    title: string,
    label: string,
    text: string,
    destructive = false,
  ) => {
    if (!memory || isMemoryLoading) return;
    invoker.current = document.activeElement as HTMLElement;
    setConfirmation({
      action,
      inspection: memory,
      title,
      label,
      text,
      destructive,
    });
  };
  const cancelConfirmation = () => {
    setConfirmation(null);
    queueMicrotask(() => {
      if (invoker.current?.isConnected) invoker.current.focus();
    });
  };
  return (
    <div
      className={`memory-root-card${summaryEditing ? " memory-summary-editing" : ""}`}
      aria-label="Cross-chat memory"
      data-memory-ready={!!memory && !isMemoryLoading}
      data-memory-chat-ready={!!memory?.selectedChat}
      data-memory-view={view}
      ref={root}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        if (confirmation || editingMemoryId || view !== "overview") {
          event.preventDefault();
          event.stopPropagation();
          if (confirmation) cancelConfirmation();
          else if (editingMemoryId) {
            if (canDiscardMemoryEdit()) cancelMemoryEdit();
          } else back();
        }
      }}
    >
      {view !== "overview" && (
        <button
          className="secondary-button memory-back"
          type="button"
          disabled={isMemoryLoading}
          onClick={back}
        >
          Back to memory
        </button>
      )}
      {!summaryEditing && (
        <h3 tabIndex={-1} ref={heading}>
          {titles[view]}
        </h3>
      )}
      {view === "overview" && !summaryEditing && (
        <p>
          When enabled, memory helps your trainer carry important details from
          previous conversations into new chats.
        </p>
      )}
      {memoryMessage && (
        <p className="memory-notice" role="status" aria-live="polite">
          {memoryMessage}
        </p>
      )}
      {isBusy && (
        <p role="status">
          {pendingMemoryAction === "rebuild-start"
            ? "Starting history update…"
            : pendingMemoryAction === "rebuild-cancel"
              ? "Checking cancellation…"
              : pendingMemoryAction
                ? "Saving memory change… Previous content is hidden until checked."
                : "Checking saved memory…"}
        </p>
      )}
      {!memory && !isBusy && (
        <button type="button" onClick={() => runInBackground(loadMemories())}>
          Retry loading
        </button>
      )}
      {confirmation && (
        <section className="memory-confirm" aria-label={confirmation.title}>
          <h4>{confirmation.title}</h4>
          {confirmation.text && <p>{confirmation.text}</p>}
          {confirmation.action.action === "rebuild-start" && (
            <HistoryReview memory={confirmation.inspection} confirmation />
          )}
          {!confirmationCurrent && (
            <p role="alert">
              Memory or chat selection changed. Cancel and review again; this
              confirmation cannot use a newer snapshot.
            </p>
          )}
          <div className="button-row">
            <button
              type="button"
              data-confirm-cancel
              onClick={cancelConfirmation}
            >
              Cancel
            </button>
            <button
              type="button"
              className={confirmation.destructive ? "danger-button" : ""}
              disabled={!confirmationCurrent || isMemoryLoading}
              onClick={() => {
                const captured = confirmation;
                setConfirmation(null);
                runInBackground(
                  changeMemory(captured.action, captured.inspection),
                );
              }}
            >
              {confirmation.label}
            </button>
          </div>
        </section>
      )}
      {memory && !confirmation && (
        <>
          {view === "overview" && (
            <>
              {!summaryEditing && (
                <>
                  <div className="memory-status-row">
                    <p>
                      <strong>{memory.enabled ? "On" : "Off"}</strong> ·{" "}
                      {memoryStatus(memory)}
                    </p>
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={isMemoryLoading}
                      onClick={() =>
                        memory.enabled
                          ? runInBackground(changeMemory({ action: "disable" }))
                          : confirm(
                              { action: "enable" },
                              "Turn memory On?",
                              "Turn memory On",
                              "Usable context may be sent to the configured provider. Automatic processing has no daily cost cap. Saved items can be used again; past conversations are not automatically recovered.",
                            )
                      }
                    >
                      {memory.enabled ? "Turn Off" : "Turn On"}
                    </button>
                  </div>
                  <section
                    aria-label="Generated summary"
                    data-memory-id="summary"
                    tabIndex={-1}
                  >
                    <div className="memory-section-heading">
                      <h4>Generated summary</h4>
                      <button
                        type="button"
                        disabled={
                          isMemoryLoading ||
                          !!editingMemoryId ||
                          densifying ||
                          reviewingDensify
                        }
                        onClick={() => edit("summary", memory.stored.text)}
                      >
                        Edit summary
                      </button>
                    </div>
                    <p>
                      {memory.characters} characters · target {memory.cap} ·
                      generated text only
                    </p>
                    <div className="memory-densify-model">
                      <label htmlFor={`${summaryId}-model`}>
                        Model for this run
                      </label>
                      <select
                        id={`${summaryId}-model`}
                        aria-describedby={`${summaryId}-model-scope`}
                        value={densifyModel ?? ""}
                        disabled={
                          isMemoryLoading ||
                          !!editingMemoryId ||
                          densifying ||
                          reviewingDensify ||
                          !models?.options.length
                        }
                        onChange={(event) =>
                          setDensifyModel(event.target.value || undefined)
                        }
                      >
                        <option value="">
                          Default —{" "}
                          {models?.default.label ?? "Memory model unavailable"}
                          {models && !models.default.available
                            ? " (unavailable)"
                            : ""}
                        </option>
                        {densifyModel !== undefined &&
                          !models?.options.some(
                            (option) => option.value === densifyModel,
                          ) && (
                            <option value={densifyModel} disabled>
                              Unavailable selected model
                            </option>
                          )}
                        {models?.options.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="button-row">
                      {densifying && (
                        <span
                          className="memory-densify-status"
                          role="status"
                          aria-live="polite"
                          aria-atomic="true"
                        >
                          <span
                            className="memory-busy-cue"
                            aria-hidden="true"
                          />
                          Densifying…
                        </span>
                      )}
                      <button
                        type="button"
                        ref={densifyButton}
                        disabled={
                          isMemoryLoading ||
                          !!editingMemoryId ||
                          densifying ||
                          reviewingDensify ||
                          !selectedModelAvailable
                        }
                        onClick={() =>
                          runInBackground(densifyMemory("densify-request"))
                        }
                      >
                        Densify summary
                      </button>
                      {densifying && (
                        <button
                          type="button"
                          onClick={() =>
                            runInBackground(
                              densifyMemory("densify-cancel", densifyReview.id),
                            )
                          }
                        >
                          Cancel densify
                        </button>
                      )}
                    </div>
                    <p
                      className="secondary-copy"
                      id={`${summaryId}-model-scope`}
                    >
                      For this request only; saved settings and automatic
                      updates stay unchanged. This optional rewrite uses one
                      extra AI request and may incur cost; review before saving.
                    </p>
                    {(editingMemoryId || !selectedModelAvailable) &&
                      !densifying &&
                      !reviewingDensify && (
                        <p className="secondary-copy">
                          {editingMemoryId
                            ? "Save or cancel your edit first."
                            : "Needs a usable saved summary, an available model for this run and no running memory update."}
                        </p>
                      )}
                    {densifying && (
                      <p>
                        Your saved summary stays in use. Cancellation cannot
                        recall sent text or costs.
                      </p>
                    )}
                    {reviewingDensify && (
                      <section
                        className="memory-confirm"
                        aria-label="Review densified summary"
                      >
                        <h4 tabIndex={-1} ref={densifyHeading}>
                          Review densified summary
                        </h4>
                        {densifyReview.modelLabel && (
                          <p>Request model: {densifyReview.modelLabel}</p>
                        )}
                        <p>
                          {densifyReview.before} → {densifyReview.after}{" "}
                          characters · target {densifyReview.target}
                        </p>
                        <p>
                          {densifyReview.shorter
                            ? `${densifyReview.before - densifyReview.after!} fewer characters. Check meaning before saving.`
                            : "No reduction. This result cannot replace your summary; no automatic retry."}
                        </p>
                        <div
                          className="memory-text"
                          role="region"
                          aria-label="Complete candidate summary"
                          tabIndex={0}
                          style={{
                            maxHeight: "20rem",
                            overflowY: "auto",
                            whiteSpace: "pre-wrap",
                          }}
                        >
                          {densifyReview.text}
                        </div>
                        <p>
                          Use Show summary below to compare the original saved
                          summary when it is collapsed.
                        </p>
                        <div className="button-row">
                          <button
                            type="button"
                            disabled={
                              isMemoryLoading ||
                              !!editingMemoryId ||
                              !densifyReview.shorter
                            }
                            onClick={() =>
                              runInBackground(
                                densifyMemory(
                                  "densify-accept",
                                  densifyReview.id,
                                ),
                              )
                            }
                          >
                            Use shorter summary
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              runInBackground(
                                densifyMemory(
                                  "densify-discard",
                                  densifyReview.id,
                                ),
                              )
                            }
                          >
                            Discard
                          </button>
                        </div>
                      </section>
                    )}
                    {densifyReview &&
                      !densifying &&
                      !reviewingDensify &&
                      densifyReview.state !== "accepted" && (
                        <p role="status">
                          {densifyReview.state === "discarded"
                            ? "Candidate discarded. Saved summary unchanged."
                            : densifyReview.state === "cancelled"
                              ? "Densify cancelled. Sent requests may still incur cost; saved summary unchanged."
                              : "Densify unavailable or expired. Saved summary unchanged; refresh before a new deliberate request."}
                        </p>
                      )}
                    {memory.enabled && memory.state !== "unavailable" ? (
                      memory.stored.text ? (
                        <>
                          <button
                            type="button"
                            aria-expanded={summaryExpanded}
                            aria-controls={summaryId}
                            onClick={() =>
                              setSummaryExpanded((expanded) => !expanded)
                            }
                          >
                            {summaryExpanded ? "Hide summary" : "Show summary"}
                          </button>
                          <p
                            id={summaryId}
                            className="memory-text"
                            hidden={!summaryExpanded}
                          >
                            {memory.stored.text}
                          </p>
                        </>
                      ) : (
                        <p className="memory-text">
                          No generated summary yet. Update from chat history to
                          build one.
                        </p>
                      )
                    ) : (
                      <p>
                        Saved summary is not in use.{" "}
                        {memory.enabled
                          ? "Check memory status before continuing."
                          : "Turn memory On to use it again."}
                      </p>
                    )}
                  </section>
                  <section aria-label="Manual preferences">
                    <div className="memory-section-heading">
                      <h4>Your preferences</h4>
                      <button
                        type="button"
                        disabled={
                          isMemoryLoading ||
                          !!editingMemoryId ||
                          densifying ||
                          reviewingDensify
                        }
                        onClick={() => edit("new", "")}
                      >
                        Add preference
                      </button>
                    </div>
                    {!memory.preferences.length && !editingMemoryId && (
                      <p className="memory-empty">
                        Add your own preferences or restrictions here. History
                        updates do not rewrite them.
                      </p>
                    )}
                    {memory.preferences.map((saved) => (
                      <article
                        className="memory-row"
                        key={saved.id}
                        tabIndex={-1}
                        data-memory-id={saved.id}
                        aria-label="Manual preference"
                      >
                        <div className="memory-row-main">
                          <p className="memory-text">{saved.text}</p>
                          <div className="button-row">
                            <button
                              type="button"
                              disabled={
                                isMemoryLoading ||
                                !!editingMemoryId ||
                                densifying ||
                                reviewingDensify
                              }
                              onClick={() => edit(saved.id, saved.text)}
                            >
                              Edit preference
                            </button>
                            <button
                              type="button"
                              disabled={isMemoryLoading || !!editingMemoryId}
                              onClick={() =>
                                confirm(
                                  { action: "forget", id: saved.id },
                                  "Remove this preference?",
                                  "Remove preference",
                                  `“${saved.text}”\n\nRemove only this separately authored preference. This does not delete conversations or surgically remove related meaning from the generated summary.`,
                                  true,
                                )
                              }
                            >
                              Remove preference
                            </button>
                          </div>
                        </div>
                      </article>
                    ))}
                  </section>
                </>
              )}
              {editingMemoryId && (
                <section
                  className="memory-editor"
                  aria-label={
                    editingMemoryId === "summary"
                      ? "Edit generated summary"
                      : editingMemoryId === "new"
                        ? "Add preference"
                        : "Edit preference"
                  }
                >
                  {!summaryEditing && (
                    <h4>
                      {editingMemoryId === "new"
                        ? "Add preference"
                        : "Edit preference"}
                    </h4>
                  )}
                  <label>
                    {editingMemoryId === "summary"
                      ? "Complete generated summary"
                      : "Preference"}
                    <textarea
                      value={editingMemoryText}
                      disabled={isMemoryLoading}
                      onChange={(event) =>
                        setEditingMemoryText(event.target.value)
                      }
                    />
                  </label>
                  <p>
                    {editingMemoryId === "summary"
                      ? `This replaces the complete generated text. The ${memory.cap}-character target is guidance, not a maximum. Regeneration replaces direct summary edits too.`
                      : "Saved separately as your own preference; history regeneration preserves it and it does not count toward the generated target."}{" "}
                    This text may be sent to your AI provider.
                  </p>
                  <div className="button-row">
                    <button
                      type="button"
                      disabled={
                        isMemoryLoading ||
                        (editingMemoryId !== "summary" &&
                          !editingMemoryText.trim())
                      }
                      onClick={() => {
                        rowAfterSave.current =
                          editingMemoryId === "new" ? null : editingMemoryId;
                        beforeAdd.current =
                          editingMemoryId === "new"
                            ? memory.preferences.map((i) => i.id)
                            : null;
                        runInBackground(
                          changeMemory(
                            editingMemoryId === "summary"
                              ? {
                                  action: "edit-summary",
                                  text: editingMemoryText,
                                }
                              : {
                                  action: "edit",
                                  id:
                                    editingMemoryId === "new"
                                      ? null
                                      : editingMemoryId,
                                  text: editingMemoryText,
                                },
                          ),
                        );
                      }}
                    >
                      {editingMemoryId === "summary"
                        ? "Save summary"
                        : "Save preference"}
                    </button>
                    <button
                      type="button"
                      disabled={isMemoryLoading}
                      onClick={() => {
                        if (canDiscardMemoryEdit()) cancelMemoryEdit();
                      }}
                    >
                      Cancel edit
                    </button>
                  </div>
                </section>
              )}
              {!summaryEditing && (
                <>
                  <nav className="memory-routes" aria-label="Memory options">
                    <button
                      type="button"
                      disabled={isMemoryLoading || !!editingMemoryId}
                      onClick={() => go("history")}
                    >
                      Update from chat history
                      {memory.rebuild?.operation?.state === "active"
                        ? " · running"
                        : ""}
                    </button>
                    <button
                      type="button"
                      disabled={isMemoryLoading || !!editingMemoryId}
                      onClick={() => go("manage")}
                    >
                      Manage memory
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={isBusy || !!editingMemoryId}
                      onClick={() => runInBackground(loadMemories())}
                    >
                      {isMemoryReadUnavailable ? "Retry connection" : "Refresh"}
                    </button>
                  </nav>
                  {canRetrySummary(memory) && (
                    <button
                      type="button"
                      disabled={isMemoryLoading}
                      onClick={() =>
                        runInBackground(changeMemory({ action: "retry" }))
                      }
                    >
                      Retry summary processing
                    </button>
                  )}
                </>
              )}
            </>
          )}
          {view === "history" && (
            <section aria-label="Rebuild from chat history">
              <HistoryProgress
                memory={memory}
                unavailable={isMemoryReadUnavailable}
              />
              {retainedResult &&
                [
                  "complete",
                  "cancelled",
                  "interrupted",
                  "invalidated",
                ].includes(operation.state) && (
                  <button
                    type="button"
                    disabled={isMemoryLoading || isMemoryReadUnavailable}
                    onClick={() => setReviewedOperationId(operation.id)}
                  >
                    Review a new update
                  </button>
                )}
              {memory.historical.manifests
                .filter((m) =>
                  ["active", "paused", "review-required"].includes(m.state),
                )
                .map((m) => (
                  <section
                    className="memory-notice"
                    key={m.id}
                    aria-label="Earlier update recovery"
                  >
                    <p>
                      An earlier source update is{" "}
                      {m.state === "active"
                        ? "running"
                        : "paused or needs review"}
                      : {m.position} of {m.total} messages processed. Cancel it
                      before reviewing a new history update; previous costs
                      remain.
                    </p>
                    <button
                      type="button"
                      disabled={isMemoryLoading || isMemoryReadUnavailable}
                      onClick={() =>
                        confirm(
                          { action: "import-cancel", id: m.id },
                          "Cancel earlier update?",
                          "Cancel earlier update",
                          "Stop further processing of this older selection. Saved progress and previous costs remain; no new update starts automatically.",
                        )
                      }
                    >
                      Cancel earlier update
                    </button>
                  </section>
                ))}
              {memory.rebuild?.operation?.state !== "active" &&
                !retainedResult && (
                  <>
                    <fieldset disabled={isMemoryLoading}>
                      <legend>Conversations to review</legend>
                      <label className="memory-source-choice">
                        <input
                          type="radio"
                          name="memory-scope"
                          checked={chatIds === null}
                          onChange={() => setChatIds(null)}
                        />
                        All retained conversations
                      </label>
                      <label className="memory-source-choice">
                        <input
                          type="radio"
                          name="memory-scope"
                          checked={chatIds !== null}
                          onChange={() => setChatIds([])}
                        />
                        Choose conversations
                      </label>
                      {chatIds !== null && (
                        <div className="memory-chat-choices">
                          {memory.rebuild?.conversations?.map((chat) => (
                            <label
                              className="memory-source-choice"
                              key={chat.id}
                            >
                              <input
                                type="checkbox"
                                checked={chatIds.includes(chat.id)}
                                onChange={(event) =>
                                  setChatIds((ids) =>
                                    event.target.checked
                                      ? [...(ids ?? []), chat.id]
                                      : (ids ?? []).filter(
                                          (id) => id !== chat.id,
                                        ),
                                  )
                                }
                              />
                              <span>
                                {chat.title || "Untitled conversation"}
                              </span>
                            </label>
                          ))}
                        </div>
                      )}
                      <label className="memory-source-choice">
                        <input
                          type="checkbox"
                          checked={includeLegacy}
                          onChange={(event) =>
                            setIncludeLegacy(event.target.checked)
                          }
                        />
                        <span>
                          Include older conversations that need permission to
                          reuse
                        </span>
                      </label>
                    </fieldset>
                    {!selectionReviewed ? (
                      <button
                        type="button"
                        disabled={isMemoryLoading}
                        onClick={() =>
                          runInBackground(reviewHistory(selection))
                        }
                      >
                        Review selected history
                      </button>
                    ) : (
                      <>
                        <HistoryReview memory={memory} />
                        <ul>
                          {historyBlockers(memory).map((reason) => (
                            <li key={reason}>{reason}</li>
                          ))}
                        </ul>
                        <button
                          type="button"
                          disabled={
                            isMemoryLoading ||
                            !memory.rebuild?.ready ||
                            !!historyBlockers(memory).length
                          }
                          onClick={() =>
                            confirm(
                              {
                                action: "rebuild-start",
                                id: crypto.randomUUID(),
                                snapshot: memory.rebuild!.snapshot,
                                selection: memory.rebuild!.selection,
                              },
                              "Start reviewed history update?",
                              "Start update",
                              "",
                            )
                          }
                        >
                          Review and update
                        </button>
                      </>
                    )}
                  </>
                )}
              {memory.rebuild?.operation?.state === "active" && (
                <button
                  type="button"
                  disabled={isBusy}
                  aria-disabled={isMemoryReadUnavailable}
                  onClick={() =>
                    runInBackground(
                      changeMemory({
                        action: "rebuild-cancel",
                        id: memory.rebuild!.operation!.id,
                      }),
                    )
                  }
                >
                  Cancel
                </button>
              )}
              {isMemoryReadUnavailable && (
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => runInBackground(loadMemories())}
                >
                  Retry connection
                </button>
              )}
            </section>
          )}
          {view === "manage" && (
            <div className="memory-routes">
              <button
                type="button"
                className="danger-button"
                disabled={isMemoryLoading}
                onClick={() =>
                  confirm(
                    { action: "clear" },
                    "Clear saved memory?",
                    "Clear saved memory",
                    "Remove saved memory, including manual entries. Future new turns can create memory. Conversations, Profile, Garmin, plans and older records remain. Backups and text already sent to providers are not erased. To pause without deleting, turn memory Off instead.",
                    true,
                  )
                }
              >
                Clear saved memory
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
