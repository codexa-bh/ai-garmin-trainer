import { createHash } from "node:crypto";
import {
  getActivityDetailForAnalytics,
  getGarminAthleteBaseline,
  listActivitiesForComparison,
  listGarminRawPayloadsForAnalysis,
  listRecentDailyHealth,
} from "@/lib/db/repository";
import {
  runGeneratedPythonAnalysis,
  type GeneratedPythonAnalysisResult,
} from "@/lib/ai/python-sandbox";
import { payloadHasSecretLikeText } from "@/lib/garmin/raw-payload";

export type GeneratedAnalysisDatasetName =
  "activities" | "dailyHealth" | "activityDetails" | "rawPayloads";

export type GeneratedAnalysisActivitySelection = {
  includeText?: string[];
  excludeText?: string[];
};

type NormalizedGeneratedAnalysisActivitySelection = {
  includeText: string[];
  excludeText: string[];
};

export type GarminAnalysisBundle = {
  manifest: {
    generatedAt: string;
    request: string;
    selectedDatasets: GeneratedAnalysisDatasetName[];
    datasets: Array<{
      name: GeneratedAnalysisDatasetName;
      rowCount: number;
      description: string;
    }>;
    tables: Array<{ name: string; rowCount: number }>;
    rawPayloads: Array<{
      id: string;
      sourceTool: string;
      subjectType: string;
      subjectId: string;
      contentType: string;
    }>;
    limits: {
      maxRowsPerTable: number;
      maxRawPayloads: number;
      maxRawPayloadBytes: number;
      maxOutputBytes: number;
    };
    activitySelection?: NormalizedGeneratedAnalysisActivitySelection;
    scriptContract: {
      resultVariable: "RESULT";
      allowedImports: string[];
      forbiddenAccess: string[];
    };
  };
  datasets: {
    activities: unknown[];
    dailyHealth: unknown[];
    activityDetails: unknown[];
    rawPayloads: Array<{
      id: string;
      sourceTool: string;
      subjectType: string;
      subjectId: string;
      contentType: string;
      payload: unknown;
    }>;
  };
  tables: {
    activities: unknown[];
    dailyHealth: unknown[];
    activityDetails: unknown[];
  };
  athleteBaseline: unknown;
  rawPayloads: Array<{
    id: string;
    sourceTool: string;
    subjectType: string;
    subjectId: string;
    contentType: string;
    payload: unknown;
  }>;
};

export type GeneratedDatasetScriptResult = {
  kind: string;
  title?: string;
  requestedCount?: number;
  returnedCount?: number;
  rows?: Array<Record<string, unknown>>;
  summary?: unknown;
  metrics?: unknown;
  limitations: string[];
  [key: string]: unknown;
};

export type GeneratedAnalysisEvidence = {
  tool: "generatedGarminAnalysis";
  status: "succeeded" | "rejected" | "failed";
  requestedCount: number;
  scriptHash: string;
  manifest: GarminAnalysisBundle["manifest"];
  result?: GeneratedDatasetScriptResult;
  reason?: string;
  warnings: string[];
  privacy: string;
};

const MAX_ROWS_PER_TABLE = 1000;
const MAX_RAW_PAYLOADS = 100;
const MAX_RAW_BYTES = 200000;
const MAX_OUTPUT_BYTES = 12000;
const MAX_SELECTION_TERMS = 8;
const MAX_SELECTION_TERM_LENGTH = 40;
const DEFAULT_DATASETS: GeneratedAnalysisDatasetName[] = [
  "activities",
  "dailyHealth",
  "activityDetails",
  "rawPayloads",
];
const DATASET_DESCRIPTIONS: Record<GeneratedAnalysisDatasetName, string> = {
  activities:
    "Bounded normalized Garmin activity summaries with IDs, labels, dates, sports, duration, distance, heart-rate, elevation, calories, steps, and training-effect fields.",
  dailyHealth:
    "Recent normalized daily health/recovery rows available in local SQLite.",
  activityDetails:
    "Bounded normalized activity detail slices for selected local activities; stream/lap rows are capped.",
  rawPayloads:
    "Redacted Garmin raw payload snapshots retained by the app; metadata is always explicit and payload bytes are capped.",
};
const SAFE_IMPORTS = [
  "collections",
  "datetime",
  "decimal",
  "functools",
  "itertools",
  "json",
  "math",
  "statistics",
];

