import type { Dispatch, SetStateAction } from "react";
import { useMemo, useState } from "react";
import {
  memoryKindLabels,
  type MemoryHealth,
  type MemoryItem,
  type MemoryKindFilter,
  type MemoryPayload,
  type MemorySort,
  type Status,
} from "./contracts";
import { compareMemoryText, memoryTimestamp } from "./memory-presentation";
import { readJsonResponse } from "./transport";

export function useMemoryFeature({
  setStatus,
}: {
  setStatus: Dispatch<SetStateAction<Status>>;
}) {
  const [memoryItems, setMemoryItems] = useState<MemoryItem[]>([]);

  const [memoryHealth, setMemoryHealth] = useState<MemoryHealth | null>(null);

  const [editingMemoryId, setEditingMemoryId] = useState<string | null>(null);

  const [editingMemoryText, setEditingMemoryText] = useState("");

  const [memoryMessage, setMemoryMessage] = useState(
    "Semantic memory readiness will load from local settings.",
  );

  const [isMemoryLoading, setIsMemoryLoading] = useState(false);

  const [memorySearchQuery, setMemorySearchQuery] = useState("");

  const [memoryKindFilter, setMemoryKindFilter] =
    useState<MemoryKindFilter>("all");

  const [memorySort, setMemorySort] = useState<MemorySort>("newest");

  const filteredMemories = useMemo(() => {
    const query = memorySearchQuery.trim().toLocaleLowerCase();
    return [...memoryItems]
      .filter((item) => {
        if (memoryKindFilter !== "all" && item.kind !== memoryKindFilter)
          return false;
        if (!query) return true;
        const searchable = [
          item.text,
          memoryKindLabels[item.kind],
          item.kind,
          item.conversationId ?? "cross-conversation",
          item.updatedAt ?? "",
          item.createdAt ?? "",
        ]
          .join(" ")
          .toLocaleLowerCase();
        return searchable.includes(query);
      })
      .sort((first, second) => {
        if (memorySort === "newest") {
          return (
            memoryTimestamp(second) - memoryTimestamp(first) ||
            compareMemoryText(first, second) ||
            first.id.localeCompare(second.id)
          );
        }
        if (memorySort === "oldest") {
          return (
            memoryTimestamp(first) - memoryTimestamp(second) ||
            compareMemoryText(first, second) ||
            first.id.localeCompare(second.id)
          );
        }
        if (memorySort === "kind") {
          return (
            memoryKindLabels[first.kind].localeCompare(
              memoryKindLabels[second.kind],
            ) ||
            compareMemoryText(first, second) ||
            first.id.localeCompare(second.id)
          );
        }
        return (
          compareMemoryText(first, second) || first.id.localeCompare(second.id)
        );
      });
  }, [memoryItems, memoryKindFilter, memorySearchQuery, memorySort]);

  const hasMemoryFilters =
    memorySearchQuery.trim().length > 0 || memoryKindFilter !== "all";

  async function loadMemories(showStatus = true) {
    if (showStatus)
      setStatus({
        kind: "busy",
        message: "Memory: loading local learned memories…",
      });
    setIsMemoryLoading(true);
    try {
      const payload = await readJsonResponse<MemoryPayload>(
        await fetch("/api/memory", { method: "GET" }),
      );
      const memories = payload.memories ?? [];
      setMemoryItems(memories);
      setMemoryHealth(payload.health);
      const providerDetail = payload.health.embeddingProvider
        ? ` Provider: ${payload.health.embeddingProvider}${payload.health.embeddingModel ? `/${payload.health.embeddingModel}` : ""}.`
        : "";
      setMemoryMessage(
        `Memory: ${payload.health.status}; ${memories.length} inspectable semantic memories. ${payload.health.detail}${providerDetail}`,
      );
      if (showStatus)
        setStatus({
          kind:
            payload.health.ready || !payload.health.enabled ? "ok" : "error",
          message:
            "Memory: loaded semantic memory readiness and local memory list.",
        });
    } catch (error) {
      const message = `Memory load failed: ${error instanceof Error ? error.message : "unknown error"}`;
      setMemoryMessage(message);
      if (showStatus) setStatus({ kind: "error", message });
    } finally {
      setIsMemoryLoading(false);
    }
  }

  async function setMemoryEnabled(enabled: boolean) {
    setIsMemoryLoading(true);
    setStatus({
      kind: "busy",
      message: `Memory: ${enabled ? "enabling" : "disabling"}…`,
    });
    try {
      const payload = await readJsonResponse<MemoryPayload>(
        await fetch("/api/memory", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "set-enabled", enabled }),
        }),
      );
      setMemoryItems(payload.memories ?? []);
      setMemoryHealth(payload.health);
      setMemoryMessage(
        `Memory: ${payload.health.status}. ${payload.health.detail}`,
      );
      setStatus({
        kind: "ok",
        message: `Memory: ${enabled ? "enabled" : "disabled"}.`,
      });
    } catch (error) {
      const message = `Memory toggle failed: ${error instanceof Error ? error.message : "unknown error"}`;
      setMemoryMessage(message);
      setStatus({ kind: "error", message });
    } finally {
      setIsMemoryLoading(false);
    }
  }

  async function actOnMemory(
    action: "update" | "delete" | "clear",
    id?: string,
    text?: string,
  ) {
    if (
      action === "delete" &&
      !window.confirm("Delete this memory before the next answer?")
    )
      return;
    if (
      action === "clear" &&
      !window.confirm(
        "Clear all semantic memories? Profile, chat, and Garmin data are preserved.",
      )
    )
      return;
    setIsMemoryLoading(true);
    setStatus({ kind: "busy", message: `Memory: ${action}…` });
    try {
      const payload = await readJsonResponse<MemoryPayload>(
        await fetch("/api/memory", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id, action, text }),
        }),
      );
      setMemoryItems(payload.memories ?? []);
      setMemoryHealth(payload.health);
      setEditingMemoryId(null);
      setEditingMemoryText("");
      setMemoryMessage(
        `Memory: ${action} complete. Changes affect the next answer.`,
      );
      setStatus({ kind: "ok", message: `Memory: ${action} complete.` });
    } catch (error) {
      const message = `Memory ${action} failed: ${error instanceof Error ? error.message : "unknown error"}`;
      setMemoryMessage(message);
      setStatus({ kind: "error", message });
    } finally {
      setIsMemoryLoading(false);
    }
  }
  return {
    loadMemories,
    setEditingMemoryId,
    setEditingMemoryText,
    memoryHealth,
    memoryItems,
    filteredMemories,
    memoryMessage,
    setMemoryEnabled,
    isMemoryLoading,
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
  };
}
