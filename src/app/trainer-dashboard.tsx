"use client";

import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";

type Status = { kind: "idle" | "ok" | "error" | "busy"; message: string };
type ChatRole = "user" | "assistant";
type LlmDebugTrace = {
  schemaVersion: 1;
  capturedAt: string;
  provider?: string;
  model?: string | null;
  userRequest?: string;
  providerCalls?: unknown[];
  toolSteps?: unknown[];
  finalAnswer?: string;
  truncated?: boolean;
  caps?: Record<string, number>;
  [key: string]: unknown;
};

type ChatGrounding = {
  debugTrace?: LlmDebugTrace;
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
  llmDebugTracesEnabled?: boolean;
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
      llmDebugTracesEnabled?: boolean;
    }
  | { type: "error"; code: string; message: string; retryable: boolean };

type MemoryItem = {
  id: string;
  text: string;
  kind: "conversation" | "saved_preference" | "correction" | "temporary";
  score?: number;
  conversationId?: string;
  createdAt?: string;
  updatedAt?: string;
  expiresAt?: string;
};

type MemoryHealth = {
  enabled: boolean;
  ready: boolean;
  status: "disabled" | "ready" | "degraded" | "misconfigured";
  detail: string;
  provider: "app-sqlite-vector";
  vectorProvider: "sqlite";
  userDisabled: boolean;
  embeddingProvider?: "openai" | "deterministic" | "ollama";
  embeddingModel?: string;
};

type MemoryPayload = {
  memories: MemoryItem[];
  health: MemoryHealth;
  enabled: boolean;
  ready: boolean;
};
type MemoryKindFilter = "all" | MemoryItem["kind"];
type MemorySort = "newest" | "oldest" | "kind" | "text";

const memoryKindOptions: { value: MemoryKindFilter; label: string }[] = [
  { value: "all", label: "All kinds" },
  { value: "conversation", label: "Conversation" },
  { value: "saved_preference", label: "Saved preference" },
  { value: "correction", label: "Correction" },
  { value: "temporary", label: "Temporary" },
];

const memorySortOptions: { value: MemorySort; label: string }[] = [
  { value: "newest", label: "Newest updated" },
  { value: "oldest", label: "Oldest updated" },
  { value: "kind", label: "Kind" },
  { value: "text", label: "Text" },
];

