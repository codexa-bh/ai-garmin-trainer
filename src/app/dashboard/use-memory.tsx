import type { Dispatch, SetStateAction } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Status } from "./contracts";
import type {
  SummaryStatus,
  SummaryValue,
  SummaryVersion,
} from "@/lib/memory/summary-policy";
import type {
  SummaryCommand,
  SummaryRebuildInspection,
} from "@/lib/memory/summary-controls";
import type { SummaryPin } from "@/lib/chat/summary-pin";
import { readJsonResponse } from "./transport";

export type SummaryInspection = Omit<SummaryStatus, "usedByChat"> & {
  usedByChat: boolean;
  expected: SummaryVersion;
  stored: SummaryValue;
  manualIds: string[];
  sources: {
    sourceId: string;
    conversationId: string | null;
    messageId: string | null;
    manual: boolean;
  }[];
  legacy: {
    id: string;
    kind: string;
    text: string;
    status: string;
    conversationId: string | null;
    expiresAt: number | null;
  }[];
  historical: {
    candidates: {
      id: string;
      conversationId: string;
      text: string;
      referent: string | null;
    }[];
    manifests: { id: string; state: string; position: number; total: number }[];
    exclusions: string;
  };
  rebuild?: SummaryRebuildInspection;
  selectedChat: {
    conversationId: string;
    segmentRevision: number;
    pin: SummaryPin | null;
    reason: string | null;
  } | null;
  authority: string;
};
type Action = SummaryCommand extends infer C
  ? C extends SummaryCommand
    ? Omit<C, "version" | "expected">
    : never
  : never;

