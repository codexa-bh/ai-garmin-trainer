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
export type MemoryAction = SummaryCommand extends infer C
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
  const [pendingMemoryAction, setPendingMemoryAction] = useState<
    MemoryAction["action"] | null
  >(null);
  const currentInspection = useRef<SummaryInspection | null>(null);
  const editorOriginal = useRef("");
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
        currentInspection.current = null;
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
          ![
            "disabled",
            "unselected",
            "unavailable",
            "never-produced",
            "fresh",
            "stale",
          ].includes(result.state) ||
          typeof result.enabled !== "boolean" ||
          (result.reason !== null && typeof result.reason !== "string") ||
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
              !Number.isFinite(result.rebuild.estimatedUsd?.low) ||
              result.rebuild.estimatedUsd.low < 0 ||
              (result.rebuild.estimatedUsd.conservativeMaximum !== null &&
                (!Number.isFinite(
                  result.rebuild.estimatedUsd.conservativeMaximum,
                ) ||
                  result.rebuild.estimatedUsd.conservativeMaximum <
                    result.rebuild.estimatedUsd.low)) ||
              typeof result.rebuild.capability !== "string" ||
              !result.rebuild.reasons ||
              !Object.values(result.rebuild.reasons).every(
                (n) => Number.isSafeInteger(n) && n >= 0,
              )))
        )
          throw new Error("Unsupported memory inspection");
        if (request !== sequence.current) return;
        currentInspection.current = result;
        setMemory(result);
        setMemoryMessage("");
        if (showStatus)
          setStatus({ kind: "ok", message: "Memory inspected locally." });
      } catch {
        if (request !== sequence.current) return;
        currentInspection.current = null;
        setMemory(null);
        setMemoryMessage(
          "Memory inspection unavailable. Check again to reconcile saved state; your data has not been reset.",
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
  async function changeMemory(
    action: MemoryAction,
    reviewed?: SummaryInspection,
  ) {
    if (!memory || changing.current) return;
    if (
      reviewed &&
      (reviewed !== currentInspection.current || reviewed !== memory)
    ) {
      setMemoryMessage(
        "Memory changed. Review the current information before confirming again.",
      );
      return;
    }
    if (
      action.action === "refresh" &&
      (action.conversationId !== selected.current ||
        action.segmentRevision !== memory.selectedChat?.segmentRevision)
    )
      return;
    if (
      !reviewed &&
      action.action === "clear" &&
      !window.confirm(
        "Clear summary, manual items and chat pins? Transcripts, Profile, Garmin, plans and preserved legacy records remain. Future new turns may create memory; backups/provider logs are not erased.",
      )
    )
      return;
    if (
      !reviewed &&
      action.action === "forget" &&
      !window.confirm(
        "Forget this item and suppress its exact source versions? Original transcripts and other stores remain.",
      )
    )
      return;
    if (
      !reviewed &&
      (action.action === "import-create" ||
        action.action === "import-resume") &&
      !window.confirm(
        "Process only the explicitly reviewed historical selection with the configured cloud summary model? Minimized text may leave this device and incur cost. No original is deleted; uncertain previous billing remains reserved. Finite foreground jobs apply, but there is no daily summary spend/count ceiling; no embeddings or transcript-wide sweep.",
      )
    )
      return;
    if (
      !reviewed &&
      action.action === "rebuild-start" &&
      !window.confirm(
        "Rebuild generated memory from the reviewed original-message inventory with the configured cloud model? Minimized originals and screened assistant context may leave this device and incur the displayed cost. Old memory stays active until one complete validated replacement. Manual overlays, suppressed sources and originals remain; existing chat pins do not refresh. Unknown prior costs remain reserved. Keep the app open; cancellation or interruption does not replay unknown effects.",
      )
    )
      return;
    sequence.current++;
    changing.current = true;
    currentInspection.current = null;
    setPendingMemoryAction(action.action);
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
      const feedback: Record<MemoryAction["action"], string> = {
        edit:
          action.action === "edit" && action.id === null
            ? "Memory added."
            : "Memory edited.",
        forget: "Item forgotten. Original transcripts remain.",
        clear:
          "Saved memory and chat snapshots cleared. Original transcripts remain; future new turns may create memory.",
        disable:
          "Memory is Off. Saved items stay; automatic titles are separate.",
        enable:
          "Memory is On. Earlier Off history was not automatically imported.",
        retry:
          "Summary scheduling retry requested. Previous unknown costs remain reserved.",
        refresh:
          "This chat update checked. Only the available memory was saved; review this chat and any pending updates below.",
        "rebuild-start":
          "History update started. Keep the app open; this chat is not automatically updated.",
        "rebuild-cancel":
          "Cancellation checked. Review the actual update status; sent requests and costs cannot be recalled.",
        "import-create": "Reviewed source import created.",
        "import-pause":
          "Import pause checked; sent requests cannot be recalled.",
        "import-resume": "Reviewed import resumed.",
        "import-cancel": "Import cancellation checked; prior costs remain.",
      };
      setMemoryMessage(
        currentInspection.current
          ? feedback[action.action]
          : "Change committed, but saved state could not be inspected. Check again before another action.",
      );
    } catch {
      currentInspection.current = null;
      setMemoryMessage(
        "Memory change failed or outcome unknown. Reload and review before another action; nothing was automatically retried.",
      );
      // Do not permit another mutation against an uncertain saved snapshot.
      setMemory(null);
    } finally {
      changing.current = false;
      setIsMemoryLoading(false);
      setPendingMemoryAction(null);
    }
  }
  function beginMemoryEdit(id: string, text: string) {
    editorOriginal.current = text;
    setEditingMemoryId(id);
    setEditingMemoryText(text);
  }
  function canDiscardMemoryEdit() {
    return (
      !editingMemoryId ||
      editingMemoryText === editorOriginal.current ||
      window.confirm("Discard unsaved memory changes? Cancel keeps editing.")
    );
  }
  function cancelMemoryEdit() {
    setEditingMemoryId(null);
    setEditingMemoryText("");
  }
  return {
    memory,
    memoryMessage,
    isMemoryLoading,
    pendingMemoryAction,
    beginMemoryEdit,
    canDiscardMemoryEdit,
    loadMemories,
    changeMemory,
    editingMemoryId,
    editingMemoryText,
    setEditingMemoryId,
    setEditingMemoryText,
    cancelMemoryEdit,
  };
}