function normalizeFilterText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeSelectionTerms(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return [
    ...new Set(
      values
        .map((value) =>
          typeof value === "string" ? normalizeFilterText(value) : "",
        )
        .filter(
          (value) =>
            value.length >= 2 && value.length <= MAX_SELECTION_TERM_LENGTH,
        )
        .slice(0, MAX_SELECTION_TERMS),
    ),
  ];
}

function normalizeGeneratedAnalysisActivitySelection(
  selection?: GeneratedAnalysisActivitySelection,
): NormalizedGeneratedAnalysisActivitySelection {
  return {
    includeText: normalizeSelectionTerms(selection?.includeText),
    excludeText: normalizeSelectionTerms(selection?.excludeText),
  };
}

function hasActiveActivitySelection(
  selection: NormalizedGeneratedAnalysisActivitySelection | undefined,
): selection is NormalizedGeneratedAnalysisActivitySelection {
  return Boolean(
    selection?.includeText.length || selection?.excludeText.length,
  );
}

function activitySearchText(activity: {
  sport?: unknown;
  label?: unknown;
}): string {
  return normalizeFilterText(
    `${String(activity.sport ?? "")} ${String(activity.label ?? "")}`,
  );
}

function activityMatchesTerm(
  activity: { sport?: unknown; label?: unknown },
  term: string,
): boolean {
  return activitySearchText(activity).includes(term);
}

function activityPassesSelection(
  activity: { sport?: unknown; label?: unknown },
  selection: NormalizedGeneratedAnalysisActivitySelection,
): boolean {
  const included =
    selection.includeText.length === 0 ||
    selection.includeText.some((term) => activityMatchesTerm(activity, term));
  const excluded = selection.excludeText.some((term) =>
    activityMatchesTerm(activity, term),
  );
  return included && !excluded;
}

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function safeActivityLabel(activity: {
  name: string | null;
  sport: string;
  startedAt: Date;
  garminId: string;
}): string {
  return (
    activity.name?.trim() ||
    `Imported ${activity.sport} on ${isoDate(activity.startedAt)} (Garmin ID ${activity.garminId})`
  );
}

function normalizeDatasets(
  datasets?: GeneratedAnalysisDatasetName[],
): GeneratedAnalysisDatasetName[] {
  if (!datasets?.length) return [...DEFAULT_DATASETS];
  return [...new Set(datasets)].filter((name) =>
    DEFAULT_DATASETS.includes(name),
  );
}

