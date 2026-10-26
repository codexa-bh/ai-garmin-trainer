import {
  validProgressCounters,
  type TrainerProgress,
} from "@/lib/ai/trainer-progress";
import type { Dispatch, SetStateAction } from "react";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import {
  type ChatMessage,
  type ChatPayload,
  type ChatStreamEvent,
  type ConversationCreatePayload,
  type ConversationDeletePayload,
  type ConversationListPayload,
  type ConversationRenamePayload,
  type ConversationSummary,
  type Status,
} from "./contracts";
import { readJsonResponse, readResponse } from "./transport";
import { useActiveConversation } from "../use-active-conversation";

export function useChatFeature({
  setStatus,
  setIsConversationDrawerOpen,
  conversationButtonRef,
  rememberTranscriptFollowIntent,
  forceNextScrollRef,
  transcriptRef,
  closeConversationMenu,
  runInBackground,
  loadMemories,
  loadTrainingPlan,
  loadWeekly,
  messageInputRef,
}: {
  setStatus: Dispatch<SetStateAction<Status>>;
  setIsConversationDrawerOpen: Dispatch<SetStateAction<boolean>>;
  conversationButtonRef: RefObject<HTMLButtonElement | null>;
  rememberTranscriptFollowIntent: () => void;
  forceNextScrollRef: RefObject<boolean>;
  transcriptRef: RefObject<HTMLDivElement | null>;
  closeConversationMenu: () => void;
  runInBackground: (work: Promise<unknown>) => void;
  loadMemories: (showStatus?: boolean) => Promise<void>;
  loadTrainingPlan: (
    trigger: "startup" | "manual" | "chat-save",
    showStatus?: boolean,
  ) => Promise<void>;
  loadWeekly?: () => Promise<void>;
  messageInputRef: RefObject<HTMLTextAreaElement | null>;
}) {
  const [message, setMessage] = useState("");

  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);

  const [conversationId, setConversationId] = useActiveConversation();

  const [conversations, setConversations] = useState<ConversationSummary[]>([]);

  const [historyCursor, setHistoryCursor] = useState<string | null>(null);

  const [isHistoryLoading, setIsHistoryLoading] = useState(false);

  const [renameTarget, setRenameTarget] = useState<Pick<
    ConversationSummary,
    "id" | "title"
  > | null>(null);

  const [renameTitle, setRenameTitle] = useState("");

  const [renameError, setRenameError] = useState("");

  const renameRevisionRef = useRef(0);
  const acknowledgedRenamesRef = useRef(
    new Map<string, { revision: number; title: string; updatedAt: string }>(),
  );

  const [isRenamingConversation, setIsRenamingConversation] = useState(false);

  const [isChatLoading, setIsChatLoading] = useState(false);

  const [chatPendingStatus, setChatPendingStatus] =
    useState<TrainerProgress | null>(null);

  const [lastFailedMessage, setLastFailedMessage] = useState("");

  const [llmDebugTracesEnabled, setLlmDebugTracesEnabled] = useState(false);

  const chatHistoryRequestRef = useRef(0);

  const chatAbortRef = useRef<AbortController | null>(null);
  const titleRefreshRef = useRef<{
    timer?: ReturnType<typeof setTimeout>;
    cancelled: boolean;
  } | null>(null);

  useEffect(() => {
    const lifetime = { cancelled: false };
    titleRefreshRef.current = lifetime;
    return () => {
      lifetime.cancelled = true;
      const refresh = titleRefreshRef.current;
      if (refresh) {
        refresh.cancelled = true;
        clearTimeout(refresh.timer);
      }
    };
  }, [conversationId]);

  const renameInputRef = useRef<HTMLInputElement>(null);

  const renameReturnFocusRef = useRef<HTMLElement | null>(null);

  const activeConversation = useMemo(
    () => conversations.find((item) => item.id === conversationId) ?? null,
    [conversationId, conversations],
  );

  const debugTraceMessages = useMemo(
    () =>
      [...chatMessages].filter((item) => item.role === "assistant").reverse(),
    [chatMessages],
  );

  function cancelChat() {
    chatAbortRef.current?.abort();
    setChatPendingStatus(null);
    setStatus({
      kind: "busy",
      message: "Chat: cancelling streamed response before completion…",
    });
  }

  function conversationUrl(
    id = conversationId,
    cursor?: string | null,
  ): string {
    const params = new URLSearchParams({ limit: "30" });
    if (cursor) params.set("cursor", cursor);
    return `/api/conversations/${encodeURIComponent(id)}?${params.toString()}`;
  }

  async function loadConversations(showStatus = true) {
    const renameRevision = renameRevisionRef.current;
    if (showStatus)
      setStatus({ kind: "busy", message: "Conversations: loading…" });
    try {
      const payload = await readJsonResponse<ConversationListPayload>(
        await fetch("/api/conversations", { method: "GET" }),
      );
      // Keep list membership/order fresh, but an older GET cannot undo a PATCH.
      const reconciled = (payload.conversations ?? []).map((item) => {
        const renamed = acknowledgedRenamesRef.current.get(item.id);
        return renamed && renamed.revision > renameRevision
          ? {
              ...item,
              title: renamed.title,
              updatedAt:
                item.updatedAt > renamed.updatedAt
                  ? item.updatedAt
                  : renamed.updatedAt,
            }
          : item;
      });
      setConversations(reconciled);
      if (showStatus)
        setStatus({
          kind: "ok",
          message: `Conversations: loaded ${payload.conversations?.length ?? 0} local conversations.`,
        });
      return reconciled;
    } catch (error) {
      if (showStatus)
        setStatus({
          kind: "error",
          message: `Conversation list failed: ${error instanceof Error ? error.message : "unknown error"}`,
        });
    }
  }

  function refreshPendingTitle(id: string) {
    const previous = titleRefreshRef.current;
    if (previous) {
      previous.cancelled = true;
      clearTimeout(previous.timer);
    }
    const refresh = {
      cancelled: false,
      timer: undefined as ReturnType<typeof setTimeout> | undefined,
    };
    titleRefreshRef.current = refresh;
    // after() starts after response delivery. Stop on settlement, navigation,
    // unmount, or four reads over five seconds, even after a server shutdown.
    const delays = [250, 750, 1500, 2500];
    function schedule(index: number) {
      if (refresh.cancelled || index >= delays.length) return;
      refresh.timer = setTimeout(() => {
        runInBackground(
          loadConversations(false).then((items) => {
            if (
              !refresh.cancelled &&
              items?.find((item) => item.id === id)?.titlePending
            )
              schedule(index + 1);
          }),
        );
      }, delays[index]);
    }
    schedule(0);
  }

  async function selectConversation(id: string) {
    if (isChatLoading) {
      setStatus({
        kind: "error",
        message:
          "Cancel or finish the current streamed answer before switching conversations.",
      });
      return;
    }
    setConversationId(id);
    setIsConversationDrawerOpen(false);
    conversationButtonRef.current?.focus();
  }

  async function loadChatHistory(showStatus = true, id = conversationId) {
    const requestId = chatHistoryRequestRef.current + 1;
    chatHistoryRequestRef.current = requestId;
    if (showStatus)
      setStatus({ kind: "busy", message: "Chat: loading local history…" });
    try {
      let response = await fetch(conversationUrl(id), { method: "GET" });
      if (response.status === 404) {
        const created = await readJsonResponse<ConversationCreatePayload>(
          await fetch("/api/conversations", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ id }),
          }),
        );
        await loadConversations(false);
        response = await fetch(conversationUrl(created.conversation.id), {
          method: "GET",
        });
      }
      let payload = await readJsonResponse<ChatPayload>(response);
      if (!Array.isArray(payload.messages)) {
        payload = await readJsonResponse<ChatPayload>(
          await fetch(`/api/chat?conversationId=${encodeURIComponent(id)}`, {
            method: "GET",
          }),
        );
      }
      if (chatHistoryRequestRef.current !== requestId) return;
      const nextMessages = payload.messages ?? [];
      rememberTranscriptFollowIntent();
      setChatMessages(nextMessages);
      setLlmDebugTracesEnabled(payload.llmDebugTracesEnabled === true);
      setHistoryCursor(payload.nextCursor ?? null);
      setLastFailedMessage("");
      if (!showStatus) forceNextScrollRef.current = true;
      if (showStatus)
        setStatus({
          kind: "ok",
          message: `Chat: loaded ${nextMessages.length} messages from the local conversation.`,
        });
    } catch (error) {
      if (showStatus)
        setStatus({
          kind: "error",
          message: `Chat history failed: ${error instanceof Error ? error.message : "unknown error"}`,
        });
    }
  }

  async function loadOlderMessages() {
    if (!historyCursor || isHistoryLoading) return;
    const transcript = transcriptRef.current;
    const previousHeight = transcript?.scrollHeight ?? 0;
    setIsHistoryLoading(true);
    try {
      const payload = await readJsonResponse<ChatPayload>(
        await fetch(conversationUrl(conversationId, historyCursor), {
          method: "GET",
        }),
      );
      const olderMessages = payload.messages ?? [];
      if (typeof payload.llmDebugTracesEnabled === "boolean")
        setLlmDebugTracesEnabled(payload.llmDebugTracesEnabled);
      setChatMessages((items) => [...olderMessages, ...items]);
      setHistoryCursor(payload.nextCursor ?? null);
      requestAnimationFrame(() => {
        const nextTranscript = transcriptRef.current;
        if (!nextTranscript) return;
        nextTranscript.scrollTop +=
          nextTranscript.scrollHeight - previousHeight;
      });
    } catch (error) {
      setStatus({
        kind: "error",
        message: `Older history failed: ${error instanceof Error ? error.message : "unknown error"}`,
      });
    } finally {
      setIsHistoryLoading(false);
    }
  }

  function closeConversationRenameDialog(restoreFocus = true) {
    setRenameTarget(null);
    setRenameTitle("");
    setRenameError("");
    setIsRenamingConversation(false);
    if (restoreFocus) renameReturnFocusRef.current?.focus();
    renameReturnFocusRef.current = null;
  }

  function cancelConversationRename() {
    if (isRenamingConversation) return;
    closeConversationRenameDialog();
  }

  function startConversationRename(
    target: Pick<ConversationSummary, "id" | "title">,
    trigger?: HTMLElement,
  ) {
    closeConversationMenu();
    if (isRenamingConversation) return;
    setRenameError("");
    renameReturnFocusRef.current =
      trigger ??
      [
        ...document.querySelectorAll<HTMLElement>(".conversation-menu-trigger"),
      ].find((item) => item.dataset.conversationMenuId === target.id) ??
      null;
    setRenameTarget(target);
    setRenameTitle(target.title);
  }

  async function saveConversationRename() {
    if (!renameTarget || isRenamingConversation) return;
    const nextTitle = renameTitle.trim();
    if (!nextTitle) {
      setStatus({
        kind: "error",
        message: "Conversation rename failed: enter a non-empty title.",
      });
      renameInputRef.current?.focus();
      return;
    }
    if (nextTitle === renameTarget.title) {
      closeConversationRenameDialog();
      setStatus({
        kind: "ok",
        message: "Conversation rename cancelled; title is unchanged.",
      });
      return;
    }
    setIsRenamingConversation(true);
    setRenameError("");
    setStatus({ kind: "busy", message: "Conversation: renaming…" });
    try {
      const payload = await readJsonResponse<ConversationRenamePayload>(
        await fetch(
          `/api/conversations/${encodeURIComponent(renameTarget.id)}`,
          {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ title: nextTitle }),
          },
        ),
      );
      const renamed = payload.conversation;
      renameRevisionRef.current += 1;
      acknowledgedRenamesRef.current.set(renamed.id, {
        revision: renameRevisionRef.current,
        title: renamed.title,
        updatedAt: renamed.updatedAt,
      });
      setConversations((items) =>
        items.map((item) =>
          item.id === renamed.id
            ? {
                ...item,
                title: renamed.title,
                updatedAt:
                  item.updatedAt > renamed.updatedAt
                    ? item.updatedAt
                    : renamed.updatedAt,
              }
            : item,
        ),
      );
      closeConversationRenameDialog();
      setStatus({
        kind: "ok",
        message:
          "Conversation renamed locally. Messages, Garmin data, Profile, and saved memories stay unchanged.",
      });
    } catch (error) {
      setIsRenamingConversation(false);
      const message = `Conversation rename failed: ${error instanceof Error ? error.message : "unknown error"}`;
      setRenameError(message);
      setStatus({ kind: "error", message });
      renameInputRef.current?.focus();
    }
  }

  async function deleteConversationById(targetId: string, title: string) {
    if (isChatLoading) {
      setStatus({
        kind: "error",
        message:
          "Cancel or finish the current streamed answer before deleting.",
      });
      return;
    }
    const label = title.trim() || "this chat";
    if (
      !window.confirm(
        `Delete local conversation "${label}" and its messages? Garmin data, Profile, and saved memories stay unchanged.`,
      )
    )
      return;
    const isActiveDelete = targetId === conversationId;
    setStatus({ kind: "busy", message: "Conversation: deleting…" });
    try {
      const payload = await readJsonResponse<ConversationDeletePayload>(
        await fetch(`/api/conversations/${encodeURIComponent(targetId)}`, {
          method: "DELETE",
        }),
      );
      setConversations(payload.conversations ?? []);
      if (isActiveDelete) {
        rememberTranscriptFollowIntent();
        setChatMessages([]);
        setHistoryCursor(null);
        setLastFailedMessage("");
        forceNextScrollRef.current = true;
        setConversationId(payload.nextConversationId);
      }
      setStatus({
        kind: "ok",
        message: payload.deleted
          ? isActiveDelete
            ? "Conversation deleted; a safe remaining/new conversation is selected. Garmin data, Profile, and saved memories stay unchanged."
            : "Conversation deleted from saved chats. The current transcript, Garmin data, Profile, and saved memories stay unchanged."
          : isActiveDelete
            ? "Conversation was already absent; a safe conversation is selected."
            : "Conversation was already absent; saved chats were refreshed.",
      });
    } catch (error) {
      setStatus({
        kind: "error",
        message: `Conversation delete failed: ${error instanceof Error ? error.message : "unknown error"}`,
      });
    }
  }

  async function startNewChat() {
    if (isChatLoading) return;
    setStatus({
      kind: "busy",
      message: "New chat: creating local conversation…",
    });
    try {
      const payload = await readJsonResponse<
        Partial<ConversationCreatePayload>
      >(
        await fetch("/api/conversations", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ title: "New chat" }),
        }),
      );
      await loadConversations(false);
      const nextConversationId =
        payload.conversation?.id ??
        `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      setConversationId(nextConversationId);
      setChatMessages([]);
      setHistoryCursor(null);
      setLastFailedMessage("");
      forceNextScrollRef.current = true;
      setStatus({
        kind: "ok",
        message:
          "New chat created. Active session context reset; prior transcripts stay in local SQLite. Semantic memory, Profile, and Garmin facts remain available when configured.",
      });
    } catch (error) {
      setStatus({
        kind: "error",
        message: `New chat failed: ${error instanceof Error ? error.message : "unknown error"}`,
      });
    }
  }

  async function submitChat(text: string) {
    if (!text.trim() || isChatLoading) return;
    const trimmed = text.trim();
    const pendingAssistantId = `streaming-assistant-${Date.now()}`;
    let assistantDraft = "";
    let acceptsProgress = true;
    let titlePending = false;
    const titleRefreshOwner = titleRefreshRef.current;
    chatHistoryRequestRef.current += 1;
    const controller = new AbortController();
    chatAbortRef.current = controller;
    setMessage("");
    setLastFailedMessage("");
    setChatPendingStatus({ message: "Starting your request…" });
    setIsChatLoading(true);
    forceNextScrollRef.current = true;
    setStatus({ kind: "busy", message: "Chat: starting your request…" });

    function applyEvent(event: ChatStreamEvent) {
      if (chatAbortRef.current !== controller || controller.signal.aborted)
        return;
      if (event.type === "start") {
        setChatMessages((items) => [...items, event.userMessage]);
        return;
      }
      if (event.type === "status") {
        if (!acceptsProgress) return;
        setChatPendingStatus({
          message: event.message,
          counters: validProgressCounters(event.counters),
        });
        setStatus({ kind: "busy", message: `Chat: ${event.message}` });
        return;
      }
      if (event.type === "metadata") return;
      if (event.type === "delta") {
        acceptsProgress = false;
        setChatPendingStatus(null);
        assistantDraft += event.textDelta;
        setChatMessages((items) => {
          const withoutPending = items.filter(
            (item) => item.id !== pendingAssistantId,
          );
          return [
            ...withoutPending,
            {
              id: pendingAssistantId,
              role: "assistant",
              content: assistantDraft,
              createdAt: new Date().toISOString(),
            },
          ];
        });
        return;
      }
      if (event.type === "done") {
        acceptsProgress = false;
        setChatPendingStatus(null);
        setChatMessages((items) => [
          ...items.filter((item) => item.id !== pendingAssistantId),
          event.assistantMessage,
        ]);
        setLlmDebugTracesEnabled(event.llmDebugTracesEnabled === true);
        const memorySuffix =
          event.memoryProposal.status === "pending"
            ? ` Pending learned-memory proposal created: ${event.memoryProposal.value}`
            : event.memoryProposal.status === "skipped"
              ? ` Memory not proposed: ${event.memoryProposal.reason}`
              : "";
        const savedTrainingPlan =
          event.assistantMessage.grounding?.toolSteps?.some(
            (step) =>
              step.tool === "saveTrainingPlan" && step.status === "succeeded",
          ) ?? event.assistantMessage.grounding?.tool === "saveTrainingPlan";
        void event.memoryProposal;
        runInBackground(loadMemories(false));
        runInBackground(loadConversations(false));
        if (savedTrainingPlan)
          runInBackground(loadTrainingPlan("chat-save", false));
        if (
          loadWeekly &&
          event.assistantMessage.grounding?.toolSteps?.some(
            (step) =>
              ["saveWeeklyDocuments", "applyWeeklyProposal"].includes(
                step.tool,
              ) && step.status === "succeeded",
          )
        )
          runInBackground(loadWeekly());
        setStatus({
          kind: "ok",
          message: `Chat: streamed response complete.${memorySuffix}`,
        });
        return;
      }
      acceptsProgress = false;
      setChatPendingStatus(null);
      setLastFailedMessage(trimmed);
      setChatMessages((items) =>
        items.filter((item) => item.id !== pendingAssistantId),
      );
      setStatus({
        kind: event.code === "aborted" ? "ok" : "error",
        message:
          event.code === "aborted"
            ? "Chat: response cancelled before a complete assistant answer was persisted. Retry is available."
            : `Chat failed: ${event.message}`,
      });
    }

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          conversationId,
          message: trimmed,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          stream: true,
        }),
        signal: controller.signal,
      });
      titlePending = response.headers.get("x-chat-title-pending") === "true";
      if (!response.ok || !response.body) {
        const body = await readResponse(response);
        throw new Error(body);
      }
      if (response.headers.get("content-type")?.includes("application/json")) {
        const payload = (await response.json()) as ChatPayload;
        const nextMessages = payload.messages ?? [];
        setChatMessages(nextMessages);
        setChatPendingStatus(null);
        setLlmDebugTracesEnabled(payload.llmDebugTracesEnabled === true);
        if (payload.memoryProposal) runInBackground(loadMemories(false));
        runInBackground(loadConversations(false));
        if (
          payload.toolEvidence?.toolSteps?.some(
            (step) =>
              step.tool === "saveTrainingPlan" && step.status === "succeeded",
          ) ??
          payload.toolEvidence?.tool === "saveTrainingPlan"
        )
          runInBackground(loadTrainingPlan("chat-save", false));
        if (
          loadWeekly &&
          payload.toolEvidence?.toolSteps?.some(
            (step) =>
              ["saveWeeklyDocuments", "applyWeeklyProposal"].includes(
                step.tool,
              ) && step.status === "succeeded",
          )
        )
          runInBackground(loadWeekly());
        setStatus({
          kind: "ok",
          message: "Chat: response complete.",
        });
        return;
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          applyEvent(JSON.parse(line) as ChatStreamEvent);
        }
      }
      if (buffer.trim()) applyEvent(JSON.parse(buffer) as ChatStreamEvent);
    } catch (error) {
      setChatPendingStatus(null);
      setLastFailedMessage(trimmed);
      setChatMessages((items) =>
        items.filter((item) => item.id !== pendingAssistantId),
      );
      setStatus({
        kind: controller.signal.aborted ? "ok" : "error",
        message: controller.signal.aborted
          ? "Chat: response cancelled before completion. Retry is available."
          : `Chat failed: ${error instanceof Error ? error.message : "unknown error"}`,
      });
    } finally {
      if (titlePending && titleRefreshOwner && !titleRefreshOwner.cancelled)
        refreshPendingTitle(conversationId);
      if (chatAbortRef.current === controller) {
        chatAbortRef.current = null;
        setChatPendingStatus(null);
        setIsChatLoading(false);
      }
    }
  }

  async function sendChat() {
    await submitChat(messageInputRef.current?.value ?? message);
  }

  const conversationRows = conversations.length
    ? conversations
    : [
        {
          id: conversationId,
          title: activeConversation?.title ?? "Trainer chat",
          updatedAt: null,
        },
      ];
  return {
    loadConversations,
    loadChatHistory,
    cancelConversationRename,
    conversationId,
    chatMessages,
    isChatLoading,
    chatPendingStatus,
    renameTarget,
    renameInputRef,
    conversationRows,
    startNewChat,
    selectConversation,
    startConversationRename,
    deleteConversationById,
    saveConversationRename,
    renameTitle,
    renameError,
    setRenameTitle,
    isRenamingConversation,
    historyCursor,
    loadOlderMessages,
    isHistoryLoading,
    message,
    setMessage,
    sendChat,
    lastFailedMessage,
    submitChat,
    cancelChat,
    llmDebugTracesEnabled,
    debugTraceMessages,
  };
}