export function useMemoryFeature({
  setStatus,
  onChangeCommitted,
}: {
  setStatus: Dispatch<SetStateAction<Status>>;
  onChangeCommitted?: (conversationId: string | null) => Promise<void>;
}) {
  const [memory, setMemory] = useState<SummaryInspection | null>(null);
  const [memoryMessage, setMemoryMessage] = useState(
    "Memory has not been inspected.",
  );
  const [isMemoryLoading, setIsMemoryLoading] = useState(false);
  const [editingMemoryId, setEditingMemoryId] = useState<string | null>(null);
  const [editingMemoryText, setEditingMemoryText] = useState("");
  const selected = useRef<string | null>(null);
  const sequence = useRef(0);
  const changing = useRef(false);
  useEffect(
    () => () => {
      sequence.current++;
    },
    [],
  );

  const loadMemories = useCallback(
    async (showStatus = true, conversationId?: string | null) => {
      if (conversationId !== undefined && selected.current !== conversationId) {
        selected.current = conversationId;
        setMemory(null);
        setEditingMemoryId(null);
        setEditingMemoryText("");
      }
      // Global memory changes revoke every selected-chat projection. A read made
      // before commit must not repopulate the hidden snapshot, even after failure.
      if (changing.current) return;
      const request = ++sequence.current;
      setIsMemoryLoading(true);
      try {
        const query = new URLSearchParams({ view: "content" });
        if (selected.current) query.set("conversationId", selected.current);
        const result = await readJsonResponse<SummaryInspection>(
          await fetch(`/api/cross-chat-summary?${query}`, {
            cache: "no-store",
          }),
        );
        if (
          result.version !== 1 ||
          !result.expected ||
          !result.stored ||
          result.stored.version !== 1 ||
          !Array.isArray(result.stored.items) ||
          !Array.isArray(result.sources) ||
          !Array.isArray(result.manualIds) ||
          ![
            result.reservedUsdToday,
            result.estimatedUsdToday,
            result.unknownReservedUsd,
          ].every(
            (value) =>
              typeof value === "number" && Number.isFinite(value) && value >= 0,
          ) ||
          typeof result.priceBasis !== "string" ||
          !result.priceBasis ||
          !Array.isArray(result.legacy) ||
          !Array.isArray(result.historical?.candidates) ||
          !Array.isArray(result.historical?.manifests) ||
          (result.rebuild !== undefined &&
            (result.rebuild.version !== 1 ||
              typeof result.rebuild.ready !== "boolean" ||
              !/^[a-f0-9]{64}$/.test(result.rebuild.snapshot) ||
              !result.rebuild.counts ||
              !Object.values(result.rebuild.counts).every(
                (n) => Number.isSafeInteger(n) && n >= 0,
              ) ||
              !Number.isFinite(
                result.rebuild.estimatedUsd?.conservativeMaximum,
              )))
        )
          throw new Error("Unsupported memory inspection");
        if (request !== sequence.current) return;
        setMemory(result);
        setMemoryMessage(
          `Summary ${result.state}${result.reason ? `: ${result.reason}` : ""}. Reads do not call a model or embeddings.`,
        );
        if (showStatus)
          setStatus({ kind: "ok", message: "Memory inspected locally." });
      } catch {
        if (request !== sequence.current) return;
        setMemory(null);
        setMemoryMessage(
          "Memory inspection unavailable. Preserve data and use a compatible build; no reset or success claimed.",
        );
        if (showStatus)
          setStatus({
            kind: "error",
            message: "Memory inspection unavailable.",
          });
      } finally {
        if (request === sequence.current) setIsMemoryLoading(changing.current);
      }
    },
    [setStatus],
  );
  useEffect(() => {
    if (memory?.rebuild?.operation?.state !== "active") return;
    // Status reconciliation only. Never replay Start or unknown mutations.
    const timer = setInterval(() => {
      loadMemories(false).catch(() => {
        setMemory(null);
        setMemoryMessage(
          "Rebuild status unavailable. Reload to reconcile; no action was replayed.",
        );
      });
    }, 2000);
    return () => clearInterval(timer);
  }, [memory?.rebuild?.operation?.state, loadMemories]);
  async function changeMemory(action: Action) {
    if (!memory || changing.current) return;
    if (
      action.action === "clear" &&
      !window.confirm(
        "Clear summary, manual items and chat pins? Transcripts, Profile, Garmin, plans and preserved legacy records remain. Future new turns may create memory; backups/provider logs are not erased.",
      )
    )
      return;
    if (
      action.action === "forget" &&
      !window.confirm(
        "Forget this item and suppress its exact source versions? Original transcripts and other stores remain.",
      )
    )
      return;
    if (
      (action.action === "import-create" ||
        action.action === "import-resume") &&
      !window.confirm(
        "Process only the explicitly reviewed historical selection with the configured cloud summary model? Minimized text may leave this device and incur cost. No original is deleted; uncertain previous billing remains reserved. Finite foreground jobs apply, but there is no daily summary spend/count ceiling; no embeddings or transcript-wide sweep.",
      )
    )
      return;
    if (
      action.action === "rebuild-start" &&
      !window.confirm(
        "Rebuild generated memory from the reviewed original-message inventory with the configured cloud model? Minimized originals and screened assistant context may leave this device and incur the displayed cost. Old memory stays active until one complete validated replacement. Manual overlays, suppressed sources and originals remain; existing chat pins do not refresh. Unknown prior costs remain reserved. Keep the app open; cancellation or interruption does not replay unknown effects.",
      )
    )
      return;
    const selectedAtStart = selected.current;
    sequence.current++;
    changing.current = true;
    setMemory(null);
    setMemoryMessage(
      "Applying memory change; prior projection hidden until reinspection.",
    );
    setIsMemoryLoading(true);
    try {
      await readJsonResponse(
        await fetch("/api/cross-chat-summary", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            version: 1,
            expected: memory.expected,
            ...action,
          }),
        }),
      );
      setEditingMemoryId(null);
      setEditingMemoryText("");
      // Clear/Forget also affect a chat selected while this mutation was pending.
      await onChangeCommitted?.(selected.current);
      changing.current = false;
      await loadMemories(false);
      setMemoryMessage(
        "Memory change committed. Refresh gives pending work up to 8 seconds, then freezes only the available snapshot (or none). Inspect pending/as-of and selected-chat use; late work requires another explicit Refresh. Native settings still require an explicit restart.",
      );
    } catch {
      if (selected.current !== selectedAtStart) return;
      setMemoryMessage(
        "Memory change failed or outcome unknown. Reload and review before another action; nothing was automatically retried.",
      );
      // Do not permit another mutation against an uncertain saved snapshot.
      setMemory(null);
    } finally {
      changing.current = false;
      setIsMemoryLoading(false);
    }
  }
  function cancelMemoryEdit() {
    setEditingMemoryId(null);
    setEditingMemoryText("");
  }
  return {
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
  };
}
