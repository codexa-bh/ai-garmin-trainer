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

export type GeneratedAnalysisCriterion =
  | "demand_score"
  | "elevationGainMeters"
  | "distanceMeters"
  | "durationSec"
  | "avgHeartRate"
  | "trainingEffect";

export type GarminAnalysisBundle = {
  manifest: {
    generatedAt: string;
    request: string;
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

export type GeneratedAnalysisEvidence = {
  tool: "generatedGarminAnalysis";
  status: "succeeded" | "rejected" | "failed";
  criterion: string;
  requestedCount: number;
  scriptHash: string;
  manifest: GarminAnalysisBundle["manifest"];
  result?: GeneratedRankingResult;
  reason?: string;
  warnings: string[];
  privacy: string;
};

export type GeneratedRankingResult = {
  kind: "ranking";
  criterion: string;
  requestedCount: number;
  returnedCount: number;
  rows: Array<{
    rank: number;
    garminId?: string;
    label?: string;
    date?: string;
    sport?: string;
    value: number | string;
    units?: string;
    notes?: string;
  }>;
  limitations: string[];
};

const MAX_ROWS_PER_TABLE = 1000;
const MAX_RAW_PAYLOADS = 100;
const MAX_RAW_BYTES = 200000;
const MAX_OUTPUT_BYTES = 12000;

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

export function buildGarminAnalysisBundle(
  request: string,
): GarminAnalysisBundle {
  const activities = listActivitiesForComparison(MAX_ROWS_PER_TABLE).map(
    (activity) => ({
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
    }),
  );
  const dailyHealth = listRecentDailyHealth(366);
  const detailIds = activities
    .slice(0, 250)
    .map((activity) => activity.garminId);
  const activityDetails = detailIds.map((garminId) => {
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
  });
  let rawBytes = 0;
  const rawPayloads = listGarminRawPayloadsForAnalysis(MAX_RAW_PAYLOADS)
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
    .filter(() => rawBytes <= MAX_RAW_BYTES);
  return {
    manifest: {
      generatedAt: new Date().toISOString(),
      request: request.slice(0, 500),
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
    },
    tables: { activities, dailyHealth, activityDetails },
    athleteBaseline: getGarminAthleteBaseline(),
    rawPayloads,
  };
}

export function defaultRankingScript(): string {
  return `
activities = bundle["tables"]["activities"]
criterion = bundle.get("criterion", "demand_score")
requested_count = int(bundle.get("requestedCount", 10))

def number(value):
    return value if isinstance(value, (int, float)) else None

def score(activity):
    if criterion == "demand_score":
        duration = number(activity.get("durationSec")) or 0
        distance = number(activity.get("distanceMeters")) or 0
        elevation = number(activity.get("elevationGainMeters")) or 0
        hr = number(activity.get("avgHeartRate")) or 0
        te = number(activity.get("trainingEffect")) or 0
        return duration / 3600 + distance / 10000 + elevation / 500 + hr / 100 + te
    return number(activity.get(criterion))
ranked = []
for activity in activities:
    value = score(activity)
    if value is None:
        continue
    ranked.append((float(value), activity))
ranked = sorted(ranked, key=lambda item: item[0], reverse=True)[:requested_count]
rows = []
for index, item in enumerate(ranked):
    value = item[0]
    activity = item[1]
    rows.append({
        "rank": index + 1,
        "garminId": activity.get("garminId"),
        "label": activity.get("label"),
        "date": activity.get("date"),
        "sport": activity.get("sport"),
        "value": round(value, 2),
        "units": "composite score" if criterion == "demand_score" else criterion,
    })
RESULT = {
    "kind": "ranking",
    "criterion": criterion,
    "requestedCount": requested_count,
    "returnedCount": len(rows),
    "rows": rows,
    "limitations": [] if len(rows) >= requested_count else ["Fewer matching imported activities were available than requested."],
}
`;
}

function validateRankingResult(
  value: unknown,
  requestedCount: number,
  bundle: GarminAnalysisBundle,
): GeneratedRankingResult | null {
  if (!value || typeof value !== "object") return null;
  const record = value as GeneratedRankingResult;
  if (record.kind !== "ranking" || !Array.isArray(record.rows)) return null;
  if (record.rows.length > requestedCount || record.rows.length > 25)
    return null;
  const knownIds = new Set(
    (bundle.tables.activities as Array<{ garminId?: string }>).map(
      (activity) => activity.garminId,
    ),
  );
  for (const row of record.rows) {
    if (row.garminId && !knownIds.has(row.garminId)) return null;
    if (payloadHasSecretLikeText(row)) return null;
  }
  return {
    kind: "ranking",
    criterion: String(record.criterion ?? "generated analysis").slice(0, 120),
    requestedCount,
    returnedCount: record.rows.length,
    rows: record.rows.map((row, index) => ({
      rank: index + 1,
      garminId: row.garminId?.slice(0, 80),
      label: row.label?.slice(0, 160),
      date: row.date?.slice(0, 40),
      sport: row.sport?.slice(0, 40),
      value:
        typeof row.value === "number"
          ? row.value
          : String(row.value).slice(0, 80),
      units: row.units?.slice(0, 80),
      notes: row.notes?.slice(0, 160),
    })),
    limitations: Array.isArray(record.limitations)
      ? record.limitations.map((item) => String(item).slice(0, 200)).slice(0, 5)
      : [],
  };
}

export async function runGeneratedGarminAnalysis(input: {
  request: string;
  criterion: GeneratedAnalysisCriterion;
  requestedCount?: number;
  script?: string;
}): Promise<GeneratedAnalysisEvidence> {
  const requestedCount = Math.min(Math.max(input.requestedCount ?? 10, 1), 25);
  const bundle = buildGarminAnalysisBundle(input.request);
  const executableBundle = {
    ...bundle,
    criterion: input.criterion,
    requestedCount,
  };
  const script = input.script?.trim() || defaultRankingScript();
  const scriptHash = createHash("sha256").update(script).digest("hex");
  const privacy =
    "Generated Python ran locally against an explicit read-only Garmin analysis bundle; no credentials, environment, filesystem paths, connector handles, or raw secret fields were exposed.";
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
      criterion: input.criterion,
      requestedCount,
      scriptHash,
      manifest: bundle.manifest,
      reason: sandbox.reason,
      warnings: sandbox.warnings,
      privacy,
    };
  }
  const result = validateRankingResult(sandbox.result, requestedCount, bundle);
  if (!result) {
    return {
      tool: "generatedGarminAnalysis",
      status: "rejected",
      criterion: input.criterion,
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
    criterion: result.criterion,
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
