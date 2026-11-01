import { type TrainerProgress } from "@/lib/ai/trainer-progress";

export type Status = {
  kind: "idle" | "ok" | "error" | "busy";
  message: string;
};

export type SyncRunState = {
  kind: "idle" | "running" | "completed" | "failed";
  lines: Array<{ text: string; severity: "info" | "error" }>;
  finalMessage: string;
  failureSummary: string | null;
  recovery: "connector" | "auth" | "network" | "rate-limit" | null;
};

export type TranscriptScrollSnapshot = {
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

export type ChatGrounding = {
  toolSteps?: { tool: string; status: "succeeded" | "rejected" | "failed" }[];
  debugTrace?: LlmDebugTrace;
  tool?: string;
  activityId?: string;
  activityName?: string | null;
  activityDate?: string | null;
  privacy?: string;
  summary?: string;
};

export type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: string;
  grounding?: ChatGrounding | null;
};

export type ChatPayload = {
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

export type ConversationSummary = {
  titlePending?: boolean;
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
};

export type ConversationListPayload = { conversations: ConversationSummary[] };

export type ConversationCreatePayload = { conversation: ConversationSummary };

export type ConversationDeletePayload = {
  deleted: boolean;
  conversationId: string;
  nextConversationId: string;
  conversations: ConversationSummary[];
};

export type ConversationRenamePayload = {
  conversation: ConversationSummary;
};

export type ChatStreamEvent =
  | { type: "start"; conversationId: string; userMessage: ChatMessage }
  | ({ type: "status" } & TrainerProgress)
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

export type MemoryItem = {
  id: string;
  text: string;
  kind: "conversation" | "saved_preference" | "correction" | "temporary";
  score?: number;
  conversationId?: string;
  createdAt?: string;
  updatedAt?: string;
  expiresAt?: string;
};

export type MemoryHealth = {
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

export type MemoryPayload = {
  memories: MemoryItem[];
  health: MemoryHealth;
  enabled: boolean;
  ready: boolean;
};

export type MemoryKindFilter = "all" | MemoryItem["kind"];

export type MemorySort = "newest" | "oldest" | "kind" | "text";

export const memoryKindOptions: { value: MemoryKindFilter; label: string }[] = [
  { value: "all", label: "All kinds" },
  { value: "conversation", label: "Conversation" },
  { value: "saved_preference", label: "Saved preference" },
  { value: "correction", label: "Correction" },
  { value: "temporary", label: "Temporary" },
];

export const memorySortOptions: { value: MemorySort; label: string }[] = [
  { value: "newest", label: "Newest updated" },
  { value: "oldest", label: "Oldest updated" },
  { value: "kind", label: "Kind" },
  { value: "text", label: "Text" },
];

export const memoryKindLabels: Record<MemoryItem["kind"], string> = {
  conversation: "Conversation",
  saved_preference: "Saved preference",
  correction: "Correction",
  temporary: "Temporary",
};

export type TrainerProfilePayload = {
  goals: string[];
  sports: string[];
  preferences: Record<string, unknown>;
  constraints: string[];
};

export type ProfileResponse = { ok?: boolean; profile?: TrainerProfilePayload };

export type TrainingPlanPayload = {
  plan: TrainingPlan | null;
  stale: boolean;
  staleAfterDays: number;
};

export type TrainingPlanResponse = { plan: TrainingPlan };

export type TrainingPlan = {
  title: string;
  contentMarkdown: string;
  revisedAt: string;
};

export type TrainingPlanState = "idle" | "loading" | "loaded" | "error";

type AthleteBaselineAvailability =
  "complete" | "partial" | "unavailable" | "failed";

export type AthleteBaselinePayload = {
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

export type BodyMetricsPayload = {
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

export type HealthCoveragePayload = {
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

export type DetailCoveragePayload = {
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

export type ImportSummaryPayload = {
  activities: number;
  healthDays: number;
  healthCoverage?: HealthCoveragePayload;
  detailedActivities: number;
  detailCoverage?: DetailCoveragePayload;
  athleteBaseline: AthleteBaselinePayload;
  bodyMetrics: BodyMetricsPayload;
};

export type ProfileFields = {
  goals: string;
  sports: string;
  constraints: string;
};

export type HealthDashboardDay = {
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

export type HealthDashboardMode = "daily" | "weekly" | "monthly";

export type HealthDashboardPayload = {
  days: HealthDashboardDay[];
  latestDate: string | null;
};

export const SLEEP_DETAIL_SOURCE_LIMITED =
  "Unavailable sleep score or stage details may be source-limited; they are not inferred from other metrics.";

export const SLEEP_STAGE_FIELDS = [
  ["Deep", "sleepDeepMinutes"],
  ["Light", "sleepLightMinutes"],
  ["REM", "sleepRemMinutes"],
  ["Awake", "sleepAwakeMinutes"],
  ["Nap", "sleepNapMinutes"],
] as const;

export type HealthDashboardLoadState = "idle" | "loading" | "loaded" | "error";

export type ProfileFetchState = "idle" | "loading" | "loaded" | "error";

export type ProfileSaveState = "idle" | "saving" | "saved" | "error";

export type SyncProgressEvent = {
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

export type ActivityListItem = {
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

export type ActivityListPayload = {
  activities: ActivityListItem[];
  nextOffset?: number | null;
  totalApprox?: number;
  limit?: number;
  offset?: number;
};

export const ACTIVITY_LIST_PAGE_SIZE = 100;

export const ACTIVITY_LIST_SCROLL_THRESHOLD_PX = 96;

export const emptySyncRun: SyncRunState = {
  kind: "idle",
  lines: [],
  finalMessage: "No sync has run in this browser session yet.",
  failureSummary: null,
  recovery: null,
};

export type ActivityDashboardPayload = {
  terrainSections?: import("@/lib/analytics/terrain-sections").TerrainAnalysis;
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
      // Original stored coordinate, independent of displayed chart timing.
      sourceElapsedSec?: number;
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

export const emptyProfileFields: ProfileFields = {
  goals: "",
  sports: "",
  constraints: "",
};

export const emptyAthleteBaseline: AthleteBaselinePayload = {
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

export const emptyBodyMetrics: BodyMetricsPayload = {
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
