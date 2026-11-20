import { officialProtocol } from "./official-error";
import {
  SLEEP_SCORE_COMPONENTS,
  SNOWBOARD_SPLIT_TYPES,
  type ActivityListExtras,
  type BodyBatteryDay,
  type BodyBatteryEvent,
  type DailyExtras,
  type ExtraCoverage,
  type ExtraDataGroup,
  type HrvDetail,
  type SleepDetail,
  type SleepScoreComponent,
  type SleepScoreComponentName,
  type SplitTypeSummary,
  type StressDay,
  type Vo2Branch,
  type Vo2Reading,
} from "./extra-types";

/**
 * Pure translation of the additional documented Personal API fields. Vendor
 * names stop here; feedback is kept as bounded codes, never prose. Invalid
 * values become null rather than a guessed or zero value.
 */
type Row = Record<string, unknown>;

const MAX_EVENTS_PER_DAY = 200;
const MAX_SPLIT_SUMMARIES = 50;
const MAX_OFFSET_MINUTES = 18 * 60;
const MAX_SLEEP_WINDOW_MS = 36 * 3_600_000;

function row(value: unknown): Row | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Row)
    : null;
}
function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
function numeric(value: unknown): number | null {
  if (typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value.trim()))
    return Number(value);
  return num(value);
}
function nonNegative(value: unknown): number | null {
  const parsed = num(value);
  return parsed !== null && parsed >= 0 ? parsed : null;
}
function positive(value: unknown): number | null {
  const parsed = num(value);
  return parsed !== null && parsed > 0 ? parsed : null;
}
function level(value: unknown): number | null {
  const parsed = numeric(value);
  return parsed !== null && parsed >= 0 && parsed <= 100
    ? Math.round(parsed)
    : null;
}
function seconds(milliseconds: unknown): number | null {
  const parsed = nonNegative(milliseconds);
  return parsed === null ? null : parsed / 1000;
}
/** Bounded vendor enum code; free text and long values are dropped. */
function sourceCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 &&
    trimmed.length <= 64 &&
    /^[A-Za-z0-9_.-]+$/.test(trimmed)
    ? trimmed
    : null;
}
/** Bounded ISO-like source timestamp text, or epoch ms rendered as UTC ISO. */
function timestampText(value: unknown): string | null {
  const epoch = num(value);
  if (epoch !== null && epoch > 0) {
    const date = new Date(epoch);
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
  }
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:?\d{2})?$/.test(
    trimmed,
  )
    ? trimmed
    : null;
}
function anyValue(value: Record<string, unknown>): boolean {
  return Object.values(value).some((item) => item !== null);
}
function coverage(
  group: ExtraDataGroup,
  subjectType: ExtraCoverage["subjectType"],
  subjectId: string,
  populated: boolean,
): ExtraCoverage {
  return {
    group,
    subjectType,
    subjectId,
    status: populated ? "populated" : "empty",
    reason: populated ? null : "source-empty",
  };
}

// ---- sleep ----

const SLEEP_COMPONENT_KEYS: Record<SleepScoreComponentName, string> = {
  overall: "overall",
  deep: "deepPercentage",
  light: "lightPercentage",
  rem: "remPercentage",
  total_duration: "totalDuration",
  stress: "stress",
  awake_count: "awakeCount",
  restlessness: "restlessness",
};
const VALUED_COMPONENTS = new Set<SleepScoreComponentName>([
  "overall",
  "deep",
  "light",
  "rem",
]);

function sleepComponents(scores: Row | null): SleepScoreComponent[] | null {
  if (!scores) return null;
  const components: SleepScoreComponent[] = [];
  for (const component of SLEEP_SCORE_COMPONENTS) {
    const item = row(scores[SLEEP_COMPONENT_KEYS[component]]);
    if (!item) continue;
    const value = VALUED_COMPONENTS.has(component) ? level(item.value) : null;
    const entry: SleepScoreComponent = {
      component,
      value,
      qualifier: sourceCode(item.qualifierKey),
      optimalStart: num(item.optimalStart),
      optimalEnd: num(item.optimalEnd),
      idealStartSeconds: nonNegative(item.idealStartInSeconds),
      idealEndSeconds: nonNegative(item.idealEndInSeconds),
    };
    if (
      [
        entry.value,
        entry.qualifier,
        entry.optimalStart,
        entry.optimalEnd,
        entry.idealStartSeconds,
        entry.idealEndSeconds,
      ].some((field) => field !== null)
    )
      components.push(entry);
  }
  return components;
}

