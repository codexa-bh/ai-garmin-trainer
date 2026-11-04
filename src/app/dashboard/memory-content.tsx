import { useState } from "react";
import type { useMemoryFeature } from "./use-memory";

export function MemoryContent({
  memory,
  memoryMessage,
  isMemoryLoading,
  loadMemories,
  changeMemory,
  editingMemoryId,
  editingMemoryText,
  setEditingMemoryId,
  setEditingMemoryText,
  cancelMemoryEdit,
  onOpenSource,
  runInBackground,
}: ReturnType<typeof useMemoryFeature> & {
  onOpenSource: (conversationId: string) => void;
  runInBackground: (work: Promise<unknown>) => void;
}) {
  const [reviewed, setReviewed] = useState<string[]>([]);
  const pin = memory?.selectedChat?.pin;
  const selectedSources = reviewed.filter((id) =>
    memory?.historical.candidates.some((source) => source.id === id),
  );
  const edit = (id: string, text: string) => {
    setEditingMemoryId(id);
    setEditingMemoryText(text);
  };
  return (
    <div
      className="settings-card memory-root-card"
      aria-label="Cross-chat memory"
    >
      <h2>Cross-chat memory</h2>
      <p>
        Bounded user-derived summaries, without embeddings. Current corrections,
        Profile and fresh tool evidence take precedence. The selected summary
        model also writes future automatic chat titles; titles remain
        independent when summary processing is Off.
      </p>
      <p role="status" aria-live="polite">
        {memoryMessage}
      </p>
      <div className="button-row memory-actions">
        <button
          type="button"
          disabled={isMemoryLoading}
          onClick={() => runInBackground(loadMemories())}
        >
          Reload memory
        </button>
        <button
          type="button"
          disabled={!memory || isMemoryLoading}
          onClick={() =>
            runInBackground(
              changeMemory({ action: memory?.enabled ? "disable" : "enable" }),
            )
          }
        >
          {memory?.enabled ? "Disable processing" : "Enable processing"}
        </button>
        <button
          type="button"
          disabled={!memory || isMemoryLoading}
          onClick={() => runInBackground(changeMemory({ action: "retry" }))}
        >
          Retry processing
        </button>
        <button
          type="button"
          className="danger-button"
          disabled={!memory || isMemoryLoading}
          onClick={() => runInBackground(changeMemory({ action: "clear" }))}
        >
          Clear summary
        </button>
      </div>
      {memory && (
        <>
          <p>
            Active configuration: {memory.model || "Unselected"} · N=
            {memory.cap} · {memory.enabled ? "On" : "Off"}. Change model/N in
            native Settings; saved topology stays pending until explicit
            quit/reopen.
          </p>
          <p>
            Latest revision {memory.revision} · source frontier{" "}
            {memory.frontier} · pending {memory.pending} · {memory.items} items
            / {memory.characters} characters. As of{" "}
            {memory.publishedAt === null
              ? "never produced"
              : new Date(memory.publishedAt).toLocaleString()}
            .
          </p>
          <p>
            Summary attempts today: {memory.attemptsToday}; no daily count or
            spend ceiling. Conservative reservations today: $
            {memory.reservedUsdToday.toFixed(4)}. Observed-token estimate today:
            ${memory.estimatedUsdToday.toFixed(4)}. Outstanding unknown/legacy
            reservations (all days): ${memory.unknownReservedUsd.toFixed(4)}.
            These are not invoices or cache-savings claims. Disable processing
            to stop new summary work; title limits remain separate.
          </p>
          <p>
            Price basis: {memory.priceBasis}. Exact total chat request admission
            includes policy/tools, fresh context and output/safety reserves; N
            is a character bound, not a token guarantee. If the whole request
            cannot fit, the app reports capacity rather than clipping memory.
          </p>
          <section aria-label="Selected chat memory">
            <h3>Selected chat projection</h3>
            <p>
              {!memory.selectedChat
                ? "No chat selected."
                : pin
                  ? `Pinned revision ${pin.stamp.revision}; ${memory.usedByChat ? "used on the selected qualified route" : pin.tokens === null ? "awaiting exact token projection before use" : "not used by the current chat route"}. ${pin.omitted} whole items omitted; ${pin.tokens ?? "unmeasured"} measured memory tokens; total-request capacity is checked before each inference.`
                  : `No active cross-chat pin${memory.selectedChat.reason ? `: ${memory.selectedChat.reason}` : ""}. Local chat remains available.`}
            </p>
            {pin && <p className="memory-text">{pin.value.text}</p>}
            {pin && memory.revision > pin.stamp.revision && (
              <p>
                A newer summary is available. Ordinary publication does not
                alter this chat&apos;s stable prefix.
              </p>
            )}
            <button
              type="button"
              disabled={!memory.selectedChat || isMemoryLoading}
              onClick={() =>
                memory.selectedChat &&
                runInBackground(
                  changeMemory({
                    action: "refresh",
                    conversationId: memory.selectedChat.conversationId,
                    segmentRevision: memory.selectedChat.segmentRevision,
                  }),
                )
              }
            >
              Refresh selected chat memory
            </button>
          </section>
          <section aria-label="Saved summary items">
            <h3>Saved summary</h3>
            <p>{memory.authority}</p>
            <button
              type="button"
              disabled={isMemoryLoading}
              onClick={() => edit("new", "")}
            >
              Add manual preference
            </button>
            {(editingMemoryId === "new" ||
              memory.stored.items.some(
                (item) => item.id === editingMemoryId,
              )) && (
              <div>
                <label>
                  Manual memory text
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
                  Manual items pass the same privacy rules. Existing-item edits
                  retain source/expiry; new preferences are honestly standalone.
                  Uncertain source deletion invalidates them conservatively.
                </p>
                <button
                  type="button"
                  disabled={isMemoryLoading || !editingMemoryText.trim()}
                  onClick={() =>
                    runInBackground(
                      changeMemory({
                        action: "edit",
                        id: editingMemoryId === "new" ? null : editingMemoryId,
                        text: editingMemoryText,
                      }),
                    )
                  }
                >
                  Save manual edit
                </button>
                <button
                  type="button"
                  disabled={isMemoryLoading}
                  onClick={cancelMemoryEdit}
                >
                  Cancel edit
                </button>
              </div>
            )}
            {!memory.stored.items.length && (
              <p>
                No saved summary items. This does not mean transcripts, Profile,
                legacy records or backups were deleted.
              </p>
            )}
            {memory.stored.items.map((item) => (
              <article className="memory-row" key={item.id}>
                <div className="memory-row-main">
                  <p className="memory-text">{item.text}</p>
                  <p>
                    {item.category} · {item.stance} ·{" "}
                    {memory.manualIds.includes(item.id)
                      ? "manual override"
                      : "generated"}{" "}
                    · {item.sourceIds.length} sources
                  </p>
                  <p>
                    {item.expiresAt === null
                      ? "No automatic expiry"
                      : `Expires ${new Date(item.expiresAt).toLocaleString()}`}{" "}
                    · review {new Date(item.reviewAt).toLocaleDateString()}
                  </p>
                  {item.sourceIds.map((sourceId) => {
                    const source = memory.sources.find(
                      (value) => value.sourceId === sourceId,
                    );
                    return source?.conversationId ? (
                      <button
                        type="button"
                        className="secondary-button"
                        key={sourceId}
                        onClick={() => onOpenSource(source.conversationId!)}
                      >
                        Open source conversation
                      </button>
                    ) : (
                      <span key={sourceId}>
                        {source?.manual
                          ? "Standalone manual source"
                          : "Source unavailable; no reconstructed transcript"}
                      </span>
                    );
                  })}
                </div>
                <div className="button-row">
                  <button
                    type="button"
                    disabled={isMemoryLoading}
                    onClick={() => edit(item.id, item.text)}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    disabled={isMemoryLoading}
                    onClick={() =>
                      runInBackground(
                        changeMemory({ action: "forget", id: item.id }),
                      )
                    }
                  >
                    Forget item
                  </button>
                </div>
              </article>
            ))}
          </section>
          <details>
            <summary>
              Explicit historical transition — opt in, no startup backfill
            </summary>
            <p>{memory.historical.exclusions}</p>
            <p>
              Review individual minimized source records before selecting. At
              most 200 records / 100,000 Unicode scalars per manifest; batches
              of at most 20 share the existing foreground writer, daily spend
              and retry limits. No second summarizer or embeddings. Originals
              remain preserved. Pause/cancel cannot recall an already sent
              request or refund unknown cost.
            </p>
            {memory.historical.candidates.map((source) => (
              <label className="memory-row" key={source.id}>
                <input
                  type="checkbox"
                  checked={selectedSources.includes(source.id)}
                  disabled={isMemoryLoading}
                  onChange={(event) =>
                    setReviewed((values) =>
                      event.target.checked
                        ? [...values, source.id]
                        : values.filter((id) => id !== source.id),
                    )
                  }
                />
                <span>
                  <strong>Completed user source</strong>
                  <p>{source.text}</p>
                  {source.referent && (
                    <p>Selected antecedent only: {source.referent}</p>
                  )}
                </span>
              </label>
            ))}
            {!memory.historical.candidates.length && (
              <p>
                No eligible linked source is available. Preserved
                unproven/expired legacy records require manual review, not
                inferred provenance.
              </p>
            )}
            <button
              type="button"
              disabled={
                !memory.enabled ||
                isMemoryLoading ||
                !selectedSources.length ||
                memory.historical.manifests.some(
                  (manifest) =>
                    manifest.state === "active" || manifest.state === "paused",
                )
              }
              onClick={() =>
                runInBackground(
                  changeMemory({
                    action: "import-create",
                    sourceIds: selectedSources,
                  }),
                )
              }
            >
              Process reviewed selection ({selectedSources.length})
            </button>
            {memory.historical.manifests.map((manifest) => (
              <div key={manifest.id}>
                <p>
                  Import {manifest.state}: {manifest.position} /{" "}
                  {manifest.total} records dispositioned. Reload for progress;
                  no repeated approvals per batch.
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
                      runInBackground(
                        changeMemory({
                          action: "import-resume",
                          id: manifest.id,
                        }),
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
                    Source/control authority changed. This old manifest cannot
                    resume; cancel and review a new eligible selection.
                  </p>
                )}
              </div>
            ))}
          </details>
          <details>
            <summary>
              Preserved legacy records — inactive, local review only (
              {memory.legacy.length} loaded, maximum 200)
            </summary>
            <p>
              These facts/vectors are not retrieved or updated by ordinary chat.
              Inspection performs no embedding call or lazy migration.
              Provenance-less records require manual review, not automatic
              synthesis/export. Originals and migration markers remain
              preserved.
            </p>
            {memory.legacy.map((item) => (
              <article className="memory-row" key={item.id}>
                <div>
                  <p>{item.text}</p>
                  <small>
                    {item.kind} · {item.status}
                    {item.expiresAt !== null
                      ? ` · expiry ${new Date(item.expiresAt).toLocaleString()}`
                      : ""}
                  </small>
                  {item.conversationId && (
                    <button
                      type="button"
                      onClick={() => onOpenSource(item.conversationId!)}
                    >
                      Open legacy source conversation
                    </button>
                  )}
                </div>
              </article>
            ))}
          </details>
          <p>
            Clear/Forget affect summary derivatives, not transcripts, Profile,
            Garmin, saved plans or preserved legacy stores. Off is not Clear.
            Already exported content, provider logs and backups cannot be
            recalled.
          </p>
        </>
      )}
    </div>
  );
}
