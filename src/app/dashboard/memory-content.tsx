import { useLayoutEffect, useRef, useState } from "react";
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
  memoryQualification,
  memoryStatus,
} from "./memory-presentation";

type View = "overview" | "item" | "history" | "manage" | "import" | "legacy";
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
  memoryMessage,
  isMemoryLoading,
  pendingMemoryAction,
  loadMemories,
  reviewHistory,
  changeMemory,
  editingMemoryId,
  editingMemoryText,
  setEditingMemoryText,
  beginMemoryEdit,
  canDiscardMemoryEdit,
  cancelMemoryEdit,
  onOpenSource,
  runInBackground,
}: ReturnType<typeof useMemoryFeature> & {
  onOpenSource: (conversationId: string) => void;
  runInBackground: (work: Promise<unknown>) => void;
}) {
  const [view, setView] = useState<View>("overview");
  const [itemId, setItemId] = useState<string | null>(null);
  const [reviewed, setReviewed] = useState<string[]>([]);
  const [chatIds, setChatIds] = useState<string[] | null>(null);
  const [includeLegacy, setIncludeLegacy] = useState(false);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const invoker = useRef<HTMLElement | null>(null);
  const rowAfterSave = useRef<string | null>(null);
  const beforeAdd = useRef<string[] | null>(null);
  const previousEditing = useRef(editingMemoryId);
  const item = memory?.stored.items.find((i) => i.id === itemId);
  const selectedSources = reviewed.filter((id) =>
    memory?.historical.candidates.some((s) => s.id === id),
  );
  const selection = {
    version: 1 as const,
    conversationIds: chatIds === null ? null : [...chatIds].sort(),
    includeLegacy,
  };
  const selectionReviewed =
    JSON.stringify(selection) === JSON.stringify(memory?.rebuild?.selection);
  const titles: Record<View, string> = {
    overview: "What your trainer remembers",
    item: "Memory details",
    history: "Update memory from chat history",
    manage: "Manage memory",
    import: "Review earlier sources",
    legacy: "Older saved records",
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
    if (editingMemoryId) root.current?.querySelector("textarea")?.focus();
    else if (previousEditing.current && memory) {
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
      (target ?? invoker.current ?? heading.current)?.focus();
      rowAfterSave.current = null;
      beforeAdd.current = null;
    }
    previousEditing.current = editingMemoryId;
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
      className="memory-root-card"
      aria-label="Cross-chat memory"
      data-memory-ready={!!memory && !isMemoryLoading}
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
      <h3 tabIndex={-1} ref={heading}>
        {titles[view]}
      </h3>
      {memoryMessage && (
        <p className="memory-notice" role="status" aria-live="polite">
          {memoryMessage}
        </p>
      )}
      {isMemoryLoading && (
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
      {!memory && !isMemoryLoading && (
        <button type="button" onClick={() => runInBackground(loadMemories())}>
          Check saved memory
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
              <section aria-label="Saved summary items">
                <div className="memory-section-heading">
                  <h4>Saved memories</h4>
                  <button
                    type="button"
                    disabled={isMemoryLoading || !!editingMemoryId}
                    onClick={() => edit("new", "")}
                  >
                    Add memory
                  </button>
                </div>
                {!memory.stored.items.length && !editingMemoryId && (
                  <p className="memory-empty">
                    Nothing saved here yet. Add something you want your trainer
                    to remember, or update from past conversations below.
                  </p>
                )}
                {memory.stored.items.map((saved) => (
                  <article
                    className="memory-row"
                    key={saved.id}
                    tabIndex={-1}
                    data-memory-id={saved.id}
                    aria-label="Saved memory"
                  >
                    <div className="memory-row-main">
                      <p className="memory-qualifier">
                        {memoryQualification(saved)}
                      </p>
                      <p className="memory-text">{saved.text}</p>
                      <div className="button-row">
                        <button
                          type="button"
                          disabled={isMemoryLoading || !!editingMemoryId}
                          onClick={() => edit(saved.id, saved.text)}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          disabled={isMemoryLoading || !!editingMemoryId}
                          onClick={() =>
                            confirm(
                              { action: "forget", id: saved.id },
                              "Forget this memory?",
                              "Forget memory",
                              `“${saved.text}”\n\nRemove this memory and keep its sources from recreating it. The original conversation remains. New statements can still become new memories.`,
                              true,
                            )
                          }
                        >
                          Forget
                        </button>
                        <button
                          type="button"
                          className="secondary-button"
                          disabled={isMemoryLoading || !!editingMemoryId}
                          onClick={() => {
                            setItemId(saved.id);
                            go("item");
                          }}
                        >
                          Source & details
                        </button>
                      </div>
                    </div>
                  </article>
                ))}
                {editingMemoryId && (
                  <section
                    className="memory-editor"
                    aria-label={
                      editingMemoryId === "new" ? "Add memory" : "Edit memory"
                    }
                  >
                    <h4>
                      {editingMemoryId === "new" ? "Add memory" : "Edit memory"}
                    </h4>
                    <label>
                      Memory
                      <textarea
                        value={editingMemoryText}
                        maxLength={2400}
                        disabled={isMemoryLoading}
                        onChange={(event) =>
                          setEditingMemoryText(event.target.value)
                        }
                      />
                    </label>
                    <p>
                      {editingMemoryId === "new"
                        ? "Saved as your own memory."
                        : "Keeps its existing sources and expiry."}{" "}
                      Keep it concise; sensitive details cannot be saved.
                    </p>
                    <div className="button-row">
                      <button
                        type="button"
                        disabled={isMemoryLoading || !editingMemoryText.trim()}
                        onClick={() => {
                          rowAfterSave.current =
                            editingMemoryId === "new" ? null : editingMemoryId;
                          beforeAdd.current =
                            editingMemoryId === "new"
                              ? memory.stored.items.map((i) => i.id)
                              : null;
                          runInBackground(
                            changeMemory({
                              action: "edit",
                              id:
                                editingMemoryId === "new"
                                  ? null
                                  : editingMemoryId,
                              text: editingMemoryText,
                            }),
                          );
                        }}
                      >
                        Save memory
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
              </section>
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
                  disabled={isMemoryLoading || !!editingMemoryId}
                  onClick={() => runInBackground(loadMemories())}
                >
                  Check saved memory
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
          {view === "item" &&
            (item ? (
              <>
                <p className="memory-qualifier">{memoryQualification(item)}</p>
                <p className="memory-text">{item.text}</p>
                <p>
                  {memory.manualIds.includes(item.id)
                    ? "Manually saved"
                    : "Saved from conversations"}
                  {item.expiresAt !== null
                    ? ` · Expires ${new Date(item.expiresAt).toLocaleDateString()}`
                    : ""}
                </p>
                {!item.sourceIds.length && (
                  <p>
                    Source unavailable; the conversation cannot be
                    reconstructed.
                  </p>
                )}
                {[
                  ...new Set(
                    item.sourceIds
                      .map(
                        (id) =>
                          memory.sources.find((s) => s.sourceId === id)
                            ?.conversationId,
                      )
                      .filter((id): id is string => !!id),
                  ),
                ].map((id) => (
                  <button
                    key={id}
                    type="button"
                    disabled={isMemoryLoading}
                    onClick={() => onOpenSource(id)}
                  >
                    Open source conversation
                  </button>
                ))}
                {item.sourceIds.some(
                  (id) =>
                    !memory.sources.find((s) => s.sourceId === id)
                      ?.conversationId,
                ) && (
                  <p>
                    {memory.manualIds.includes(item.id)
                      ? "Includes your own saved text."
                      : "Some source conversations are unavailable."}
                  </p>
                )}
              </>
            ) : (
              <p>This item is no longer available. Return to saved memory.</p>
            ))}
          {view === "history" && (
            <section aria-label="Rebuild from chat history">
              <HistoryProgress memory={memory} />
              {memory.rebuild?.operation?.state === "complete" && (
                <button type="button" onClick={back}>
                  View saved memory
                </button>
              )}
              {memory.rebuild?.operation?.state !== "active" && (
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
                          <label className="memory-source-choice" key={chat.id}>
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
                            <span>{chat.title || "Untitled conversation"}</span>
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
                      onClick={() => runInBackground(reviewHistory(selection))}
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
                  disabled={isMemoryLoading}
                  onClick={() =>
                    runInBackground(
                      changeMemory({
                        action: "rebuild-cancel",
                        id: memory.rebuild!.operation!.id,
                      }),
                    )
                  }
                >
                  Cancel history update
                </button>
              )}
              <button
                type="button"
                className="secondary-button"
                disabled={isMemoryLoading}
                onClick={() => runInBackground(loadMemories())}
              >
                Check update status
              </button>
            </section>
          )}
          {view === "manage" && (
            <div className="memory-routes">
              <button type="button" onClick={() => go("import")}>
                Review earlier sources
              </button>
              <button type="button" onClick={() => go("legacy")}>
                Older saved records
              </button>
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
          {view === "import" && (
            <>
              <p>
                Choose earlier messages to add to memory. Only usable completed
                sources are offered; originals remain.
              </p>
              {memory.historical.candidates.map((source) => (
                <label className="memory-source-choice" key={source.id}>
                  <input
                    type="checkbox"
                    checked={selectedSources.includes(source.id)}
                    disabled={isMemoryLoading}
                    onChange={(event) =>
                      setReviewed((ids) =>
                        event.target.checked
                          ? [...ids, source.id]
                          : ids.filter((id) => id !== source.id),
                      )
                    }
                  />
                  <span>
                    {source.text}
                    {source.referent && (
                      <span className="memory-source-context">
                        Context: {source.referent}
                      </span>
                    )}
                  </span>
                </label>
              ))}
              {!memory.historical.candidates.length && (
                <p>
                  No usable earlier messages available. To recover older
                  conversations, use Update from chat history.
                </p>
              )}
              <button
                type="button"
                disabled={
                  !memory.enabled ||
                  isMemoryLoading ||
                  !selectedSources.length ||
                  memory.historical.manifests.some((m) =>
                    ["active", "paused"].includes(m.state),
                  )
                }
                onClick={() =>
                  confirm(
                    { action: "import-create", sourceIds: selectedSources },
                    "Process reviewed sources?",
                    "Process selection",
                    `${selectedSources.length} selected messages go to the configured provider and may incur cost, with no daily processing cap. Original conversations remain. Cancel cannot recall sent text or charges.`,
                  )
                }
              >
                Process reviewed selection ({selectedSources.length})
              </button>
              {memory.historical.manifests.map((manifest) => (
                <section className="memory-notice" key={manifest.id}>
                  <p>
                    {manifest.state === "active"
                      ? "Import running"
                      : manifest.state === "paused"
                        ? "Import paused"
                        : manifest.state === "complete"
                          ? "Import finished"
                          : "Import needs review"}
                    : {manifest.position} of {manifest.total} messages
                    processed.
                  </p>
                  {manifest.state === "active" && (
                    <button
                      type="button"
                      disabled={isMemoryLoading}
                      onClick={() =>
                        runInBackground(
                          changeMemory({
                            action: "import-pause",
                            id: manifest.id,
                          }),
                        )
                      }
                    >
                      Pause import
                    </button>
                  )}
                  {manifest.state === "paused" && (
                    <button
                      type="button"
                      disabled={isMemoryLoading || !memory.enabled}
                      onClick={() =>
                        confirm(
                          { action: "import-resume", id: manifest.id },
                          "Resume reviewed import?",
                          "Resume import",
                          "Send the remaining reviewed messages to the configured provider. Costs have no daily cap; earlier uncertain requests are not repeated. Changed sources require a new review.",
                        )
                      }
                    >
                      Resume reviewed import
                    </button>
                  )}
                  {["active", "paused", "review-required"].includes(
                    manifest.state,
                  ) && (
                    <button
                      type="button"
                      disabled={isMemoryLoading}
                      onClick={() =>
                        runInBackground(
                          changeMemory({
                            action: "import-cancel",
                            id: manifest.id,
                          }),
                        )
                      }
                    >
                      Cancel import
                    </button>
                  )}
                  {manifest.state === "review-required" && (
                    <p>
                      Sources changed. Cancel this import and review a new
                      selection.
                    </p>
                  )}
                </section>
              ))}
            </>
          )}
          {view === "legacy" && (
            <>
              <p>
                Older records are read-only and not used by chat. Up to 200 are
                shown; nothing is automatically imported.
              </p>
              {!memory.legacy.length && <p>No older records loaded.</p>}
              {memory.legacy.map((old) => (
                <article className="memory-row" key={old.id}>
                  <div>
                    <p className="memory-text">{old.text}</p>
                    {old.expiresAt !== null && (
                      <p>
                        Expires {new Date(old.expiresAt).toLocaleDateString()}
                      </p>
                    )}
                    {old.conversationId && (
                      <button
                        type="button"
                        onClick={() => onOpenSource(old.conversationId!)}
                      >
                        Open legacy source conversation
                      </button>
                    )}
                  </div>
                </article>
              ))}
            </>
          )}
        </>
      )}
    </div>
  );
}
