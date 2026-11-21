import {
  ACTIVITY_SUPPLEMENT_GROUPS,
  HEALTH_SUPPLEMENT_GROUPS,
  SNOW_RUN_LIST_LIMIT,
  type ActivitySupplement,
  type HealthSupplementDay,
  type HealthSupplements,
  type LapZoneEvidence,
  type SleepComponentEvidence,
  type SnowRunEntry,
  type SupplementCoverage,
  type Vo2Point,
} from "./supplement-contracts";

/**
 * Interprets independently read child sets into the Health/Activity supplement
 * shapes. No storage, vendor or UI dependency. Rules enforced here: an absent
 * coverage row is `not_imported` (unknown); a populated group never implies every
 * field exists; nothing is zero-filled, forward-filled or averaged.
 */

const NOT_IMPORTED: SupplementCoverage = {
  status: "not_imported",
  reason: null,
};

function coverageFor<G extends string>(
  groups: readonly G[],
  found: ReadonlyMap<string, SupplementCoverage> | undefined,
) {
  return Object.fromEntries(
    groups.map((group) => [group, found?.get(group) ?? NOT_IMPORTED]),
  ) as Record<G, SupplementCoverage>;
}

type DateRows<T> = Array<T & { date: string }>;
const byDate = <T>(rows: DateRows<T>) =>
  new Map(rows.map((row) => [row.date, row]));

export function interpretHealthSupplements(input: {
  from: string;
  to: string;
  sleep: DateRows<{ overallQualifier: string | null }>;
  components: DateRows<{
    component: string;
    value: number | null;
    qualifier: string | null;
  }>;
  hrv: DateRows<{
    weeklyAvgMs: number | null;
    balancedLowMs: number | null;
    balancedUpperMs: number | null;
    feedbackCode: string | null;
  }>;
  stress: DateRows<{
    totalSeconds: number | null;
    restSeconds: number | null;
    lowSeconds: number | null;
    mediumSeconds: number | null;
    highSeconds: number | null;
    activitySeconds: number | null;
    uncategorizedSeconds: number | null;
  }>;
  battery: DateRows<{ charged: number | null; drained: number | null }>;
  vo2: Vo2Point[];
  coverage: Map<string, Map<string, SupplementCoverage>>;
}): HealthSupplements {
  const sleep = byDate(input.sleep);
  const hrv = byDate(input.hrv);
  const stress = byDate(input.stress);
  const battery = byDate(input.battery);
  const components = new Map<string, SleepComponentEvidence[]>();
  for (const row of input.components)
    components.set(row.date, [
      ...(components.get(row.date) ?? []),
      { component: row.component, value: row.value, qualifier: row.qualifier },
    ]);
  const dates = new Set<string>([
    ...sleep.keys(),
    ...components.keys(),
    ...hrv.keys(),
    ...stress.keys(),
    ...battery.keys(),
    ...input.coverage.keys(),
  ]);
  const days = [...dates].sort().map((date): HealthSupplementDay => {
    const sleepRow = sleep.get(date);
    const sleepComponents = components.get(date);
    const hrvRow = hrv.get(date);
    const stressRow = stress.get(date);
    const batteryRow = battery.get(date);
    return {
      date,
      hrv: hrvRow
        ? {
            weeklyAvgMs: hrvRow.weeklyAvgMs,
            // A band needs both endpoints in order; otherwise it is not drawn.
            balancedLowMs:
              hrvRow.balancedLowMs !== null &&
              hrvRow.balancedUpperMs !== null &&
              hrvRow.balancedLowMs <= hrvRow.balancedUpperMs
                ? hrvRow.balancedLowMs
                : null,
            balancedUpperMs:
              hrvRow.balancedLowMs !== null &&
              hrvRow.balancedUpperMs !== null &&
              hrvRow.balancedLowMs <= hrvRow.balancedUpperMs
                ? hrvRow.balancedUpperMs
                : null,
            feedbackCode: hrvRow.feedbackCode,
          }
        : null,
      sleep:
        sleepRow || sleepComponents
          ? {
              overallQualifier: sleepRow?.overallQualifier ?? null,
              components: sleepComponents ?? [],
            }
          : null,
      stress: stressRow
        ? {
            totalSeconds: stressRow.totalSeconds,
            restSeconds: stressRow.restSeconds,
            lowSeconds: stressRow.lowSeconds,
            mediumSeconds: stressRow.mediumSeconds,
            highSeconds: stressRow.highSeconds,
            activitySeconds: stressRow.activitySeconds,
            uncategorizedSeconds: stressRow.uncategorizedSeconds,
          }
        : null,
      bodyBattery: batteryRow
        ? { charged: batteryRow.charged, drained: batteryRow.drained }
        : null,
      coverage: coverageFor(HEALTH_SUPPLEMENT_GROUPS, input.coverage.get(date)),
    };
  });
  return {
    from: input.from,
    to: input.to,
    days,
    vo2: input.vo2,
  };
}

