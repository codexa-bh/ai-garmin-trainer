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
  | "sport_aware_demand_score"
  | "elevationGainMeters"
  | "distanceMeters"
  | "durationSec"
  | "avgHeartRate"
  | "trainingEffect";

export type GeneratedAnalysisActivityFilter = {
  includeSports?: string[];
  excludeSports?: string[];
};

type NormalizedGeneratedAnalysisActivityFilter = {
  includeSports: string[];
  excludeSports: string[];
};

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
    activityFilter?: NormalizedGeneratedAnalysisActivityFilter;
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
const MAX_FILTER_TERMS = 8;
const MAX_FILTER_TERM_LENGTH = 40;

function normalizeFilterText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeFilterTerms(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return [
    ...new Set(
      values
        .map((value) =>
          typeof value === "string" ? normalizeFilterText(value) : "",
        )
        .filter(
          (value) =>
            value.length >= 2 && value.length <= MAX_FILTER_TERM_LENGTH,
        )
        .slice(0, MAX_FILTER_TERMS),
    ),
  ];
}

function normalizeGeneratedAnalysisActivityFilter(
  filter?: GeneratedAnalysisActivityFilter,
): NormalizedGeneratedAnalysisActivityFilter {
  return {
    includeSports: normalizeFilterTerms(filter?.includeSports),
    excludeSports: normalizeFilterTerms(filter?.excludeSports),
  };
}

function hasActiveActivityFilter(
  filter: NormalizedGeneratedAnalysisActivityFilter | undefined,
): filter is NormalizedGeneratedAnalysisActivityFilter {
  return Boolean(filter?.includeSports.length || filter?.excludeSports.length);
}

