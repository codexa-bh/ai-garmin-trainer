"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Status = { kind: "idle" | "ok" | "error" | "busy"; message: string };
type ChatRole = "user" | "assistant";
type ChatGrounding = {
  tool?: string;
  activityId?: string;
  activityName?: string | null;
  activityDate?: string | null;
  privacy?: string;
  summary?: string;
};
type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: string;
  grounding?: ChatGrounding | null;
};
type ChatPayload = {
  conversationId: string;
  messages: ChatMessage[];
  contextWindow?: number;
  historyLimit?: number;
  nextCursor?: string | null;
  toolEvidence?: ChatGrounding | null;
  memoryProposal?: MemoryProposalResult;
};

type MemoryProposalResult =
  | { status: "none" }
  | { status: "pending"; id: string; value: string }
  | { status: "skipped"; reason: string };

type ConversationSummary = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
};

type ConversationListPayload = { conversations: ConversationSummary[] };

type ConversationCreatePayload = { conversation: ConversationSummary };

type ConversationDeletePayload = {
  deleted: boolean;
  conversationId: string;
  nextConversationId: string;
  conversations: ConversationSummary[];
};

type ChatStreamEvent =
  | { type: "start"; conversationId: string; userMessage: ChatMessage }
  | { type: "status"; message: string }
  | { type: "delta"; textDelta: string }
  | { type: "metadata"; grounding: ChatGrounding | null }
  | {
      type: "done";
      assistantMessage: ChatMessage;
      conversationId: string;
      contextWindow: number;
      historyLimit: number;
      memoryProposal: MemoryProposalResult;
    }
  | { type: "error"; code: string; message: string; retryable: boolean };

type MemoryItem = {
  id: string;
  category: "learned_preference" | "temporary_constraint" | "commitment";
  value: string;
  status:
    | "pending_confirmation"
    | "confirmed"
    | "rejected"
    | "deleted"
    | "expired"
    | "superseded";
  provenanceText: string;
  expiresAt: string | null;
  reconfirmAfter: string | null;
  createdAt: string;
  updatedAt: string;
};

type MemoryPayload = {
  memories: MemoryItem[];
  pending: MemoryItem[];
  confirmed: MemoryItem[];
};
type TrainerProfilePayload = {
  goals: string[];
  sports: string[];
  preferences: Record<string, unknown>;
  constraints: string[];
};
type ProfileResponse = { ok?: boolean; profile?: TrainerProfilePayload };
type AthleteBaselineAvailability =
  "complete" | "partial" | "unavailable" | "failed";
type AthleteBaselinePayload = {
  availability: AthleteBaselineAvailability;
  source: "garmin_mcp" | null;
  fetchedAt: string | null;
  lastAttemptAt: string | null;
  preservedPrevious: boolean;
  values: {
    configuredMaxHeartRateBpm: number | null;
    heartRateZones: {
      status:
        "garmin_configured" | "derived_from_garmin_max_hr" | "unavailable";
      source: "garmin_mcp" | "derived" | null;
      formula: string | null;
      boundaries: Array<{
        zone: 1 | 2 | 3 | 4 | 5;
        label: string | null;
        lowerBpm: number;
        upperBpm: number | null;
      }>;
    };
    runningLactateThresholdHeartRateBpm: number | null;
    cyclingLactateThresholdHeartRateBpm: number | null;
    rowingLactateThresholdHeartRateBpm: number | null;
    cyclingFtpWatts: number | null;
    cyclingFtpMeasuredOn: string | null;
    cyclingFtpSourceStale: boolean | null;
    vo2MaxRunning: number | null;
    vo2MaxCycling: number | null;
    availableTrainingDays: string[];
    preferredLongTrainingDays: string[];
  };
  unsupported: {
    configuredMaxHeartRate: boolean;
    completeHeartRateZoneBoundaries: boolean;
    reason:
      "not_exposed_by_pinned_connector" | "derived_from_garmin_max_hr" | null;
  };
};
type ImportSummaryPayload = {
  activities: number;
  healthDays: number;
  detailedActivities: number;
  athleteBaseline: AthleteBaselinePayload;
};
type ProfileFields = {
  goals: string;
  sports: string;
  constraints: string;
};
type ProfileFetchState = "idle" | "loading" | "loaded" | "error";
type ProfileSaveState = "idle" | "saving" | "saved" | "error";
type SyncProgressEvent = {
  type?: string;
  status?: string;
  stage?: string;
  message?: string;
  detail?: string;
  activitiesImported?: number;
  healthDaysImported?: number;
  detailsProcessed?: number;
  detailTotal?: number | null;
  athleteAvailability?: AthleteBaselineAvailability;
};

const emptyProfileFields: ProfileFields = {
  goals: "",
  sports: "",
  constraints: "",
};

const emptyAthleteBaseline: AthleteBaselinePayload = {
  availability: "unavailable",
  source: null,
  fetchedAt: null,
  lastAttemptAt: null,
  preservedPrevious: false,
  values: {
    configuredMaxHeartRateBpm: null,
    heartRateZones: {
      status: "unavailable",
      source: null,
      formula: null,
      boundaries: [],
    },
    runningLactateThresholdHeartRateBpm: null,
    cyclingLactateThresholdHeartRateBpm: null,
    rowingLactateThresholdHeartRateBpm: null,
    cyclingFtpWatts: null,
    cyclingFtpMeasuredOn: null,
    cyclingFtpSourceStale: null,
    vo2MaxRunning: null,
    vo2MaxCycling: null,
    availableTrainingDays: [],
    preferredLongTrainingDays: [],
  },
  unsupported: {
    configuredMaxHeartRate: true,
    completeHeartRateZoneBoundaries: true,
    reason: "not_exposed_by_pinned_connector",
  },
};