/** Source GMT/local epoch-ms pair; never interpreted in the host timezone. */
function sleepTiming(sleep: Row) {
  const startGmt = numeric(sleep.sleepStartTimestampGMT);
  const endGmt = numeric(sleep.sleepEndTimestampGMT);
  const startLocal = numeric(sleep.sleepStartTimestampLocal);
  const endLocal = numeric(sleep.sleepEndTimestampLocal);
  const none = {
    startGmtMs: null,
    endGmtMs: null,
    startLocal: null,
    endLocal: null,
    utcOffsetMinutes: null,
  };
  if (startGmt === null || endGmt === null || startGmt <= 0) return none;
  if (endGmt < startGmt || endGmt - startGmt > MAX_SLEEP_WINDOW_MS) return none;
  const local = (value: number | null) =>
    value !== null && value > 0
      ? new Date(value).toISOString().slice(0, 19)
      : null;
  let offset: number | null = null;
  if (startLocal !== null && endLocal !== null) {
    const startOffset = Math.round((startLocal - startGmt) / 60_000);
    const endOffset = Math.round((endLocal - endGmt) / 60_000);
    // A DST change inside the window is allowed; anything else is inconsistent.
    if (
      Math.abs(startOffset) <= MAX_OFFSET_MINUTES &&
      Math.abs(endOffset) <= MAX_OFFSET_MINUTES &&
      Math.abs(startOffset - endOffset) <= 60
    )
      offset = startOffset;
  }
  return {
    startGmtMs: Math.round(startGmt),
    endGmtMs: Math.round(endGmt),
    startLocal: offset === null ? null : local(startLocal),
    endLocal: offset === null ? null : local(endLocal),
    utcOffsetMinutes: offset,
  };
}

function sleepDetail(sleep: Row): {
  detail: SleepDetail;
  components: SleepScoreComponent[] | null;
} {
  const scores = row(sleep.sleepScores);
  const overall = row(scores?.overall);
  const awake = nonNegative(sleep.awakeCount);
  const unmeasurable = nonNegative(sleep.unmeasurableSleepSeconds);
  return {
    detail: {
      ...sleepTiming(sleep),
      awakeCount: awake === null ? null : Math.round(awake),
      avgSleepStress: nonNegative(sleep.avgSleepStress),
      avgHeartRate: positive(sleep.avgHeartRate),
      unmeasurableSeconds:
        unmeasurable === null ? null : Math.round(unmeasurable),
      windowConfirmationType: sourceCode(sleep.sleepWindowConfirmationType),
      overallScore: level(overall?.value),
      overallQualifier: sourceCode(overall?.qualifierKey),
      feedbackCode: sourceCode(sleep.sleepScoreFeedback),
      insightCode: sourceCode(sleep.sleepScoreInsight),
      personalizedInsightCode: sourceCode(sleep.sleepScorePersonalizedInsight),
    },
    components: sleepComponents(scores),
  };
}

// ---- HRV ----

function hrvDetail(hrv: Row): HrvDetail {
  const baseline = row(hrv.baseline);
  return {
    weeklyAvgMs: positive(hrv.weeklyAvg),
    lastNight5MinHighMs: positive(hrv.lastNight5MinHigh),
    baselineLowUpperMs: positive(baseline?.lowUpper),
    baselineBalancedLowMs: positive(baseline?.balancedLow),
    baselineBalancedUpperMs: positive(baseline?.balancedUpper),
    baselineMarkerValue: num(baseline?.markerValue),
    feedbackCode: sourceCode(hrv.feedbackPhrase),
  };
}

// ---- Body Battery ----

function feedbackEvent(value: unknown) {
  const event = row(value);
  return {
    level: level(event?.bodyBatteryLevel),
    at: timestampText(event?.eventTimestampGmt),
    short: sourceCode(event?.feedbackShortType),
    long: sourceCode(event?.feedbackLongType),
  };
}

