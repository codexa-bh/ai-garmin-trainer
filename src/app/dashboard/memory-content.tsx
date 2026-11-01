import type { Dispatch, SetStateAction } from "react";
import {
  memoryKindLabels,
  memoryKindOptions,
  memorySortOptions,
  type MemoryHealth,
  type MemoryItem,
  type MemoryKindFilter,
  type MemorySort,
} from "./contracts";
import { memoryScopeLabel, memoryUpdatedLabel } from "./memory-presentation";

export function MemoryContent({
  memoryHealth,
  memoryItems,
  filteredMemories,
  memoryMessage,
  runInBackground,
  setMemoryEnabled,
  isMemoryLoading,
  loadMemories,
  actOnMemory,
  memorySearchQuery,
  setMemorySearchQuery,
  memoryKindFilter,
  setMemoryKindFilter,
  memorySort,
  setMemorySort,
  hasMemoryFilters,
  editingMemoryId,
  editingMemoryText,
  setEditingMemoryText,
  setEditingMemoryId,
}: {
  memoryHealth: MemoryHealth | null;
  memoryItems: MemoryItem[];
  filteredMemories: MemoryItem[];
  memoryMessage: string;
  runInBackground: (work: Promise<unknown>) => void;
  setMemoryEnabled: (enabled: boolean) => Promise<void>;
  isMemoryLoading: boolean;
  loadMemories: (showStatus?: boolean) => Promise<void>;
  actOnMemory: (
    action: "update" | "delete" | "clear",
    id?: string,
    text?: string,
  ) => Promise<void>;
  memorySearchQuery: string;
  setMemorySearchQuery: Dispatch<SetStateAction<string>>;
  memoryKindFilter: MemoryKindFilter;
  setMemoryKindFilter: Dispatch<SetStateAction<MemoryKindFilter>>;
  memorySort: MemorySort;
  setMemorySort: Dispatch<SetStateAction<MemorySort>>;
  hasMemoryFilters: boolean;
  editingMemoryId: string | null;
  editingMemoryText: string;
  setEditingMemoryText: Dispatch<SetStateAction<string>>;
  setEditingMemoryId: Dispatch<SetStateAction<string | null>>;
}) {
  return (
    <details className="settings-card memory-root-card" open>
      <summary>
        Learned memory{" "}
        <span className="pill" aria-live="polite">
          {memoryHealth?.status ?? "loading"} · {memoryItems.length} loaded ·{" "}
          {filteredMemories.length} shown
        </span>
      </summary>
      <p>
        Embedded SQLite memory stores concise user-derived cross-session facts,
        preferences, corrections, and temporary plans after complete persisted
        answers; it is not a transcript archive. Current chats carry bounded
        same-chat continuity. Local Ollama embeddings do not make extraction
        local: selecting useful facts may use configured DeepSeek/OpenAI cloud
        AI. A configured OpenAI key is not proof of remote readiness;
        deterministic embeddings are local test vectors, not semantic-provider
        readiness. This immediate Memory preference is separate from native
        Settings saved for next launch. Off is not deletion and does not stop
        independent chat or title processing.
      </p>
      <p className="helper-text" role="status" aria-live="polite">
        {memoryMessage}
      </p>
      <div className="button-row memory-actions">
        <button
          type="button"
          onClick={() =>
            runInBackground(setMemoryEnabled(!(memoryHealth?.enabled ?? false)))
          }
          disabled={isMemoryLoading}
        >
          {memoryHealth?.enabled ? "Disable memory" : "Enable memory"}
        </button>
        <button
          type="button"
          className="secondary-button"
          onClick={() => runInBackground(loadMemories())}
          disabled={isMemoryLoading}
        >
          Reload memories
        </button>
        <button
          type="button"
          className="danger-button"
          onClick={() => runInBackground(actOnMemory("clear"))}
          disabled={isMemoryLoading || !memoryItems.length}
        >
          Clear all memory
        </button>
      </div>
      <div
        className="memory-browser"
        aria-label="Search and sort semantic memories"
      >
        <div className="memory-browser-header">
          <div>
            <h3>Inspectable semantic memories</h3>
            <p className="helper-text compact-helper">
              Browsing applies only to the {memoryItems.length} loaded local
              management records.
            </p>
          </div>
          <span className="pill" aria-live="polite">
            {filteredMemories.length} of {memoryItems.length} shown
          </span>
        </div>
        <div className="memory-controls">
          <label>
            Search memory text
            <input
              type="search"
              value={memorySearchQuery}
              placeholder="Search text, kind, conversation…"
              onChange={(event) => setMemorySearchQuery(event.target.value)}
              disabled={isMemoryLoading || !memoryItems.length}
            />
          </label>
          <label>
            Kind
            <select
              value={memoryKindFilter}
              onChange={(event) =>
                setMemoryKindFilter(event.target.value as MemoryKindFilter)
              }
              disabled={isMemoryLoading || !memoryItems.length}
            >
              {memoryKindOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Sort
            <select
              value={memorySort}
              onChange={(event) =>
                setMemorySort(event.target.value as MemorySort)
              }
              disabled={isMemoryLoading || !memoryItems.length}
            >
              {memorySortOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="secondary-button"
            onClick={() => {
              setMemorySearchQuery("");
              setMemoryKindFilter("all");
            }}
            disabled={isMemoryLoading || !hasMemoryFilters}
          >
            Clear filters
          </button>
        </div>
        <div
          className="memory-list"
          aria-label="Inspectable semantic memories"
          aria-busy={isMemoryLoading}
        >
          {filteredMemories.length ? (
            filteredMemories.map((item) => (
              <div className="memory-row" key={item.id}>
                <div className="memory-row-main">
                  {editingMemoryId === item.id ? (
                    <label>
                      Edit memory
                      <textarea
                        aria-label="Edit memory"
                        value={editingMemoryText}
                        onChange={(event) =>
                          setEditingMemoryText(event.target.value)
                        }
                        disabled={isMemoryLoading}
                      />
                    </label>
                  ) : (
                    <p className="memory-text">{item.text}</p>
                  )}
                  <small className="memory-meta">
                    <span>{memoryKindLabels[item.kind]}</span>
                    <span>{memoryScopeLabel(item)}</span>
                    <span>{memoryUpdatedLabel(item)}</span>
                  </small>
                </div>
                <div className="button-row memory-row-actions">
                  {editingMemoryId === item.id ? (
                    <>
                      <button
                        type="button"
                        onClick={() =>
                          runInBackground(
                            actOnMemory("update", item.id, editingMemoryText),
                          )
                        }
                        disabled={isMemoryLoading}
                      >
                        Save edit
                      </button>
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => {
                          setEditingMemoryId(null);
                          setEditingMemoryText("");
                        }}
                        disabled={isMemoryLoading}
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => {
                        setEditingMemoryId(item.id);
                        setEditingMemoryText(item.text);
                      }}
                      disabled={isMemoryLoading}
                    >
                      Edit
                    </button>
                  )}
                  <button
                    type="button"
                    className="danger-button"
                    onClick={() =>
                      runInBackground(actOnMemory("delete", item.id))
                    }
                    disabled={isMemoryLoading}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))
          ) : memoryItems.length ? (
            <p className="memory-empty-state">
              No memories match the current search or kind filter. Clear filters
              to return to the loaded list.
            </p>
          ) : (
            <p className="memory-empty-state">
              No inspectable semantic memories. If memory is enabled and ready,
              explicit preferences, goals, corrections, or useful temporary
              plans can create concise memories after complete chats; ordinary
              transient turns may create none.
            </p>
          )}
        </div>
      </div>
    </details>
  );
}