async function readResponse(response: Response): Promise<string> {
  const text = await response.text();
  if (!text) return response.ok ? "OK" : `HTTP ${response.status}`;
  try {
    const json = JSON.parse(text) as unknown;
    return JSON.stringify(json, null, 2);
  } catch {
    return text;
  }
}

function formatDetailProgress(event: SyncProgressEvent): string | null {
  const detailTotal = event.detailTotal ?? 0;
  if (detailTotal > 0) {
    return `activity details ${event.detailsProcessed ?? 0}/${detailTotal}`;
  }
  if (event.stage === "detail") return "activity details up to date";
  return null;
}

function formatSyncProgressLine(event: SyncProgressEvent): string {
  const progressParts = [
    `activities ${event.activitiesImported ?? 0}`,
    `health days ${event.healthDaysImported ?? 0}`,
  ];
  const detailProgress = formatDetailProgress(event);
  if (detailProgress) progressParts.push(detailProgress);
  return `${event.stage ?? "progress"}: ${event.message ?? "working"} (${progressParts.join(", ")})`;
}

async function readJsonResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (!response.ok) {
    try {
      const json = JSON.parse(text) as { error?: string };
      throw new Error(json.error ?? `HTTP ${response.status}`);
    } catch (error) {
      if (
        error instanceof Error &&
        error.message !== "Unexpected end of JSON input"
      )
        throw error;
      throw new Error(text || `HTTP ${response.status}`);
    }
  }
  return JSON.parse(text) as T;
}

function linesToText(items: string[] | undefined): string {
  return (items ?? []).join("\n");
}