export function buildGarminAnalysisBundle(
  request: string,
  options: {
    datasets?: GeneratedAnalysisDatasetName[];
    activitySelection?: GeneratedAnalysisActivitySelection;
  } = {},
): GarminAnalysisBundle {
  const selectedDatasets = normalizeDatasets(options.datasets);
  const selected = new Set(selectedDatasets);
  const normalizedSelection = normalizeGeneratedAnalysisActivitySelection(
    options.activitySelection,
  );
  const allActivities = listActivitiesForComparison(MAX_ROWS_PER_TABLE)
    .map((activity) => ({
      garminId: activity.garminId,
      label: safeActivityLabel(activity),
      sport: activity.sport,
      date: isoDate(activity.startedAt),
      startedAt: activity.startedAt.toISOString(),
      durationSec: activity.durationSec,
      distanceMeters: activity.distanceMeters,
      calories: activity.calories,
      avgHeartRate: activity.avgHeartRate,
      maxHeartRate: activity.maxHeartRate,
      steps: activity.steps,
      elevationGainMeters: activity.elevationGainMeters,
      elevationLossMeters: activity.elevationLossMeters,
      trainingEffect: activity.trainingEffect,
    }))
    .filter((activity) =>
      activityPassesSelection(activity, normalizedSelection),
    );
  const activities = selected.has("activities") ? allActivities : [];
  const dailyHealth = selected.has("dailyHealth")
    ? listRecentDailyHealth(366)
    : [];
  const detailIds = allActivities
    .slice(0, 250)
    .map((activity) => activity.garminId);
  const activityDetails = selected.has("activityDetails")
    ? detailIds.map((garminId) => {
        const detail = getActivityDetailForAnalytics(garminId);
        return {
          garminId,
          availability: detail.availability,
          session: detail.session,
          derived: detail.derived,
          laps: detail.laps.slice(0, 50),
          stream: detail.stream.slice(0, 500),
          totalStreamPoints: detail.stream.length,
        };
      })
    : [];
  let rawBytes = 0;
  const rawPayloads = selected.has("rawPayloads")
    ? listGarminRawPayloadsForAnalysis(MAX_RAW_PAYLOADS)
        .map((raw) => {
          const payloadText = JSON.stringify(raw.payload) ?? "";
          rawBytes += Buffer.byteLength(payloadText, "utf8");
          return {
            id: raw.id,
            sourceTool: raw.sourceTool,
            subjectType: raw.subjectType,
            subjectId: raw.subjectId,
            contentType: raw.contentType,
            payload: raw.payload,
          };
        })
        .filter(() => rawBytes <= MAX_RAW_BYTES)
    : [];
  const datasetRows: Record<GeneratedAnalysisDatasetName, number> = {
    activities: activities.length,
    dailyHealth: dailyHealth.length,
    activityDetails: activityDetails.length,
    rawPayloads: rawPayloads.length,
  };
  const manifest = {
    generatedAt: new Date().toISOString(),
    request: request.slice(0, 500),
    selectedDatasets,
    datasets: selectedDatasets.map((name) => ({
      name,
      rowCount: datasetRows[name],
      description: DATASET_DESCRIPTIONS[name],
    })),
    tables: [
      { name: "activities", rowCount: activities.length },
      { name: "dailyHealth", rowCount: dailyHealth.length },
      { name: "activityDetails", rowCount: activityDetails.length },
    ],
    rawPayloads: rawPayloads.map((raw) => ({
      id: raw.id,
      sourceTool: raw.sourceTool,
      subjectType: raw.subjectType,
      subjectId: raw.subjectId,
      contentType: raw.contentType,
    })),
    limits: {
      maxRowsPerTable: MAX_ROWS_PER_TABLE,
      maxRawPayloads: MAX_RAW_PAYLOADS,
      maxRawPayloadBytes: MAX_RAW_BYTES,
      maxOutputBytes: MAX_OUTPUT_BYTES,
    },
    activitySelection: hasActiveActivitySelection(normalizedSelection)
      ? normalizedSelection
      : undefined,
    scriptContract: {
      resultVariable: "RESULT" as const,
      allowedImports: SAFE_IMPORTS,
      forbiddenAccess: [
        "filesystem",
        "network",
        "process/subprocess",
        "environment",
        "SQL/database handles",
        "Garmin connector handles or credentials",
        "raw FIT bytes or unrestricted streams",
      ],
    },
  };
  const datasets = { activities, dailyHealth, activityDetails, rawPayloads };
  return {
    manifest,
    datasets,
    tables: { activities, dailyHealth, activityDetails },
    athleteBaseline: getGarminAthleteBaseline(),
    rawPayloads,
  };
}

function truncateString(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

function sanitizeJsonValue(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[depth-limit]";
  if (value === null) return null;
  if (typeof value === "string") return truncateString(value, 1000);
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => sanitizeJsonValue(item, depth + 1));
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).slice(
      0,
      40,
    );
    return Object.fromEntries(
      entries.map(([key, item]) => [
        truncateString(key.replace(/[^\p{L}\p{N}\s_.:-]+/gu, ""), 80),
        sanitizeJsonValue(item, depth + 1),
      ]),
    );
  }
  return String(value).slice(0, 200);
}

function resultHasForbiddenText(value: unknown): boolean {
  const text =
    typeof value === "string" ? value : (JSON.stringify(value) ?? "");
  return (
    payloadHasSecretLikeText(value) ||
    /(?:\/Users\/|\/home\/|file:\/\/|https?:\/\/|\bSELECT\b|\bINSERT\b|\bUPDATE\b|\bDELETE\b|process\.env|DATABASE_URL|GARMIN_|connector|sqlite|\.fit\b)/i.test(
      text,
    )
  );
}