function bodyBatteryEvents(list: unknown): BodyBatteryEvent[] | null {
  if (!Array.isArray(list)) return null;
  const events = new Map<string, BodyBatteryEvent>();
  for (const item of list.slice(0, MAX_EVENTS_PER_DAY)) {
    const event = row(item);
    if (!event) continue;
    const type = sourceCode(event.eventType);
    const startGmt = timestampText(event.eventStartTimeGmt);
    const durationMs = nonNegative(
      event.durationInMillis ?? event.durationInMilliseconds,
    );
    // Without a start instant there is no stable identity: skip, never invent one.
    if (!startGmt) continue;
    const eventKey = `${type ?? "UNKNOWN"}|${startGmt}|${durationMs ?? ""}`;
    if (events.has(eventKey)) continue;
    const impact = num(event.bodyBatteryImpact);
    const activityId = num(event.activityId);
    events.set(eventKey, {
      eventKey,
      eventType: type,
      startGmt,
      startLocal: timestampText(event.eventStartTimeLocal),
      durationSeconds: durationMs === null ? null : durationMs / 1000,
      impact:
        impact !== null && Math.abs(impact) <= 100 ? Math.round(impact) : null,
      feedbackType: sourceCode(event.feedbackType),
      shortFeedback: sourceCode(event.shortFeedback),
      sourceActivityId:
        activityId !== null &&
        Number.isSafeInteger(activityId) &&
        activityId > 0
          ? String(activityId)
          : null,
    });
  }
  return [...events.values()];
}

function bodyBattery(value: Row): {
  day: BodyBatteryDay;
  events: BodyBatteryEvent[] | null;
} {
  const feedback = feedbackEvent(value.dynamicFeedbackEvent);
  const endOfDay = feedbackEvent(value.endOfDayDynamicFeedbackEvent);
  const charged = nonNegative(value.chargedValue);
  const drained = nonNegative(value.drainedValue);
  return {
    day: {
      minLevel: level(value.minValue),
      maxLevel: level(value.maxValue),
      charged: charged === null ? null : Math.round(charged),
      drained: drained === null ? null : Math.round(drained),
      latestLevel: level(value.latestValue),
      endOfDayLevel: level(value.endOfDayValue),
      feedbackLevel: feedback.level,
      feedbackAtGmt: feedback.at,
      feedbackShortCode: feedback.short,
      feedbackLongCode: feedback.long,
      endOfDayFeedbackLevel: endOfDay.level,
      endOfDayFeedbackAtGmt: endOfDay.at,
      endOfDayFeedbackShortCode: endOfDay.short,
      endOfDayFeedbackLongCode: endOfDay.long,
    },
    events: bodyBatteryEvents(value.activityEvents),
  };
}

// ---- stress ----

const STRESS_BUCKETS = [
  ["rest", "restDurationInMillis", "restProportion"],
  ["activity", "activityDurationInMillis", "activityProportion"],
  ["uncategorized", "uncategorizedDurationInMillis", "uncategorizedProportion"],
  ["low", "lowStressDurationInMillis", "lowStressProportion"],
  ["medium", "mediumStressDurationInMillis", "mediumStressProportion"],
  ["high", "highStressDurationInMillis", "highStressProportion"],
] as const;

/**
 * The proportion scale (0–1 or percent) is not documented, so it is accepted
 * only when it agrees with the same row's own duration/total ratio for every
 * bucket that carries both; otherwise fractions stay unknown (null).
 */
function stressFractionScale(stress: Row, total: number | null): number | null {
  if (total === null || total <= 0) return null;
  let scale: number | null = null;
  let compared = 0;
  for (const [, durationKey, proportionKey] of STRESS_BUCKETS) {
    const proportion = nonNegative(stress[proportionKey]);
    const duration = seconds(stress[durationKey]);
    if (proportion === null || duration === null) continue;
    const ratio = duration / total;
    const candidate =
      Math.abs(proportion - ratio) <= 0.02
        ? 1
        : Math.abs(proportion / 100 - ratio) <= 0.02
          ? 100
          : null;
    // A zero ratio is consistent with both scales and decides nothing.
    if (ratio === 0 && proportion === 0) continue;
    if (candidate === null || (scale !== null && candidate !== scale))
      return null;
    scale = candidate;
    compared += 1;
  }
  return compared > 0 ? scale : null;
}

