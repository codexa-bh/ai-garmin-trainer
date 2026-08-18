"use client";

import {
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
  type UIEvent,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

type Status = { kind: "idle" | "ok" | "error" | "busy"; message: string };
type SyncRunState = {
  kind: "idle" | "running" | "completed" | "failed";
  lines: string[];
  finalMessage: string;
};
type TranscriptScrollSnapshot = {
  scrollTop: number;
  wasNearBottom: boolean;
};
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

type ConversationRenamePayload = {
  conversation: ConversationSummary;
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
type TrainingPlanPayload = {
  plan: TrainingPlan | null;
  stale: boolean;
  staleAfterDays: number;
};
type TrainingPlanResponse = { plan: TrainingPlan };
type TrainingPlan = {
  title: string;
  contentMarkdown: string;
  revisedAt: string;
};
type TrainingPlanState = "idle" | "loading" | "loaded" | "error";
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
type BodyMetricsAvailability =
  "complete" | "partial" | "unavailable" | "failed";
type BodyMetricsPayload = {
  availability: BodyMetricsAvailability;
  source: "garmin_mcp" | null;
  fetchedAt: string | null;
  lastAttemptAt: string | null;
  preservedPrevious: boolean;
  values: { weightKg: number | null; heightCm: number | null };
  currentWeightSource: "profile" | "weigh_in" | null;
  weighInAvailability: "available" | "unavailable" | "failed" | null;
  history: {
    availability: "available" | "unavailable" | "failed";
    source: "weigh_in" | "body_composition" | "mixed" | null;
    rangeStart: string | null;
    rangeEnd: string | null;
    count: number;
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
    intensityDays?: number;
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
  bodyMetrics: BodyMetricsPayload;
};
type ProfileFields = {
  goals: string;
  sports: string;
  constraints: string;
};
type HealthDashboardDay = {
  date: string;
  sleepMinutes: number | null;
  sleepScore: number | null;
  sleepDeepMinutes: number | null;
  sleepLightMinutes: number | null;
  sleepRemMinutes: number | null;
  sleepAwakeMinutes: number | null;
  sleepNapMinutes: number | null;
  restingHeartRate: number | null;
  hrvStatus: string | null;
  hrvMs: number | null;
  stressAvg: number | null;
  steps: number | null;
  calories: number | null;
  activeCalories: number | null;
  restingCalories: number | null;
  totalCalories: number | null;
  intensityMinutes: number | null;
  bodyBatteryAvg: number | null;
  bodyBatteryMorning: number | null;
  bodyBatteryEvening: number | null;
  availability: "complete" | "partial" | "missing";
};

type HealthDashboardMode = "daily" | "weekly" | "monthly";

type HealthDashboardPayload = {
  days: HealthDashboardDay[];
  latestDate: string | null;
};

const SLEEP_DETAIL_SOURCE_LIMITED =
  "Sleep score or stage details are unavailable from the Garmin sleep source for this day.";
const SLEEP_STAGE_FIELDS = [
  ["Deep", "sleepDeepMinutes"],
  ["Light", "sleepLightMinutes"],
  ["REM", "sleepRemMinutes"],
  ["Awake", "sleepAwakeMinutes"],
  ["Nap", "sleepNapMinutes"],
] as const;

type HealthDashboardLoadState = "idle" | "loading" | "loaded" | "error";
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
  effortDetailsProcessed?: number;
  detailTotal?: number | null;
  storedActivities?: number;
  storedHealthRows?: number;
  healthCoverage?: HealthCoveragePayload;
  detailCoverage?: DetailCoveragePayload;
  athleteAvailability?: AthleteBaselineAvailability;
  bodyMetricsAvailability?: BodyMetricsAvailability;
  athleteBaseline?: AthleteBaselinePayload;
  bodyMetrics?: BodyMetricsPayload;
};

type ActivityListItem = {
  garminId: string;
  name: string | null;
  label: string;
  sport: string;
  date: string;
  startedAt: string;
  durationSec: number | null;
  distanceMeters: number | null;
  elevationGainMeters: number | null;
  avgHeartRate: number | null;
  detailStatus: string | null;
};

type ActivityListPayload = {
  activities: ActivityListItem[];
  nextOffset?: number | null;
  totalApprox?: number;
  limit?: number;
  offset?: number;
};

const ACTIVITY_LIST_PAGE_SIZE = 100;
const ACTIVITY_LIST_SCROLL_THRESHOLD_PX = 96;

type ActivitySportIconDescriptor = {
  key: string;
  glyph: string;
  label: string;
  tone: "trail" | "walk" | "snow" | "cycle" | "ball" | "generic";
};

const ACTIVITY_SPORT_ICONS: Record<string, ActivitySportIconDescriptor> = {
  hiking: {
    key: "hiking",
    glyph: "⛰️",
    label: "Hiking",
    tone: "trail",
  },
  walking: {
    key: "walking",
    glyph: "🚶",
    label: "Walking",
    tone: "walk",
  },
  resort_snowboarding: {
    key: "resort_snowboarding",
    glyph: "🏂",
    label: "Resort snowboarding",
    tone: "snow",
  },
  backcountry_snowboarding: {
    key: "backcountry_snowboarding",
    glyph: "🏂",
    label: "Backcountry snowboarding",
    tone: "snow",
  },
  volleyball: {
    key: "volleyball",
    glyph: "🏐",
    label: "Volleyball",
    tone: "ball",
  },
  gravel_cycling: {
    key: "gravel_cycling",
    glyph: "🚴",
    label: "Gravel cycling",
    tone: "cycle",
  },
  mountaineering: {
    key: "mountaineering",
    glyph: "⛰️",
    label: "Mountaineering",
    tone: "trail",
  },
  other: {
    key: "other",
    glyph: "◆",
    label: "Other activity",
    tone: "generic",
  },
};

const FALLBACK_ACTIVITY_SPORT_ICON: ActivitySportIconDescriptor = {
  key: "unknown",
  glyph: "◆",
  label: "Activity type",
  tone: "generic",
};

export function activitySportIconDescriptor(
  sport: string | null | undefined,
): ActivitySportIconDescriptor {
  const key = (sport ?? "").trim().toLowerCase();
  return ACTIVITY_SPORT_ICONS[key] ?? FALLBACK_ACTIVITY_SPORT_ICON;
}

function ActivitySportIcon({ sport }: { sport: string }) {
  const icon = activitySportIconDescriptor(sport);
  return (
    <span
      aria-label={icon.label}
      className={`activity-sport-icon activity-sport-icon-${icon.tone}`}
      data-sport-icon={icon.key}
      role="img"
    >
      {icon.glyph}
    </span>
  );
}

const emptySyncRun: SyncRunState = {
  kind: "idle",
  lines: [],
  finalMessage: "No sync has run in this browser session yet.",
};

type ActivityDashboardPayload = {
  activity: ActivityListItem & {
    calories: number | null;
    maxHeartRate: number | null;
    steps: number | null;
    elevationLossMeters: number | null;
    trainingEffect: number | null;
    anaerobicTrainingEffect: number | null;
    trainingEffectLabel: string | null;
    trainingLoad: number | null;
    moderateIntensityMinutes: number | null;
    vigorousIntensityMinutes: number | null;
    totalIntensityMinutes: number | null;
    effortSource?: string | null;
  };
  detail: {
    status: string | null;
    hasHeartRate: boolean;
    hasElevation: boolean;
    hasLaps: boolean;
    recordCount: number;
    lapCount: number;
    unavailableReason?: string | null;
  };
  charts: {
    downsampled: boolean;
    sourcePointCount: number;
    pointCount: number;
    maxPoints: number;
    domainStartSec: number;
    domainEndSec: number | null;
    timeScaleStatus: "elapsed" | "timestamp_derived" | "sample_index_limited";
    timeScaleMessage: string | null;
    speed?: {
      status: "available" | "missing_speed" | "insufficient_speed";
      sourcePointCount: number;
      pointCount: number;
      message: string;
    };
    points: Array<{
      elapsedSec: number;
      heartRate: number | null;
      altitudeMeters: number | null;
      speedKmh?: number | null;
      gradePct: number | null;
    }>;
  };
  route: {
    status: "available" | "missing_gps" | "insufficient_points";
    sourcePointCount: number;
    pointCount: number;
    maxPoints: number;
    simplified: boolean;
    bounds: {
      minLat: number;
      maxLat: number;
      minLon: number;
      maxLon: number;
      minAltitudeMeters: number | null;
      maxAltitudeMeters: number | null;
    } | null;
    points: Array<{
      elapsedSec: number;
      lat: number;
      lon: number;
      altitudeMeters: number | null;
      gradePct: number | null;
    }>;
    message: string;
  };
  heartRateZones: {
    status:
      | "available"
      | "missing_zones"
      | "missing_heart_rate"
      | "insufficient_stream"
      | "missing_activity_zone_times";
    timeSource: "garmin_activity" | "local_stream" | null;
    zoneSource: "garmin_mcp" | "derived" | null;
    zoneStatus:
      "garmin_configured" | "derived_from_garmin_max_hr" | "unavailable";
    formula: string | null;
    classifiedSeconds: number;
    unclassifiedSeconds: number;
    noHeartRateSeconds: number;
    activityDurationSec: number | null;
    sourceTotalSeconds: number | null;
    message: string;
    buckets: Array<{
      zone: 1 | 2 | 3 | 4 | 5;
      label: string | null;
      lowerBpm: number;
      upperBpm: number | null;
      seconds: number;
      percent: number;
    }>;
  };
  laps: Array<{
    lapNumber: number;
    durationSec: number | null;
    distanceMeters: number | null;
    avgSpeedMps: number | null;
    avgHeartRate: number | null;
    maxHeartRate: number | null;
    elevationGainMeters: number | null;
    elevationLossMeters: number | null;
    avgPowerWatts: number | null;
    normalizedPowerWatts: number | null;
  }>;
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

const emptyBodyMetrics: BodyMetricsPayload = {
  availability: "unavailable",
  source: null,
  fetchedAt: null,
  lastAttemptAt: null,
  preservedPrevious: false,
  values: { weightKg: null, heightCm: null },
  currentWeightSource: null,
  weighInAvailability: null,
  history: {
    availability: "unavailable",
    source: null,
    rangeStart: null,
    rangeEnd: null,
    count: 0,
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

function formatSyncResultLine(event: SyncProgressEvent): string {
  const status = event.status ?? "completed";
  const activityCount =
    event.activitiesProcessed ?? event.activitiesImported ?? 0;
  const healthCount =
    event.healthDaysRefreshed ?? event.healthDaysImported ?? 0;
  const detailsProcessed = event.detailsProcessed ?? 0;
  const parts = [
    `processed activity records ${activityCount}`,
    `refreshed health dates ${healthCount}`,
    `details processed ${detailsProcessed}`,
    `stored totals ${event.storedActivities ?? "unknown"} activities, ${event.storedHealthRows ?? "unknown"} health rows`,
  ];
  if (event.healthCoverage) {
    parts.push(
      `health coverage ${event.healthCoverage.completeDays} complete, ${event.healthCoverage.partialDays} partial, ${event.healthCoverage.missingDays} source-unavailable`,
    );
  }
  if (event.detailCoverage) {
    parts.push(
      `detail coverage ${event.detailCoverage.available} available, ${event.detailCoverage.partial} partial, ${event.detailCoverage.pending} pending`,
    );
  }
  if (status !== "completed" && event.detail) {
    parts.push(`failure detail ${event.detail}`);
  }
  return `Result: ${status} — ${parts.join("; ")}.`;
}

function formatSyncFinalMessage(event: SyncProgressEvent): string {
  if (event.status !== "completed") {
    return `Sync failed. ${event.detail ?? "See the current-run log for details."}`;
  }
  const healthCoverage = event.healthCoverage
    ? ` Health coverage: ${event.healthCoverage.completeDays} complete, ${event.healthCoverage.partialDays} partial, ${event.healthCoverage.missingDays} source-unavailable; not estimated.`
    : "";
  const athleteAvailability =
    event.athleteBaseline?.availability ?? event.athleteAvailability;
  const bodyAvailability =
    event.bodyMetrics?.availability ?? event.bodyMetricsAvailability;
  const profileStatus = [
    athleteAvailability ? `athlete baseline ${athleteAvailability}` : null,
    bodyAvailability ? `body metrics ${bodyAvailability}` : null,
  ]
    .filter(Boolean)
    .join("; ");
  return `Sync complete. Summary refreshed for ${event.storedActivities ?? "unknown"} stored activities and ${event.storedHealthRows ?? "unknown"} health rows.${healthCoverage}${profileStatus ? ` ${profileStatus}.` : ""}`;
}

function formatHealthCoverageSummary(
  coverage: HealthCoveragePayload | undefined,
  legacyHealthDays: number,
): string {
  if (!coverage) return `${legacyHealthDays} health calendar rows`;
  const unavailable =
    coverage.missingDays > 0
      ? `${coverage.missingDays} source-unavailable, often pre-watch/pre-device or Garmin returned no daily-health metrics; not estimated`
      : "0 source-unavailable";
  const intensity = coverage.metrics.intensityDays ?? 0;
  return `${coverage.totalRows} health calendar rows (${coverage.completeDays} complete, ${coverage.partialDays} partial, ${unavailable}; populated metrics: sleep ${coverage.metrics.sleepDays}, HRV ${coverage.metrics.hrvDays}, intensity ${intensity})`;
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

function formatBodyMetricsSummary(metrics: BodyMetricsPayload): string {
  const weight =
    metrics.values.weightKg !== null
      ? `current weight imported (${metrics.values.weightKg} kg${metrics.currentWeightSource === "weigh_in" ? ", source: weigh-in" : metrics.currentWeightSource === "profile" ? ", source: profile" : ""})`
      : "current weight unavailable";
  const height =
    metrics.values.heightCm !== null
      ? `height imported (${metrics.values.heightCm} cm)`
      : "height unavailable";
  const history =
    metrics.history.availability === "available"
      ? `weight history ${metrics.history.count} rows (${metrics.history.rangeStart ?? "unknown"} to ${metrics.history.rangeEnd ?? "unknown"}${metrics.history.source ? `, source: ${metrics.history.source}` : ""})`
      : `weight history ${metrics.history.availability}`;
  const weighIns =
    metrics.weighInAvailability === "failed" ? " weigh-in refresh failed" : "";
  return `Body metrics ${metrics.availability}; ${weight}; ${height}; ${history};${weighIns} last attempt ${dateLabel(metrics.lastAttemptAt)}.`;
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

function numberLabel(
  value: number | null | undefined,
  fractionDigits = 0,
): string {
  return value == null
    ? "Unavailable"
    : value.toLocaleString(undefined, {
        maximumFractionDigits: fractionDigits,
        minimumFractionDigits: fractionDigits,
      });
}

function formatSleepMinutes(value: number | null): string {
  if (value == null) return "Unavailable";
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  if (hours > 0) return minutes > 0 ? `${hours} h ${minutes} m` : `${hours} h`;
  return `${minutes} m`;
}

function formatCalendarDate(dateValue: string): string {
  const parsed = new Date(`${dateValue}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return dateValue;
  return parsed.toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function healthAvailabilityLabel(
  availability: "complete" | "partial" | "missing",
): string {
  if (availability === "complete") return "Complete daily health record";
  if (availability === "partial")
    return "Partial day — some metrics unavailable";
  return "Source-unavailable day — no metrics available";
}

function sumNumbers(values: Array<number | null>): number | null {
  const present = values.filter(
    (value): value is number =>
      typeof value === "number" && Number.isFinite(value),
  );
  if (present.length === 0) return null;
  return present.reduce((total, value) => total + value, 0);
}

function averageNumbers(values: Array<number | null>): number | null {
  const present = values.filter(
    (value): value is number =>
      typeof value === "number" && Number.isFinite(value),
  );
  if (present.length === 0) return null;
  return present.reduce((total, value) => total + value, 0) / present.length;
}

function periodKey(
  date: string,
  mode: Exclude<HealthDashboardMode, "daily">,
): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return date;
  if (mode === "monthly") return date.slice(0, 7);
  const day = parsed.getUTCDay() || 7;
  parsed.setUTCDate(parsed.getUTCDate() + 1 - day);
  return parsed.toISOString().slice(0, 10);
}

function periodLabel(
  key: string,
  mode: Exclude<HealthDashboardMode, "daily">,
): string {
  if (mode === "monthly") {
    const parsed = new Date(`${key}-01T00:00:00Z`);
    return Number.isNaN(parsed.getTime())
      ? key
      : parsed.toLocaleDateString(undefined, {
          month: "short",
          year: "numeric",
          timeZone: "UTC",
        });
  }
  return `Week of ${formatCalendarDate(key)}`;
}

type HealthRollup = {
  key: string;
  label: string;
  dayCount: number;
  sleepMinutes: number | null;
  sleepScore: number | null;
  sleepDeepMinutes: number | null;
  sleepLightMinutes: number | null;
  sleepRemMinutes: number | null;
  sleepAwakeMinutes: number | null;
  sleepNapMinutes: number | null;
  steps: number | null;
  activeCalories: number | null;
  restingCalories: number | null;
  totalCalories: number | null;
  intensityMinutes: number | null;
  restingHeartRate: number | null;
  hrvMs: number | null;
  stressAvg: number | null;
};

function healthRollups(
  days: HealthDashboardDay[],
  mode: Exclude<HealthDashboardMode, "daily">,
): HealthRollup[] {
  const grouped = new Map<string, HealthDashboardDay[]>();
  for (const day of days.slice().reverse()) {
    const key = periodKey(day.date, mode);
    grouped.set(key, [...(grouped.get(key) ?? []), day]);
  }
  return Array.from(grouped.entries()).map(([key, rows]) => ({
    key,
    label: periodLabel(key, mode),
    dayCount: rows.length,
    sleepMinutes: averageNumbers(rows.map((day) => day.sleepMinutes)),
    sleepScore: averageNumbers(rows.map((day) => day.sleepScore)),
    sleepDeepMinutes: averageNumbers(rows.map((day) => day.sleepDeepMinutes)),
    sleepLightMinutes: averageNumbers(rows.map((day) => day.sleepLightMinutes)),
    sleepRemMinutes: averageNumbers(rows.map((day) => day.sleepRemMinutes)),
    sleepAwakeMinutes: averageNumbers(rows.map((day) => day.sleepAwakeMinutes)),
    sleepNapMinutes: averageNumbers(rows.map((day) => day.sleepNapMinutes)),
    steps: sumNumbers(rows.map((day) => day.steps)),
    activeCalories: sumNumbers(rows.map((day) => day.activeCalories)),
    restingCalories: sumNumbers(rows.map((day) => day.restingCalories)),
    totalCalories: sumNumbers(
      rows.map((day) => day.totalCalories ?? day.calories),
    ),
    intensityMinutes: sumNumbers(rows.map((day) => day.intensityMinutes)),
    restingHeartRate: averageNumbers(rows.map((day) => day.restingHeartRate)),
    hrvMs: averageNumbers(rows.map((day) => day.hrvMs)),
    stressAvg: averageNumbers(rows.map((day) => day.stressAvg)),
  }));
}

function HealthRollupChart({
  rollups,
  metric,
  title,
  unit,
  emptyMessage = "Unavailable for these periods.",
}: {
  rollups: HealthRollup[];
  metric: (rollup: HealthRollup) => number | null;
  title: string;
  unit: string;
  emptyMessage?: string;
}) {
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const values = rollups.map(metric);
  const numericValues = values.filter(
    (value): value is number =>
      typeof value === "number" && Number.isFinite(value),
  );
  if (numericValues.length === 0) {
    return (
      <div className="health-rollup-chart empty-state">
        <strong>{title}</strong>
        <p>{emptyMessage}</p>
      </div>
    );
  }
  const max = Math.max(...numericValues, 1);
  const scaleLabels = [max, max / 2, 0].map(
    (value) => `${numberLabel(value, value % 1 === 0 ? 0 : 1)} ${unit}`,
  );
  const valueLabels = values.map((value) =>
    value === null
      ? "Unavailable"
      : `${numberLabel(value, value % 1 === 0 ? 0 : 1)} ${unit}`,
  );
  const chartValues = rollups.map((rollup, index) => {
    const value = values[index];
    const height = value === null ? null : Math.max(8, (value / max) * 100);
    return {
      rollup,
      value,
      valueLabel: valueLabels[index],
      height,
    };
  });
  const activeValue =
    chartValues.find((item) => item.rollup.key === activeKey) ??
    chartValues.find((item) => item.value !== null) ??
    chartValues[0];
  const readoutId = `health-rollup-readout-${title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")}`;
  return (
    <div
      className="health-rollup-chart"
      role="group"
      aria-label={`${title} rollup chart`}
    >
      <strong>{title}</strong>
      <div className="health-rollup-scale" aria-hidden="true">
        {scaleLabels.map((label) => (
          <span key={`${title}-${label}`}>{label}</span>
        ))}
      </div>
      <div
        className="health-rollup-bars"
        role="group"
        aria-label={`${title} chart marks`}
      >
        {chartValues.map(({ rollup, value, valueLabel, height }) => (
          <button
            type="button"
            className="health-rollup-bar"
            data-chart-state={value === null ? "unavailable" : "available"}
            key={rollup.key}
            aria-describedby={readoutId}
            aria-label={`${rollup.label}: ${valueLabel.toLowerCase()}`}
            title={`${rollup.label}: ${valueLabel}`}
            onPointerEnter={() => setActiveKey(rollup.key)}
            onPointerLeave={() => setActiveKey(null)}
            onFocus={() => setActiveKey(rollup.key)}
            onBlur={() => setActiveKey(null)}
          >
            {height === null ? (
              <span className="health-rollup-bar-missing" aria-hidden="true" />
            ) : (
              <span
                className="health-rollup-bar-fill"
                aria-hidden="true"
                style={{ height: `${height}%` }}
              />
            )}
            <small>{rollup.label}</small>
          </button>
        ))}
      </div>
      <p className="health-rollup-readout" id={readoutId} aria-live="polite">
        {activeValue
          ? `${activeValue.rollup.label}: ${activeValue.valueLabel}`
          : "Focus or hover a period to read its value."}
      </p>
      <ul
        className="health-rollup-values"
        aria-label={`${title} period values`}
      >
        {chartValues.map(({ rollup, valueLabel }) => (
          <li key={`${rollup.key}-value`}>
            <span>{rollup.label}</span>
            <strong>{valueLabel}</strong>
          </li>
        ))}
      </ul>
    </div>
  );
}

function hasFiniteRollupMetric(
  rollups: HealthRollup[],
  metric: (rollup: HealthRollup) => number | null,
) {
  return rollups.some((rollup) => {
    const value = metric(rollup);
    return typeof value === "number" && Number.isFinite(value);
  });
}

function sleepStageEntries(day: HealthDashboardDay) {
  return SLEEP_STAGE_FIELDS.flatMap(([label, field]) => {
    const minutes = day[field];
    return typeof minutes === "number" && Number.isFinite(minutes)
      ? [{ label, minutes }]
      : [];
  });
}

function hasSleepStageRollup(rollups: HealthRollup[]): boolean {
  return SLEEP_STAGE_FIELDS.some(([, field]) =>
    hasFiniteRollupMetric(rollups, (rollup) => rollup[field]),
  );
}

function SleepWidget({ day }: { day: HealthDashboardDay }) {
  const stages = sleepStageEntries(day);
  const hasScore = typeof day.sleepScore === "number";
  const totalLabel =
    day.sleepMinutes == null
      ? "Unavailable"
      : formatSleepMinutes(day.sleepMinutes);
  return (
    <div
      className="health-widget health-sleep-widget"
      role="group"
      aria-label={`Sleep: ${totalLabel.toLowerCase()}`}
    >
      <p className="health-widget-label">Sleep</p>
      <p className="health-widget-value">
        {day.sleepMinutes == null ? (
          <span className="health-widget-unavailable">Unavailable</span>
        ) : (
          totalLabel
        )}
      </p>
      <div className="health-sleep-details" aria-label="Sleep source details">
        <span>
          Score{" "}
          <strong>
            {hasScore ? numberLabel(day.sleepScore) : "Unavailable"}
          </strong>
        </span>
        {stages.map((stage) => (
          <span key={stage.label}>
            {stage.label} <strong>{formatSleepMinutes(stage.minutes)}</strong>
          </span>
        ))}
      </div>
      {!hasScore || stages.length === 0 ? (
        <p className="health-widget-detail">{SLEEP_DETAIL_SOURCE_LIMITED}</p>
      ) : null}
    </div>
  );
}

function HealthWidget({
  label,
  value,
  unit,
  detail,
}: {
  label: string;
  value: string | null;
  unit?: string;
  detail?: string | null;
}) {
  const hasValue = value !== null;
  const accessibleValue = hasValue
    ? unit
      ? `${value} ${unit}`
      : value
    : "unavailable";
  return (
    <div
      className="health-widget"
      role="group"
      aria-label={`${label}: ${accessibleValue}`}
    >
      <p className="health-widget-label">{label}</p>
      <p className="health-widget-value">
        {hasValue ? (
          <>
            {value}
            {unit ? <span className="health-widget-unit">{unit}</span> : null}
          </>
        ) : (
          <span className="health-widget-unavailable">Unavailable</span>
        )}
      </p>
      {detail ? <p className="health-widget-detail">{detail}</p> : null}
    </div>
  );
}

function CaloriesWidget({ day }: { day: HealthDashboardDay }) {
  const total = day.totalCalories ?? day.calories;
  const splitTotal =
    day.activeCalories !== null && day.restingCalories !== null
      ? day.activeCalories + day.restingCalories
      : null;
  const showSplit =
    splitTotal !== null &&
    splitTotal > 0 &&
    day.activeCalories !== null &&
    day.restingCalories !== null;
  return (
    <div
      className="health-widget health-calories-widget"
      role="group"
      aria-label="Calories source split"
    >
      <p className="health-widget-label">Calories</p>
      <div className="health-split-values">
        <span>
          Active <strong>{finiteNumberLabel(day.activeCalories)}</strong>
        </span>
        <span>
          Resting <strong>{finiteNumberLabel(day.restingCalories)}</strong>
        </span>
        <span>
          Total <strong>{finiteNumberLabel(total)}</strong>
        </span>
      </div>
      {showSplit ? (
        <div
          className="health-calorie-split"
          aria-label="Active and resting calorie split"
        >
          <span style={{ flexGrow: day.activeCalories ?? 0 }} />
          <span style={{ flexGrow: day.restingCalories ?? 0 }} />
        </div>
      ) : (
        <p className="health-widget-trend-note">
          Split unavailable from source.
        </p>
      )}
    </div>
  );
}

function HealthDashboardView({
  days,
  selectedIndex,
  onSelectIndex,
}: {
  days: HealthDashboardDay[];
  selectedIndex: number;
  onSelectIndex: (index: number) => void;
}) {
  const [mode, setMode] = useState<HealthDashboardMode>("daily");
  const clampedIndex = Math.min(Math.max(selectedIndex, 0), days.length - 1);
  const day = days[clampedIndex];
  const isNewest = clampedIndex <= 0;
  const isOldest = clampedIndex >= days.length - 1;
  const hrvValue =
    day.hrvMs != null ? numberLabel(day.hrvMs, 1) : (day.hrvStatus ?? null);
  const hrvDetail = day.hrvMs != null && day.hrvStatus ? day.hrvStatus : null;
  const rollupMode = mode === "daily" ? null : mode;
  const rollups = rollupMode ? healthRollups(days, rollupMode).slice(-8) : [];
  const hasAnySleepStageRollup = hasSleepStageRollup(rollups);

  return (
    <div className="health-dashboard-body">
      <div
        className="health-mode-controls"
        role="tablist"
        aria-label="Health time range"
      >
        {(["daily", "weekly", "monthly"] as const).map((item) => (
          <button
            key={item}
            type="button"
            className={`chrome-button ${mode === item ? "active" : ""}`}
            onClick={() => setMode(item)}
            role="tab"
            aria-selected={mode === item}
          >
            {item[0].toUpperCase() + item.slice(1)}
          </button>
        ))}
      </div>

      {mode === "daily" ? (
        <>
          <div className="health-day-browser" aria-label="Browse health days">
            <button
              type="button"
              className="chrome-button"
              onClick={() => onSelectIndex(clampedIndex + 1)}
              disabled={isOldest}
              aria-label="Previous day"
            >
              ← Previous day
            </button>
            <div className="health-day-label">
              <p className="section-kicker">Selected day</p>
              <h2>{formatCalendarDate(day.date)}</h2>
              <p className="health-day-availability">
                {healthAvailabilityLabel(day.availability)}
              </p>
            </div>
            <button
              type="button"
              className="chrome-button"
              onClick={() => onSelectIndex(clampedIndex - 1)}
              disabled={isNewest}
              aria-label="Next day"
            >
              Next day →
            </button>
          </div>

          <div className="health-widget-grid">
            <SleepWidget day={day} />
            <HealthWidget
              label="Resting HR"
              value={
                day.restingHeartRate == null
                  ? null
                  : numberLabel(day.restingHeartRate)
              }
              unit="bpm"
            />
            <HealthWidget
              label="HRV"
              value={hrvValue}
              unit={day.hrvMs != null ? "ms" : undefined}
              detail={hrvDetail}
            />
            <HealthWidget
              label="Stress avg"
              value={day.stressAvg == null ? null : numberLabel(day.stressAvg)}
              unit="avg"
            />
            <HealthWidget
              label="Steps"
              value={day.steps == null ? null : numberLabel(day.steps)}
              unit="steps"
            />
            <CaloriesWidget day={day} />
            <HealthWidget
              label="Intensity minutes"
              value={
                day.intensityMinutes == null
                  ? null
                  : numberLabel(day.intensityMinutes)
              }
              unit="min"
              detail="Daily Garmin health source only"
            />
          </div>
        </>
      ) : (
        <div className="health-rollup-view">
          <div className="health-rollup-summary">
            <h2>
              {mode === "weekly"
                ? "Weekly Health rollups"
                : "Monthly Health rollups"}
            </h2>
            <p>
              Sleep duration and sleep stages are averages over available source
              days; steps, calories, and source intensity minutes remain period
              sums. Unavailable days are not estimated.
            </p>
          </div>
          <div className="health-rollup-grid">
            <HealthRollupChart
              rollups={rollups}
              title="Sleep duration avg"
              unit="min"
              metric={(rollup) => rollup.sleepMinutes}
            />
            <HealthRollupChart
              rollups={rollups}
              title="Sleep score avg"
              unit="avg"
              metric={(rollup) => rollup.sleepScore}
              emptyMessage="Source sleep scores are unavailable for these periods."
            />
            {hasAnySleepStageRollup ? (
              SLEEP_STAGE_FIELDS.map(([label, field]) => (
                <HealthRollupChart
                  key={field}
                  rollups={rollups}
                  title={`${label} sleep avg`}
                  unit="min"
                  metric={(rollup) => rollup[field]}
                />
              ))
            ) : (
              <div className="health-rollup-chart empty-state">
                <strong>Sleep stages</strong>
                <p>
                  Source sleep-stage durations are unavailable for these
                  periods.
                </p>
              </div>
            )}
            <HealthRollupChart
              rollups={rollups}
              title="Steps"
              unit="steps"
              metric={(rollup) => rollup.steps}
            />
            <HealthRollupChart
              rollups={rollups}
              title="Total calories"
              unit="kcal"
              metric={(rollup) => rollup.totalCalories}
            />
            <HealthRollupChart
              rollups={rollups}
              title="Intensity minutes"
              unit="min"
              metric={(rollup) => rollup.intensityMinutes}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function finiteNumberLabel(
  value: number | null | undefined,
  fractionDigits = 0,
): string {
  return typeof value === "number" && Number.isFinite(value)
    ? value.toLocaleString(undefined, {
        maximumFractionDigits: fractionDigits,
        minimumFractionDigits: fractionDigits,
      })
    : "Unavailable";
}

function finiteNumberUnitLabel(
  value: number | null | undefined,
  unit: string,
  fractionDigits = 0,
): string {
  const label = finiteNumberLabel(value, fractionDigits);
  return label === "Unavailable" ? label : `${label} ${unit}`;
}

function weightedIntensityMinutes(
  moderate: number | null | undefined,
  vigorous: number | null | undefined,
): number | null {
  if (
    typeof moderate !== "number" ||
    !Number.isFinite(moderate) ||
    typeof vigorous !== "number" ||
    !Number.isFinite(vigorous)
  ) {
    return null;
  }
  return moderate + 2 * vigorous;
}

function durationLabel(seconds: number | null): string {
  if (seconds === null) return "Unavailable";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes.toString().padStart(2, "0")}m`;
  return `${minutes}m`;
}

function durationDetailLabel(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = Math.round(seconds % 60);
  if (hours > 0) return `${hours}h ${minutes.toString().padStart(2, "0")}m`;
  if (minutes > 0)
    return `${minutes}m ${remainingSeconds.toString().padStart(2, "0")}s`;
  return `${remainingSeconds}s`;
}

function distanceLabel(meters: number | null): string {
  if (meters === null) return "Unavailable";
  return `${(meters / 1000).toLocaleString(undefined, {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  })} km`;
}

function metersLabel(meters: number | null): string {
  if (meters === null) return "Unavailable";
  return `${Math.round(meters).toLocaleString()} m`;
}

function paceSecondsLabel(secondsPerKm: number | null) {
  if (
    secondsPerKm === null ||
    !Number.isFinite(secondsPerKm) ||
    secondsPerKm <= 0
  )
    return "Unavailable";
  const roundedSeconds = Math.max(1, Math.round(secondsPerKm));
  const minutes = Math.floor(roundedSeconds / 60);
  const seconds = roundedSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}/km`;
}

function paceLabel(durationSec: number | null, distanceMeters: number | null) {
  if (durationSec === null || distanceMeters === null || distanceMeters <= 0)
    return "Unavailable";
  return paceSecondsLabel(durationSec / (distanceMeters / 1000));
}

function speedKmhLabel(speedKmh: number) {
  return `${speedKmh.toLocaleString(undefined, {
    maximumFractionDigits: 1,
  })} km/h`;
}

function averageSpeedLabel(avgSpeedMps: number | null | undefined) {
  if (
    avgSpeedMps === null ||
    avgSpeedMps === undefined ||
    !Number.isFinite(avgSpeedMps) ||
    avgSpeedMps < 0
  ) {
    return "Unavailable";
  }
  return speedKmhLabel(avgSpeedMps * 3.6);
}

type ChartSeriesPoint = {
  elapsedSec: number;
  value: number;
  readoutDetail: string | null;
  x: number;
  y: number;
};

type ChartPlotModel = {
  width: number;
  height: number;
  plotLeft: number;
  plotRight: number;
  plotTop: number;
  plotBottom: number;
  domainStartSec: number;
  domainEndSec: number;
};

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function chartPlotModel({
  width,
  height,
  domainStartSec,
  domainEndSec,
}: {
  width: number;
  height: number;
  domainStartSec: number;
  domainEndSec: number;
}): ChartPlotModel {
  return {
    width,
    height,
    plotLeft: 8,
    plotRight: width - 6,
    plotTop: 8,
    plotBottom: height - 16,
    domainStartSec,
    domainEndSec: Math.max(domainStartSec + 1, domainEndSec),
  };
}

function chartYCoordinate(
  value: number,
  minY: number,
  maxY: number,
  model: ChartPlotModel,
) {
  const yRange = Math.max(1, maxY - minY);
  const plotHeight = Math.max(1, model.plotBottom - model.plotTop);
  const boundedValue = clamp(value, minY, maxY);
  return model.plotBottom - ((boundedValue - minY) / yRange) * plotHeight;
}

function chartSeriesCoordinates(
  points: Array<{
    elapsedSec: number;
    value: number;
    readoutDetail: string | null;
  }>,
  model: ChartPlotModel,
  minY: number,
  maxY: number,
): ChartSeriesPoint[] {
  const xRange = Math.max(1, model.domainEndSec - model.domainStartSec);
  const plotWidth = Math.max(1, model.plotRight - model.plotLeft);
  return points.map((point) => ({
    ...point,
    x:
      model.plotLeft +
      ((clamp(point.elapsedSec, model.domainStartSec, model.domainEndSec) -
        model.domainStartSec) /
        xRange) *
        plotWidth,
    y: chartYCoordinate(point.value, minY, maxY, model),
  }));
}

function chartPolyline(points: ChartSeriesPoint[]) {
  return points
    .map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`)
    .join(" ");
}

function closestChartPoint(points: ChartSeriesPoint[], x: number) {
  return points.reduce((closest, point) =>
    Math.abs(point.x - x) < Math.abs(closest.x - x) ? point : closest,
  );
}

function chartNumberLabel(value: number, unit: string) {
  return `${Math.round(value).toLocaleString()} ${unit}`;
}

function chartValueLabel(
  point: Pick<ChartSeriesPoint, "elapsedSec" | "value">,
  formatValue: (value: number) => string,
  suffix?: string | null,
) {
  const selectedValue = `${durationLabel(point.elapsedSec)} elapsed · ${formatValue(point.value)}`;
  return suffix ? `${selectedValue} · ${suffix}` : selectedValue;
}

function gradeReadoutLabel(gradePct: number | null | undefined) {
  if (typeof gradePct !== "number" || !Number.isFinite(gradePct)) {
    return "Grade unavailable";
  }
  const rounded = Math.round(gradePct * 10) / 10;
  const sign = rounded > 0 ? "+" : "";
  return `Grade ${sign}${rounded.toFixed(1)}%`;
}

function finiteChartAverage(values: Array<number | null | undefined>) {
  const finiteValues = values.filter(
    (value): value is number =>
      typeof value === "number" && Number.isFinite(value),
  );
  if (finiteValues.length < 2) return null;
  return (
    finiteValues.reduce((total, value) => total + value, 0) /
    finiteValues.length
  );
}

function finiteHeartRateAverage(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function MiniLineChart({
  title,
  unit,
  points,
  valueKey,
  domainStartSec,
  domainEndSec,
  formatValue = (value) => chartNumberLabel(value, unit),
  averageValue,
  averageLabel = (value) => `Avg ${formatValue(value)}`,
  readoutDetail,
  note,
}: {
  title: string;
  unit: string;
  points: ActivityDashboardPayload["charts"]["points"];
  valueKey: "heartRate" | "altitudeMeters" | "speedKmh";
  domainStartSec: number;
  domainEndSec: number | null;
  formatValue?: (value: number) => string;
  averageValue?: number | null;
  averageLabel?: (value: number) => string;
  readoutDetail?: (
    point: ActivityDashboardPayload["charts"]["points"][number],
  ) => string | null;
  note?: string;
}) {
  const width = 320;
  const height = 120;
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const series = points
    .filter(
      (point) =>
        typeof point[valueKey] === "number" && Number.isFinite(point[valueKey]),
    )
    .map((point) => ({
      elapsedSec: point.elapsedSec,
      value: point[valueKey]!,
      readoutDetail: readoutDetail?.(point) ?? null,
    }));
  if (series.length < 2) {
    return (
      <div className="activity-chart empty-state">
        <strong>{title}</strong>
        <span>Not enough chartable data.</span>
      </div>
    );
  }
  const values = series.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const maxElapsed = Math.max(...series.map((point) => point.elapsedSec));
  const model = chartPlotModel({
    width,
    height,
    domainStartSec,
    domainEndSec: Math.max(domainEndSec ?? maxElapsed, maxElapsed),
  });
  const averageLine =
    typeof averageValue === "number" && Number.isFinite(averageValue)
      ? {
          y: chartYCoordinate(averageValue, min, max, model),
          label: averageLabel(averageValue),
        }
      : null;
  const chartPoints = chartSeriesCoordinates(series, model, min, max);
  const selectedPoint = chartPoints[activeIndex ?? 0];
  const readoutSuffix = [selectedPoint.readoutDetail, averageLine?.label]
    .filter((part): part is string => Boolean(part))
    .join(" · ");
  const polyline = chartPolyline(chartPoints);
  function setNearestPoint(x: number) {
    const boundedX = clamp(x, model.plotLeft, model.plotRight);
    const nearestPoint = closestChartPoint(chartPoints, boundedX);
    setActiveIndex(chartPoints.indexOf(nearestPoint));
  }
  function handlePointer(event: ReactPointerEvent<SVGSVGElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const renderedWidth = rect.width || width;
    const relativeX = ((event.clientX - rect.left) / renderedWidth) * width;
    setNearestPoint(relativeX);
  }
  function handleKeyDown(event: ReactKeyboardEvent<SVGSVGElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const currentIndex = activeIndex ?? 0;
    setActiveIndex(
      clamp(
        currentIndex + (event.key === "ArrowRight" ? 1 : -1),
        0,
        chartPoints.length - 1,
      ),
    );
  }

  return (
    <figure className="activity-chart" aria-label={`${title} chart`}>
      <figcaption>
        <strong>{title}</strong>
        <span>
          {formatValue(min)}–{formatValue(max)}
        </span>
      </figcaption>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        tabIndex={0}
        aria-label={`${title} over elapsed time`}
        onPointerEnter={handlePointer}
        onPointerMove={handlePointer}
        onPointerLeave={() => setActiveIndex(null)}
        onFocus={() => setActiveIndex(0)}
        onBlur={() => setActiveIndex(null)}
        onKeyDown={handleKeyDown}
      >
        {averageLine ? (
          <g className="activity-chart-average" aria-hidden="true">
            <line
              className="activity-chart-average-line"
              x1={model.plotLeft}
              x2={model.plotRight}
              y1={averageLine.y}
              y2={averageLine.y}
            />
          </g>
        ) : null}
        <polyline points={polyline} />
        {activeIndex !== null ? (
          <g className="activity-chart-cursor">
            <line
              x1={selectedPoint.x}
              x2={selectedPoint.x}
              y1={model.plotTop}
              y2={model.plotBottom}
            />
            <circle cx={selectedPoint.x} cy={selectedPoint.y} r={4} />
          </g>
        ) : null}
      </svg>
      <p className="activity-chart-readout" aria-live="polite">
        {chartValueLabel(selectedPoint, formatValue, readoutSuffix || null)}
      </p>
      {note ? <p className="activity-chart-note">{note}</p> : null}
    </figure>
  );
}

type RouteMapPoint = ActivityDashboardPayload["route"]["points"][number];

type RouteMapSvgPoint = RouteMapPoint & {
  x: number;
  y: number;
};

type RouteMapTile = {
  key: string;
  href: string;
  x: number;
  y: number;
};

type ExternalRouteMapView = {
  points: RouteMapSvgPoint[];
  tiles: RouteMapTile[];
};

type RouteMapPanOffset = {
  x: number;
  y: number;
};

type RouteMapDragState = {
  pointerId: number;
  lastClientX: number;
  lastClientY: number;
};

const ROUTE_MAP_WIDTH = 420;
const ROUTE_MAP_HEIGHT = 220;
const ROUTE_MAP_PADDING = 14;
const ROUTE_MAP_TILE_SIZE = 256;
const ROUTE_MAP_MIN_ZOOM = 2;
const ROUTE_MAP_MAX_ZOOM = 17;
const ROUTE_MAP_MIN_ZOOM_OFFSET = -1;
const ROUTE_MAP_MAX_ZOOM_OFFSET = 2;
const ROUTE_MAP_ZERO_PAN: RouteMapPanOffset = { x: 0, y: 0 };
const OPEN_TOPO_MAP_TILE_HOSTS = ["a", "b", "c"] as const;

function routeMapPanIsCentered(panOffset: RouteMapPanOffset) {
  return Math.round(panOffset.x) === 0 && Math.round(panOffset.y) === 0;
}

function routeMapCoordinates(
  route: ActivityDashboardPayload["route"],
  width: number,
  height: number,
  zoomOffset: number,
  panOffset: RouteMapPanOffset,
): RouteMapSvgPoint[] {
  if (!route.bounds) return [];
  const lonSpan = route.bounds.maxLon - route.bounds.minLon || 0.000001;
  const latSpan = route.bounds.maxLat - route.bounds.minLat || 0.000001;
  const usableWidth = width - ROUTE_MAP_PADDING * 2;
  const usableHeight = height - ROUTE_MAP_PADDING * 2;
  const scale = 2 ** zoomOffset;
  const centerX = width / 2;
  const centerY = height / 2;
  return route.points.map((point) => {
    const fittedX =
      ROUTE_MAP_PADDING +
      ((point.lon - route.bounds!.minLon) / lonSpan) * usableWidth;
    const fittedY =
      ROUTE_MAP_PADDING +
      (1 - (point.lat - route.bounds!.minLat) / latSpan) * usableHeight;
    return {
      ...point,
      x: centerX + (fittedX - centerX) * scale + panOffset.x,
      y: centerY + (fittedY - centerY) * scale + panOffset.y,
    };
  });
}

function clampLatitude(lat: number) {
  return Math.max(-85.05112878, Math.min(85.05112878, lat));
}

function lonLatToWorldPixel(lon: number, lat: number, zoom: number) {
  const scale = ROUTE_MAP_TILE_SIZE * 2 ** zoom;
  const sinLat = Math.sin((clampLatitude(lat) * Math.PI) / 180);
  return {
    x: ((lon + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * scale,
  };
}

function routeMapPixelBounds(
  route: ActivityDashboardPayload["route"],
  zoom: number,
) {
  if (!route.bounds) return null;
  const corners = [
    lonLatToWorldPixel(route.bounds.minLon, route.bounds.minLat, zoom),
    lonLatToWorldPixel(route.bounds.minLon, route.bounds.maxLat, zoom),
    lonLatToWorldPixel(route.bounds.maxLon, route.bounds.minLat, zoom),
    lonLatToWorldPixel(route.bounds.maxLon, route.bounds.maxLat, zoom),
  ];
  return {
    minX: Math.min(...corners.map((corner) => corner.x)),
    maxX: Math.max(...corners.map((corner) => corner.x)),
    minY: Math.min(...corners.map((corner) => corner.y)),
    maxY: Math.max(...corners.map((corner) => corner.y)),
  };
}

function routeMapZoom(
  route: ActivityDashboardPayload["route"],
  width: number,
  height: number,
) {
  const usableWidth = width - ROUTE_MAP_PADDING * 3;
  const usableHeight = height - ROUTE_MAP_PADDING * 3;
  let selectedZoom = ROUTE_MAP_MIN_ZOOM;
  for (let zoom = ROUTE_MAP_MIN_ZOOM; zoom <= ROUTE_MAP_MAX_ZOOM; zoom += 1) {
    const bounds = routeMapPixelBounds(route, zoom);
    if (!bounds) return selectedZoom;
    if (
      bounds.maxX - bounds.minX <= usableWidth &&
      bounds.maxY - bounds.minY <= usableHeight
    ) {
      selectedZoom = zoom;
    } else {
      break;
    }
  }
  return selectedZoom;
}

function externalRouteMapView(
  route: ActivityDashboardPayload["route"],
  width: number,
  height: number,
  zoomOffset: number,
  panOffset: RouteMapPanOffset,
): ExternalRouteMapView | null {
  if (!route.bounds) return null;
  const zoom = Math.max(
    ROUTE_MAP_MIN_ZOOM,
    Math.min(
      ROUTE_MAP_MAX_ZOOM,
      routeMapZoom(route, width, height) + zoomOffset,
    ),
  );
  const bounds = routeMapPixelBounds(route, zoom);
  if (!bounds) return null;

  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;
  const originX = centerX - width / 2 - panOffset.x;
  const originY = centerY - height / 2 - panOffset.y;
  const tileStartX = Math.floor(originX / ROUTE_MAP_TILE_SIZE);
  const tileEndX = Math.floor((originX + width) / ROUTE_MAP_TILE_SIZE);
  const tileStartY = Math.floor(originY / ROUTE_MAP_TILE_SIZE);
  const tileEndY = Math.floor((originY + height) / ROUTE_MAP_TILE_SIZE);
  const tileWrap = 2 ** zoom;

  const tiles: RouteMapTile[] = [];
  for (let tileX = tileStartX; tileX <= tileEndX; tileX += 1) {
    const wrappedTileX = ((tileX % tileWrap) + tileWrap) % tileWrap;
    for (let tileY = tileStartY; tileY <= tileEndY; tileY += 1) {
      if (tileY < 0 || tileY >= tileWrap) continue;
      const host =
        OPEN_TOPO_MAP_TILE_HOSTS[
          (zoom + wrappedTileX + tileY) % OPEN_TOPO_MAP_TILE_HOSTS.length
        ];
      tiles.push({
        key: `${zoom}-${wrappedTileX}-${tileY}`,
        href: `https://${host}.tile.opentopomap.org/${zoom}/${wrappedTileX}/${tileY}.png`,
        x: tileX * ROUTE_MAP_TILE_SIZE - originX,
        y: tileY * ROUTE_MAP_TILE_SIZE - originY,
      });
    }
  }

  return {
    tiles,
    points: route.points.map((point) => {
      const worldPoint = lonLatToWorldPixel(point.lon, point.lat, zoom);
      return {
        ...point,
        x: worldPoint.x - originX,
        y: worldPoint.y - originY,
      };
    }),
  };
}

function routeSegmentClass(point: RouteMapSvgPoint) {
  if (point.gradePct === null) return "route-map-segment";
  if (point.gradePct >= 3) return "route-map-segment climbing";
  if (point.gradePct <= -3) return "route-map-segment descending";
  return "route-map-segment rolling";
}

function RouteMap({ route }: { route: ActivityDashboardPayload["route"] }) {
  const [mapBackgroundFailed, setMapBackgroundFailed] = useState(false);
  const [zoomOffset, setZoomOffset] = useState(0);
  const [panOffset, setPanOffset] =
    useState<RouteMapPanOffset>(ROUTE_MAP_ZERO_PAN);
  const [isDragging, setIsDragging] = useState(false);
  const routeMapSvgRef = useRef<SVGSVGElement | null>(null);
  const dragStateRef = useRef<RouteMapDragState | null>(null);
  const externalMapView = useMemo(
    () =>
      externalRouteMapView(
        route,
        ROUTE_MAP_WIDTH,
        ROUTE_MAP_HEIGHT,
        zoomOffset,
        panOffset,
      ),
    [route, zoomOffset, panOffset],
  );
  const canLoadExternalMap = route.status === "available" && !!externalMapView;
  const externalMapActive = canLoadExternalMap && !mapBackgroundFailed;
  const localSvgPoints = routeMapCoordinates(
    route,
    ROUTE_MAP_WIDTH,
    ROUTE_MAP_HEIGHT,
    zoomOffset,
    panOffset,
  );
  const svgPoints = externalMapActive ? externalMapView.points : localSvgPoints;
  const first = svgPoints[0];
  const last = svgPoints[svgPoints.length - 1];
  const canPanRoute = route.status === "available" && svgPoints.length >= 2;
  const panIsCentered = routeMapPanIsCentered(panOffset);

  useEffect(() => {
    dragStateRef.current = null;
    setIsDragging(false);
    setMapBackgroundFailed(false);
    setZoomOffset(0);
    setPanOffset(ROUTE_MAP_ZERO_PAN);
  }, [route]);

  useEffect(() => {
    return () => {
      const dragState = dragStateRef.current;
      const routeMapSvg = routeMapSvgRef.current;
      if (dragState && routeMapSvg?.hasPointerCapture?.(dragState.pointerId)) {
        routeMapSvg.releasePointerCapture(dragState.pointerId);
      }
      dragStateRef.current = null;
    };
  }, []);

  const resetRouteMapView = () => {
    dragStateRef.current = null;
    setIsDragging(false);
    setZoomOffset(0);
    setPanOffset(ROUTE_MAP_ZERO_PAN);
  };

  const endRouteMapDrag = (pointerId?: number) => {
    const dragState = dragStateRef.current;
    if (
      !dragState ||
      (pointerId !== undefined && dragState.pointerId !== pointerId)
    ) {
      return;
    }
    const routeMapSvg = routeMapSvgRef.current;
    if (routeMapSvg?.hasPointerCapture?.(dragState.pointerId)) {
      routeMapSvg.releasePointerCapture(dragState.pointerId);
    }
    dragStateRef.current = null;
    setIsDragging(false);
  };

  const handleRouteMapPointerDown = (
    event: ReactPointerEvent<SVGSVGElement>,
  ) => {
    if (!canPanRoute || event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dragStateRef.current = {
      pointerId: event.pointerId,
      lastClientX: event.clientX,
      lastClientY: event.clientY,
    };
    setIsDragging(true);
  };

  const handleRouteMapPointerMove = (
    event: ReactPointerEvent<SVGSVGElement>,
  ) => {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    event.preventDefault();
    const deltaX = event.clientX - dragState.lastClientX;
    const deltaY = event.clientY - dragState.lastClientY;
    if (deltaX === 0 && deltaY === 0) return;
    dragStateRef.current = {
      ...dragState,
      lastClientX: event.clientX,
      lastClientY: event.clientY,
    };
    setPanOffset((current) => ({
      x: current.x + deltaX,
      y: current.y + deltaY,
    }));
  };

  return (
    <section className="route-map-card" aria-label="Local GPS route map">
      <div className="route-map-card-header">
        <h2>Route map</h2>
        {route.status === "available" && svgPoints.length >= 2 ? (
          <div
            className="route-map-controls"
            aria-label="Route map zoom controls"
          >
            <button
              type="button"
              onClick={() =>
                setZoomOffset((current) =>
                  Math.max(ROUTE_MAP_MIN_ZOOM_OFFSET, current - 1),
                )
              }
              disabled={zoomOffset <= ROUTE_MAP_MIN_ZOOM_OFFSET}
              aria-label="Zoom out route map"
            >
              −
            </button>
            <button
              type="button"
              onClick={resetRouteMapView}
              disabled={zoomOffset === 0 && panIsCentered}
              aria-label="Reset route map view"
            >
              Fit
            </button>
            <button
              type="button"
              onClick={() =>
                setZoomOffset((current) =>
                  Math.min(ROUTE_MAP_MAX_ZOOM_OFFSET, current + 1),
                )
              }
              disabled={zoomOffset >= ROUTE_MAP_MAX_ZOOM_OFFSET}
              aria-label="Zoom in route map"
            >
              +
            </button>
          </div>
        ) : null}
      </div>
      {route.status === "available" && svgPoints.length >= 2 ? (
        <>
          <svg
            ref={routeMapSvgRef}
            className={[
              "route-map-svg",
              externalMapActive ? "external-map" : "",
              canPanRoute ? "is-pannable" : "",
              isDragging ? "is-dragging" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            viewBox={`0 0 ${ROUTE_MAP_WIDTH} ${ROUTE_MAP_HEIGHT}`}
            data-zoom-offset={zoomOffset}
            data-pan-x={Math.round(panOffset.x)}
            data-pan-y={Math.round(panOffset.y)}
            data-dragging={isDragging ? "true" : "false"}
            onPointerDown={handleRouteMapPointerDown}
            onPointerMove={handleRouteMapPointerMove}
            onPointerUp={(event) => endRouteMapDrag(event.pointerId)}
            onPointerCancel={(event) => endRouteMapDrag(event.pointerId)}
            onLostPointerCapture={(event) => endRouteMapDrag(event.pointerId)}
            role="img"
            aria-label="GPS route map with OpenTopoMap background and start and finish markers"
          >
            <defs>
              <linearGradient id="route-map-bg" x1="0" x2="1" y1="0" y2="1">
                <stop offset="0%" stopColor="rgba(73, 214, 200, 0.16)" />
                <stop offset="100%" stopColor="rgba(90, 180, 255, 0.08)" />
              </linearGradient>
              <filter
                id="route-map-shadow"
                x="-20%"
                y="-20%"
                width="140%"
                height="140%"
              >
                <feDropShadow
                  dx="0"
                  dy="5"
                  stdDeviation="4"
                  floodColor="rgba(0, 0, 0, 0.42)"
                />
              </filter>
            </defs>
            <rect
              className={
                externalMapActive
                  ? "route-map-ground external-map"
                  : "route-map-ground"
              }
              x="0"
              y="0"
              width={ROUTE_MAP_WIDTH}
              height={ROUTE_MAP_HEIGHT}
              rx="16"
            />
            {externalMapActive ? (
              <g className="route-map-tiles" aria-hidden="true">
                {externalMapView.tiles.map((tile) => (
                  <image
                    key={tile.key}
                    href={tile.href}
                    x={tile.x}
                    y={tile.y}
                    width={ROUTE_MAP_TILE_SIZE}
                    height={ROUTE_MAP_TILE_SIZE}
                    preserveAspectRatio="xMidYMid slice"
                    onError={() => setMapBackgroundFailed(true)}
                  >
                    <title>OpenTopoMap map tile unavailable</title>
                  </image>
                ))}
              </g>
            ) : null}
            <g className="route-map-route-halo" aria-hidden="true">
              {svgPoints.slice(1).map((point, index) => {
                const previous = svgPoints[index];
                return (
                  <line
                    className="route-map-segment-halo"
                    key={`halo-${point.elapsedSec}-${index}`}
                    x1={previous.x}
                    x2={point.x}
                    y1={previous.y}
                    y2={point.y}
                  />
                );
              })}
            </g>
            <g className="route-map-route-line">
              {svgPoints.slice(1).map((point, index) => {
                const previous = svgPoints[index];
                return (
                  <line
                    className={routeSegmentClass(point)}
                    key={`${point.elapsedSec}-${index}`}
                    x1={previous.x}
                    x2={point.x}
                    y1={previous.y}
                    y2={point.y}
                  />
                );
              })}
            </g>
            {first ? (
              <g className="route-map-marker start">
                <circle cx={first.x} cy={first.y} r="4.5" />
                <text x={first.x + 7} y={first.y - 7}>
                  Start
                </text>
              </g>
            ) : null}
            {last ? (
              <g className="route-map-marker finish">
                <circle cx={last.x} cy={last.y} r="5.5" />
                <text x={last.x + 7} y={last.y + 15}>
                  Finish
                </text>
              </g>
            ) : null}
          </svg>
          <p className="route-map-attribution">
            {externalMapActive
              ? "Map data © OpenStreetMap contributors; map style © OpenTopoMap (CC-BY-SA). Tiles may reveal route area and client IP to OpenTopoMap."
              : mapBackgroundFailed
                ? "OpenTopoMap tiles failed; offline route shown."
                : "Offline route shown."}
          </p>
        </>
      ) : (
        <div className="route-map-empty-state">
          <strong>Route map unavailable</strong>
          <span>{route.message}</span>
        </div>
      )}
      <p className="visually-hidden">
        Route status {route.status}; source points {route.sourcePointCount};
        plotted points {route.pointCount}; maximum plotted points{" "}
        {route.maxPoints}.
      </p>
    </section>
  );
}

function HeartRateZoneTimeChart({
  summary,
}: {
  summary: ActivityDashboardPayload["heartRateZones"];
}) {
  const boundaryProvenance =
    summary.zoneStatus === "garmin_configured"
      ? "Garmin-configured HR-zone boundaries"
      : summary.zoneStatus === "derived_from_garmin_max_hr"
        ? "Estimated zones derived from Garmin max HR"
        : "HR-zone boundaries unavailable";
  const timeProvenance =
    summary.timeSource === "garmin_activity"
      ? "Garmin activity HR-zone totals"
      : summary.timeSource === "local_stream"
        ? "Local stream-derived fallback"
        : "HR-zone time unavailable";
  const totalMismatch =
    summary.status === "available" &&
    summary.activityDurationSec !== null &&
    summary.sourceTotalSeconds !== null &&
    Math.abs(summary.activityDurationSec - summary.sourceTotalSeconds) >= 60;
  const denominator = Math.max(1, summary.classifiedSeconds);
  const orderedBuckets = [...summary.buckets].sort(
    (left, right) => right.zone - left.zone,
  );
  return (
    <section className="hr-zone-card" aria-label="Time in HR zones">
      <div className="hr-zone-card-header">
        <div>
          <h2>Time in HR zones</h2>
        </div>
        <span>{timeProvenance}</span>
      </div>
      <p className="activity-dashboard-status">{summary.message}</p>
      {summary.status === "available" ? (
        <>
          <div className="hr-zone-bars">
            {orderedBuckets.map((bucket) => {
              const widthPercent = (bucket.seconds / denominator) * 100;
              return (
                <div className="hr-zone-row" key={bucket.zone}>
                  <div>
                    <strong>{bucket.label ?? `Zone ${bucket.zone}`}</strong>
                    <span>
                      {bucket.lowerBpm}–{bucket.upperBpm ?? "max"} bpm
                    </span>
                  </div>
                  <div
                    className={`hr-zone-bar hr-zone-bar-zone-${bucket.zone}`}
                    aria-hidden="true"
                  >
                    <span style={{ width: `${widthPercent}%` }} />
                  </div>
                  <p>
                    {durationDetailLabel(bucket.seconds)} · {bucket.percent}%
                  </p>
                </div>
              );
            })}
          </div>
          <p className="activity-dashboard-status">
            Source total:{" "}
            {durationDetailLabel(
              summary.sourceTotalSeconds ?? summary.classifiedSeconds,
            )}
            {summary.activityDurationSec !== null
              ? ` · activity duration ${durationDetailLabel(summary.activityDurationSec)}`
              : ""}
            . {boundaryProvenance}.
            {totalMismatch
              ? " Garmin's HR-zone source total differs from the activity duration, so unclassified/no-HR or moving-time differences may not be included."
              : ""}
            {summary.timeSource === "local_stream" &&
            summary.unclassifiedSeconds > 0
              ? ` Unclassified HR time: ${durationDetailLabel(summary.unclassifiedSeconds)}.`
              : ""}
            {summary.timeSource === "local_stream" &&
            summary.noHeartRateSeconds > 0
              ? ` No-HR stream time: ${durationDetailLabel(summary.noHeartRateSeconds)}.`
              : ""}
          </p>
        </>
      ) : (
        <div className="activity-chart empty-state">
          <strong>Time in HR zones unavailable</strong>
          <span>{summary.message}</span>
        </div>
      )}
    </section>
  );
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
  const [renameTarget, setRenameTarget] = useState<ConversationSummary | null>(
    null,
  );
  const [renameTitle, setRenameTitle] = useState("");
  const [isRenamingConversation, setIsRenamingConversation] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncRun, setSyncRun] = useState<SyncRunState>(emptySyncRun);
  const [importSummary, setImportSummary] =
    useState<ImportSummaryPayload | null>(null);
  const [isMainMenuOpen, setIsMainMenuOpen] = useState(false);
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
  const [bodyMetrics, setBodyMetrics] = useState<BodyMetricsPayload | null>(
    null,
  );
  const [bodyMetricsMessage, setBodyMetricsMessage] = useState(
    "Garmin body metrics will load from the local import summary.",
  );
  const [detailGarminId, setDetailGarminId] = useState("");
  const [activityDashboardOpen, setActivityDashboardOpen] = useState(false);
  const [activitySelectorCollapsed, setActivitySelectorCollapsed] =
    useState(false);
  const [trainingPlanOpen, setTrainingPlanOpen] = useState(false);
  const [syncOpen, setSyncOpen] = useState(false);
  const [healthDashboardOpen, setHealthDashboardOpen] = useState(false);
  const [healthDashboardData, setHealthDashboardData] =
    useState<HealthDashboardPayload | null>(null);
  const [healthDashboardState, setHealthDashboardState] =
    useState<HealthDashboardLoadState>("idle");
  const [healthDashboardError, setHealthDashboardError] = useState("");
  const [selectedHealthDayIndex, setSelectedHealthDayIndex] = useState(0);
  const [trainingPlan, setTrainingPlan] = useState<TrainingPlan | null>(null);
  const [trainingPlanStale, setTrainingPlanStale] = useState(true);
  const [trainingPlanStaleAfterDays, setTrainingPlanStaleAfterDays] =
    useState(14);
  const [trainingPlanState, setTrainingPlanState] =
    useState<TrainingPlanState>("idle");
  const [trainingPlanMessage, setTrainingPlanMessage] = useState(
    "Training Plan will load from local SQLite.",
  );
  const [trainingPlanEditing, setTrainingPlanEditing] = useState(false);
  const [trainingPlanTitleDraft, setTrainingPlanTitleDraft] = useState("");
  const [trainingPlanMarkdownDraft, setTrainingPlanMarkdownDraft] =
    useState("");
  const [trainingPlanSaving, setTrainingPlanSaving] = useState(false);
  const [activitySearchQuery, setActivitySearchQuery] = useState("");
  const [activities, setActivities] = useState<ActivityListItem[]>([]);
  const [activityListState, setActivityListState] = useState<
    "idle" | "loading" | "loaded" | "error"
  >("idle");
  const [activityListNextOffset, setActivityListNextOffset] = useState<
    number | null
  >(null);
  const [activityListTotalApprox, setActivityListTotalApprox] = useState<
    number | undefined
  >(undefined);
  const [isActivityListLoadingMore, setIsActivityListLoadingMore] =
    useState(false);
  const [activityListMessage, setActivityListMessage] = useState(
    "Open Activity charts to load synced activities.",
  );
  const [selectedActivityId, setSelectedActivityId] = useState<string | null>(
    null,
  );
  const [activityDashboard, setActivityDashboard] =
    useState<ActivityDashboardPayload | null>(null);
  const [activityDashboardState, setActivityDashboardState] = useState<
    "idle" | "loading" | "loaded" | "error"
  >("idle");
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
  const transcriptScrollSnapshotRef = useRef<TranscriptScrollSnapshot | null>(
    null,
  );
  const restoreTranscriptOnSectionReturnRef = useRef(false);
  const chatAbortRef = useRef<AbortController | null>(null);
  const conversationButtonRef = useRef<HTMLButtonElement>(null);
  const activityDashboardButtonRef = useRef<HTMLButtonElement>(null);
  const activityDashboardCloseRef = useRef<HTMLButtonElement>(null);
  const activityDashboardReturnFocusRef = useRef(false);
  const trainingPlanButtonRef = useRef<HTMLButtonElement>(null);
  const trainingPlanCloseRef = useRef<HTMLButtonElement>(null);
  const trainingPlanReturnFocusRef = useRef(false);
  const syncButtonRef = useRef<HTMLButtonElement>(null);
  const syncCloseRef = useRef<HTMLButtonElement>(null);
  const syncLogRef = useRef<HTMLPreElement>(null);
  const syncReturnFocusRef = useRef(false);
  const healthDashboardReturnFocusRef = useRef(false);
  const healthDashboardButtonRef = useRef<HTMLButtonElement | null>(null);
  const healthDashboardCloseRef = useRef<HTMLButtonElement | null>(null);
  const activityListRequestRef = useRef(0);
  const activityListQueryRef = useRef("");
  const activityListLoadedCountRef = useRef(0);
  const activityListLoadingMoreRef = useRef(false);
  const settingsButtonRef = useRef<HTMLButtonElement>(null);
  const settingsCloseRef = useRef<HTMLButtonElement>(null);
  const messageInputRef = useRef<HTMLTextAreaElement>(null);
  const conversationMenuRef = useRef<HTMLDivElement>(null);
  const mainMenuRef = useRef<HTMLDivElement>(null);
  const mainMenuToggleRef = useRef<HTMLButtonElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const renameReturnFocusRef = useRef<HTMLElement | null>(null);
  const isSyncingRef = useRef(false);

  const activeConversation = useMemo(
    () => conversations.find((item) => item.id === conversationId) ?? null,
    [conversationId, conversations],
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
    void loadTrainingPlan("startup", false);
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
  useLayoutEffect(() => {
    if (activityDashboardOpen || trainingPlanOpen || syncOpen) return;
    if (!restoreTranscriptOnSectionReturnRef.current) return;
    restoreTranscriptOnSectionReturnRef.current = false;
    restoreTranscriptScrollSnapshot();
  }, [activityDashboardOpen, trainingPlanOpen, syncOpen]);
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (renameTarget) {
        cancelConversationRename();
        return;
      }
      if (openConversationMenuId) {
        closeConversationMenu();
        return;
      }
      if (isMainMenuOpen) {
        setIsMainMenuOpen(false);
        mainMenuToggleRef.current?.focus();
        return;
      }
      if (settingsOpen) {
        setSettingsOpen(false);
        focusMainNavigationControl(settingsButtonRef);
        return;
      }
      if (syncOpen) {
        closeSyncView();
        return;
      }
      if (trainingPlanOpen) {
        closeTrainingPlan();
        return;
      }
      if (activityDashboardOpen) {
        closeActivityDashboard();
        return;
      }
      if (isConversationDrawerOpen) {
        setIsConversationDrawerOpen(false);
        focusMainNavigationControl(conversationButtonRef);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    isConversationDrawerOpen,
    openConversationMenuId,
    renameTarget,
    activityDashboardOpen,
    trainingPlanOpen,
    syncOpen,
    settingsOpen,
    isMainMenuOpen,
  ]);
  useEffect(() => {
    if (settingsOpen) settingsCloseRef.current?.focus();
  }, [settingsOpen]);
  useEffect(() => {
    if (activityDashboardOpen) {
      activityDashboardCloseRef.current?.focus();
      return;
    }
    if (activityDashboardReturnFocusRef.current) {
      activityDashboardReturnFocusRef.current = false;
      focusMainNavigationControl(activityDashboardButtonRef);
    }
  }, [activityDashboardOpen]);
  useEffect(() => {
    if (trainingPlanOpen) {
      trainingPlanCloseRef.current?.focus();
      void loadTrainingPlan("manual", false);
      return;
    }
    if (trainingPlanReturnFocusRef.current) {
      trainingPlanReturnFocusRef.current = false;
      focusMainNavigationControl(trainingPlanButtonRef);
    }
  }, [trainingPlanOpen]);
  useEffect(() => {
    if (syncOpen) {
      syncCloseRef.current?.focus();
      return;
    }
    if (syncReturnFocusRef.current) {
      syncReturnFocusRef.current = false;
      focusMainNavigationControl(syncButtonRef);
    }
  }, [syncOpen]);
  useEffect(() => {
    if (healthDashboardOpen) {
      healthDashboardCloseRef.current?.focus();
      return;
    }
    if (healthDashboardReturnFocusRef.current) {
      healthDashboardReturnFocusRef.current = false;
      focusMainNavigationControl(healthDashboardButtonRef);
    }
  }, [healthDashboardOpen]);
  useLayoutEffect(() => {
    const syncLog = syncLogRef.current;
    if (!syncLog || !syncOpen) return;
    syncLog.scrollTop = syncLog.scrollHeight;
  }, [syncOpen, syncRun.lines]);
  useEffect(() => {
    if (!activityDashboardOpen) return;
    void loadActivities(activitySearchQuery);
  }, [activityDashboardOpen, activitySearchQuery]);
  useEffect(() => {
    if (renameTarget) renameInputRef.current?.focus();
  }, [renameTarget]);

  useEffect(() => {
    if (!isMainMenuOpen) return;
    function closeOnOutsidePointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (mainMenuRef.current?.contains(target)) return;
      setIsMainMenuOpen(false);
    }
    document.addEventListener("pointerdown", closeOnOutsidePointerDown);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointerDown);
    };
  }, [isMainMenuOpen]);

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

  function focusMainNavigationControl(
    ref: RefObject<HTMLButtonElement | null>,
  ) {
    const isNarrowViewport =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(max-width: 720px)").matches;
    if (isNarrowViewport) {
      mainMenuToggleRef.current?.focus();
      return;
    }
    ref.current?.focus();
  }

  function toggleConversationHistory() {
    setIsMainMenuOpen(false);
    const isMobileViewport =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(max-width: 960px)").matches;
    if (isMobileViewport) {
      setIsConversationDrawerOpen(true);
    } else {
      setDesktopSidebarExpanded((expanded) => !expanded);
    }
  }

  function openSyncFromNavigation() {
    setIsMainMenuOpen(false);
    openSyncView();
  }

  function openHealthDashboardFromNavigation() {
    setIsMainMenuOpen(false);
    openHealthDashboard();
  }

  function openActivityDashboardFromNavigation() {
    setIsMainMenuOpen(false);
    openActivityDashboard();
  }

  function openTrainingPlanFromNavigation() {
    setIsMainMenuOpen(false);
    openTrainingPlan();
  }

  function openSettingsFromNavigation() {
    setIsMainMenuOpen(false);
    setSettingsOpen(true);
  }

  function toggleConversationMenu(itemId: string, trigger: HTMLButtonElement) {
    if (openConversationMenuId === itemId) {
      closeConversationMenu();
      return;
    }

    const rect = trigger.getBoundingClientRect();
    const menuWidth = 184;
    const menuHeight = itemId === conversationId ? 150 : 104;
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
    focusMainNavigationControl(settingsButtonRef);
  }

  function closeConversationDrawer() {
    closeConversationMenu();
    setIsConversationDrawerOpen(false);
    focusMainNavigationControl(conversationButtonRef);
  }

  function transcriptIsNearBottom(): boolean {
    const transcript = transcriptRef.current;
    if (!transcript) return true;
    const remaining =
      transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight;
    return remaining <= 96;
  }

  function rememberTranscriptFollowIntent() {
    const wasNearBottom = transcriptIsNearBottom();
    shouldAutoScrollRef.current = wasNearBottom;
    const transcript = transcriptRef.current;
    if (!transcript) return;
    transcriptScrollSnapshotRef.current = {
      scrollTop: transcript.scrollTop,
      wasNearBottom,
    };
  }

  function handleTranscriptScroll() {
    rememberTranscriptFollowIntent();
  }

  function captureTranscriptScrollSnapshot() {
    rememberTranscriptFollowIntent();
  }

  function restoreTranscriptScrollSnapshot(retryIfLayoutMissing = true) {
    const transcript = transcriptRef.current;
    const snapshot = transcriptScrollSnapshotRef.current;
    if (!transcript || !snapshot) return;
    if (snapshot.wasNearBottom) {
      if (transcript.scrollHeight === 0 && retryIfLayoutMissing) {
        scheduleTranscriptScrollRestoreRetry();
        return;
      }
      scrollTranscriptToBottom("auto");
      return;
    }

    const maxScrollTop = Math.max(
      0,
      transcript.scrollHeight - transcript.clientHeight,
    );
    if (maxScrollTop === 0 && snapshot.scrollTop > 0 && retryIfLayoutMissing) {
      scheduleTranscriptScrollRestoreRetry();
      return;
    }

    transcript.scrollTop = Math.min(
      Math.max(snapshot.scrollTop, 0),
      maxScrollTop,
    );
    shouldAutoScrollRef.current = transcriptIsNearBottom();
    transcriptScrollSnapshotRef.current = {
      scrollTop: transcript.scrollTop,
      wasNearBottom: shouldAutoScrollRef.current,
    };
  }

  function scheduleTranscriptScrollRestoreRetry() {
    if (typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(() =>
        restoreTranscriptScrollSnapshot(false),
      );
      return;
    }
    restoreTranscriptScrollSnapshot(false);
  }

  function openActivityDashboard() {
    captureTranscriptScrollSnapshot();
    setActivityDashboardOpen(true);
  }

  function openTrainingPlan() {
    captureTranscriptScrollSnapshot();
    setTrainingPlanOpen(true);
  }

  function openSyncView() {
    captureTranscriptScrollSnapshot();
    setSyncOpen(true);
  }

  function openHealthDashboard() {
    captureTranscriptScrollSnapshot();
    setHealthDashboardOpen(true);
    if (healthDashboardData === null && healthDashboardState === "idle") {
      void loadHealthDashboard();
    }
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
    let logLines = ["Sync now: starting…"];
    setSyncRun({
      kind: "running",
      lines: logLines,
      finalMessage: "Sync in progress…",
    });
    setStatus({ kind: "busy", message: "Sync now: starting…" });
    try {
      const response = await fetch("/api/sync", { method: "POST" });
      if (!response.ok || !response.body) {
        const body = await readResponse(response);
        const message = `Sync now: failed (${response.status})\n${body}`;
        logLines = [...logLines, message].slice(-20);
        setSyncRun({ kind: "failed", lines: logLines, finalMessage: message });
        setStatus({ kind: "error", message });
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finalKind: Status["kind"] = "ok";
      let finalMessage = "Sync in progress…";

      const appendLine = (line: string, nextFinalMessage?: string) => {
        logLines = [...logLines, line].slice(-20);
        finalMessage = nextFinalMessage ?? "Sync in progress…";
        const message = logLines.join("\n");
        setSyncRun({
          kind: "running",
          lines: logLines,
          finalMessage,
        });
        setStatus({
          kind: finalKind === "error" ? "error" : "busy",
          message,
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
              formatSyncResultLine(event),
              formatSyncFinalMessage(event),
            );
          } else {
            appendLine(formatSyncProgressLine(event));
          }
        }
      }
      await loadImportSummary("sync", false);
      if (finalKind === "ok" && (healthDashboardOpen || healthDashboardData)) {
        await loadHealthDashboard({ preserveSelectedDate: true });
      }
      setSyncRun({
        kind: finalKind === "ok" ? "completed" : "failed",
        lines: logLines.length ? logLines : ["Sync complete."],
        finalMessage,
      });
      setStatus({ kind: finalKind, message: finalMessage });
    } catch (error) {
      const message = `Sync now failed: ${error instanceof Error ? error.message : "unknown error"}`;
      const nextLines = [...logLines, message].slice(-20);
      setSyncRun({ kind: "failed", lines: nextLines, finalMessage: message });
      setStatus({ kind: "error", message });
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
      const nextBodyMetrics = payload.bodyMetrics ?? emptyBodyMetrics;
      const nextSummary = {
        ...payload,
        athleteBaseline: nextBaseline,
        bodyMetrics: nextBodyMetrics,
      };
      setImportSummary(nextSummary);
      setAthleteBaseline(nextBaseline);
      setBodyMetrics(nextBodyMetrics);
      setAthleteBaselineMessage(formatAthleteBaselineSummary(nextBaseline));
      setBodyMetricsMessage(formatBodyMetricsSummary(nextBodyMetrics));
      if (showStatus)
        setStatus({
          kind: "ok",
          message: `Import summary: ${payload.activities} stored activities, ${formatHealthCoverageSummary(payload.healthCoverage, payload.healthDays)}, detail coverage ${formatDetailCoverageSummary(payload.detailCoverage, payload.detailedActivities)}, athlete baseline ${nextBaseline.availability}, body metrics ${nextBodyMetrics.availability}.`,
        });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "unknown error";
      setAthleteBaselineMessage(
        `Athlete baseline summary failed: ${errorMessage}`,
      );
      setBodyMetricsMessage(`Body metrics summary failed: ${errorMessage}`);
      if (showStatus || trigger === "manual")
        setStatus({
          kind: "error",
          message: `Import summary failed: ${errorMessage}`,
        });
    }
  }

  async function refreshSummary() {
    await loadImportSummary("manual");
  }

  async function loadHealthDashboard(
    options: { preserveSelectedDate?: boolean } = {},
  ) {
    setHealthDashboardState("loading");
    const selectedDate = options.preserveSelectedDate
      ? healthDashboardData?.days[selectedHealthDayIndex]?.date
      : null;
    try {
      const payload = await readJsonResponse<HealthDashboardPayload>(
        await fetch("/api/health-dashboard", { method: "GET" }),
      );
      setHealthDashboardData(payload);
      const preservedIndex = selectedDate
        ? payload.days.findIndex((day) => day.date === selectedDate)
        : -1;
      setSelectedHealthDayIndex(preservedIndex >= 0 ? preservedIndex : 0);
      setHealthDashboardError("");
      setHealthDashboardState("loaded");
    } catch (error) {
      setHealthDashboardError(
        error instanceof Error
          ? `Health dashboard failed: ${error.message}`
          : "Health dashboard failed: unknown error",
      );
      setHealthDashboardState("error");
    }
  }

  function closeActivityDashboard() {
    activityDashboardReturnFocusRef.current = true;
    restoreTranscriptOnSectionReturnRef.current = true;
    setActivityDashboardOpen(false);
  }

  function closeTrainingPlan() {
    trainingPlanReturnFocusRef.current = true;
    restoreTranscriptOnSectionReturnRef.current = true;
    setTrainingPlanOpen(false);
    setTrainingPlanEditing(false);
  }

  function closeSyncView() {
    syncReturnFocusRef.current = true;
    restoreTranscriptOnSectionReturnRef.current = true;
    setSyncOpen(false);
  }

  function closeHealthDashboard() {
    healthDashboardReturnFocusRef.current = true;
    restoreTranscriptOnSectionReturnRef.current = true;
    setHealthDashboardOpen(false);
  }

  function applyTrainingPlanPayload(payload: TrainingPlanPayload) {
    setTrainingPlan(payload.plan);
    setTrainingPlanStale(payload.stale);
    setTrainingPlanStaleAfterDays(payload.staleAfterDays);
    setTrainingPlanState("loaded");
    setTrainingPlanTitleDraft(payload.plan?.title ?? "Training Plan");
    setTrainingPlanMarkdownDraft(payload.plan?.contentMarkdown ?? "");
    setTrainingPlanMessage(
      payload.plan
        ? payload.stale
          ? `Training Plan is older than ${payload.staleAfterDays} days. Review or revise when useful.`
          : "Training Plan loaded from local SQLite."
        : "No Training Plan saved yet. Ask chat to create one or write it manually.",
    );
  }

  async function loadTrainingPlan(
    trigger: "startup" | "manual" | "chat-save",
    showStatus = true,
  ) {
    setTrainingPlanState("loading");
    if (showStatus)
      setStatus({ kind: "busy", message: "Training Plan: loading…" });
    try {
      const payload = await readJsonResponse<TrainingPlanPayload>(
        await fetch("/api/training-plan", { method: "GET" }),
      );
      applyTrainingPlanPayload(payload);
      if (showStatus)
        setStatus({
          kind: "ok",
          message: payload.plan
            ? `Training Plan: loaded ${payload.plan.title}.`
            : "Training Plan: no saved plan yet.",
        });
    } catch (error) {
      setTrainingPlanState("error");
      setTrainingPlanMessage(
        `Training Plan load failed: ${error instanceof Error ? error.message : "unknown error"}`,
      );
      if (showStatus || trigger === "manual")
        setStatus({
          kind: "error",
          message: `Training Plan load failed: ${error instanceof Error ? error.message : "unknown error"}`,
        });
    }
  }

  function startTrainingPlanEdit() {
    setTrainingPlanTitleDraft(trainingPlan?.title ?? "Training Plan");
    setTrainingPlanMarkdownDraft(trainingPlan?.contentMarkdown ?? "");
    setTrainingPlanEditing(true);
  }

  function cancelTrainingPlanEdit() {
    setTrainingPlanTitleDraft(trainingPlan?.title ?? "Training Plan");
    setTrainingPlanMarkdownDraft(trainingPlan?.contentMarkdown ?? "");
    setTrainingPlanEditing(false);
    setTrainingPlanMessage(
      "Training Plan edit cancelled; saved content is unchanged.",
    );
  }

  async function saveTrainingPlan() {
    if (trainingPlanSaving) return;
    const contentMarkdown = trainingPlanMarkdownDraft.trim();
    if (!contentMarkdown) {
      setTrainingPlanMessage(
        "Training Plan save failed: Markdown content is required.",
      );
      return;
    }
    setTrainingPlanSaving(true);
    setTrainingPlanMessage("Saving Training Plan to local SQLite…");
    setStatus({ kind: "busy", message: "Training Plan: saving…" });
    try {
      const payload = await readJsonResponse<TrainingPlanResponse>(
        await fetch("/api/training-plan", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            title: trainingPlanTitleDraft,
            contentMarkdown,
          }),
        }),
      );
      setTrainingPlan(payload.plan);
      setTrainingPlanStale(false);
      setTrainingPlanTitleDraft(payload.plan.title);
      setTrainingPlanMarkdownDraft(payload.plan.contentMarkdown);
      setTrainingPlanEditing(false);
      setTrainingPlanState("loaded");
      setTrainingPlanMessage(
        "Training Plan saved and rendered from local SQLite.",
      );
      setStatus({ kind: "ok", message: "Training Plan: saved." });
    } catch (error) {
      setTrainingPlanMessage(
        `Training Plan save failed; edits are still in the form: ${error instanceof Error ? error.message : "unknown error"}`,
      );
      setStatus({
        kind: "error",
        message: `Training Plan save failed: ${error instanceof Error ? error.message : "unknown error"}`,
      });
    } finally {
      setTrainingPlanSaving(false);
    }
  }

  async function loadActivities(query: string, offset = 0, append = false) {
    const trimmed = query.trim();
    if (append) {
      if (activityListLoadingMoreRef.current || activityListNextOffset === null)
        return;
      activityListLoadingMoreRef.current = true;
      setIsActivityListLoadingMore(true);
    } else {
      activityListRequestRef.current += 1;
      activityListQueryRef.current = trimmed;
      activityListLoadedCountRef.current = 0;
      setActivities([]);
      setActivityListNextOffset(null);
      setActivityListTotalApprox(undefined);
      setActivityListState("loading");
      setActivityListMessage("Loading synced activities…");
    }

    const requestGeneration = activityListRequestRef.current;
    try {
      const params = new URLSearchParams({
        limit: String(ACTIVITY_LIST_PAGE_SIZE),
        offset: String(offset),
      });
      if (trimmed) params.set("q", trimmed);
      const payload = await readJsonResponse<ActivityListPayload>(
        await fetch(`/api/activities?${params.toString()}`),
      );
      if (
        requestGeneration !== activityListRequestRef.current ||
        trimmed !== activityListQueryRef.current
      ) {
        return;
      }

      const loadedCount = append
        ? activityListLoadedCountRef.current + payload.activities.length
        : payload.activities.length;
      activityListLoadedCountRef.current = loadedCount;
      setActivities((current) =>
        append ? [...current, ...payload.activities] : payload.activities,
      );
      setActivityListNextOffset(payload.nextOffset ?? null);
      setActivityListTotalApprox(payload.totalApprox);
      setActivityListState("loaded");
      if (!loadedCount) {
        setActivityListMessage(
          trimmed
            ? "No synced activities match that search."
            : "No synced Garmin activities are imported yet.",
        );
        return;
      }
      setActivityListMessage(
        `${loadedCount} of ${payload.totalApprox ?? loadedCount} synced activities loaded.`,
      );
    } catch (error) {
      if (
        requestGeneration !== activityListRequestRef.current ||
        trimmed !== activityListQueryRef.current
      ) {
        return;
      }
      setActivityListState("error");
      setActivityListMessage(
        append
          ? `More activities could not be loaded: ${error instanceof Error ? error.message : "unknown error"}`
          : `Activity search failed: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    } finally {
      if (append) {
        activityListLoadingMoreRef.current = false;
        setIsActivityListLoadingMore(false);
      }
    }
  }

  function handleActivityListScroll(event: UIEvent<HTMLDivElement>) {
    const target = event.currentTarget;
    const remaining =
      target.scrollHeight - target.scrollTop - target.clientHeight;
    if (remaining > ACTIVITY_LIST_SCROLL_THRESHOLD_PX) return;
    if (activityListState === "loading" || isActivityListLoadingMore) return;
    if (activityListNextOffset === null) return;
    void loadActivities(activitySearchQuery, activityListNextOffset, true);
  }

  async function selectActivityDashboard(garminId: string) {
    setSelectedActivityId(garminId);
    setActivityDashboardState("loading");
    try {
      const payload = await readJsonResponse<ActivityDashboardPayload>(
        await fetch(
          `/api/activities/${encodeURIComponent(garminId)}/dashboard`,
        ),
      );
      setActivityDashboard(payload);
      setActivityDashboardState("loaded");
    } catch (error) {
      setActivityDashboard(null);
      setActivityDashboardState("error");
      setStatus({
        kind: "error",
        message: `Activity dashboard failed: ${error instanceof Error ? error.message : "unknown error"}`,
      });
    }
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

  function closeConversationRenameDialog(restoreFocus = true) {
    setRenameTarget(null);
    setRenameTitle("");
    setIsRenamingConversation(false);
    if (restoreFocus) renameReturnFocusRef.current?.focus();
    renameReturnFocusRef.current = null;
  }

  function cancelConversationRename() {
    closeConversationRenameDialog();
  }

  function startConversationRename(
    target: ConversationSummary,
    trigger?: HTMLElement,
  ) {
    closeConversationMenu();
    if (isChatLoading) {
      setStatus({
        kind: "error",
        message:
          "Cancel or finish the current streamed answer before renaming.",
      });
      return;
    }
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
    if (isChatLoading) {
      setStatus({
        kind: "error",
        message:
          "Cancel or finish the current streamed answer before renaming.",
      });
      return;
    }
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
      setConversations((items) =>
        items.map((item) => (item.id === renamed.id ? renamed : item)),
      );
      closeConversationRenameDialog();
      setStatus({
        kind: "ok",
        message:
          "Conversation renamed locally. Messages, Garmin data, Profile, and saved memories stay unchanged.",
      });
    } catch (error) {
      setIsRenamingConversation(false);
      setStatus({
        kind: "error",
        message: `Conversation rename failed: ${error instanceof Error ? error.message : "unknown error"}`,
      });
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
        setLlmDebugTracesEnabled(event.llmDebugTracesEnabled === true);
        const memorySuffix =
          event.memoryProposal.status === "pending"
            ? ` Pending learned-memory proposal created: ${event.memoryProposal.value}`
            : event.memoryProposal.status === "skipped"
              ? ` Memory not proposed: ${event.memoryProposal.reason}`
              : "";
        const savedTrainingPlan =
          event.assistantMessage.grounding?.tool === "saveTrainingPlan";
        void event.memoryProposal;
        void loadMemories(false);
        void loadConversations(false);
        if (savedTrainingPlan) void loadTrainingPlan("chat-save", false);
        setStatus({
          kind: "ok",
          message: `Chat: streamed response complete.${memorySuffix}`,
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
        if (payload.memoryProposal) void loadMemories(false);
        if (payload.toolEvidence?.tool === "saveTrainingPlan")
          void loadTrainingPlan("chat-save", false);
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

  const syncPillKind: Status["kind"] = isSyncing
    ? "busy"
    : syncRun.kind === "completed"
      ? "ok"
      : syncRun.kind === "failed"
        ? "error"
        : "idle";
  const syncPillLabel = isSyncing
    ? "Syncing"
    : syncRun.kind === "completed"
      ? "Complete"
      : syncRun.kind === "failed"
        ? "Failed"
        : "Ready";
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
      className={`dashboard-shell ${desktopSidebarExpanded ? "" : "sidebar-collapsed"} ${activityDashboardOpen ? "activity-dashboard-active" : ""} ${trainingPlanOpen ? "training-plan-active" : ""} ${syncOpen ? "sync-view-active" : ""} ${healthDashboardOpen ? "health-dashboard-active" : ""}`}
      aria-label="AI trainer dashboard"
    >
      {!activityDashboardOpen &&
      !trainingPlanOpen &&
      !syncOpen &&
      !healthDashboardOpen ? (
        <header className="app-topbar">
          <div className="app-brand">
            <h1 className="app-title" title="Garmin AI Trainer">
              Garmin AI Trainer
            </h1>
          </div>
          <nav className="app-nav" aria-label="Main navigation">
            <button
              type="button"
              className="chrome-button sidebar-toggle"
              onClick={toggleConversationHistory}
              ref={conversationButtonRef}
              aria-label="Toggle conversation history"
              aria-expanded={desktopSidebarExpanded || isConversationDrawerOpen}
            >
              Conversations
            </button>
            <button
              type="button"
              className="chrome-button"
              onClick={openActivityDashboardFromNavigation}
              ref={activityDashboardButtonRef}
              aria-label="Activities"
              aria-expanded={activityDashboardOpen}
            >
              Activities
            </button>
            <button
              type="button"
              className="chrome-button"
              onClick={openHealthDashboardFromNavigation}
              ref={healthDashboardButtonRef}
              aria-label="Health"
              aria-expanded={healthDashboardOpen}
            >
              Health
            </button>
            <button
              type="button"
              className="chrome-button"
              onClick={openTrainingPlanFromNavigation}
              ref={trainingPlanButtonRef}
              aria-label="Training Plan"
              aria-expanded={trainingPlanOpen}
            >
              Training Plan
            </button>
            <button
              type="button"
              className="chrome-button sync-now-button"
              onClick={openSyncFromNavigation}
              ref={syncButtonRef}
              aria-label="Sync"
              aria-expanded={syncOpen}
            >
              {isSyncing ? "Sync · syncing" : "Sync"}
            </button>
            <button
              type="button"
              className="chrome-button"
              onClick={openSettingsFromNavigation}
              ref={settingsButtonRef}
              aria-label="Data & settings"
            >
              Settings
            </button>
          </nav>
          <div className="app-mobile-menu" ref={mainMenuRef}>
            <button
              type="button"
              className="chrome-button app-menu-toggle"
              onClick={() => setIsMainMenuOpen((open) => !open)}
              ref={mainMenuToggleRef}
              aria-haspopup="menu"
              aria-expanded={isMainMenuOpen}
              aria-controls="app-main-menu"
            >
              Menu
            </button>
            {isMainMenuOpen ? (
              <div
                id="app-main-menu"
                className="app-menu-panel"
                role="menu"
                aria-label="Main menu"
              >
                <button
                  type="button"
                  className="app-menu-item"
                  role="menuitem"
                  onClick={toggleConversationHistory}
                  aria-label="Toggle conversation history"
                  aria-expanded={
                    desktopSidebarExpanded || isConversationDrawerOpen
                  }
                >
                  Conversations
                </button>
                <button
                  type="button"
                  className="app-menu-item"
                  role="menuitem"
                  onClick={openActivityDashboardFromNavigation}
                  aria-label="Activities"
                >
                  Activities
                </button>
                <button
                  type="button"
                  className="app-menu-item"
                  role="menuitem"
                  onClick={openHealthDashboardFromNavigation}
                  aria-label="Health"
                >
                  Health
                </button>
                <button
                  type="button"
                  className="app-menu-item"
                  role="menuitem"
                  onClick={openTrainingPlanFromNavigation}
                  aria-label="Training Plan"
                >
                  Training Plan
                </button>
                <button
                  type="button"
                  className="app-menu-item"
                  role="menuitem"
                  onClick={openSyncFromNavigation}
                  aria-label="Sync"
                >
                  {isSyncing ? "Sync · syncing" : "Sync"}
                </button>
                <button
                  type="button"
                  className="app-menu-item"
                  role="menuitem"
                  onClick={openSettingsFromNavigation}
                  aria-label="Data & settings"
                >
                  Settings
                </button>
              </div>
            ) : null}
          </div>
        </header>
      ) : null}

      {syncOpen ? (
        <section
          className="sync-view-panel"
          aria-labelledby="sync-view-heading"
        >
          <div className="sync-view-header">
            <div>
              <p className="section-kicker">Garmin sync</p>
              <h1 id="sync-view-heading">Sync</h1>
            </div>
            <button
              type="button"
              className="chrome-button"
              onClick={closeSyncView}
              ref={syncCloseRef}
              aria-label="Back to chat"
            >
              Back to chat
            </button>
          </div>

          <div className="sync-view-content">
            <section
              className="sync-action-card"
              aria-labelledby="sync-action-heading"
            >
              <div className="card-title-row">
                <div>
                  <p className="section-kicker">Current run</p>
                  <h2 id="sync-action-heading">Run Garmin sync</h2>
                </div>
                <span className={`pill ${syncPillKind}`}>{syncPillLabel}</span>
              </div>
              <p>
                Uses the existing local read-only connector and normalized
                import pipeline.
              </p>
              <div className="button-row">
                <button
                  type="button"
                  className="primary-action"
                  onClick={syncNow}
                  disabled={isSyncing}
                  aria-label="Sync now — import latest Garmin data"
                >
                  {isSyncing ? "Sync already in progress" : "Sync now"}
                </button>
              </div>
              {isSyncing ? (
                <p className="helper-text" role="status" aria-live="polite">
                  Sync already in progress. Keep this view open or navigate
                  elsewhere; the current-run log will remain available here.
                </p>
              ) : null}
              <p className="helper-text" role="status" aria-live="polite">
                {syncRun.finalMessage}
              </p>
              <pre
                ref={syncLogRef}
                className={`sync-log status ${syncPillKind}`}
                aria-label="Current sync progress log"
                aria-live="polite"
              >
                {syncRun.lines.length
                  ? syncRun.lines.join("\n")
                  : "Current-run progress will appear here after Sync now starts."}
              </pre>
            </section>

            <section
              className="sync-metrics-card"
              aria-labelledby="sync-metrics-heading"
            >
              <div className="card-title-row">
                <div>
                  <p className="section-kicker">Import summary</p>
                  <h2 id="sync-metrics-heading">Local Garmin coverage</h2>
                </div>
              </div>
              {importSummary ? (
                <dl className="compact-facts sync-metrics-grid">
                  <div>
                    <dt>Stored activities</dt>
                    <dd>{numberLabel(importSummary.activities)}</dd>
                  </div>
                  <div>
                    <dt>Athlete baseline</dt>
                    <dd>{importSummary.athleteBaseline.availability}</dd>
                  </div>
                  <div>
                    <dt>Body metrics</dt>
                    <dd>{importSummary.bodyMetrics.availability}</dd>
                  </div>
                  <div>
                    <dt>Health coverage</dt>
                    <dd>
                      {formatHealthCoverageSummary(
                        importSummary.healthCoverage,
                        importSummary.healthDays,
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>Detail coverage</dt>
                    <dd>
                      {formatDetailCoverageSummary(
                        importSummary.detailCoverage,
                        importSummary.detailedActivities,
                      )}
                    </dd>
                  </div>
                </dl>
              ) : (
                <p>
                  Summary metrics are not available until the local summary
                  loads.
                </p>
              )}
            </section>
          </div>
        </section>
      ) : null}

      {activityDashboardOpen ? (
        <section
          className={`activity-dashboard-panel ${activitySelectorCollapsed ? "activity-selector-collapsed" : ""}`}
          aria-label="Selected activity dashboard"
        >
          <div className="activity-dashboard-header">
            <div>
              <p className="section-kicker">Activity charts</p>
              <h1>Activity dashboard</h1>
            </div>
            <button
              type="button"
              className="chrome-button"
              onClick={closeActivityDashboard}
              ref={activityDashboardCloseRef}
              aria-label="Back to chat"
            >
              Back to chat
            </button>
          </div>
          <div className="activity-dashboard-selector">
            <div className="activity-selector-header">
              <div
                className="activity-selector-heading"
                hidden={activitySelectorCollapsed}
              >
                <p className="section-kicker">Activity selector</p>
                <h2>Search synced activities</h2>
              </div>
              <button
                type="button"
                className="activity-selector-toggle"
                onClick={() =>
                  setActivitySelectorCollapsed((collapsed) => !collapsed)
                }
                aria-expanded={!activitySelectorCollapsed}
                aria-controls="activity-selector-body"
                aria-label={
                  activitySelectorCollapsed
                    ? "Expand activity selector"
                    : "Collapse activity selector"
                }
                title={
                  activitySelectorCollapsed
                    ? "Expand activity selector"
                    : "Collapse activity selector"
                }
              >
                <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                  <path
                    d="M10.5 3 5.5 8l5 5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            </div>
            {activitySelectorCollapsed ? (
              <span className="activity-selector-rail-label">Activities</span>
            ) : null}
            <div
              className="activity-selector-body"
              id="activity-selector-body"
              hidden={activitySelectorCollapsed}
            >
              <label className="activity-search-field">
                <span>Search activity name, sport, date, or Garmin ID</span>
                <input
                  type="search"
                  value={activitySearchQuery}
                  onChange={(event) =>
                    setActivitySearchQuery(event.target.value)
                  }
                  placeholder="Search all synced activities"
                />
              </label>
              <p className="activity-dashboard-status">{activityListMessage}</p>
              <div
                className="activity-list"
                role="list"
                aria-label="Synced activities"
                onScroll={handleActivityListScroll}
              >
                {activityListState === "loading" ? (
                  <p className="empty-chat">Loading synced activities…</p>
                ) : activities.length ? (
                  <>
                    {activities.map((activity) => (
                      <button
                        type="button"
                        role="listitem"
                        className={`activity-list-item ${selectedActivityId === activity.garminId ? "selected" : ""}`}
                        key={activity.garminId}
                        onClick={() =>
                          void selectActivityDashboard(activity.garminId)
                        }
                      >
                        <span>
                          <strong>{activity.label}</strong>
                          <small>
                            {activity.date} ·{" "}
                            <ActivitySportIcon sport={activity.sport} /> ·
                            Garmin ID {activity.garminId}
                          </small>
                        </span>
                        <span>
                          {distanceLabel(activity.distanceMeters)} ·{" "}
                          {durationLabel(activity.durationSec)}
                        </span>
                      </button>
                    ))}
                    {isActivityListLoadingMore ? (
                      <p className="activity-dashboard-status">
                        Loading more activities…
                      </p>
                    ) : null}
                    {!isActivityListLoadingMore &&
                    activityListNextOffset === null &&
                    activityListTotalApprox !== undefined ? (
                      <p className="activity-dashboard-status">
                        End of results
                      </p>
                    ) : null}
                  </>
                ) : (
                  <p className="empty-chat">{activityListMessage}</p>
                )}
              </div>
            </div>
          </div>
          <div className="selected-activity-detail">
            {activityDashboardState === "loading" ? (
              <p className="empty-chat">Loading selected activity details…</p>
            ) : activityDashboard ? (
              <>
                <div className="selected-activity-heading">
                  <div>
                    <h2>{activityDashboard.activity.label}</h2>
                    <p>
                      {activityDashboard.activity.date} ·{" "}
                      {activityDashboard.activity.sport} · Garmin ID{" "}
                      {activityDashboard.activity.garminId}
                    </p>
                  </div>
                  <span className="detail-status-pill">
                    Detail: {activityDashboard.detail.status ?? "not requested"}
                  </span>
                </div>
                <div
                  className="activity-stat-grid"
                  aria-label="Selected activity summary stats"
                >
                  <span>
                    <strong>Duration</strong>
                    {durationLabel(activityDashboard.activity.durationSec)}
                  </span>
                  <span>
                    <strong>Distance</strong>
                    {distanceLabel(activityDashboard.activity.distanceMeters)}
                  </span>
                  <span>
                    <strong>Elevation gain</strong>
                    {metersLabel(
                      activityDashboard.activity.elevationGainMeters,
                    )}
                  </span>
                  <span>
                    <strong>Elevation loss</strong>
                    {metersLabel(
                      activityDashboard.activity.elevationLossMeters,
                    )}
                  </span>
                  <span>
                    <strong>Calories</strong>
                    {numberLabel(activityDashboard.activity.calories)}
                  </span>
                  <span>
                    <strong>Avg HR</strong>
                    {numberLabel(activityDashboard.activity.avgHeartRate)} bpm
                  </span>
                  <span>
                    <strong>Max HR</strong>
                    {numberLabel(activityDashboard.activity.maxHeartRate)} bpm
                  </span>
                  <span>
                    <strong>Steps</strong>
                    {numberLabel(activityDashboard.activity.steps)}
                  </span>
                </div>
                <div className="activity-chart-grid">
                  {activityDashboard.detail.hasHeartRate ? (
                    <MiniLineChart
                      title="Heart rate"
                      unit="bpm"
                      points={activityDashboard.charts.points}
                      valueKey="heartRate"
                      domainStartSec={activityDashboard.charts.domainStartSec}
                      domainEndSec={activityDashboard.charts.domainEndSec}
                      averageValue={finiteHeartRateAverage(
                        activityDashboard.activity.avgHeartRate,
                      )}
                    />
                  ) : (
                    <div className="activity-chart empty-state">
                      No heart-rate stream data available.
                    </div>
                  )}
                  {activityDashboard.detail.hasElevation ? (
                    <MiniLineChart
                      title="Elevation profile"
                      unit="m"
                      points={activityDashboard.charts.points}
                      valueKey="altitudeMeters"
                      domainStartSec={activityDashboard.charts.domainStartSec}
                      domainEndSec={activityDashboard.charts.domainEndSec}
                      readoutDetail={(point) =>
                        gradeReadoutLabel(point.gradePct)
                      }
                    />
                  ) : (
                    <div className="activity-chart empty-state">
                      No per-point altitude stream data available.
                    </div>
                  )}
                  {activityDashboard.charts.speed?.status === "available" ? (
                    <MiniLineChart
                      title="Speed"
                      unit="km/h"
                      points={activityDashboard.charts.points}
                      valueKey="speedKmh"
                      domainStartSec={activityDashboard.charts.domainStartSec}
                      domainEndSec={activityDashboard.charts.domainEndSec}
                      formatValue={speedKmhLabel}
                      averageValue={finiteChartAverage(
                        activityDashboard.charts.points.map(
                          (point) => point.speedKmh,
                        ),
                      )}
                    />
                  ) : (
                    <div className="activity-chart empty-state">
                      <strong>Speed</strong>
                      <span>
                        {activityDashboard.charts.speed?.message ??
                          "Speed unavailable because normalized cumulative-distance stream samples are not available."}
                      </span>
                      <span>
                        Requires reliable cumulative-distance and elapsed-time
                        windows; no measured speed, GPS, summary, lap, or pace
                        fallback is used.
                      </span>
                    </div>
                  )}
                </div>
                {activityDashboard.charts.timeScaleMessage ? (
                  <p className="activity-dashboard-status">
                    {activityDashboard.charts.timeScaleMessage}
                  </p>
                ) : null}
                <div className="route-zone-grid">
                  <RouteMap route={activityDashboard.route} />
                  <HeartRateZoneTimeChart
                    summary={activityDashboard.heartRateZones}
                  />
                </div>
                <div
                  className="activity-effort-widget-grid"
                  aria-label="Selected activity effort widgets"
                >
                  <section
                    className="activity-effort-widget"
                    aria-labelledby="activity-intensity-minutes-heading"
                  >
                    <div className="activity-effort-widget-heading">
                      <h3 id="activity-intensity-minutes-heading">
                        Intensity Minutes
                      </h3>
                      <span>Weighted total</span>
                    </div>
                    <div className="activity-effort-total">
                      <span>Total</span>
                      <strong>
                        {finiteNumberUnitLabel(
                          weightedIntensityMinutes(
                            activityDashboard.activity.moderateIntensityMinutes,
                            activityDashboard.activity.vigorousIntensityMinutes,
                          ),
                          "min",
                          0,
                        )}
                      </strong>
                    </div>
                    <dl className="activity-effort-list">
                      <div>
                        <dt>Moderate</dt>
                        <dd>
                          {finiteNumberUnitLabel(
                            activityDashboard.activity.moderateIntensityMinutes,
                            "min",
                            0,
                          )}
                        </dd>
                      </div>
                      <div>
                        <dt>
                          Vigorous <span className="effort-weight-cue">x2</span>
                        </dt>
                        <dd>
                          {finiteNumberUnitLabel(
                            activityDashboard.activity.vigorousIntensityMinutes,
                            "min",
                            0,
                          )}
                        </dd>
                      </div>
                    </dl>
                  </section>
                  <section
                    className="activity-effort-widget"
                    aria-labelledby="activity-training-effect-heading"
                  >
                    <div className="activity-effort-widget-heading">
                      <h3 id="activity-training-effect-heading">
                        Training Effect
                      </h3>
                      <span>Effort summary</span>
                    </div>
                    <dl className="activity-effort-list activity-effort-list-grid">
                      <div>
                        <dt>Aerobic</dt>
                        <dd>
                          {finiteNumberLabel(
                            activityDashboard.activity.trainingEffect,
                            1,
                          )}
                        </dd>
                      </div>
                      <div>
                        <dt>Anaerobic</dt>
                        <dd>
                          {finiteNumberLabel(
                            activityDashboard.activity.anaerobicTrainingEffect,
                            1,
                          )}
                        </dd>
                      </div>
                      <div>
                        <dt>Primary Benefit</dt>
                        <dd>
                          {activityDashboard.activity.trainingEffectLabel ??
                            "Unavailable"}
                        </dd>
                      </div>
                      <div>
                        <dt>Exercise Load</dt>
                        <dd>
                          {finiteNumberLabel(
                            activityDashboard.activity.trainingLoad,
                            0,
                          )}
                        </dd>
                      </div>
                    </dl>
                  </section>
                </div>
                <p className="activity-dashboard-status activity-effort-note">
                  Effort fields come from Garmin activity detail when exposed;
                  unavailable means the local row has not exposed that field.
                  Explicit zero values display as 0.
                </p>
                {activityDashboard.laps.length ? (
                  <div className="lap-table-wrap">
                    <table className="lap-table">
                      <caption>Lap details</caption>
                      <thead>
                        <tr>
                          <th>Lap</th>
                          <th>Duration</th>
                          <th>Distance</th>
                          <th>Pace</th>
                          <th>Avg Speed</th>
                          <th>Avg HR</th>
                          <th>Elev +/−</th>
                        </tr>
                      </thead>
                      <tbody>
                        {activityDashboard.laps.map((lap) => (
                          <tr key={lap.lapNumber}>
                            <td>{lap.lapNumber}</td>
                            <td>{durationLabel(lap.durationSec)}</td>
                            <td>{distanceLabel(lap.distanceMeters)}</td>
                            <td>
                              {paceLabel(lap.durationSec, lap.distanceMeters)}
                            </td>
                            <td>{averageSpeedLabel(lap.avgSpeedMps)}</td>
                            <td>{numberLabel(lap.avgHeartRate)} bpm</td>
                            <td>
                              {metersLabel(lap.elevationGainMeters)} /{" "}
                              {metersLabel(lap.elevationLossMeters)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="activity-dashboard-status">
                    No lap rows are available for this activity.
                  </p>
                )}
                {activityDashboard.detail.unavailableReason ? (
                  <p className="activity-dashboard-status">
                    Detail limitation:{" "}
                    {activityDashboard.detail.unavailableReason}
                  </p>
                ) : null}
              </>
            ) : activityDashboardState === "error" ? (
              <p className="empty-chat">
                Selected activity could not be loaded. Try another activity.
              </p>
            ) : (
              <p className="empty-chat">
                Select a synced activity to inspect charts and stats.
              </p>
            )}
          </div>
        </section>
      ) : null}

      {trainingPlanOpen ? (
        <section
          className="training-plan-panel"
          aria-label="Training Plan section"
        >
          <div className="activity-dashboard-header">
            <div>
              <p className="section-kicker">Training Plan</p>
              <h1>{trainingPlan?.title ?? "Training Plan"}</h1>
            </div>
            <button
              type="button"
              className="chrome-button"
              onClick={closeTrainingPlan}
              ref={trainingPlanCloseRef}
              aria-label="Back to chat"
            >
              Back to chat
            </button>
          </div>
          <div className="training-plan-content">
            <div className="training-plan-toolbar">
              <div>
                <p className="activity-dashboard-status">
                  {trainingPlanMessage}
                </p>
                {trainingPlan ? (
                  <p className="training-plan-meta">
                    Last revised {dateLabel(trainingPlan.revisedAt)} ·{" "}
                    {trainingPlanStale
                      ? `Stale after ${trainingPlanStaleAfterDays} days`
                      : "Current"}
                  </p>
                ) : null}
              </div>
              <div className="training-plan-actions">
                <button
                  type="button"
                  className="chrome-button"
                  onClick={() => void loadTrainingPlan("manual")}
                  disabled={
                    trainingPlanState === "loading" || trainingPlanSaving
                  }
                >
                  Reload
                </button>
                {!trainingPlanEditing ? (
                  <button
                    type="button"
                    className="primary-action compact"
                    onClick={startTrainingPlanEdit}
                    disabled={trainingPlanState === "loading"}
                  >
                    {trainingPlan ? "Edit" : "Create"}
                  </button>
                ) : null}
              </div>
            </div>
            {trainingPlanState === "loading" ? (
              <p className="empty-chat">Loading Training Plan…</p>
            ) : trainingPlanEditing ? (
              <form
                className="training-plan-editor"
                onSubmit={(event) => {
                  event.preventDefault();
                  void saveTrainingPlan();
                }}
              >
                <label>
                  <span>Title</span>
                  <input
                    type="text"
                    value={trainingPlanTitleDraft}
                    onChange={(event) =>
                      setTrainingPlanTitleDraft(event.currentTarget.value)
                    }
                    maxLength={120}
                  />
                </label>
                <label>
                  <span>Markdown plan</span>
                  <textarea
                    value={trainingPlanMarkdownDraft}
                    onChange={(event) =>
                      setTrainingPlanMarkdownDraft(event.currentTarget.value)
                    }
                    placeholder="Write a freeform Markdown training plan…"
                  />
                </label>
                <div className="training-plan-actions">
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={cancelTrainingPlanEdit}
                    disabled={trainingPlanSaving}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="primary-action compact"
                    disabled={
                      trainingPlanSaving || !trainingPlanMarkdownDraft.trim()
                    }
                  >
                    {trainingPlanSaving ? "Saving…" : "Save"}
                  </button>
                </div>
              </form>
            ) : trainingPlan ? (
              <article className="training-plan-report">
                {trainingPlanStale ? (
                  <p className="training-plan-stale">
                    This plan is older than {trainingPlanStaleAfterDays} days.
                    Ask chat to revise it when your goals or recent training
                    have changed.
                  </p>
                ) : null}
                <AssistantContent content={trainingPlan.contentMarkdown} />
              </article>
            ) : trainingPlanState === "error" ? (
              <p className="empty-chat">
                Training Plan could not be loaded. Try Reload.
              </p>
            ) : (
              <div className="empty-chat empty-chat-hero">
                <p>
                  No Training Plan is saved yet. Create one manually here, or
                  ask chat: “Create my Training Plan.”
                </p>
              </div>
            )}
          </div>
        </section>
      ) : null}

      {healthDashboardOpen ? (
        <section
          className="health-dashboard-panel"
          aria-labelledby="health-dashboard-heading"
        >
          <div className="health-dashboard-header">
            <div>
              <p className="section-kicker">Health</p>
              <h1 id="health-dashboard-heading">Health</h1>
            </div>
            <button
              type="button"
              className="chrome-button"
              onClick={closeHealthDashboard}
              ref={healthDashboardCloseRef}
              aria-label="Back to chat"
            >
              Back to chat
            </button>
          </div>

          <div className="health-dashboard-content">
            {healthDashboardState === "loading" ? (
              <p className="helper-text" role="status" aria-live="polite">
                Loading health data…
              </p>
            ) : null}
            {healthDashboardState === "error" ? (
              <p className="health-dashboard-error" role="alert">
                {healthDashboardError}
              </p>
            ) : null}
            {healthDashboardState === "loaded" &&
            healthDashboardData &&
            healthDashboardData.days.length === 0 ? (
              <div className="health-empty-state">
                <h2>No health data yet</h2>
                <p>
                  No daily health rows are available locally. Use the existing
                  Sync view to import Garmin health data — this dashboard stays
                  read-only and never starts a sync by itself.
                </p>
              </div>
            ) : null}
            {healthDashboardState === "loaded" &&
            healthDashboardData &&
            healthDashboardData.days.length > 0 ? (
              <HealthDashboardView
                days={healthDashboardData.days}
                selectedIndex={selectedHealthDayIndex}
                onSelectIndex={setSelectedHealthDayIndex}
              />
            ) : null}
          </div>
        </section>
      ) : null}

      {!activityDashboardOpen &&
      !trainingPlanOpen &&
      !syncOpen &&
      !healthDashboardOpen ? (
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
                onClick={() => {
                  startConversationRename(openConversationMenuItem);
                }}
                disabled={isChatLoading}
              >
                Rename
              </button>
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
          {renameTarget ? (
            <div className="modal-layer rename-dialog-layer">
              <button
                type="button"
                className="settings-backdrop"
                aria-label="Cancel rename"
                onClick={cancelConversationRename}
              />
              <form
                className="rename-dialog"
                role="dialog"
                aria-modal="true"
                aria-labelledby="rename-dialog-title"
                onSubmit={(event) => {
                  event.preventDefault();
                  void saveConversationRename();
                }}
              >
                <div>
                  <p className="section-kicker">Saved chat</p>
                  <h2 id="rename-dialog-title">Rename conversation</h2>
                </div>
                <label htmlFor="conversation-rename-title">
                  Conversation title
                </label>
                <input
                  id="conversation-rename-title"
                  ref={renameInputRef}
                  value={renameTitle}
                  onChange={(event) => setRenameTitle(event.target.value)}
                  disabled={isRenamingConversation || isChatLoading}
                  maxLength={160}
                />
                <p className="helper-text">
                  Saves a local title only; messages, Garmin data, Profile, and
                  saved memories stay unchanged.
                </p>
                <div className="button-row rename-dialog-actions">
                  <button
                    type="button"
                    className="chrome-button"
                    onClick={cancelConversationRename}
                    disabled={isRenamingConversation}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="primary-action"
                    disabled={
                      isRenamingConversation ||
                      isChatLoading ||
                      renameTitle.trim().length === 0
                    }
                  >
                    {isRenamingConversation ? "Saving…" : "Save"}
                  </button>
                </div>
              </form>
            </div>
          ) : null}

          <section className="trainer-card" aria-labelledby="trainer-heading">
            <div className="trainer-heading-row">
              <div>
                <p className="section-kicker">Daily trainer</p>
                <h2 id="trainer-heading">Chat with your private coach</h2>
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
                <div className="empty-chat empty-chat-hero">
                  <p>
                    Start with the latest training question. Profile, memory,
                    Garmin data, diagnostics, and privacy controls are in
                    Settings.
                  </p>
                  {trainingPlanState === "loaded" &&
                  (!trainingPlan || trainingPlanStale) ? (
                    <div className="training-plan-suggestion">
                      <strong>
                        {trainingPlan
                          ? "Your Training Plan may be stale."
                          : "No Training Plan saved yet."}
                      </strong>
                      <span>
                        Ask chat to {trainingPlan ? "revise" : "create"} it, or
                        open the Training Plan section to edit Markdown
                        manually.
                      </span>
                    </div>
                  ) : null}
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
                  <p className="pending-thinking-text">
                    <span>Trainer is thinking…</span>
                    <span
                      className="pending-thinking-dots"
                      aria-hidden="true"
                      data-testid="pending-thinking-indicator"
                    >
                      <span />
                      <span />
                      <span />
                    </span>
                  </p>
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
      ) : null}

      {!activityDashboardOpen && !syncOpen && settingsOpen ? (
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
                <p className="helper-text" role="status" aria-live="polite">
                  {bodyMetricsMessage}
                </p>
                {bodyMetrics ? (
                  <dl
                    className="compact-facts"
                    aria-label="Garmin body metrics"
                  >
                    <div>
                      <dt>Body-metrics status</dt>
                      <dd>{bodyMetrics.availability}</dd>
                    </div>
                    <div>
                      <dt>Body metrics refreshed</dt>
                      <dd>{dateLabel(bodyMetrics.fetchedAt)}</dd>
                    </div>
                    <div>
                      <dt>Current weight</dt>
                      <dd>
                        {valueLabel(bodyMetrics.values.weightKg, " kg")}
                        {bodyMetrics.currentWeightSource === "weigh_in"
                          ? " (source: latest weigh-in)"
                          : bodyMetrics.currentWeightSource === "profile"
                            ? " (source: profile weight field)"
                            : ""}
                      </dd>
                    </div>
                    <div>
                      <dt>Height</dt>
                      <dd>{valueLabel(bodyMetrics.values.heightCm, " cm")}</dd>
                    </div>
                    <div>
                      <dt>Weight history</dt>
                      <dd>
                        {bodyMetrics.history.availability === "available"
                          ? `${bodyMetrics.history.count} rows (${bodyMetrics.history.rangeStart ?? "unknown"} to ${bodyMetrics.history.rangeEnd ?? "unknown"}${bodyMetrics.history.source ? `, source: ${bodyMetrics.history.source}` : ""})`
                          : bodyMetrics.history.availability}
                      </dd>
                    </div>
                    <div>
                      <dt>Weigh-in status</dt>
                      <dd>
                        {bodyMetrics.weighInAvailability ?? "not attempted"}
                      </dd>
                    </div>
                  </dl>
                ) : (
                  <p>
                    Body metrics not available until the local summary loads.
                  </p>
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
                  <strong>Private AI coaching.</strong> Responses may use the
                  selected conversation context and normalized local Garmin
                  evidence under the privacy and tool boundaries below.
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