function activityFilterSearchText(activity: {
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
  return activityFilterSearchText(activity).includes(term);
}

function activityPassesFilter(
  activity: { sport?: unknown; label?: unknown },
  filter: NormalizedGeneratedAnalysisActivityFilter,
): boolean {
  const included =
    filter.includeSports.length === 0 ||
    filter.includeSports.some((term) => activityMatchesTerm(activity, term));
  const excluded = filter.excludeSports.some((term) =>
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

export function buildGarminAnalysisBundle(
  request: string,
  activityFilter?: GeneratedAnalysisActivityFilter,
): GarminAnalysisBundle {
  const normalizedFilter =
    normalizeGeneratedAnalysisActivityFilter(activityFilter);
  const activities = listActivitiesForComparison(MAX_ROWS_PER_TABLE)
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
    .filter((activity) => activityPassesFilter(activity, normalizedFilter));
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
      activityFilter: hasActiveActivityFilter(normalizedFilter)
        ? normalizedFilter
        : undefined,
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
request_text = str(bundle.get("request") or bundle.get("manifest", {}).get("request") or "").lower()
request_is_snowboarding = "snowboard" in request_text

def number(value):
    return value if isinstance(value, (int, float)) else None

def compact_number(value, digits=0):
    rounded = round(value, digits)
    return ("{:,.0f}" if digits == 0 else "{:,.1f}").format(rounded)

def activity_text(activity):
    return (str(activity.get("sport") or "") + " " + str(activity.get("label") or "")).lower()

def is_snowboarding_activity(activity):
    return "snowboard" in activity_text(activity)

def sport_aware_snowboarding_score(activity):
    notes = []
    limitations = []
    score = 0
    calories = number(activity.get("calories"))
    distance = number(activity.get("distanceMeters"))
    descent = number(activity.get("elevationLossMeters"))
    duration = number(activity.get("durationSec"))
    avg_hr = number(activity.get("avgHeartRate"))
    max_hr = number(activity.get("maxHeartRate"))
    training_effect = number(activity.get("trainingEffect"))
    if calories is None:
        limitations.append("calories unavailable")
    else:
        score += calories / 100
        notes.append(compact_number(calories) + " kcal")
    if distance is None:
        limitations.append("distance unavailable")
    else:
        score += distance / 10000
        notes.append(compact_number(distance / 1000, 1) + " km")
    if descent is None:
        limitations.append("descent unavailable")
    else:
        score += descent / 500
        notes.append(compact_number(descent) + " m descent")
    if duration is not None:
        score += duration / 3600
        notes.append(compact_number(duration / 60) + " min")
    if avg_hr is not None:
        score += avg_hr / 100
        notes.append(compact_number(avg_hr) + " bpm avg HR")
    elif max_hr is not None:
        score += max_hr / 150
        notes.append(compact_number(max_hr) + " bpm max HR")
    if training_effect is not None:
        score += training_effect
        notes.append("TE " + compact_number(training_effect, 1))
    notes.append("ascent excluded for resort/lift context")
    if limitations:
        notes.extend(limitations)
    return score, "; ".join(notes), limitations

def score(activity):
    if criterion == "sport_aware_demand_score":
        return sport_aware_snowboarding_score(activity)
    if criterion == "demand_score":
        if request_is_snowboarding and is_snowboarding_activity(activity):
            return sport_aware_snowboarding_score(activity)
        duration = number(activity.get("durationSec")) or 0
        distance = number(activity.get("distanceMeters")) or 0
        elevation = number(activity.get("elevationGainMeters")) or 0
        hr = number(activity.get("avgHeartRate")) or 0
        te = number(activity.get("trainingEffect")) or 0
        return duration / 3600 + distance / 10000 + elevation / 500 + hr / 100 + te, "", []
    value = number(activity.get(criterion))
    return value, "", []
ranked = []
all_limitations = []
for activity in activities:
    if criterion == "sport_aware_demand_score" and request_is_snowboarding and not is_snowboarding_activity(activity):
        continue
    value, notes, limitations = score(activity)
    if value is None:
        continue
    for limitation in limitations:
        if limitation not in all_limitations:
            all_limitations.append(limitation)
    ranked.append((float(value), activity, notes))
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
        "units": "sport-aware composite score" if criterion == "sport_aware_demand_score" else ("composite score" if criterion == "demand_score" else criterion),
        "notes": item[2],
    })
limitations = []
if len(rows) >= requested_count:
    limitations = []
else:
    limitations = ["Fewer matching imported activities were available than requested."]
if criterion == "sport_aware_demand_score" and request_is_snowboarding and not rows:
    limitations.append("No imported snowboarding activities matched the request.")
for limitation in all_limitations:
    if limitation == "calories unavailable":
        message = "Some snowboarding rows report calories are missing in local data; scores use distance, descent, duration, heart-rate, and training-effect fields that are available."
    elif limitation == "descent unavailable":
        message = "Some snowboarding rows have descent unavailable; scores do not invent elevation loss."
    else:
        message = "Some snowboarding rows have " + limitation + "; scores use remaining available local metrics."
    if message not in limitations:
        limitations.append(message)
RESULT = {
    "kind": "ranking",
    "criterion": criterion,
    "requestedCount": requested_count,
    "returnedCount": len(rows),
    "rows": rows,
    "limitations": limitations[:5],
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
  const knownActivities = new Map(
    (
      bundle.tables.activities as Array<{
        garminId?: string;
        label?: string;
        date?: string;
        sport?: string;
      }>
    )
      .filter((activity) => activity.garminId)
      .map((activity) => [activity.garminId as string, activity]),
  );
  const filterIsActive = hasActiveActivityFilter(
    bundle.manifest.activityFilter,
  );
  for (const row of record.rows) {
    if (row.garminId && !knownActivities.has(row.garminId)) return null;
    if (filterIsActive && !row.garminId) return null;
    if (payloadHasSecretLikeText(row)) return null;
  }
  return {
    kind: "ranking",
    criterion: String(record.criterion ?? "generated analysis").slice(0, 120),
    requestedCount,
    returnedCount: record.rows.length,
    rows: record.rows.map((row, index) => {
      const activity = row.garminId ? knownActivities.get(row.garminId) : null;
      return {
        rank: index + 1,
        garminId: row.garminId?.slice(0, 80),
        label: (activity?.label ?? row.label)?.slice(0, 160),
        date: (activity?.date ?? row.date)?.slice(0, 40),
        sport: (activity?.sport ?? row.sport)?.slice(0, 40),
        value:
          typeof row.value === "number"
            ? row.value
            : String(row.value).slice(0, 80),
        units: row.units?.slice(0, 80),
        notes: row.notes?.slice(0, 160),
      };
    }),
    limitations: Array.isArray(record.limitations)
      ? record.limitations.map((item) => String(item).slice(0, 200)).slice(0, 5)
      : [],
  };
}

export async function runGeneratedGarminAnalysis(input: {
  request: string;
  criterion: GeneratedAnalysisCriterion;
  requestedCount?: number;
  activityFilter?: GeneratedAnalysisActivityFilter;
  script?: string;
}): Promise<GeneratedAnalysisEvidence> {
  const requestedCount = Math.min(Math.max(input.requestedCount ?? 10, 1), 25);
  const bundle = buildGarminAnalysisBundle(input.request, input.activityFilter);
  const executableBundle = {
    ...bundle,
    criterion: input.criterion,
    requestedCount,
    request: input.request,
    activityFilter: bundle.manifest.activityFilter,
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