function stressDay(stress: Row): StressDay {
  const total = seconds(stress.totalDurationInMillis);
  const scale = stressFractionScale(stress, total);
  const values = Object.fromEntries(
    STRESS_BUCKETS.flatMap(([name, durationKey, proportionKey]) => {
      const proportion = nonNegative(stress[proportionKey]);
      return [
        [`${name}Seconds`, seconds(stress[durationKey])],
        [
          `${name}Fraction`,
          scale === null || proportion === null ? null : proportion / scale,
        ],
      ];
    }),
  );
  const average = num(stress.avgLevel);
  const maximum = num(stress.maxLevel);
  return {
    // Garmin uses negative sentinels for "not enough data": unknown, not zero.
    avgLevel: average !== null && average >= 0 ? Math.round(average) : null,
    maxLevel: maximum !== null && maximum >= 0 ? Math.round(maximum) : null,
    qualifier: sourceCode(stress.qualifier),
    totalSeconds: total,
    ...(values as Omit<
      StressDay,
      "avgLevel" | "maxLevel" | "qualifier" | "totalSeconds"
    >),
  };
}

// ---- daily assembly ----

export type OfficialExtraSources = {
  summary: Row | undefined;
  sleep: Row | undefined;
  hrv: Row | undefined;
  /** Readings for this date, or "failed" when the VO2 range read failed. */
  vo2: Vo2Reading[] | "failed" | undefined;
};

export function officialDailyExtras(
  date: string,
  sources: OfficialExtraSources,
): DailyExtras {
  const covered: ExtraCoverage[] = [];
  const sleep = sources.sleep ? sleepDetail(sources.sleep) : null;
  covered.push(
    coverage(
      "sleep",
      "date",
      date,
      Boolean(
        sleep && (anyValue(sleep.detail) || (sleep.components ?? []).length),
      ),
    ),
  );
  const hrv = sources.hrv ? hrvDetail(sources.hrv) : null;
  covered.push(coverage("hrv", "date", date, Boolean(hrv && anyValue(hrv))));
  const batteryRow = row(sources.summary?.bodyBattery);
  const battery = batteryRow ? bodyBattery(batteryRow) : null;
  covered.push(
    coverage(
      "body_battery",
      "date",
      date,
      Boolean(
        battery && (anyValue(battery.day) || (battery.events ?? []).length),
      ),
    ),
  );
  const stressRow = row(sources.summary?.stress);
  const stress = stressRow ? stressDay(stressRow) : null;
  covered.push(
    coverage("stress", "date", date, Boolean(stress && anyValue(stress))),
  );
  let vo2: Vo2Reading[] | undefined;
  if (sources.vo2 === "failed")
    covered.push({
      group: "vo2_max",
      subjectType: "date",
      subjectId: date,
      status: "failed",
      reason: "read-failed",
    });
  else if (sources.vo2) {
    vo2 = sources.vo2;
    covered.push(coverage("vo2_max", "date", date, vo2.length > 0));
  }
  return {
    date,
    sleep,
    hrv,
    bodyBattery: battery,
    stress,
    ...(vo2 ? { vo2 } : {}),
    coverage: covered,
  };
}

// ---- VO2 max ----

const VO2_BRANCHES: Vo2Branch[] = ["generic", "cycling", "rowing"];

function vo2Value(value: unknown): number | null {
  const parsed = positive(value);
  return parsed !== null && parsed <= 100 ? parsed : null;
}

/** Sparse dated readings keyed by date; a missing date is not a reading. */
export function parseVo2Range(
  payload: unknown,
  startDate: string,
  endDate: string,
): Map<string, Vo2Reading[]> {
  if (payload === null || payload === undefined) return new Map();
  if (!Array.isArray(payload)) throw officialProtocol("Expected a list reply.");
  const byKey = new Map<string, Vo2Reading>();
  for (const item of payload) {
    const entry = row(item);
    if (!entry) throw officialProtocol("Expected object rows.");
    for (const branch of VO2_BRANCHES) {
      const reading = row(entry[branch]);
      if (!reading) continue;
      const date = reading.calendarDate ?? entry.calendarDate;
      if (
        typeof date !== "string" ||
        !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
        date < startDate ||
        date > endDate
      )
        throw officialProtocol("Reply contained an out-of-range date.");
      const value: Vo2Reading = {
        date,
        branch,
        vo2Max: vo2Value(reading.vo2MaxValue),
        vo2MaxPrecise: vo2Value(reading.vo2MaxPreciseValue),
        sport: sourceCode(reading.sport),
        subSport: sourceCode(reading.subSport),
      };
      if (value.vo2Max === null && value.vo2MaxPrecise === null) continue;
      const key = `${date}|${branch}`;
      const previous = byKey.get(key);
      if (previous && JSON.stringify(previous) !== JSON.stringify(value))
        throw officialProtocol("Reply repeated a date.");
      byKey.set(key, value);
    }
  }
  const byDate = new Map<string, Vo2Reading[]>();
  for (const reading of byKey.values())
    byDate.set(reading.date, [...(byDate.get(reading.date) ?? []), reading]);
  return byDate;
}