function validateDatasetScriptResult(
  value: unknown,
  requestedCount: number,
  bundle: GarminAnalysisBundle,
): GeneratedDatasetScriptResult | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const sanitized = sanitizeJsonValue(value) as Record<string, unknown>;
  if (resultHasForbiddenText(sanitized)) return null;
  const kind =
    typeof sanitized.kind === "string" && sanitized.kind.trim()
      ? sanitized.kind.trim().slice(0, 40)
      : null;
  if (!kind) return null;
  const knownActivities = new Map(
    (
      bundle.datasets.activities as Array<{
        garminId?: string;
        label?: string;
        date?: string;
        sport?: string;
      }>
    )
      .filter((activity) => activity.garminId)
      .map((activity) => [activity.garminId as string, activity]),
  );
  const rows = Array.isArray(sanitized.rows)
    ? (sanitized.rows as unknown[]).slice(0, 25)
    : undefined;
  if (Array.isArray(sanitized.rows) && sanitized.rows.length > requestedCount) {
    return null;
  }
  if (Array.isArray(sanitized.rows) && sanitized.rows.length > 25) return null;
  const filterIsActive = hasActiveActivitySelection(
    bundle.manifest.activitySelection,
  );
  const normalizedRows = rows?.map((row, index) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) return null;
    const record = row as Record<string, unknown>;
    const garminId =
      typeof record.garminId === "string" ? record.garminId : undefined;
    if (garminId && !knownActivities.has(garminId)) return null;
    if (filterIsActive && !garminId) return null;
    const activity = garminId ? knownActivities.get(garminId) : null;
    return {
      ...record,
      rank:
        typeof record.rank === "number" && Number.isFinite(record.rank)
          ? record.rank
          : index + 1,
      garminId: garminId?.slice(0, 80),
      label:
        typeof record.label === "string"
          ? record.label.slice(0, 160)
          : activity?.label?.slice(0, 160),
      date:
        typeof record.date === "string"
          ? record.date.slice(0, 40)
          : activity?.date?.slice(0, 40),
      sport:
        typeof record.sport === "string"
          ? record.sport.slice(0, 40)
          : activity?.sport?.slice(0, 40),
    };
  });
  if (normalizedRows?.some((row) => row === null)) return null;
  const limitations = Array.isArray(sanitized.limitations)
    ? sanitized.limitations
        .map((item) => String(item).slice(0, 200))
        .slice(0, 5)
    : [];
  return {
    ...sanitized,
    kind,
    title:
      typeof sanitized.title === "string"
        ? sanitized.title.slice(0, 120)
        : undefined,
    requestedCount,
    returnedCount:
      normalizedRows?.length ?? Number(sanitized.returnedCount ?? 0),
    rows: normalizedRows as Array<Record<string, unknown>> | undefined,
    limitations,
  };
}

export async function runGeneratedGarminAnalysis(input: {
  request: string;
  datasets?: GeneratedAnalysisDatasetName[];
  requestedCount?: number;
  activitySelection?: GeneratedAnalysisActivitySelection;
  script: string;
}): Promise<GeneratedAnalysisEvidence> {
  const requestedCount = Math.min(Math.max(input.requestedCount ?? 10, 1), 25);
  const bundle = buildGarminAnalysisBundle(input.request, {
    datasets: input.datasets,
    activitySelection: input.activitySelection,
  });
  const executableBundle = {
    ...bundle,
    request: input.request,
    requestedCount,
  };
  const script = input.script.trim();
  const scriptHash = createHash("sha256").update(script).digest("hex");
  const privacy =
    "Generated Python ran locally against explicit read-only Garmin datasets; no credentials, environment, filesystem paths, connector handles, SQL, or unrestricted raw streams were exposed.";
  const sandbox = await runGeneratedPythonAnalysis({
    script,
    bundle: executableBundle,
    timeoutMs: 2000,
    maxStdoutBytes: 2048,
    maxResultBytes: MAX_OUTPUT_BYTES,
  });
  if (sandbox.status !== "succeeded") {
    return {
      tool: "generatedGarminAnalysis",
      status: sandbox.status,
      requestedCount,
      scriptHash,
      manifest: bundle.manifest,
      reason: sandbox.reason,
      warnings: sandbox.warnings,
      privacy,
    };
  }
  const result = validateDatasetScriptResult(
    sandbox.result,
    requestedCount,
    bundle,
  );
  if (!result) {
    return {
      tool: "generatedGarminAnalysis",
      status: "rejected",
      requestedCount,
      scriptHash,
      manifest: bundle.manifest,
      reason: "invalid_result_shape",
      warnings: sandbox.warnings,
      privacy,
    };
  }
  return {
    tool: "generatedGarminAnalysis",
    status: "succeeded",
    requestedCount,
    scriptHash,
    manifest: bundle.manifest,
    result,
    warnings: sandbox.warnings,
    privacy,
  };
}

export function generatedAnalysisFailureText(
  result: GeneratedPythonAnalysisResult,
): string {
  return result.status === "succeeded"
    ? "succeeded"
    : `${result.reason}: ${result.message}`;
}
