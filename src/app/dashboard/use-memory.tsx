import type { Dispatch, SetStateAction } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Status } from "./contracts";
import type {
  SummaryStatus,
  SummaryValue,
  SummaryVersion,
  ManualPreference,
} from "@/lib/memory/summary-policy";
import type {
  SummaryCommand,
  SummaryRebuildInspection,
  SummaryRebuildSelection,
} from "@/lib/memory/summary-controls";
import { parseRebuildSelection } from "@/lib/memory/summary-controls";
import type { SummaryPin } from "@/lib/chat/summary-pin";
import { readJsonResponse } from "./transport";

export type SummaryInspection = Omit<SummaryStatus, "usedByChat"> & {
  usedByChat: boolean;
  expected: SummaryVersion;
  stored: SummaryValue;
  preferences: ManualPreference[];
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

function validRebuildInspection(
  r: SummaryRebuildInspection | undefined,
): boolean {
  return (
    !!r &&
    r.version === 1 &&
    typeof r.ready === "boolean" &&
    /^[a-f0-9]{64}$/.test(r.snapshot) &&
    !!parseRebuildSelection(r.selection) &&
    Array.isArray(r.conversations) &&
    r.conversations.every(
      (chat) => typeof chat.id === "string" && typeof chat.title === "string",
    ) &&
    !!r.counts &&
    Object.values(r.counts).every((n) => Number.isSafeInteger(n) && n >= 0) &&
    Number.isFinite(r.estimatedUsd?.low) &&
    r.estimatedUsd.low >= 0 &&
    (r.estimatedUsd.conservativeMaximum === null ||
      (Number.isFinite(r.estimatedUsd.conservativeMaximum) &&
        r.estimatedUsd.conservativeMaximum >= r.estimatedUsd.low)) &&
    typeof r.capability === "string" &&
    !!r.reasons &&
    Object.values(r.reasons).every((n) => Number.isSafeInteger(n) && n >= 0)
  );
}

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
  const [isMemoryReadUnavailable, setIsMemoryReadUnavailable] = useState(false);
  const reading = useRef<number | null>(null);
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
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    const generation = sequence;
    return () => {
      mounted.current = false;
      generation.current++;
    };
  }, []);

  const loadMemories = useCallback(
    async (showStatus = true, conversationId?: string | null) => {
      if (!mounted.current) return;
      if (conversationId !== undefined && selected.current !== conversationId) {
        selected.current = conversationId;
        sequence.current++;
        // Resolving/selecting a conversation is a passive metadata read, not a
        // revocation of global memory or its editor. Discard only the old chat
        // projection and confirmation identity; privacy mutations still clear all.
        if (currentInspection.current) {
          const global = { ...currentInspection.current, selectedChat: null };
          currentInspection.current = global;
          setMemory(global);
        }
      }
      // Global memory changes revoke every selected-chat projection. A read made
      // before commit must not repopulate the hidden snapshot, even after failure.
      if (changing.current) return;
      if (reading.current === sequence.current) return;
      const request = ++sequence.current;
      reading.current = request;
      // Passive observation never blanks, disables or inserts a loading row.
      setIsMemoryLoading(currentInspection.current === null);
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
          result.stored.version !== 2 ||
          typeof result.stored.text !== "string" ||
          !Array.isArray(result.preferences) ||
          result.preferences.some(
            (preference) =>
              typeof preference.id !== "string" ||
              typeof preference.text !== "string",
          ) ||
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
            !validRebuildInspection(result.rebuild))
        )
          throw new Error("Unsupported memory inspection");
        if (request !== sequence.current) return;
        const same =
          JSON.stringify(currentInspection.current) === JSON.stringify(result);
        if (!same) {
          currentInspection.current = result;
          setMemory(result);
        }
        setIsMemoryReadUnavailable(false);
        setMemoryMessage("");
        if (showStatus)
          setStatus({ kind: "ok", message: "Memory inspected locally." });
      } catch {
        if (request !== sequence.current) return;
        // Keep the last observed content/operation visibly marked as stale.
        // All mutations are refused until a successful read restores authority.
        setIsMemoryReadUnavailable(true);
        setMemoryMessage(
          "Connection lost. Shown memory and progress are last known, not current. Reconnecting automatically; no update is repeated.",
        );
        if (showStatus)
          setStatus({
            kind: "error",
            message: "Memory inspection unavailable.",
          });
      } finally {
        if (reading.current === request) reading.current = null;
        if (request === sequence.current) setIsMemoryLoading(changing.current);
      }
    },
    [setStatus],
  );
  useEffect(() => {
    if (
      memory?.rebuild?.operation?.state !== "active" &&
      !isMemoryReadUnavailable &&
      !memory?.historical.manifests.some((m) => m.state === "active")
    )
      return;
    // Status reconciliation only. Never replay Start or unknown mutations.
    const timer = setInterval(() => {
      loadMemories(false).catch(() => setIsMemoryReadUnavailable(true));
    }, 2000);
    return () => clearInterval(timer);
  }, [
    memory?.rebuild?.operation?.state,
    memory?.historical.manifests,
    isMemoryReadUnavailable,
    loadMemories,
  ]);
  async function reviewHistory(selection: SummaryRebuildSelection) {
    if (!memory || changing.current || isMemoryReadUnavailable) return;
    const request = ++sequence.current;
    changing.current = true;
    const before = memory;
    setIsMemoryLoading(true);
    try {
      const result = await readJsonResponse<{
        rebuild: SummaryRebuildInspection;
      }>(
        await fetch("/api/cross-chat-summary", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            version: 2,
            expected: before.expected,
            action: "rebuild-review",
            selection,
          }),
        }),
      );
      if (request !== sequence.current) return;
      if (!validRebuildInspection(result.rebuild))
        throw new Error("Unsupported review");
      const reviewed = { ...before, rebuild: result.rebuild };
      currentInspection.current = reviewed;
      setMemory(reviewed);
      setMemoryMessage("");
    } catch {
      if (request !== sequence.current) return;
      currentInspection.current = null;
      setMemory(null);
      setMemoryMessage(
        "History review unavailable. Check saved memory and review again; nothing was started.",
      );
    } finally {
      changing.current = false;
      if (mounted.current) {
        setIsMemoryLoading(false);
        if (request !== sequence.current) await loadMemories(false);
      }
    }
  }
  async function changeMemory(
    action: MemoryAction,
    reviewed?: SummaryInspection,
  ) {
    if (!memory || changing.current || isMemoryReadUnavailable) return;
    if (action.action === "rebuild-review")
      return reviewHistory(action.selection);
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
        "Remove this separately authored preference? Conversations and generated summary remain. This does not surgically erase meaning from history.",
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
        "Rebuild generated memory from the reviewed original-message inventory with the configured cloud model? Minimized originals and screened assistant context may leave this device and incur the displayed cost. Old generated text stays active until one complete validated replacement, including direct summary edits. Separate preferences, suppressed sources and originals remain; next chat turns use available valid memory. Unknown prior costs remain reserved. Keep the app open; cancellation or interruption does not replay unknown effects.",
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
            version: 2,
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
        "edit-summary":
          "Complete generated summary saved. A future regeneration replaces it; separate preferences are unchanged.",
        edit:
          action.action === "edit" && action.id === null
            ? "Preference added."
            : "Preference edited.",
        forget:
          "Preference removed. Conversations and generated summary remain.",
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
        "rebuild-review": "History reviewed locally; nothing started.",
        "rebuild-start":
          "History update started. Keep the app open. Saved memory changes only after the update finishes.",
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
      setIsMemoryReadUnavailable(true);
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
    isMemoryReadUnavailable,
    pendingMemoryAction,
    beginMemoryEdit,
    canDiscardMemoryEdit,
    loadMemories,
    changeMemory,
    reviewHistory,
    editingMemoryId,
    editingMemoryText,
    setEditingMemoryId,
    setEditingMemoryText,
    cancelMemoryEdit,
  };
}