// ---- activity list ----

const SPLIT_TYPES = new Set<string>(SNOWBOARD_SPLIT_TYPES);

function splitSummaries(value: unknown): SplitTypeSummary[] | null {
  if (!Array.isArray(value)) return null;
  const byType = new Map<string, SplitTypeSummary | "ambiguous">();
  for (const item of value.slice(0, MAX_SPLIT_SUMMARIES)) {
    const split = row(item);
    const type = typeof split?.splitType === "string" ? split.splitType : null;
    // Only verified per-type snowboard summaries; other split kinds are ignored.
    if (!split || !type || !SPLIT_TYPES.has(type)) continue;
    if (byType.has(type)) {
      byType.set(type, "ambiguous");
      continue;
    }
    const count = nonNegative(split.noOfSplits);
    const falls = nonNegative(split.numFalls);
    const sends = nonNegative(split.numClimbSends);
    byType.set(type, {
      splitType: type as SplitTypeSummary["splitType"],
      count: count === null ? null : Math.round(count),
      durationSec: nonNegative(split.duration),
      distanceMeters: nonNegative(split.distance),
      avgSpeedMps: nonNegative(split.averageSpeed),
      maxSpeedMps: nonNegative(split.maxSpeed),
      totalAscentMeters: nonNegative(split.totalAscent),
      elevationLossMeters: nonNegative(split.elevationLoss),
      avgElevationGainMeters: nonNegative(split.averageElevationGain),
      maxElevationGainMeters: nonNegative(split.maxElevationGain),
      maxDistanceMeters:
        nonNegative(split.maxDistanceWithPrecision) ??
        nonNegative(split.maxDistance),
      numFalls: falls === null ? null : Math.round(falls),
      numClimbSends: sends === null ? null : Math.round(sends),
    });
  }
  return [...byType.values()].filter(
    (entry): entry is SplitTypeSummary => entry !== "ambiguous",
  );
}

/** Additional evidence on one activity-list row (or its `summaryDTO`). */
export function officialActivityListExtras(
  garminId: string,
  list: Row,
): ActivityListExtras {
  const summary = row(list.summaryDTO) ?? {};
  const pick = (key: string) => list[key] ?? summary[key];
  const delta = num(pick("differenceBodyBattery"));
  const dynamics = {
    avgRunCadenceSpm: positive(pick("averageRunningCadenceInStepsPerMinute")),
    maxRunCadenceSpm: positive(pick("maxRunningCadenceInStepsPerMinute")),
    avgDoubleCadenceSpm: positive(pick("avgDoubleCadence")),
    maxDoubleCadenceSpm: positive(pick("maxDoubleCadence")),
    avgFractionalCadenceSpm: nonNegative(pick("avgFractionalCadence")),
    maxFractionalCadenceSpm: nonNegative(pick("maxFractionalCadence")),
    avgStrideLengthCm: positive(pick("avgStrideLength")),
    avgVerticalOscillationCm: positive(pick("avgVerticalOscillation")),
    avgGroundContactTimeMs: positive(pick("avgGroundContactTime")),
    avgGroundContactBalancePct: positive(pick("avgGroundContactBalance")),
    avgVerticalRatioPct: positive(pick("avgVerticalRatio")),
    avgGradeAdjustedSpeedMps: positive(pick("avgGradeAdjustedSpeed")),
  };
  const splits = splitSummaries(pick("splitSummaries"));
  const bodyBatteryDelta =
    delta !== null && Math.abs(delta) <= 100 ? Math.round(delta) : null;
  return {
    garminId,
    bodyBatteryDelta,
    ...dynamics,
    splits,
    coverage: [
      coverage(
        "activity_body_battery",
        "activity",
        garminId,
        bodyBatteryDelta !== null,
      ),
      coverage("running_dynamics", "activity", garminId, anyValue(dynamics)),
      coverage(
        "snowboard_splits",
        "activity",
        garminId,
        (splits ?? []).length > 0,
      ),
    ],
  };
}