export function interpretActivitySupplement(input: {
  metrics: {
    bodyBatteryDelta: number | null;
    avgSpm: number | null;
    maxSpm: number | null;
    strideLengthCm: number | null;
    fitAvgCpm: number | null;
    fitStepLengthM: number | null;
  } | null;
  lapNumbers: number[];
  zones: Array<{
    lapNumber: number;
    bucket: number;
    kind: "below" | "zone" | "above";
    zone: number | null;
    seconds: number;
    lowerBpm: number | null;
    upperBpm: number | null;
    calcMethod: string | null;
    sourceMaxHeartRate: number | null;
    sourceRestingHeartRate: number | null;
  }>;
  totals: ActivitySupplement["snowTotals"];
  snowActivity?: boolean;
  runTotal: number;
  runs: SnowRunEntry[];
  coverage: ReadonlyMap<string, SupplementCoverage>;
}): ActivitySupplement {
  const known = new Set(input.lapNumbers);
  const laps = new Map<number, LapZoneEvidence>();
  for (const row of input.zones) {
    // Zone rows are keyed by lap identity; a row for an unlisted lap is ignored,
    // never attached to a neighbouring lap.
    if (!known.has(row.lapNumber)) continue;
    const lap = laps.get(row.lapNumber) ?? {
      lapNumber: row.lapNumber,
      calcMethod: row.calcMethod,
      sourceMaxHeartRate: row.sourceMaxHeartRate,
      sourceRestingHeartRate: row.sourceRestingHeartRate,
      buckets: [],
    };
    lap.buckets.push({
      bucket: row.bucket,
      kind: row.kind,
      zone: row.zone,
      seconds: row.seconds,
      lowerBpm: row.lowerBpm,
      upperBpm: row.upperBpm,
    });
    laps.set(row.lapNumber, lap);
  }
  const metrics = input.metrics;
  return {
    bodyBatteryDelta: metrics?.bodyBatteryDelta ?? null,
    listCadence: {
      avgSpm: metrics?.avgSpm ?? null,
      maxSpm: metrics?.maxSpm ?? null,
      strideLengthCm: metrics?.strideLengthCm ?? null,
    },
    fitCadence: {
      avgCpm: metrics?.fitAvgCpm ?? null,
      stepLengthM: metrics?.fitStepLengthM ?? null,
    },
    lapZones: [...laps.values()],
    snowTotals: input.totals,
    snowRuns: {
      relevant:
        input.snowActivity === true ||
        input.runTotal > 0 ||
        input.totals.length > 0 ||
        input.coverage.has("snow_run_lift_splits") ||
        input.coverage.has("snowboard_splits"),
      total: input.runTotal,
      returned: input.runs.length,
      truncated:
        input.runTotal > Math.min(input.runs.length, SNOW_RUN_LIST_LIMIT),
      entries: input.runs,
    },
    coverage: coverageFor(ACTIVITY_SUPPLEMENT_GROUPS, input.coverage),
  };
}