const memoryKindLabels: Record<MemoryItem["kind"], string> = {
  conversation: "Conversation",
  saved_preference: "Saved preference",
  correction: "Correction",
  temporary: "Temporary",
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
    cyclingFtpWatts: number | null;
    cyclingFtpMeasuredOn: string | null;
    cyclingFtpSourceStale: boolean | null;
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
type HealthCoveragePayload = {
  totalRows: number;
  completeDays: number;
  partialDays: number;
  missingDays: number;
  metrics: {
    sleepDays: number;
    restingHeartRateDays: number;
    hrvDays: number;
    stressDays: number;
    stepsDays: number;
    calorieDays: number;
    bodyBatteryDays: number;
  };
};

type DetailCoveragePayload = {
  total: number;
  pending: number;
  available: number;
  partial: number;
  unsupported: number;
  retryableFailures: number;
  preservedFailures: number;
  inProgress: number;
  terminal: number;
};

type ImportSummaryPayload = {
  activities: number;
  healthDays: number;
  healthCoverage?: HealthCoveragePayload;
  detailedActivities: number;
  detailCoverage?: DetailCoveragePayload;
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
  activitiesProcessed?: number;
  healthDaysRefreshed?: number;
  detailsProcessed?: number;
  detailTotal?: number | null;
  storedActivities?: number;
  storedHealthRows?: number;
  healthCoverage?: HealthCoveragePayload;
  detailCoverage?: DetailCoveragePayload;
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
    cyclingFtpWatts: null,
    cyclingFtpMeasuredOn: null,
    cyclingFtpSourceStale: null,
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
  const activityCount =
    event.activitiesProcessed ?? event.activitiesImported ?? 0;
  const healthCount =
    event.healthDaysRefreshed ?? event.healthDaysImported ?? 0;
  const progressParts = [
    `processed activity records ${activityCount}`,
    `refreshed health dates ${healthCount}`,
  ];
  const detailProgress = formatDetailProgress(event);
  if (detailProgress) progressParts.push(detailProgress);
  return `${event.stage ?? "progress"}: ${event.message ?? "working"} (${progressParts.join(", ")})`;
}

function formatHealthCoverageSummary(
  coverage: HealthCoveragePayload | undefined,
  legacyHealthDays: number,
): string {
  if (!coverage) return `${legacyHealthDays} health calendar rows`;
  return `${coverage.totalRows} health calendar rows (${coverage.completeDays} complete, ${coverage.partialDays} partial, ${coverage.missingDays} missing; populated metrics: sleep ${coverage.metrics.sleepDays}, HRV ${coverage.metrics.hrvDays})`;
}

function formatDetailCoverageSummary(
  coverage: DetailCoveragePayload | undefined,
  legacyDetailedActivities: number,
): string {
  if (!coverage)
    return `${legacyDetailedActivities} available/partial detailed activities`;
  return `${coverage.available} available, ${coverage.partial} partial, ${coverage.unsupported} unsupported, ${coverage.pending} pending, ${coverage.retryableFailures} retryable activity details`;
}

function formatAthleteBaselineSummary(
  baseline: AthleteBaselinePayload,
): string {
  const maxHr = baseline.values.configuredMaxHeartRateBpm
    ? `configured max HR ${baseline.values.configuredMaxHeartRateBpm} bpm from Garmin FIT zones target`
    : "configured max HR unavailable from the pinned connector";
  const zones =
    baseline.values.heartRateZones.status === "derived_from_garmin_max_hr"
      ? "HR zones derived from Garmin max HR; official boundaries unavailable"
      : baseline.values.heartRateZones.status === "garmin_configured"
        ? "Garmin-configured HR-zone boundaries available"
        : "HR-zone boundaries unavailable";
  return `Athlete baseline ${baseline.availability}; ${maxHr}; ${zones}; last attempt ${dateLabel(baseline.lastAttemptAt)}.`;
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

function hasVisibleGrounding(grounding: ChatGrounding | null | undefined) {
  if (!grounding) return false;
  return Object.keys(grounding).some((key) => key !== "debugTrace");
}

function debugMessageSummary(message: ChatMessage): string {
  const date = new Date(message.createdAt).toLocaleString();
  const excerpt = message.content.replace(/\s+/g, " ").trim().slice(0, 80);
  return `${date}${excerpt ? ` — ${excerpt}` : ""}`;
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

function memoryTimestamp(item: MemoryItem): number {
  const raw = item.updatedAt ?? item.createdAt ?? "";
  const timestamp = raw ? Date.parse(raw) : Number.NaN;
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function compareMemoryText(first: MemoryItem, second: MemoryItem): number {
  return first.text.localeCompare(second.text, undefined, {
    sensitivity: "base",
  });
}

function memoryScopeLabel(item: MemoryItem): string {
  return item.conversationId
    ? `Conversation ${item.conversationId}`
    : "Cross-conversation";
}

function memoryUpdatedLabel(item: MemoryItem): string {
  if (item.updatedAt) return `Updated ${dateLabel(item.updatedAt)}`;
  if (item.createdAt) return `Created ${dateLabel(item.createdAt)}`;
  return "No timestamp";
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

function safeMarkdownHref(value: string): string | null {
  try {
    const url = new URL(value, "http://localhost");
    if (["http:", "https:", "mailto:"].includes(url.protocol)) return value;
  } catch {
    return null;
  }
  return null;
}

function renderInlineMarkdown(text: string, keyPrefix: string): ReactNode[] {
  const pattern = /(\[[^\]]+\]\([^\s)]+\)|`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g;
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index));
    const token = match[0];
    const key = `${keyPrefix}-${match.index}`;
    const link = token.match(/^\[([^\]]+)\]\(([^\s)]+)\)$/);
    if (link) {
      const href = safeMarkdownHref(link[2]);
      nodes.push(
        href ? (
          <a key={key} href={href} rel="noreferrer noopener">
            {link[1]}
          </a>
        ) : (
          <span key={key}>{link[1]}</span>
        ),
      );
    } else if (token.startsWith("`")) {
      nodes.push(<code key={key}>{token.slice(1, -1)}</code>);
    } else if (token.startsWith("**")) {
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("*")) {
      nodes.push(<em key={key}>{token.slice(1, -1)}</em>);
    }
    lastIndex = pattern.lastIndex;
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

type MarkdownTableBlock = {
  headers: string[];
  rows: string[][];
};

function splitMarkdownTableRow(line: string): string[] | null {
  const trimmed = line.trim();
  if (!trimmed.includes("|")) return null;
  const withoutOuterPipes = trimmed.replace(/^\|/, "").replace(/\|$/, "");
  const cells = withoutOuterPipes.split("|").map((cell) => cell.trim());
  return cells.length >= 2 ? cells : null;
}

function isMarkdownTableSeparator(line: string, columnCount: number): boolean {
  const cells = splitMarkdownTableRow(line);
  return (
    cells?.length === columnCount &&
    cells.every((cell) => /^:?-{3,}:?$/.test(cell))
  );
}

function parseMarkdownTableBlock(
  lines: string[],
  startIndex: number,
): { table: MarkdownTableBlock; nextIndex: number } | null {
  const headers = splitMarkdownTableRow(lines[startIndex]);
  if (!headers || headers.some((header) => !header)) return null;
  if (!isMarkdownTableSeparator(lines[startIndex + 1] ?? "", headers.length)) {
    return null;
  }

  const rows: string[][] = [];
  let nextIndex = startIndex + 2;
  while (nextIndex < lines.length) {
    const line = lines[nextIndex];
    if (!line.trim()) break;
    const cells = splitMarkdownTableRow(line);
    if (!cells || cells.length !== headers.length) break;
    rows.push(cells);
    nextIndex += 1;
  }

  if (!rows.length) return null;
  return { table: { headers, rows }, nextIndex };
}

function renderMarkdownTable(table: MarkdownTableBlock, keyPrefix: string) {
  return (
    <div className="assistant-table-wrapper" key={keyPrefix}>
      <table className="assistant-table">
        <thead>
          <tr>
            {table.headers.map((header, index) => (
              <th key={index} scope="col">
                {renderInlineMarkdown(header, `${keyPrefix}-h-${index}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, cellIndex) => (
                <td key={cellIndex}>
                  {renderInlineMarkdown(
                    cell,
                    `${keyPrefix}-r-${rowIndex}-${cellIndex}`,
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AssistantContent({ content }: { content: string }) {
  const blocks: ReactNode[] = [];
  const lines = content.split(/\r?\n/);
  let paragraph: string[] = [];
  let list: Array<{ ordered: boolean; text: string }> = [];
  let codeLines: string[] | null = null;

  function flushParagraph() {
    if (!paragraph.length) return;
    const text = paragraph.join(" ");
    blocks.push(
      <p key={`p-${blocks.length}`}>
        {renderInlineMarkdown(text, `p-${blocks.length}`)}
      </p>,
    );
    paragraph = [];
  }

  function flushList() {
    if (!list.length) return;
    const ordered = list[0].ordered;
    const items = list;
    const ListTag = ordered ? "ol" : "ul";
    blocks.push(
      <ListTag key={`l-${blocks.length}`}>
        {items.map((item, index) => (
          <li key={index}>
            {renderInlineMarkdown(item.text, `li-${blocks.length}-${index}`)}
          </li>
        ))}
      </ListTag>,
    );
    list = [];
  }

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    if (codeLines) {
      if (line.trim().startsWith("```")) {
        blocks.push(
          <pre key={`code-${blocks.length}`}>
            <code>{codeLines.join("\n")}</code>
          </pre>,
        );
        codeLines = null;
      } else {
        codeLines.push(line);
      }
      continue;
    }
    if (line.trim().startsWith("```")) {
      flushParagraph();
      flushList();
      codeLines = [];
      continue;
    }
    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }
    const tableBlock = parseMarkdownTableBlock(lines, lineIndex);
    if (tableBlock) {
      flushParagraph();
      flushList();
      blocks.push(
        renderMarkdownTable(tableBlock.table, `table-${blocks.length}`),
      );
      lineIndex = tableBlock.nextIndex - 1;
      continue;
    }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushList();
      const HeadingTag = `h${Math.min(heading[1].length + 2, 5)}` as
        "h3" | "h4" | "h5";
      blocks.push(
        <HeadingTag key={`h-${blocks.length}`}>
          {renderInlineMarkdown(heading[2], `h-${blocks.length}`)}
        </HeadingTag>,
      );
      continue;
    }
    const listItem = line.match(/^\s*(?:([-*])|(\d+)\.)\s+(.+)$/);
    if (listItem) {
      flushParagraph();
      list.push({ ordered: Boolean(listItem[2]), text: listItem[3] });
      continue;
    }
    flushList();
    paragraph.push(line.trim());
  }
  if (codeLines) {
    blocks.push(
      <pre key={`code-${blocks.length}`}>
        <code>{codeLines.join("\n")}</code>
      </pre>,
    );
  }
  flushParagraph();
  flushList();
  return (
    <div className="assistant-content">{blocks.length ? blocks : <p />}</div>
  );
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
  const [desktopSidebarExpanded, setDesktopSidebarExpanded] = useState(false);
  const [openConversationMenuId, setOpenConversationMenuId] = useState<
    string | null
  >(null);
  const [conversationMenuPosition, setConversationMenuPosition] = useState<{
    top: number;
    left: number;
  } | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
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
  const [llmDebugTracesEnabled, setLlmDebugTracesEnabled] = useState(false);
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
  const settingsButtonRef = useRef<HTMLButtonElement>(null);
  const settingsCloseRef = useRef<HTMLButtonElement>(null);
  const messageInputRef = useRef<HTMLTextAreaElement>(null);
  const conversationMenuRef = useRef<HTMLDivElement>(null);
  const isSyncingRef = useRef(false);

  const activeConversation = useMemo(
    () => conversations.find((item) => item.id === conversationId) ?? null,
    [conversationId, conversations],
  );
  const latestToolEvidence = useMemo(
    () => [...chatMessages].reverse().find((item) => item.grounding)?.grounding,
    [chatMessages],
  );
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
  const debugTraceMessages = useMemo(
    () =>
      [...chatMessages].filter((item) => item.role === "assistant").reverse(),
    [chatMessages],
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
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (openConversationMenuId) {
        closeConversationMenu();
        return;
      }
      if (settingsOpen) {
        setSettingsOpen(false);
        settingsButtonRef.current?.focus();
        return;
      }
      if (isConversationDrawerOpen) {
        setIsConversationDrawerOpen(false);
        conversationButtonRef.current?.focus();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isConversationDrawerOpen, openConversationMenuId, settingsOpen]);
  useEffect(() => {
    if (settingsOpen) settingsCloseRef.current?.focus();
  }, [settingsOpen]);

  useEffect(() => {
    if (!openConversationMenuId) return;
    function closeOnViewportChange() {
      closeConversationMenu();
    }
    window.addEventListener("resize", closeOnViewportChange);
    return () => {
      window.removeEventListener("resize", closeOnViewportChange);
    };
  }, [openConversationMenuId]);

  useEffect(() => {
    if (!openConversationMenuId) return;
    function closeOnOutsidePointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (conversationMenuRef.current?.contains(target)) return;
      if (target instanceof Element) {
        const trigger = target.closest(".conversation-menu-trigger");
        if (
          trigger instanceof HTMLElement &&
          trigger.dataset.conversationMenuId === openConversationMenuId
        ) {
          return;
        }
      }
      closeConversationMenu();
    }
    document.addEventListener("pointerdown", closeOnOutsidePointerDown);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointerDown);
    };
  }, [openConversationMenuId]);

  function closeConversationMenu() {
    setOpenConversationMenuId(null);
    setConversationMenuPosition(null);
  }

  function toggleConversationMenu(itemId: string, trigger: HTMLButtonElement) {
    if (openConversationMenuId === itemId) {
      closeConversationMenu();
      return;
    }

    const rect = trigger.getBoundingClientRect();
    const menuWidth = 184;
    const menuHeight = itemId === conversationId ? 104 : 58;
    const viewportWidth = window.innerWidth || 1024;
    const viewportHeight = window.innerHeight || 768;
    const left = Math.min(
      viewportWidth - menuWidth - 8,
      Math.max(8, rect.right - menuWidth),
    );
    const belowTop = rect.bottom + 6;
    const top =
      belowTop + menuHeight > viewportHeight - 8
        ? Math.max(8, rect.top - menuHeight - 6)
        : belowTop;

    setOpenConversationMenuId(itemId);
    setConversationMenuPosition({ top, left });
  }

  function closeSettingsSheet() {
    setSettingsOpen(false);
    settingsButtonRef.current?.focus();
  }

  function closeConversationDrawer() {
    closeConversationMenu();
    setIsConversationDrawerOpen(false);
    conversationButtonRef.current?.focus();
  }

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
      setContextWindow(
        payload.contextWindow ?? Math.min(nextMessages.length, 6),
      );
      setHistoryLimit(payload.historyLimit ?? 12);
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
    if (isSyncingRef.current) return;
    isSyncingRef.current = true;
    setIsSyncing(true);
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
              `Result: ${event.status}. Processed activity records: ${event.activitiesProcessed ?? event.activitiesImported ?? 0}; refreshed health dates: ${event.healthDaysRefreshed ?? event.healthDaysImported ?? 0}; details processed: ${event.detailsProcessed ?? 0}; stored totals: ${event.storedActivities ?? "unknown"} activities, ${event.storedHealthRows ?? "unknown"} health rows. ${event.detail ?? ""}`,
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
    } finally {
      isSyncingRef.current = false;
      setIsSyncing(false);
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
      setAthleteBaselineMessage(formatAthleteBaselineSummary(nextBaseline));
      if (showStatus)
        setStatus({
          kind: "ok",
          message: `Import summary: ${payload.activities} stored activities, ${formatHealthCoverageSummary(payload.healthCoverage, payload.healthDays)}, detail coverage ${formatDetailCoverageSummary(payload.detailCoverage, payload.detailedActivities)}, athlete baseline ${nextBaseline.availability}.`,
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
        setContextWindow(0);
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
      setContextWindow(0);
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
        setLlmDebugTracesEnabled(event.llmDebugTracesEnabled === true);
        const memorySuffix =
          event.memoryProposal.status === "pending"
            ? ` Pending learned-memory proposal created: ${event.memoryProposal.value}`
            : event.memoryProposal.status === "skipped"
              ? ` Memory not proposed: ${event.memoryProposal.reason}`
              : "";
        void event.memoryProposal;
        void loadMemories(false);
        void loadConversations(false);
        setStatus({
          kind: "ok",
          message: `Chat: streamed response complete. Active chat context selected ${event.contextWindow} of ${event.historyLimit} session lines.${memorySuffix}`,
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
        setLlmDebugTracesEnabled(payload.llmDebugTracesEnabled === true);
        setContextWindow(payload.contextWindow ?? nextMessages.length);
        setHistoryLimit(payload.historyLimit ?? historyLimit);
        if (payload.memoryProposal) void loadMemories(false);
        setStatus({
          kind: "ok",
          message: `Chat: response complete. Active chat context selected ${payload.contextWindow ?? nextMessages.length} of ${payload.historyLimit ?? historyLimit} session lines.`,
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

  const conversationRows = conversations.length
    ? conversations
    : [
        {
          id: conversationId,
          title: activeConversation?.title ?? "Trainer chat",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ];
  const openConversationMenuItem = conversationRows.find(
    (item) => item.id === openConversationMenuId,
  );

  return (
    <section
      className={`dashboard-shell ${desktopSidebarExpanded ? "" : "sidebar-collapsed"}`}
      aria-label="AI trainer dashboard"
    >
      <header className="app-topbar">
        <button
          type="button"
          className="chrome-button sidebar-toggle"
          onClick={() => {
            if (window.matchMedia("(max-width: 960px)").matches) {
              setIsConversationDrawerOpen(true);
            } else {
              setDesktopSidebarExpanded((expanded) => !expanded);
            }
          }}
          ref={conversationButtonRef}
          aria-label="Toggle conversation history"
          aria-expanded={desktopSidebarExpanded || isConversationDrawerOpen}
        >
          Conversations
        </button>
        <div className="brand-lockup" aria-label="AI Garmin Connect Trainer">
          <span className="brand-mark" aria-hidden="true">
            ⌁
          </span>
          <span>AI Trainer</span>
        </div>
        <h1
          className="active-conversation-title"
          title={activeConversation?.title ?? "Trainer chat"}
        >
          {activeConversation?.title ?? "Trainer chat"}
        </h1>
        <button
          type="button"
          className="chrome-button sync-now-button"
          onClick={syncNow}
          disabled={isSyncing}
          aria-label="Sync now — import latest Garmin data"
        >
          {isSyncing ? "Syncing…" : "Sync now"}
        </button>
        <button
          type="button"
          className="chrome-button"
          onClick={() => setSettingsOpen(true)}
          ref={settingsButtonRef}
          aria-label="Data & settings"
        >
          Settings
        </button>
      </header>

      <div className="chat-workspace">
        <aside
          className={`conversation-sidebar ${isConversationDrawerOpen ? "open" : ""}`}
          aria-label="Conversation history"
        >
          <div className="sidebar-header">
            <div>
              <p className="section-kicker">History</p>
              <strong>Conversations</strong>
            </div>
            <button
              type="button"
              className="chrome-button drawer-close"
              onClick={closeConversationDrawer}
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
            {conversationRows.length ? (
              conversationRows.map((item) => (
                <div
                  role="listitem"
                  className={`conversation-item ${item.id === conversationId ? "active" : ""}`}
                  key={item.id}
                >
                  <button
                    type="button"
                    className="conversation-select"
                    onClick={() => {
                      closeConversationMenu();
                      void selectConversation(item.id);
                    }}
                    aria-current={
                      item.id === conversationId ? "true" : undefined
                    }
                  >
                    <span>{item.title}</span>
                    <small>{dateLabel(item.updatedAt)}</small>
                  </button>
                  <div className="conversation-menu-wrap">
                    <button
                      type="button"
                      className="conversation-menu-trigger"
                      data-conversation-menu-id={item.id}
                      aria-label={`Conversation options for "${item.title}"`}
                      aria-haspopup="menu"
                      aria-expanded={openConversationMenuId === item.id}
                      aria-controls={
                        openConversationMenuId === item.id
                          ? "conversation-row-menu"
                          : undefined
                      }
                      onClick={(event) => {
                        event.stopPropagation();
                        toggleConversationMenu(item.id, event.currentTarget);
                      }}
                    >
                      ⋯
                    </button>
                  </div>
                </div>
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
            onClick={closeConversationDrawer}
          />
        ) : null}
        {openConversationMenuItem && conversationMenuPosition ? (
          <div
            id="conversation-row-menu"
            className="conversation-menu conversation-menu-floating"
            ref={conversationMenuRef}
            role="menu"
            style={{
              top: conversationMenuPosition.top,
              left: conversationMenuPosition.left,
            }}
          >
            {openConversationMenuItem.id === conversationId ? (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  closeConversationMenu();
                  void loadChatHistory();
                }}
                disabled={isChatLoading}
              >
                Reload history
              </button>
            ) : null}
            <button
              type="button"
              role="menuitem"
              className="danger-menu-item"
              onClick={() => {
                closeConversationMenu();
                void deleteConversationById(
                  openConversationMenuItem.id,
                  openConversationMenuItem.title,
                );
              }}
              disabled={isChatLoading}
            >
              Delete
            </button>
          </div>
        ) : null}

        <section className="trainer-card" aria-labelledby="trainer-heading">
          <div className="trainer-heading-row">
            <div>
              <p className="section-kicker">Daily trainer</p>
              <h2 id="trainer-heading">Chat with your private coach</h2>
            </div>
            <p
              className="context-chip"
              title={`Active chat context is selected from this session within a safe budget: ${contextWindow} of ${historyLimit} selected session context lines. New chat resets this active context.${latestToolEvidence ? " Latest answer used local Garmin/tool evidence." : " Latest answer has no local Garmin/tool evidence marker."}`}
              aria-label={`Active chat context${latestToolEvidence ? " with local Garmin evidence" : ""}`}
            >
              Active chat context
              {latestToolEvidence ? " · local evidence" : ""}
            </p>
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
              <div className="empty-chat empty-chat-hero">
                <p>
                  Start with the latest training question. Profile, memory,
                  Garmin data, diagnostics, and privacy controls are in
                  Settings.
                </p>
              </div>
            ) : null}
            {chatMessages.map((item) => (
              <div key={item.id} className={`chat-message ${item.role}`}>
                <div className="chat-meta">
                  <strong>{item.role === "user" ? "You" : "Trainer"}</strong>
                  <time dateTime={item.createdAt}>
                    {new Date(item.createdAt).toLocaleString()}
                  </time>
                </div>
                {item.role === "assistant" ? (
                  <AssistantContent content={item.content} />
                ) : (
                  <p>{item.content}</p>
                )}
                {hasVisibleGrounding(item.grounding) ? (
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
                <p>Trainer is thinking…</p>
              </div>
            ) : null}
            <div ref={transcriptBottomRef} aria-hidden="true" />
          </div>

          <div className="composer-dock" aria-label="Message composer">
            <label className="message-composer">
              <span className="visually-hidden">Message</span>
              <textarea
                aria-label="Message"
                ref={messageInputRef}
                placeholder="Ask about my latest hike, then try: what should I do tomorrow based on that?"
                value={message}
                disabled={isChatLoading}
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
            <div className="composer-actions">
              {lastFailedMessage && !isChatLoading ? (
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => submitChat(lastFailedMessage)}
                >
                  Retry
                </button>
              ) : null}
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
                onClick={sendChat}
                disabled={isChatLoading || !message.trim()}
              >
                {isChatLoading ? "Streaming…" : "Send"}
              </button>
            </div>
          </div>
        </section>
      </div>

      {settingsOpen ? (
        <div className="modal-layer" role="presentation">
          <button
            type="button"
            className="settings-backdrop"
            aria-label="Close settings"
            onClick={closeSettingsSheet}
          />
          <aside
            className="settings-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="settings-heading"
          >
            <header className="sheet-header">
              <div>
                <p className="section-kicker">Settings</p>
                <h2 id="settings-heading">Data &amp; settings</h2>
              </div>
              <button
                type="button"
                className="chrome-button"
                onClick={closeSettingsSheet}
                ref={settingsCloseRef}
              >
                Close
              </button>
            </header>

            <div className="settings-groups">
              <details className="settings-card profile-settings-card" open>
                <summary>
                  Profile / trainer grounding{" "}
                  <span
                    className={`pill ${isProfileDirty ? "dirty" : profileSaveState}`}
                  >
                    {profileSummary}
                  </span>
                </summary>
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
              </details>

              <details className="settings-card" open>
                <summary>
                  Learned memory{" "}
                  <span className="pill" aria-live="polite">
                    {memoryHealth?.status ?? "loading"} · {memoryItems.length}{" "}
                    loaded · {filteredMemories.length} shown
                  </span>
                </summary>
                <p>
                  Embedded SQLite memory stores concise user-derived
                  cross-session facts, preferences, corrections, and temporary
                  plans after complete persisted answers; it is not a transcript
                  archive. Current chats carry bounded same-chat continuity.
                  Ready memory needs Ollama, deterministic local embeddings, or
                  a valid OpenAI embedding key; DeepSeek chat alone does not
                  provide embeddings.
                </p>
                <p className="helper-text" role="status" aria-live="polite">
                  {memoryMessage}
                </p>
                <div className="button-row memory-actions">
                  <button
                    type="button"
                    onClick={() =>
                      setMemoryEnabled(!(memoryHealth?.enabled ?? false))
                    }
                    disabled={isMemoryLoading}
                  >
                    {memoryHealth?.enabled ? "Disable memory" : "Enable memory"}
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => loadMemories()}
                    disabled={isMemoryLoading}
                  >
                    Reload memories
                  </button>
                  <button
                    type="button"
                    className="danger-button"
                    onClick={() => actOnMemory("clear")}
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
                        Browsing applies only to the {memoryItems.length} loaded
                        local management records.
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
                        onChange={(event) =>
                          setMemorySearchQuery(event.target.value)
                        }
                        disabled={isMemoryLoading || !memoryItems.length}
                      />
                    </label>
                    <label>
                      Kind
                      <select
                        value={memoryKindFilter}
                        onChange={(event) =>
                          setMemoryKindFilter(
                            event.target.value as MemoryKindFilter,
                          )
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
                                    actOnMemory(
                                      "update",
                                      item.id,
                                      editingMemoryText,
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
                              onClick={() => actOnMemory("delete", item.id)}
                              disabled={isMemoryLoading}
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      ))
                    ) : memoryItems.length ? (
                      <p className="memory-empty-state">
                        No memories match the current search or kind filter.
                        Clear filters to return to the loaded list.
                      </p>
                    ) : (
                      <p className="memory-empty-state">
                        No inspectable semantic memories. If memory is enabled
                        and ready, explicit preferences, goals, corrections, or
                        useful temporary plans can create concise memories after
                        complete chats; ordinary transient turns may create
                        none.
                      </p>
                    )}
                  </div>
                </div>
              </details>

              <details className="settings-card" open>
                <summary>Garmin data and sync</summary>
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
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={refreshSummary}
                  >
                    Refresh import summary
                  </button>
                </div>
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
                      <dt>Cycling FTP</dt>
                      <dd>
                        {valueLabel(
                          athleteBaseline.values.cyclingFtpWatts,
                          " W",
                        )}
                        {athleteBaseline.values.cyclingFtpMeasuredOn
                          ? ` (${athleteBaseline.values.cyclingFtpMeasuredOn})`
                          : ""}
                        {athleteBaseline.values.cyclingFtpSourceStale
                          ? " — source marked stale by connector"
                          : ""}
                      </dd>
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
                        {athleteBaseline.values.configuredMaxHeartRateBpm
                          ? `${athleteBaseline.values.configuredMaxHeartRateBpm} bpm (Garmin FIT zones target)`
                          : "Unavailable from current Garmin source"}
                      </dd>
                    </div>
                    <div>
                      <dt>HR-zone boundaries</dt>
                      <dd>
                        {athleteBaseline.values.heartRateZones.boundaries.length
                          ? `${athleteBaseline.values.heartRateZones.status === "derived_from_garmin_max_hr" ? "Derived from Garmin max HR; official boundaries unavailable" : "Garmin configured"}: ${athleteBaseline.values.heartRateZones.boundaries.map((zone) => `Z${zone.zone} ${zone.lowerBpm}-${zone.upperBpm ?? "max"}`).join(", ")}`
                          : "Unavailable from current Garmin source"}
                      </dd>
                    </div>
                  </dl>
                ) : (
                  <p>Not available until the local summary loads.</p>
                )}
                <div className="detail-tools">
                  <label>
                    Garmin activity ID
                    <input
                      aria-label="Garmin activity ID"
                      placeholder="Garmin activity ID"
                      value={detailGarminId}
                      onChange={(event) =>
                        setDetailGarminId(event.target.value)
                      }
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
                </div>
              </details>

              {llmDebugTracesEnabled ? (
                <details className="settings-card llm-debug-card" open>
                  <summary>
                    LLM debug traces{" "}
                    <span className="pill">
                      {debugTraceMessages.length} assistant turns
                    </span>
                  </summary>
                  <p>
                    Local developer diagnostics are enabled by environment
                    configuration. Traces may include private normalized
                    Garmin/chat/tool context and are inspectable only on this
                    loopback app; Settings does not edit env files.
                  </p>
                  <div
                    className="debug-trace-list"
                    aria-label="LLM debug traces"
                  >
                    {debugTraceMessages.length ? (
                      debugTraceMessages.map((item) => (
                        <details className="debug-trace-item" key={item.id}>
                          <summary>{debugMessageSummary(item)}</summary>
                          {item.grounding?.debugTrace ? (
                            <pre>
                              {JSON.stringify(
                                item.grounding.debugTrace,
                                null,
                                2,
                              )}
                            </pre>
                          ) : (
                            <p>
                              No debug trace captured for this assistant
                              message.
                            </p>
                          )}
                        </details>
                      ))
                    ) : (
                      <p>
                        No assistant messages in the active conversation yet.
                      </p>
                    )}
                  </div>
                </details>
              ) : null}

              <details
                className="settings-card diagnostics-card"
                open={diagnosticsOpen}
                onToggle={(event) =>
                  setDiagnosticsOpen(event.currentTarget.open)
                }
              >
                <summary>
                  <span>Diagnostics / Current operation</span>
                  <span className={`pill ${status.kind}`}>{status.kind}</span>
                </summary>
                {diagnosticsOpen ? (
                  <pre className={`status ${status.kind}`} aria-live="polite">
                    {status.message}
                  </pre>
                ) : null}
              </details>

              <details className="settings-card danger-card" open>
                <summary>Safety, privacy, and deletion</summary>
                <p>
                  <strong>Not medical advice.</strong> Fitness guidance only;
                  seek qualified care for medical concerns.
                </p>
                <p>
                  Provider disclosure: selected conversation context may be sent
                  to the configured AI provider. Local safety boundary: run on
                  localhost/private loopback only, never public or LAN-exposed.
                  Garmin credential safety: authenticate out of band and never
                  paste passwords, token contents, provider keys, or raw
                  payloads into the app.
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
              </details>
            </div>
          </aside>
        </div>
      ) : null}
    </section>
  );
}
