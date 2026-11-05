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
  MemoryUsage,
} from "./memory-presentation";

type View =
  | "overview"
  | "item"
  | "chat"
  | "history"
  | "usage"
  | "technical"
  | "manage"
  | "import"
  | "legacy";
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
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const invoker = useRef<HTMLElement | null>(null);
  const rowAfterSave = useRef<string | null>(null);
  const beforeAdd = useRef<string[] | null>(null);
  const previousEditing = useRef(editingMemoryId);
  const pin = memory?.selectedChat?.pin;
  const item = memory?.stored.items.find((i) => i.id === itemId);
  const selectedSources = reviewed.filter((id) =>
    memory?.historical.candidates.some((s) => s.id === id),
  );
  const titles: Record<View, string> = {
    overview: "What your trainer remembers",
    item: "Memory details",
    chat: "This chat’s memory",
    history: "Update memory from chat history",
    usage: "How memory works & costs",
    technical: "Technical details",
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
  const updateChat = () =>
    memory?.selectedChat &&
    confirm(
      {
        action: "refresh",
        conversationId: memory.selectedChat.conversationId,
        segmentRevision: memory.selectedChat.segmentRevision,
      },
      "Update this chat?",
      "Update this chat",
      "This changes the chat’s next usable saved memory snapshot. The app allows bounded catch-up, then saves only currently available memory (or none). Pending work may still need a later explicit update. It does not rewrite your transcript.",
    );
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
          <p>{confirmation.text}</p>
          {confirmation.action.action === "rebuild-start" && (
            <HistoryReview memory={confirmation.inspection} />
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
                          "Eligible minimized context may be sent to the configured provider. Automatic summary costs have no daily cap. Saved items can be used again, but earlier Off history is not automatically imported. Native configuration must already support On; pending Settings are not activated here.",
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
                    to remember, or review eligible chat history below. Other
                    app data has not been deleted.
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
                              `“${saved.text}”\n\nRemove this item and suppress its exact source versions. Original transcripts and other stores remain. Future new statements are separate sources.`,
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
                        ? "Saved as a standalone manual memory."
                        : "Keeps the existing source and expiry."}{" "}
                      Safety rules still apply. Maximum 2400 text units.
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
              {memory.selectedChat && (
                <section className="memory-chat-notice" aria-label="This chat">
                  <p>
                    {!pin
                      ? "This chat has no usable saved memory"
                      : memory.revision > pin.stamp.revision
                        ? "This chat has earlier memory"
                        : memory.usedByChat
                          ? "Used in this chat’s latest completed answer"
                          : "Saved for this chat; not yet used in a completed answer"}
                  </p>
                  <div className="button-row">
                    {(!pin || memory.revision > pin.stamp.revision) && (
                      <button
                        type="button"
                        disabled={isMemoryLoading || !memory.enabled}
                        onClick={updateChat}
                      >
                        Update this chat
                      </button>
                    )}
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={isMemoryLoading}
                      onClick={() => go("chat")}
                    >
                      View chat memory
                    </button>
                  </div>
                </section>
              )}
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
                  onClick={() => go("usage")}
                >
                  How memory works & costs
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
                    ? "Manual memory"
                    : "Generated from eligible sources"}{" "}
                  · {item.sourceIds.length} sources
                </p>
                <p>
                  {item.expiresAt === null
                    ? "No automatic expiry"
                    : `Expires ${new Date(item.expiresAt).toLocaleString()}`}{" "}
                  · Review {new Date(item.reviewAt).toLocaleDateString()}
                </p>
                {!item.sourceIds.length && (
                  <p>Source unavailable; no reconstructed transcript.</p>
                )}
                {item.sourceIds.map((id) => {
                  const source = memory.sources.find((s) => s.sourceId === id);
                  return source?.conversationId ? (
                    <button
                      key={id}
                      type="button"
                      disabled={isMemoryLoading}
                      onClick={() => onOpenSource(source.conversationId!)}
                    >
                      Open source conversation
                    </button>
                  ) : (
                    <p key={id}>
                      {source?.manual
                        ? "Standalone manual source"
                        : "Source unavailable; no reconstructed transcript"}
                    </p>
                  );
                })}
              </>
            ) : (
              <p>This item is no longer available. Return to saved memory.</p>
            ))}
          {view === "chat" && (
            <>
              {memory.selectedChat ? (
                <>
                  <p>
                    {!pin
                      ? "This chat has no usable saved memory. It may have been cleared or invalidated; local chat remains available."
                      : memory.usedByChat
                        ? "This saved snapshot was included in this chat’s latest completed answer."
                        : "Saved for this chat; not yet used in a completed answer. The full snapshot is included on the configured chat route."}
                  </p>
                  {pin && (
                    <>
                      <p className="memory-text">
                        {pin.value.text || "This snapshot has no saved text."}
                      </p>
                      <p>
                        Saved revision {pin.stamp.revision}; latest saved
                        revision {memory.revision}. {pin.omitted} whole items
                        omitted. Provider manages context capacity; saved token
                        counts from older builds are not model-fit guarantees.
                      </p>
                    </>
                  )}
                  <p>
                    Update explicitly adopts only available memory after bounded
                    catch-up; recent pending changes may still need another
                    update.
                  </p>
                  <button
                    type="button"
                    disabled={isMemoryLoading || !memory.enabled}
                    onClick={updateChat}
                  >
                    Update this chat
                  </button>
                </>
              ) : (
                <p>No chat selected.</p>
              )}
            </>
          )}
          {view === "history" && (
            <section aria-label="Rebuild from chat history">
              <HistoryProgress memory={memory} />
              {memory.rebuild?.operation?.state !== "active" && (
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
                        },
                        "Start reviewed history update?",
                        "Start update",
                        "This confirmation uses exactly the inventory and authority reviewed below. Changed history requires a new review.",
                      )
                    }
                  >
                    Review and update
                  </button>
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
              {memory.rebuild?.operation?.state === "complete" && (
                <button type="button" onClick={back}>
                  View saved memory
                </button>
              )}
            </section>
          )}
          {view === "usage" && (
            <MemoryUsage memory={memory} onDetails={() => go("technical")} />
          )}
          {view === "technical" && (
            <>
              <p>
                Change model and memory size in native Settings; saved topology
                needs explicit quit/reopen. No configuration editor is
                duplicated here.
              </p>
              <dl className="memory-facts">
                <dt>Model / character limit</dt>
                <dd>
                  {memory.model || "Unselected"} / {memory.cap}
                </dd>
                <dt>Latest revision / source frontier / pending</dt>
                <dd>
                  {memory.revision} / {memory.frontier} / {memory.pending}
                </dd>
                <dt>Saved at</dt>
                <dd>
                  {memory.publishedAt === null
                    ? "Never produced"
                    : new Date(memory.publishedAt).toLocaleString()}
                </dd>
                <dt>Items / characters</dt>
                <dd>
                  {memory.items} / {memory.characters}
                </dd>
                <dt>Attempts today</dt>
                <dd>{memory.attemptsToday}</dd>
                <dt>Price basis</dt>
                <dd>{memory.priceBasis}</dd>
              </dl>
              <p>
                The configured provider receives the full saved memory with
                policy, tools and fresh context. No capacity/tokenizer metadata
                is required. Provider capacity errors do not silently clip
                memory or switch models.
              </p>
              <p>{memory.authority}</p>
              <p>
                Diagnostic:{" "}
                {/^summary_[a-z_]+$/.test(memory.reason ?? "")
                  ? memory.reason
                  : memory.reason
                    ? "Unrecognized reason"
                    : memory.state}
              </p>
              {canRetrySummary(memory) && (
                <button
                  type="button"
                  onClick={() =>
                    runInBackground(changeMemory({ action: "retry" }))
                  }
                >
                  Retry summary processing
                </button>
              )}
            </>
          )}
          {view === "manage" && (
            <div className="memory-routes">
              <p>
                Use the On/Off control on the overview to pause use without
                deleting saved items.
              </p>
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
                    "Remove saved summary, manual items and chat snapshots. Future new turns may create memory. Original transcripts, Profile, Garmin, plans and older stores remain. Backups, exports and provider logs are not erased. This is not turning memory Off.",
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
                Choose individual minimized earlier sources; none are selected
                automatically. Originals remain. Only eligible completed sources
                are offered.
              </p>
              <p>{memory.historical.exclusions}</p>
              <p>
                At most 200 records / 100,000 Unicode scalars per selection;
                batches at most 20 share the existing foreground writer.
                Minimized text goes to the configured cloud model and can incur
                cost, with no daily summary spend cap. Pause/cancel cannot
                recall a request or refund unknown costs.
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
                        Selected antecedent only: {source.referent}
                      </span>
                    )}
                  </span>
                </label>
              ))}
              {!memory.historical.candidates.length && (
                <p>
                  No eligible linked source is available. Unproven or expired
                  records require manual review, not inferred provenance.
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
                    `${selectedSources.length} explicitly selected records will be processed using the configured cloud summary model. Minimized text may leave this device and incur cost with no daily summary cap. Originals remain; prior unknown costs remain reserved.`,
                  )
                }
              >
                Process reviewed selection ({selectedSources.length})
              </button>
              {memory.historical.manifests.map((manifest) => (
                <section className="memory-notice" key={manifest.id}>
                  <p>
                    Import {manifest.state}: {manifest.position} /{" "}
                    {manifest.total} records dispositioned. Check saved memory
                    for progress.
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
                          "Resume only the previously reviewed selection with the configured cloud summary model. Text may leave this device; costs have no daily cap. Original records and unknown previous costs remain. Changed authority will refuse rather than silently resume.",
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
                      Sources or controls changed. This manifest cannot resume;
                      cancel it and review a new eligible selection.
                    </p>
                  )}
                </section>
              ))}
            </>
          )}
          {view === "legacy" && (
            <>
              <p>
                Inactive · not used by ordinary chat. Read-only local review,{" "}
                {memory.legacy.length} loaded (maximum 200). No embedding call,
                conversion or automatic import. Original stores and migration
                markers remain.
              </p>
              {!memory.legacy.length && <p>No older records loaded.</p>}
              {memory.legacy.map((old) => (
                <article className="memory-row" key={old.id}>
                  <div>
                    <p className="memory-text">{old.text}</p>
                    <p>
                      {old.kind} · {old.status}
                      {old.expiresAt !== null
                        ? ` · Expires ${new Date(old.expiresAt).toLocaleString()}`
                        : ""}
                    </p>
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