function textToLines(value: string): string[] {
  return value
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function profileToFields(profile: TrainerProfilePayload): ProfileFields {
  return {
    goals: linesToText(profile.goals),
    sports: linesToText(profile.sports),
    constraints: linesToText(profile.constraints),
  };
}

function dateLabel(value: string | null): string {
  return value ? new Date(value).toLocaleString() : "Not available";
}

function valueLabel(value: number | null, suffix = ""): string {
  return value === null ? "Not available" : `${value}${suffix}`;
}

function dayListLabel(days: string[]): string {
  return days.length ? days.join(", ") : "Not available";
}

function profileStatusLabel(
  fetchState: ProfileFetchState,
  saveState: ProfileSaveState,
  dirty: boolean,
): string {
  if (saveState === "saving") return "Saving Profile…";
  if (dirty) return "Unsaved Profile changes";
  if (saveState === "saved") return "Profile saved";
  if (fetchState === "loading") return "Loading saved Profile…";
  if (fetchState === "error" || saveState === "error")
    return "Profile needs attention";
  if (fetchState === "loaded") return "Profile loaded";
  return "Profile ready";
}

export function TrainerDashboard() {
  const [status, setStatus] = useState<Status>({
    kind: "idle",
    message:
      "Ready. Local trainer is available; verify the connector when needed.",
  });
  const [message, setMessage] = useState("");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [conversationId, setConversationId] = useState("default");
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [historyCursor, setHistoryCursor] = useState<string | null>(null);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);
  const [isConversationDrawerOpen, setIsConversationDrawerOpen] =
    useState(false);
  const [memoryItems, setMemoryItems] = useState<MemoryItem[]>([]);
  const [memoryDraft, setMemoryDraft] = useState("");
  const [memoryMessage, setMemoryMessage] = useState(
    "Learned memories load from local SQLite and stay inactive until approved.",
  );
  const [isMemoryLoading, setIsMemoryLoading] = useState(false);
  const [contextWindow, setContextWindow] = useState(0);
  const [historyLimit, setHistoryLimit] = useState(12);
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [lastFailedMessage, setLastFailedMessage] = useState("");
  const [profileFields, setProfileFields] =
    useState<ProfileFields>(emptyProfileFields);
  const [profileFetchState, setProfileFetchState] =
    useState<ProfileFetchState>("idle");
  const [profileSaveState, setProfileSaveState] =
    useState<ProfileSaveState>("idle");
  const [isProfileDirty, setIsProfileDirty] = useState(false);
  const [profileMessage, setProfileMessage] = useState(
    "Saved local Profile will load from local SQLite.",
  );
  const [athleteBaseline, setAthleteBaseline] =
    useState<AthleteBaselinePayload | null>(null);
  const [athleteBaselineMessage, setAthleteBaselineMessage] = useState(
    "Garmin athlete baselines will load from the local import summary.",
  );
  const [detailGarminId, setDetailGarminId] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const profileDirtyRef = useRef(false);
  const profilePreferencesRef = useRef<Record<string, unknown>>({});
  const profileRequestRef = useRef(0);
  const chatHistoryRequestRef = useRef(0);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const transcriptBottomRef = useRef<HTMLDivElement>(null);
  const shouldAutoScrollRef = useRef(true);
  const forceNextScrollRef = useRef(false);
  const chatAbortRef = useRef<AbortController | null>(null);
  const conversationButtonRef = useRef<HTMLButtonElement>(null);
  const messageInputRef = useRef<HTMLTextAreaElement>(null);

  const activeConversation = useMemo(
    () => conversations.find((item) => item.id === conversationId) ?? null,
    [conversationId, conversations],
  );
  const latestToolEvidence = useMemo(
    () => [...chatMessages].reverse().find((item) => item.grounding)?.grounding,
    [chatMessages],
  );
  const pendingMemories = useMemo(
    () => memoryItems.filter((item) => item.status === "pending_confirmation"),
    [memoryItems],
  );
  const confirmedMemories = useMemo(
    () => memoryItems.filter((item) => item.status === "confirmed"),
    [memoryItems],
  );
  const profileSummary = profileStatusLabel(
    profileFetchState,
    profileSaveState,
    isProfileDirty,
  );
  const profileControlsDisabled =
    profileFetchState === "loading" || profileSaveState === "saving";

  useEffect(() => {
    const savedConversationId = window.localStorage.getItem(
      "trainer.activeConversationId",
    );
    if (savedConversationId) setConversationId(savedConversationId);
    void loadConversations(false);
    void loadMemories(false);
    void loadProfile("startup");
    void loadImportSummary("startup", false);
  }, []);
  useEffect(() => {
    window.localStorage.setItem("trainer.activeConversationId", conversationId);
    void loadChatHistory(false, conversationId);
  }, [conversationId]);
  useEffect(() => {
    if (!forceNextScrollRef.current && !shouldAutoScrollRef.current) return;
    scrollTranscriptToBottom(forceNextScrollRef.current ? "auto" : "smooth");
    forceNextScrollRef.current = false;
  }, [chatMessages, isChatLoading]);

  function transcriptIsNearBottom(): boolean {
    const transcript = transcriptRef.current;
    if (!transcript) return true;
    const remaining =
      transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight;
    return remaining <= 96;
  }

  function rememberTranscriptFollowIntent() {
    shouldAutoScrollRef.current = transcriptIsNearBottom();
  }

  function handleTranscriptScroll() {
    shouldAutoScrollRef.current = transcriptIsNearBottom();
  }

  function cancelChat() {
    chatAbortRef.current?.abort();
    setStatus({
      kind: "busy",
      message: "Chat: cancelling streamed response before completion…",
    });
  }

  function scrollTranscriptToBottom(behavior: ScrollBehavior) {
    const transcript = transcriptRef.current;
    if (!transcript) return;
    transcript.scrollTop = transcript.scrollHeight;
    transcriptBottomRef.current?.scrollIntoView?.({ block: "end", behavior });
    shouldAutoScrollRef.current = true;
  }

  function setProfileDirty(value: boolean) {
    profileDirtyRef.current = value;
    setIsProfileDirty(value);
  }

  function updateProfileField(key: keyof ProfileFields, value: string) {
    setProfileFields((current) => ({ ...current, [key]: value }));
    setProfileDirty(true);
    if (profileSaveState === "saved") setProfileSaveState("idle");
    setProfileMessage(
      "Unsaved changes. Save Profile to update trainer grounding.",
    );
  }

  function applyProfile(profile: TrainerProfilePayload) {
    setProfileFields(profileToFields(profile));
    profilePreferencesRef.current = profile.preferences ?? {};
    setProfileDirty(false);
  }

  async function loadProfile(trigger: "startup" | "manual") {
    const requestId = profileRequestRef.current + 1;
    profileRequestRef.current = requestId;
    setProfileFetchState("loading");
    setProfileMessage(
      trigger === "manual"
        ? "Reloading saved local Profile…"
        : "Loading saved local Profile…",
    );

    try {
      const response = await fetch("/api/profile", { method: "GET" });
      const payload = await readJsonResponse<TrainerProfilePayload>(response);
      if (profileRequestRef.current !== requestId) return;
      setProfileFetchState("loaded");
      if (profileDirtyRef.current) {
        setProfileMessage(
          "Saved Profile is available, but current edits were preserved. Save them or reload Profile to replace the form.",
        );
        return;
      }
      applyProfile(payload);
      setProfileSaveState("saved");
      setProfileMessage("Saved Profile loaded from local SQLite.");
    } catch (error) {
      if (profileRequestRef.current !== requestId) return;
      setProfileFetchState("error");
      setProfileMessage(
        `Profile load failed without changing the form: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    }
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
    if (showStatus)
      setStatus({ kind: "busy", message: "Conversations: loading…" });
    try {
      const payload = await readJsonResponse<ConversationListPayload>(
        await fetch("/api/conversations", { method: "GET" }),
      );
      setConversations(payload.conversations ?? []);
      if (showStatus)
        setStatus({
          kind: "ok",
          message: `Conversations: loaded ${payload.conversations?.length ?? 0} local conversations.`,
        });
    } catch (error) {
      if (showStatus)
        setStatus({
          kind: "error",
          message: `Conversation list failed: ${error instanceof Error ? error.message : "unknown error"}`,
        });
    }
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
      const pending = payload.pending ?? [];
      const confirmed = payload.confirmed ?? [];
      setMemoryItems(memories);
      setMemoryMessage(
        `Memory: ${pending.length} pending and ${confirmed.length} confirmed local memories.`,
      );
      if (showStatus)
        setStatus({
          kind: "ok",
          message: "Memory: loaded local learned memories.",
        });
    } catch (error) {
      const message = `Memory load failed: ${error instanceof Error ? error.message : "unknown error"}`;
      setMemoryMessage(message);
      if (showStatus) setStatus({ kind: "error", message });
    } finally {
      setIsMemoryLoading(false);
    }
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
      setHistoryCursor(payload.nextCursor ?? null);
      setContextWindow(Math.min(nextMessages.length, 10));
      setHistoryLimit(payload.historyLimit ?? 12);
      setLastFailedMessage("");
      forceNextScrollRef.current = true;
      if (showStatus)
        setStatus({
          kind: "ok",
          message: `Chat: loaded ${nextMessages.length} local messages.`,
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

  async function runAction(label: string, request: () => Promise<Response>) {
    setStatus({ kind: "busy", message: `${label}…` });
    try {
      const response = await request();
      const body = await readResponse(response);
      setStatus({
        kind: response.ok ? "ok" : "error",
        message: `${label}: ${response.ok ? "success" : `failed (${response.status})`}\n${body}`,
      });
    } catch (error) {
      setStatus({
        kind: "error",
        message: `${label}: ${error instanceof Error ? error.message : "failed"}`,
      });
    }
  }

  async function syncNow() {
    setStatus({ kind: "busy", message: "Sync now: starting…" });
    try {
      const response = await fetch("/api/sync", { method: "POST" });
      if (!response.ok || !response.body) {
        const body = await readResponse(response);
        setStatus({
          kind: "error",
          message: `Sync now: failed (${response.status})\n${body}`,
        });
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let log = "";
      let finalKind: Status["kind"] = "ok";

      const appendLine = (line: string) => {
        log = `${log}${line}\n`.split("\n").slice(-20).join("\n");
        setStatus({
          kind: finalKind === "error" ? "error" : "busy",
          message: log.trim(),
        });
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line) as SyncProgressEvent;
          if (event.type === "result") {
            finalKind = event.status === "completed" ? "ok" : "error";
            appendLine(
              `Result: ${event.status}. Activities: ${event.activitiesImported ?? 0}; health days: ${event.healthDaysImported ?? 0}; details processed: ${event.detailsProcessed ?? 0}. ${event.detail ?? ""}`,
            );
          } else {
            appendLine(formatSyncProgressLine(event));
          }
        }
      }
      await loadImportSummary("sync", false);
      setStatus({ kind: finalKind, message: log.trim() || "Sync complete." });
    } catch (error) {
      setStatus({
        kind: "error",
        message: `Sync now failed: ${error instanceof Error ? error.message : "unknown error"}`,
      });
    }
  }

  async function loadImportSummary(
    trigger: "startup" | "manual" | "sync",
    showStatus = true,
  ) {
    if (showStatus)
      setStatus({ kind: "busy", message: "Import summary: loading…" });
    try {
      const payload = await readJsonResponse<ImportSummaryPayload>(
        await fetch("/api/summary"),
      );
      const nextBaseline = payload.athleteBaseline ?? emptyAthleteBaseline;
      setAthleteBaseline(nextBaseline);
      setAthleteBaselineMessage(
        `Athlete baseline ${nextBaseline.availability}; last attempt ${dateLabel(nextBaseline.lastAttemptAt)}.`,
      );
      if (showStatus)
        setStatus({
          kind: "ok",
          message: `Import summary: ${payload.activities} activities, ${payload.healthDays} health days, ${payload.detailedActivities} detailed activities, athlete baseline ${nextBaseline.availability}.`,
        });
    } catch (error) {
      setAthleteBaselineMessage(
        `Athlete baseline summary failed: ${error instanceof Error ? error.message : "unknown error"}`,
      );
      if (showStatus || trigger === "manual")
        setStatus({
          kind: "error",
          message: `Import summary failed: ${error instanceof Error ? error.message : "unknown error"}`,
        });
    }
  }

  async function refreshSummary() {
    await loadImportSummary("manual");
  }

  async function refreshDetailCoverage() {
    await runAction("Activity detail coverage", () =>
      fetch("/api/activity-detail"),
    );
  }

  async function backfillDetail() {
    const garminId = detailGarminId.trim();
    if (!garminId) {
      setStatus({
        kind: "error",
        message: "Enter an imported Garmin activity ID first.",
      });
      return;
    }
    await runAction("Detailed activity backfill", () =>
      fetch("/api/activity-detail", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ garminId, force: true }),
      }),
    );
  }

  async function deleteActiveConversation() {
    if (isChatLoading) {
      setStatus({
        kind: "error",
        message:
          "Cancel or finish the current streamed answer before deleting.",
      });
      return;
    }
    if (!window.confirm("Delete this local conversation and its messages?"))
      return;
    setStatus({ kind: "busy", message: "Conversation: deleting…" });
    try {
      const payload = await readJsonResponse<ConversationDeletePayload>(
        await fetch(
          `/api/conversations/${encodeURIComponent(conversationId)}`,
          {
            method: "DELETE",
          },
        ),
      );
      setConversations(payload.conversations ?? []);
      setConversationId(payload.nextConversationId);
      setStatus({
        kind: "ok",
        message: payload.deleted
          ? "Conversation deleted; a safe remaining/new conversation is selected."
          : "Conversation was already absent; a safe conversation is selected.",
      });
    } catch (error) {
      setStatus({
        kind: "error",
        message: `Conversation delete failed: ${error instanceof Error ? error.message : "unknown error"}`,
      });
    }
  }

  async function clearChatHistory() {
    await deleteActiveConversation();
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
      setContextWindow(0);
      setLastFailedMessage("");
      forceNextScrollRef.current = true;
      setStatus({
        kind: "ok",
        message:
          "New chat created. Prior transcripts stay in local SQLite but are not sent in this conversation context; Profile, Garmin facts, and confirmed memories remain available.",
      });
    } catch (error) {
      setStatus({
        kind: "error",
        message: `New chat failed: ${error instanceof Error ? error.message : "unknown error"}`,
      });
    }
  }

  async function createMemoryProposal() {
    const value = memoryDraft.trim();
    if (!value) {
      setMemoryMessage(
        "Enter a low-risk preference or correction before proposing memory.",
      );
      return;
    }
    setIsMemoryLoading(true);
    setStatus({ kind: "busy", message: "Memory: creating pending proposal…" });
    try {
      const payload = await readJsonResponse<MemoryPayload>(
        await fetch("/api/memory", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            category: "learned_preference",
            value,
            provenanceText:
              "User-entered memory proposal from Data & settings.",
          }),
        }),
      );
      setMemoryItems(payload.memories ?? []);
      setMemoryDraft("");
      setMemoryMessage(
        "Memory proposal saved as pending; approve it before it can ground chat.",
      );
      setStatus({ kind: "ok", message: "Memory: pending proposal created." });
    } catch (error) {
      const message = `Memory proposal failed: ${error instanceof Error ? error.message : "unknown error"}`;
      setMemoryMessage(message);
      setStatus({ kind: "error", message });
    } finally {
      setIsMemoryLoading(false);
    }
  }

  async function actOnMemory(
    id: string,
    action: "approve" | "reject" | "forget",
  ) {
    setIsMemoryLoading(true);
    setStatus({ kind: "busy", message: `Memory: ${action}…` });
    try {
      const payload = await readJsonResponse<MemoryPayload>(
        await fetch("/api/memory", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id, action }),
        }),
      );
      setMemoryItems(payload.memories ?? []);
      setMemoryMessage(
        `Memory: ${action} complete. Only confirmed active memories can ground chat.`,
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

  async function saveProfile() {
    const submittedProfile: TrainerProfilePayload = {
      goals: textToLines(profileFields.goals),
      sports: textToLines(profileFields.sports),
      constraints: textToLines(profileFields.constraints),
      preferences: profilePreferencesRef.current,
    };

    setProfileSaveState("saving");
    setProfileDirty(false);
    setProfileMessage("Saving Profile to local SQLite…");
    setStatus({ kind: "busy", message: "Profile: saving…" });

    try {
      const payload = await readJsonResponse<ProfileResponse>(
        await fetch("/api/profile", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(submittedProfile),
        }),
      );
      setProfileFetchState("loaded");
      setProfileSaveState("saved");
      if (profileDirtyRef.current) {
        setProfileMessage(
          "Previous Profile values were saved; current edits remain unsaved.",
        );
      } else {
        applyProfile(payload.profile ?? submittedProfile);
        setProfileMessage("Profile saved and ready for trainer grounding.");
      }
      setStatus({ kind: "ok", message: "Profile: saved to local SQLite." });
    } catch (error) {
      setProfileSaveState("error");
      setProfileDirty(true);
      setProfileMessage(
        `Profile save failed; unsaved edits are still in the form: ${error instanceof Error ? error.message : "unknown error"}`,
      );
      setStatus({
        kind: "error",
        message: `Profile save failed: ${error instanceof Error ? error.message : "unknown error"}`,
      });
    }
  }

  async function submitChat(text: string) {
    if (!text.trim() || isChatLoading) return;
    const trimmed = text.trim();
    const pendingAssistantId = `streaming-assistant-${Date.now()}`;
    let assistantDraft = "";
    chatHistoryRequestRef.current += 1;
    const controller = new AbortController();
    chatAbortRef.current = controller;
    setMessage("");
    setLastFailedMessage("");
    setIsChatLoading(true);
    forceNextScrollRef.current = true;
    setStatus({ kind: "busy", message: "Chat: trainer is thinking…" });

    function applyEvent(event: ChatStreamEvent) {
      if (event.type === "start") {
        setChatMessages((items) => [...items, event.userMessage]);
        return;
      }
      if (event.type === "status") {
        setStatus({ kind: "busy", message: `Chat: ${event.message}` });
        return;
      }
      if (event.type === "metadata") return;
      if (event.type === "delta") {
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
        setChatMessages((items) => [
          ...items.filter((item) => item.id !== pendingAssistantId),
          event.assistantMessage,
        ]);
        setContextWindow(event.contextWindow);
        setHistoryLimit(event.historyLimit);
        const memorySuffix =
          event.memoryProposal.status === "pending"
            ? ` Pending learned-memory proposal created: ${event.memoryProposal.value}`
            : event.memoryProposal.status === "skipped"
              ? ` Memory not proposed: ${event.memoryProposal.reason}`
              : "";
        if (event.memoryProposal.status === "pending") void loadMemories(false);
        void loadConversations(false);
        setStatus({
          kind: "ok",
          message: `Chat: streamed response complete. Context used ${event.contextWindow}/${event.historyLimit} recent local turns.${memorySuffix}`,
        });
        return;
      }
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
          stream: true,
        }),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        const body = await readResponse(response);
        throw new Error(body);
      }
      if (response.headers.get("content-type")?.includes("application/json")) {
        const payload = (await response.json()) as ChatPayload;
        const nextMessages = payload.messages ?? [];
        setChatMessages(nextMessages);
        setContextWindow(payload.contextWindow ?? nextMessages.length);
        setHistoryLimit(payload.historyLimit ?? historyLimit);
        if (payload.memoryProposal?.status === "pending")
          void loadMemories(false);
        setStatus({
          kind: "ok",
          message: `Chat: response complete. Context used ${payload.contextWindow ?? nextMessages.length}/${payload.historyLimit ?? historyLimit} recent local turns.`,
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
      if (chatAbortRef.current === controller) chatAbortRef.current = null;
      setIsChatLoading(false);
    }
  }

  async function sendChat() {
    await submitChat(messageInputRef.current?.value ?? message);
  }

  return (
    <section className="dashboard-shell" aria-label="AI trainer dashboard">
      <div className="product-grid chat-app-shell">
        <button
          type="button"
          className="drawer-toggle"
          onClick={() => setIsConversationDrawerOpen(true)}
          ref={conversationButtonRef}
        >
          Conversations
        </button>
        <aside
          className={`conversation-sidebar ${isConversationDrawerOpen ? "open" : ""}`}
          aria-label="Conversation history"
        >
          <div className="sidebar-header">
            <strong>Chats</strong>
            <button
              type="button"
              className="secondary-button drawer-close"
              onClick={() => {
                setIsConversationDrawerOpen(false);
                conversationButtonRef.current?.focus();
              }}
            >
              Close
            </button>
          </div>
          <button
            type="button"
            className="primary-action"
            onClick={startNewChat}
          >
            New chat
          </button>
          <div
            className="conversation-list"
            role="list"
            aria-label="Saved conversations"
          >
            {conversations.length ? (
              conversations.map((item) => (
                <button
                  type="button"
                  role="listitem"
                  className={`conversation-item ${item.id === conversationId ? "active" : ""}`}
                  key={item.id}
                  onClick={() => selectConversation(item.id)}
                >
                  <span>{item.title}</span>
                  <small>{dateLabel(item.updatedAt)}</small>
                </button>
              ))
            ) : (
              <p className="empty-chat">No saved conversations yet.</p>
            )}
          </div>
        </aside>
        {isConversationDrawerOpen ? (
          <button
            type="button"
            className="drawer-backdrop"
            aria-label="Close conversation drawer"
            onClick={() => setIsConversationDrawerOpen(false)}
          />
        ) : null}
        <article className="trainer-card" aria-labelledby="trainer-heading">
          <div className="chat-header">
            <div>
              <p className="section-kicker">Daily trainer</p>
              <h2 id="trainer-heading">Trainer chat</h2>
              <p>
                Ask for Garmin-grounded coaching. Responses cite relevant dates,
                activities, trends, deterministic analytics tool results, your
                saved Profile, and approved learned memories when available.
              </p>
            </div>
            <div className="chat-header-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => setIsConversationDrawerOpen(true)}
              >
                Browse chats
              </button>
              <button
                type="button"
                className="primary-action"
                onClick={syncNow}
                aria-label="Sync now — import latest Garmin data"
              >
                Sync now
              </button>
              <div className="context-card" aria-label="Recent context window">
                <strong>Recent context</strong>
                <span>
                  {contextWindow}/{historyLimit} local messages from this
                  conversation sent to grounding
                </span>
                <span>
                  Conversation: {activeConversation?.title ?? conversationId}
                </span>
                {latestToolEvidence ? (
                  <span>
                    Last tool: {latestToolEvidence.tool}
                    {latestToolEvidence.activityName
                      ? ` — ${latestToolEvidence.activityName}`
                      : ""}
                  </span>
                ) : (
                  <span>No tool evidence yet</span>
                )}
              </div>
            </div>
          </div>

          <div
            className="transcript"
            ref={transcriptRef}
            role="log"
            aria-label="Chat transcript"
            aria-live="polite"
            onScroll={handleTranscriptScroll}
          >
            {historyCursor ? (
              <button
                type="button"
                className="secondary-button load-older"
                onClick={loadOlderMessages}
                disabled={isHistoryLoading}
              >
                {isHistoryLoading ? "Loading older…" : "Load older messages"}
              </button>
            ) : null}
            {chatMessages.length === 0 && !isChatLoading ? (
              <p className="empty-chat">
                No local chat history in this conversation yet. Ask for an
                activity analysis, or say “remember that I prefer morning hikes”
                to create a pending memory. Bounded turns, tool evidence,
                Profile, Garmin facts, and approved memories stay distinct.
              </p>
            ) : null}
            {chatMessages.map((item) => (
              <div key={item.id} className={`chat-message ${item.role}`}>
                <div className="chat-meta">
                  <strong>{item.role === "user" ? "You" : "Trainer"}</strong>
                  <time dateTime={item.createdAt}>
                    {new Date(item.createdAt).toLocaleString()}
                  </time>
                </div>
                <p>{item.content}</p>
                {item.grounding ? (
                  <div
                    className="tool-evidence"
                    aria-label="Hidden grounding metadata available"
                  >
                    <span>Used local Garmin data.</span>
                  </div>
                ) : null}
              </div>
            ))}
            {isChatLoading &&
            !chatMessages.some((item) => item.id.startsWith("streaming-")) ? (
              <div className="chat-message assistant pending">
                <div className="chat-meta">
                  <strong>Trainer</strong>
                  <span>pending</span>
                </div>
                <p>Trainer is thinking with bounded local history…</p>
              </div>
            ) : null}
            <div ref={transcriptBottomRef} aria-hidden="true" />
          </div>

          <label className="message-composer">
            <span className="visually-hidden">Message</span>
            <textarea
              aria-label="Message"
              ref={messageInputRef}
              placeholder="Ask about my latest hike, then try: what should I do tomorrow based on that?"
              value={message}
              onChange={(event) => setMessage(event.currentTarget.value)}
              onInput={(event) => setMessage(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void sendChat();
                }
              }}
            />
          </label>
          <div className="button-row">
            <button type="button" onClick={sendChat} disabled={isChatLoading}>
              {isChatLoading ? "Streaming…" : "Send"}
            </button>
            {isChatLoading ? (
              <button
                type="button"
                className="secondary-button"
                onClick={cancelChat}
              >
                Cancel
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => loadChatHistory()}
              disabled={isChatLoading}
            >
              Reload history
            </button>
            <button
              type="button"
              className="danger-button"
              onClick={clearChatHistory}
              disabled={isChatLoading}
            >
              Delete chat
            </button>
            {lastFailedMessage ? (
              <button
                type="button"
                onClick={() => submitChat(lastFailedMessage)}
                disabled={isChatLoading}
              >
                Retry last message
              </button>
            ) : null}
          </div>
        </article>
      </div>

      <details
        className="settings-panel"
        open={settingsOpen}
        onToggle={(event) => setSettingsOpen(event.currentTarget.open)}
      >
        <summary>
          <span>Data &amp; settings</span>
          <small>
            Connector, sync, import summary, activity detail, privacy
          </small>
        </summary>
        {settingsOpen ? (
          <div className="settings-grid">
            <article className="profile-card" aria-labelledby="profile-heading">
              <div className="card-title-row">
                <div>
                  <p className="section-kicker">Trainer grounding</p>
                  <h2 id="profile-heading">Profile</h2>
                </div>
                <span
                  className={`pill ${isProfileDirty ? "dirty" : profileSaveState}`}
                  aria-live="polite"
                >
                  {profileSummary}
                </span>
              </div>
              <p>
                Set one item per line. Saved Profile data is loaded from local
                SQLite on startup, then used with imported Garmin facts.
              </p>
              <p className="helper-text" role="status" aria-live="polite">
                {profileMessage}
              </p>
              <label>
                Goals
                <textarea
                  aria-label="Goals"
                  value={profileFields.goals}
                  onChange={(event) =>
                    updateProfileField("goals", event.target.value)
                  }
                  placeholder="Build hiking endurance"
                  disabled={profileControlsDisabled}
                />
              </label>
              <label>
                Preferred sports
                <textarea
                  aria-label="Preferred sports"
                  value={profileFields.sports}
                  onChange={(event) =>
                    updateProfileField("sports", event.target.value)
                  }
                  placeholder="hiking\nmountaineering"
                  disabled={profileControlsDisabled}
                />
              </label>
              <label>
                Constraints
                <textarea
                  aria-label="Constraints"
                  value={profileFields.constraints}
                  onChange={(event) =>
                    updateProfileField("constraints", event.target.value)
                  }
                  placeholder="no running this week"
                  disabled={profileControlsDisabled}
                />
              </label>
              <div className="button-row">
                <button
                  type="button"
                  onClick={saveProfile}
                  disabled={profileControlsDisabled}
                >
                  {profileSaveState === "saving" ? "Saving…" : "Save Profile"}
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => loadProfile("manual")}
                  disabled={profileControlsDisabled}
                >
                  Reload saved Profile
                </button>
              </div>
            </article>

            <article
              className="settings-card memory-card"
              aria-labelledby="memory-heading"
            >
              <div className="card-title-row">
                <div>
                  <p className="section-kicker">Confirmed memory</p>
                  <h2 id="memory-heading">Learned memories</h2>
                </div>
                <span className="pill" aria-live="polite">
                  {pendingMemories.length} pending · {confirmedMemories.length}{" "}
                  confirmed
                </span>
              </div>
              <p>
                Learned memories are proposed only from explicit “remember
                that…” intent or this form. Pending memories are inspectable but
                do not ground answers until approved; forgotten memories become
                inactive.
              </p>
              <p className="helper-text" role="status" aria-live="polite">
                {memoryMessage}
              </p>
              <label>
                Propose a learned preference or correction
                <textarea
                  aria-label="Propose learned memory"
                  value={memoryDraft}
                  onChange={(event) => setMemoryDraft(event.target.value)}
                  placeholder="I prefer morning hikes and low-intensity recovery rides"
                  disabled={isMemoryLoading}
                />
              </label>
              <div className="button-row">
                <button
                  type="button"
                  onClick={createMemoryProposal}
                  disabled={isMemoryLoading}
                >
                  Propose memory
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => loadMemories()}
                  disabled={isMemoryLoading}
                >
                  Reload memories
                </button>
              </div>
              <div
                className="memory-list"
                aria-label="Pending learned memories"
              >
                <h3>Pending approval</h3>
                {pendingMemories.length ? (
                  pendingMemories.map((item) => (
                    <div className="memory-item" key={item.id}>
                      <p>{item.value}</p>
                      <small>{item.provenanceText}</small>
                      <div className="button-row">
                        <button
                          type="button"
                          onClick={() => actOnMemory(item.id, "approve")}
                          disabled={isMemoryLoading}
                        >
                          Approve
                        </button>
                        <button
                          type="button"
                          className="secondary-button"
                          onClick={() => actOnMemory(item.id, "reject")}
                          disabled={isMemoryLoading}
                        >
                          Reject
                        </button>
                      </div>
                    </div>
                  ))
                ) : (
                  <p>No pending memory proposals.</p>
                )}
              </div>
              <div
                className="memory-list"
                aria-label="Confirmed learned memories"
              >
                <h3>Confirmed and active</h3>
                {confirmedMemories.length ? (
                  confirmedMemories.map((item) => (
                    <div className="memory-item" key={item.id}>
                      <p>{item.value}</p>
                      <small>
                        Confirmed {dateLabel(item.updatedAt)} · {item.category}
                      </small>
                      <div className="button-row">
                        <button
                          type="button"
                          className="danger-button"
                          onClick={() => actOnMemory(item.id, "forget")}
                          disabled={isMemoryLoading}
                        >
                          Forget
                        </button>
                      </div>
                    </div>
                  ))
                ) : (
                  <p>No confirmed learned memories yet.</p>
                )}
              </div>
            </article>

            <article className="settings-card">
              <h2>Connector &amp; sync</h2>
              <p>
                Run <code>garmin-mcp-auth</code> outside the app, then sync
                using pinned local stdio read operations. The app never sees
                your Garmin password.
              </p>
              <div className="button-row">
                <button
                  type="button"
                  onClick={() =>
                    runAction("Verify connector", () => fetch("/api/sync"))
                  }
                >
                  Verify connector
                </button>
                <button type="button" onClick={syncNow}>
                  Sync now
                </button>
              </div>
            </article>

            <article className="settings-card">
              <h2>Import summary</h2>
              <p>
                Check imported totals, latest activity date, and health coverage
                before asking the trainer to reason about trends.
              </p>
              <button type="button" onClick={refreshSummary}>
                Refresh import summary
              </button>
            </article>

            <article
              className="settings-card"
              aria-labelledby="athlete-baseline-heading"
            >
              <h2 id="athlete-baseline-heading">Garmin athlete baselines</h2>
              <p>
                Read-only Garmin-derived thresholds and planning inputs are kept
                separate from editable Profile fields and trainer memory.
              </p>
              <p className="helper-text" role="status" aria-live="polite">
                {athleteBaselineMessage}
              </p>
              {athleteBaseline ? (
                <dl className="compact-facts">
                  <div>
                    <dt>Status</dt>
                    <dd>{athleteBaseline.availability}</dd>
                  </div>
                  <div>
                    <dt>Last successful refresh</dt>
                    <dd>{dateLabel(athleteBaseline.fetchedAt)}</dd>
                  </div>
                  <div>
                    <dt>Running threshold HR</dt>
                    <dd>
                      {valueLabel(
                        athleteBaseline.values
                          .runningLactateThresholdHeartRateBpm,
                        " bpm",
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>Cycling threshold HR</dt>
                    <dd>
                      {valueLabel(
                        athleteBaseline.values
                          .cyclingLactateThresholdHeartRateBpm,
                        " bpm",
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>Rowing threshold HR</dt>
                    <dd>
                      {valueLabel(
                        athleteBaseline.values
                          .rowingLactateThresholdHeartRateBpm,
                        " bpm",
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>Cycling FTP</dt>
                    <dd>
                      {valueLabel(athleteBaseline.values.cyclingFtpWatts, " W")}
                      {athleteBaseline.values.cyclingFtpMeasuredOn
                        ? ` (${athleteBaseline.values.cyclingFtpMeasuredOn})`
                        : ""}
                      {athleteBaseline.values.cyclingFtpSourceStale
                        ? " — source marked stale by connector"
                        : ""}
                    </dd>
                  </div>
                  <div>
                    <dt>Running VO2 max</dt>
                    <dd>{valueLabel(athleteBaseline.values.vo2MaxRunning)}</dd>
                  </div>
                  <div>
                    <dt>Cycling VO2 max</dt>
                    <dd>{valueLabel(athleteBaseline.values.vo2MaxCycling)}</dd>
                  </div>
                  <div>
                    <dt>Available training days</dt>
                    <dd>
                      {dayListLabel(
                        athleteBaseline.values.availableTrainingDays,
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>Preferred long-training days</dt>
                    <dd>
                      {dayListLabel(
                        athleteBaseline.values.preferredLongTrainingDays,
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>Configured max HR</dt>
                    <dd>
                      {valueLabel(
                        athleteBaseline.values.configuredMaxHeartRateBpm,
                        " bpm",
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>HR-zone boundaries</dt>
                    <dd>
                      {athleteBaseline.values.heartRateZones.boundaries.length
                        ? `${athleteBaseline.values.heartRateZones.status === "derived_from_garmin_max_hr" ? "Derived estimate" : "Garmin configured"}: ${athleteBaseline.values.heartRateZones.boundaries.map((zone) => `Z${zone.zone} ${zone.lowerBpm}-${zone.upperBpm ?? "max"}`).join(", ")}`
                        : "Unavailable from current Garmin source"}
                    </dd>
                  </div>
                </dl>
              ) : (
                <p>Not available until the local summary loads.</p>
              )}
              <button type="button" onClick={refreshSummary}>
                Refresh athlete baselines
              </button>
            </article>

            <article className="settings-card">
              <h2>Activity detail</h2>
              <p>
                Force-refresh one imported activity or inspect total detail
                coverage. Failed refreshes preserve the last usable normalized
                detail; redacted connector detail payloads may be retained
                locally for generated analysis.
              </p>
              <label>
                Garmin activity ID
                <input
                  aria-label="Garmin activity ID"
                  placeholder="Garmin activity ID"
                  value={detailGarminId}
                  onChange={(event) => setDetailGarminId(event.target.value)}
                />
              </label>
              <div className="button-row">
                <button type="button" onClick={backfillDetail}>
                  Force refresh detail
                </button>
                <button type="button" onClick={refreshDetailCoverage}>
                  Show detail coverage
                </button>
              </div>
            </article>

            <article className="settings-card danger-card">
              <h2>Privacy &amp; deletion</h2>
              <p>
                Destructive local-only actions are separated from routine sync.
                Use them only when you intend to remove stored chat, Profile,
                learned memories, or Garmin-derived data.
              </p>
              <div className="button-row">
                <button
                  type="button"
                  className="danger-button"
                  onClick={() =>
                    runAction("Clear chat/profile", () =>
                      fetch("/api/delete", {
                        method: "POST",
                        headers: { "content-type": "application/json" },
                        body: JSON.stringify({ scope: "chat-profile" }),
                      }),
                    )
                  }
                >
                  Clear chat/profile
                </button>
                <button
                  type="button"
                  className="danger-button"
                  onClick={() =>
                    runAction("Disconnect Garmin/delete data", () =>
                      fetch("/api/delete", {
                        method: "POST",
                        headers: { "content-type": "application/json" },
                        body: JSON.stringify({ scope: "garmin-all" }),
                      }),
                    )
                  }
                >
                  Disconnect Garmin/delete data
                </button>
              </div>
            </article>
          </div>
        ) : null}
      </details>

      <details
        className="status-card diagnostics-panel"
        open={diagnosticsOpen}
        onToggle={(event) => setDiagnosticsOpen(event.currentTarget.open)}
      >
        <summary className="diagnostics-summary">
          <span>
            <span className="section-kicker">Diagnostics</span>
            <span id="status-heading" role="heading" aria-level={2}>
              Current operation
            </span>
          </span>
          <span className={`pill ${status.kind}`}>{status.kind}</span>
        </summary>
        {diagnosticsOpen ? (
          <pre className={`status ${status.kind}`} aria-live="polite">
            {status.message}
          </pre>
        ) : null}
      </details>
    </section>
  );
}
