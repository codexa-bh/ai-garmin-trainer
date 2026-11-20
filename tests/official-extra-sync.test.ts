import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type Account,
  accountApi,
  activityRow,
  addDays,
  fitFor,
  newAccount,
} from "./official-api-fixture";

/**
 * End-to-end: authored Personal API/FIT → official reader → real import
 * application (production composition store) → real SQLite → guarded SQL.
 */
const NOW = new Date("2026-09-21T12:00:00Z");
let directory: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "official-extra-"));
  vi.stubEnv("DATABASE_PATH", join(directory, "test.sqlite"));
  vi.stubEnv("TZ", "UTC");
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.resetModules();
});
afterEach(async () => {
  const { getDatabase } = await import("../src/lib/db/connection");
  getDatabase().close();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  rmSync(directory, { recursive: true, force: true });
});

const RICH_DAY = {
  sleep: {
    sleepStartTimestampGMT: Date.parse("2026-09-18T22:00:00Z"),
    sleepEndTimestampGMT: Date.parse("2026-09-19T05:30:00Z"),
    sleepStartTimestampLocal: Date.parse("2026-09-19T00:00:00Z"),
    sleepEndTimestampLocal: Date.parse("2026-09-19T07:30:00Z"),
    awakeCount: 3,
    sleepScoreFeedback: "POSITIVE_DEEP",
    sleepScores: {
      overall: { value: 82, qualifierKey: "GOOD" },
      deepPercentage: {
        value: 24,
        qualifierKey: "EXCELLENT",
        optimalStart: 16,
        optimalEnd: 33,
      },
      stress: { qualifierKey: "GOOD", optimalStart: 0, optimalEnd: 15 },
    },
  },
  hrv: {
    weeklyAvg: 60,
    lastNight5MinHigh: 88,
    feedbackPhrase: "HRV_BALANCED_1",
    baseline: {
      lowUpper: 45,
      balancedLow: 50,
      balancedUpper: 70,
      markerValue: 0.5,
    },
  },
  summary: {
    bodyBattery: {
      minValue: 15,
      chargedValue: 60,
      drainedValue: 65,
      activityEvents: [
        {
          eventType: "ACTIVITY",
          eventStartTimeGmt: "2026-09-19T07:00:00.0",
          bodyBatteryImpact: -12,
          durationInMillis: 1_800_000,
          shortFeedback: "ACTIVE",
        },
      ],
    },
    stress: {
      maxLevel: 88,
      totalDurationInMillis: 72_000_000,
      lowStressDurationInMillis: 36_000_000,
      highStressDurationInMillis: 3_600_000,
      lowStressProportion: 0.5,
      highStressProportion: 0.05,
    },
  },
};

function populate(account: Account) {
  for (let i = 0; i < 21; i += 1)
    account.days.set(addDays("2026-08-31", i), { hours: 24, steps: 5000 + i });
  account.days.set("2026-09-19", { hours: 24, steps: 7777, extra: RICH_DAY });
  account.vo2.push({
    generic: {
      calendarDate: "2026-09-12",
      vo2MaxValue: 46,
      vo2MaxPreciseValue: 45.7,
      sport: "WALKING",
    },
    cycling: null,
  });
  account.activities.push(
    activityRow(9001, "2026-09-18 07:00:00", {
      differenceBodyBattery: -9,
      averageRunningCadenceInStepsPerMinute: 158,
      avgStrideLength: 98.5,
    }),
    activityRow(9002, "2026-09-20 09:00:00", {
      activityType: { typeKey: "resort_snowboarding" },
      differenceBodyBattery: -20,
      splitSummaries: [
        {
          splitType: "SKI_RUN_SPLIT",
          noOfSplits: 9,
          distance: 12_000,
          maxSpeed: 15.2,
        },
        { splitType: "SKI_LIFT_SPLIT", noOfSplits: 8, duration: 2400 },
      ],
    }),
  );
  account.files.set(
    "9001",
    fitFor({
      sessionZones: [0, 10, 20, 30, 40, 50],
      highBoundaries: [100, 115, 130, 145, 160, 175],
      sessionCadence: { avg: 79, fraction128: 64 },
      laps: [
        { index: 0, startOffset: 0, cadence: 78, cycles: 400 },
        { index: 1, startOffset: 1, cadence: 80, cycles: 420 },
      ],
      lapZoneMessages: [
        {
          reference: 0,
          seconds: [1, 2, 3, 4, 5, 6, 0],
          high: [100, 115, 130, 145, 160, 175],
          maxHr: 190,
        },
        {
          reference: 1,
          seconds: [0, 0, 10, 20, 0, 0, 2],
          high: [100, 115, 130, 145, 160, 175],
          maxHr: 190,
        },
      ],
    }),
  );
  // 9002 has no original file: lap evidence is unavailable, not empty.
}

async function harness(account: Account) {
  const repo = await import("../src/lib/db/repository");
  const extra = await import("../src/lib/db/extra-data-repository");
  const local = await import("../src/lib/local-data/composition");
  const { createGarminImports } = await import("../src/lib/garmin/sync-import");
  const { createOfficialReader } =
    await import("../src/lib/garmin/official-reader");
  const api = accountApi(account);
  const imports = createGarminImports({
    historyStartDate: () => "2026-09-01",
    clock: () => new Date(),
    wait: async () => undefined,
    createReader: (control) =>
      createOfficialReader({
        control,
        apiKey: () => "synthetic-key",
        fetch: api.fetch,
        clock: () => new Date(),
        archive: repo.upsertGarminRawPayload,
      }),
    store: {
      dataCounts: local.dataCounts,
      healthHistoryBounds: repo.healthHistoryBounds,
      finishSyncRun: repo.finishSyncRun,
      getCheckpoint: repo.getCheckpoint,
      getGarminAthleteBaseline: local.getGarminAthleteBaseline,
      getGarminBodyMetrics: local.getGarminBodyMetrics,
      listActivityIdsNeedingDetail: repo.listActivityIdsNeedingDetail,
      listDailyHealthMissingGapDates: repo.listDailyHealthMissingGapDates,
      listDailyHealthRepairCandidateDates:
        repo.listDailyHealthRepairCandidateDates,
      listDailyHealthIntensityRepairCandidateDates:
        repo.listDailyHealthIntensityRepairCandidateDates,
      listDailyHealthTrailingCandidateDates:
        repo.listDailyHealthTrailingCandidateDates,
      listStoredDailyHealthDates: repo.listStoredDailyHealthDates,
      listActivityIdsNeedingEffortBackfill:
        repo.listActivityIdsNeedingEffortBackfill,
      listRecentActivities: local.listRecentActivities,
      recordActivityDetailAttempt: repo.recordActivityDetailAttempt,
      recordGarminAthleteBaselineFailure:
        repo.recordGarminAthleteBaselineFailure,
      recordGarminBodyMetricsFailure: repo.recordGarminBodyMetricsFailure,
      recordSyncRun: repo.recordSyncRun,
      saveCheckpoints: repo.saveCheckpoints,
      upsertActivities: repo.upsertActivities,
      upsertActivityDetail: repo.upsertActivityDetail,
      upsertActivityHrZoneTime: repo.upsertActivityHrZoneTime,
      upsertDailyHealth: repo.upsertDailyHealth,
      upsertDailyExtras: (days) => extra.upsertDailyExtras(days),
      upsertActivityListExtras: (items) =>
        extra.upsertActivityListExtras(items),
      upsertFitActivityExtras: (id, value) =>
        extra.upsertFitActivityExtras(id, value),
      recordExtraCoverage: (entries) => extra.recordExtraCoverage(entries),
      writeGarminAthleteBaselineRefresh: repo.writeGarminAthleteBaselineRefresh,
      writeGarminBodyMetricsRefresh: repo.writeGarminBodyMetricsRefresh,
      getDetailAvailability: (id) =>
        local.getActivityDetailForAnalytics(id).availability,
    },
  });
  const { getDatabase } = await import("../src/lib/db/connection");
  const { runReadOnlySql } = await import("../src/lib/ai/sql-analysis");
  return { api, imports, db: getDatabase(), runReadOnlySql };
}

const sql = (h: Awaited<ReturnType<typeof harness>>, query: string) => {
  const result = h.runReadOnlySql({ sql: query, maxRows: 200 });
  expect(result.status, result.message).toBe("succeeded");
  return result.rows;
};

describe("additional Garmin groups through foreground Sync", () => {
  it("persists all eight groups end to end and answers bounded guarded SQL for each", async () => {
    const account = newAccount();
    populate(account);
    const h = await harness(account);
    const result = await h.imports.runGarminSync(undefined, {
      intent: "latest",
    });
    expect(result).toMatchObject({ status: "completed", detailsRemaining: 0 });
    expect(h.db.prepare("pragma integrity_check").get()).toEqual({
      integrity_check: "ok",
    });
    expect(h.db.prepare("pragma foreign_key_check").all()).toEqual([]);
    // One VO2 range read per planned block, never per day.
    const vo2Reads = h.api.requests.filter((r) => r.path.includes("maxmet"));
    expect(vo2Reads.length).toBeGreaterThan(0);
    expect(vo2Reads.length).toBe(
      h.api.requests.filter((r) => r.path.endsWith("dailysummaries")).length,
    );

    // Default consumer path uses the same imported normalized evidence, without SQL discovery.
    const local = await import("../src/lib/local-data/composition");
    const run = local.getActivityDashboard("9001")!.extraEvidence;
    expect(run).toMatchObject({
      bodyBatteryDelta: -9,
      cadence: {
        activityList: { avgRunCadenceSpm: 158, avgStrideLengthCm: 98.5 },
        fitSession: { avgCadenceCpm: 79.5, avgStepLengthM: null },
      },
      coverage: {
        activity_body_battery: { status: "populated" },
        running_dynamics: { status: "populated" },
        lap_hr_zones: { status: "populated" },
      },
      laps: {
        sourceLapCount: 2,
        returnedCount: 2,
        rows: [
          { lapNumber: 1, avgCadenceCpm: 78 },
          { lapNumber: 2, avgCadenceCpm: 80 },
        ],
      },
    });
    expect(run.laps.rows[0].heartRateZones).toMatchObject({
      sourceBucketCount: 7,
      returnedCount: 7,
      omittedCount: 0,
      buckets: [
        {
          bucket: 0,
          kind: "below",
          seconds: 1,
          upperBpm: 100,
          sourceMaxHeartRate: 190,
        },
        { bucket: 1, zone: 1, seconds: 2, lowerBpm: 100, upperBpm: 115 },
        {},
        {},
        {},
        {},
        { bucket: 6, kind: "above", seconds: 0 },
      ],
    });
    const snow = local.getActivityDashboard("9002")!.extraEvidence;
    expect(snow).toMatchObject({
      bodyBatteryDelta: -20,
      coverage: { lap_hr_zones: { status: "unavailable" } },
      snowboard: {
        sourceTypeCount: 2,
        returnedCount: 2,
        rows: [
          { splitType: "SKI_LIFT_SPLIT", count: 8, durationSec: 2400 },
          {
            splitType: "SKI_RUN_SPLIT",
            count: 9,
            distanceMeters: 12000,
            maxSpeedMps: 15.2,
          },
        ],
      },
    });
    expect(snow.snowboard.meaning).toContain("not individual");

    // 1. Sleep components/timing
    expect(
      sql(
        h,
        "select c.component, c.value, c.qualifier, d.start_local, d.utc_offset_minutes, d.feedback_code from daily_sleep_score_component c join daily_sleep_detail d on d.date = c.date where c.date = '2026-09-19' order by c.component",
      ),
    ).toEqual([
      {
        component: "deep",
        value: 24,
        qualifier: "EXCELLENT",
        start_local: "2026-09-19T00:00:00",
        utc_offset_minutes: 120,
        feedback_code: "POSITIVE_DEEP",
      },
      {
        component: "overall",
        value: 82,
        qualifier: "GOOD",
        start_local: "2026-09-19T00:00:00",
        utc_offset_minutes: 120,
        feedback_code: "POSITIVE_DEEP",
      },
      {
        component: "stress",
        value: null,
        qualifier: "GOOD",
        start_local: "2026-09-19T00:00:00",
        utc_offset_minutes: 120,
        feedback_code: "POSITIVE_DEEP",
      },
    ]);
    // 2. HRV weekly vs Garmin baseline, joined to the nightly value.
    expect(
      sql(
        h,
        "select h.weekly_avg_ms, h.baseline_balanced_low_ms, h.baseline_balanced_upper_ms, d.hrv_ms, h.weekly_avg_ms between h.baseline_balanced_low_ms and h.baseline_balanced_upper_ms as in_balanced from daily_hrv_detail h join daily_health d on d.date = h.date where h.date = '2026-09-19'",
      ),
    ).toEqual([
      {
        weekly_avg_ms: 60,
        baseline_balanced_low_ms: 50,
        baseline_balanced_upper_ms: 70,
        hrv_ms: 55,
        in_balanced: 1,
      },
    ]);
    // 3. Sparse dated VO2 (no forward fill).
    expect(
      sql(
        h,
        "select date, branch, sport, vo2_max_precise from vo2_max_reading order by date",
      ),
    ).toEqual([
      {
        date: "2026-09-12",
        branch: "generic",
        sport: "WALKING",
        vo2_max_precise: 45.7,
      },
    ]);
    // 4. Body Battery day + independent events + activity delta.
    expect(
      sql(
        h,
        "select b.charged, b.drained, (select sum(e.impact) from body_battery_event e where e.date = b.date) as event_impact from daily_body_battery b where b.date = '2026-09-19'",
      ),
    ).toEqual([{ charged: 60, drained: 65, event_impact: -12 }]);
    expect(
      sql(
        h,
        "select a.garmin_id, m.body_battery_delta from activity a join activity_extra_metrics m on m.garmin_id = a.garmin_id order by a.garmin_id",
      ),
    ).toEqual([
      { garmin_id: "9001", body_battery_delta: -9 },
      { garmin_id: "9002", body_battery_delta: -20 },
    ]);
    // 5. Stress bucket durations in seconds with verified fractions.
    expect(
      sql(
        h,
        "select low_seconds, high_seconds, high_fraction, max_level from daily_stress where date = '2026-09-19'",
      ),
    ).toEqual([
      {
        low_seconds: 36_000,
        high_seconds: 3_600,
        high_fraction: 0.05,
        max_level: 88,
      },
    ]);
    // 6. Lap zones: zone totals exclude below/above, with source boundaries.
    expect(
      sql(
        h,
        "select z.zone, sum(z.seconds) as seconds, min(z.lower_bpm) as lower_bpm from activity_lap_hr_zone_time z where z.garmin_id = '9001' and z.bucket_kind = 'zone' group by z.zone order by z.zone",
      ),
    ).toEqual([
      { zone: 1, seconds: 2, lower_bpm: 100 },
      { zone: 2, seconds: 13, lower_bpm: 115 },
      { zone: 3, seconds: 24, lower_bpm: 130 },
      { zone: 4, seconds: 5, lower_bpm: 145 },
      { zone: 5, seconds: 6, lower_bpm: 160 },
    ]);
    // Session zones remain separate and unchanged.
    expect(
      sql(
        h,
        "select sum(seconds) as s from activity_hr_zone_time where garmin_id = '9001'",
      ),
    ).toEqual([{ s: 150 }]);
    // 7. Cadence/stride: list steps/min vs FIT cycles/min, missing sensors null.
    expect(
      sql(
        h,
        "select m.avg_run_cadence_spm, m.avg_stride_length_cm, m.fit_avg_cadence_cpm, m.avg_ground_contact_time_ms, l.lap_number, l.fit_avg_cadence_cpm as lap_cpm, l.fit_total_cycles from activity_extra_metrics m join activity_lap l on l.garmin_id = m.garmin_id where m.garmin_id = '9001' order by l.lap_number",
      ),
    ).toEqual([
      {
        avg_run_cadence_spm: 158,
        avg_stride_length_cm: 98.5,
        fit_avg_cadence_cpm: 79.5,
        avg_ground_contact_time_ms: null,
        lap_number: 1,
        lap_cpm: 78,
        fit_total_cycles: 400,
      },
      {
        avg_run_cadence_spm: 158,
        avg_stride_length_cm: 98.5,
        fit_avg_cadence_cpm: 79.5,
        avg_ground_contact_time_ms: null,
        lap_number: 2,
        lap_cpm: 80,
        fit_total_cycles: 420,
      },
    ]);
    // 8. Snowboard per-type totals.
    expect(
      sql(
        h,
        "select split_type, split_count, distance_meters, max_speed_mps from activity_split_summary where garmin_id = '9002' order by split_type",
      ),
    ).toEqual([
      {
        split_type: "SKI_LIFT_SPLIT",
        split_count: 8,
        distance_meters: null,
        max_speed_mps: null,
      },
      {
        split_type: "SKI_RUN_SPLIT",
        split_count: 9,
        distance_meters: 12_000,
        max_speed_mps: 15.2,
      },
    ]);
    // Coverage distinguishes populated/empty/unavailable; unread dates have no row.
    const coverage = Object.fromEntries(
      (
        sql(
          h,
          "select data_group || ':' || subject_id as k, status from garmin_data_coverage where subject_id in ('2026-09-19', '2026-09-12', '9001', '9002')",
        ) as Array<{ k: string; status: string }>
      ).map((row) => [row.k, row.status]),
    );
    expect(coverage).toMatchObject({
      "sleep:2026-09-19": "populated",
      "vo2_max:2026-09-12": "populated",
      "lap_hr_zones:9001": "populated",
      "lap_hr_zones:9002": "unavailable",
      "snowboard_splits:9001": "empty",
      "snowboard_splits:9002": "populated",
      "running_dynamics:9002": "empty",
    });
    expect(
      sql(
        h,
        "select count(*) as n from garmin_data_coverage where subject_id = '2026-01-01'",
      ),
    ).toEqual([{ n: 0 }]);
    // Internal checkpoints/raw payloads remain denied.
    for (const denied of [
      "select * from sync_checkpoint",
      "select * from garmin_raw_payload",
    ])
      expect(h.runReadOnlySql({ sql: denied }).status).toBe("rejected");
  });

  it("is idempotent and never erases good extras on a failed or partial refresh", async () => {
    const account = newAccount();
    populate(account);
    const h = await harness(account);
    await h.imports.runGarminSync(undefined, { intent: "latest" });
    const snapshot = () =>
      JSON.stringify(
        [
          "daily_sleep_detail",
          "daily_sleep_score_component",
          "daily_hrv_detail",
          "vo2_max_reading",
          "daily_body_battery",
          "body_battery_event",
          "daily_stress",
          "activity_split_summary",
          "activity_lap_hr_zone_time",
        ].map((table) =>
          h.db
            .prepare(`select * from ${table} order by 1, 2`)
            .all()
            .map((row) => ({ ...(row as object), fetched_at: undefined })),
        ),
      );
    const first = snapshot();
    await h.imports.runGarminSync(undefined, { intent: "latest" });
    expect(snapshot()).toBe(first);
    // Today stays mutable by policy (no checkpoint editing). Its first read is
    // rich; the refresh returns plain rows and VO2 fails: prior good scalars
    // and child sets survive and VO2 is never marked empty.
    account.days.set("2026-09-21", { hours: 12, extra: RICH_DAY });
    await h.imports.runGarminSync(undefined, { intent: "latest" });
    expect(
      h.db
        .prepare(
          "select count(*) as n from daily_sleep_score_component where date = '2026-09-21'",
        )
        .get(),
    ).toEqual({ n: 3 });
    account.failPaths.set("vo2", 503);
    account.days.set("2026-09-21", { hours: 13 });
    await h.imports.runGarminSync(undefined, { intent: "latest" });
    expect(
      h.db
        .prepare(
          "select weekly_avg_ms from daily_hrv_detail where date = '2026-09-21'",
        )
        .get(),
    ).toEqual({ weekly_avg_ms: 60 });
    expect(
      h.db
        .prepare(
          "select count(*) as n from daily_sleep_score_component where date = '2026-09-21'",
        )
        .get(),
    ).toEqual({ n: 3 });
    expect(
      h.db
        .prepare(
          "select count(*) as n from body_battery_event where date = '2026-09-21'",
        )
        .get(),
    ).toEqual({ n: 1 });
    expect(
      h.db.prepare("select count(*) as n from vo2_max_reading").get(),
    ).toEqual({ n: 1 });
    expect(
      h.db
        .prepare(
          "select status from garmin_data_coverage where data_group = 'vo2_max' and subject_id = '2026-09-12'",
        )
        .get(),
    ).toEqual({ status: "populated" });
    expect(
      h.db
        .prepare(
          "select status from garmin_data_coverage where data_group = 'vo2_max' and subject_id = '2026-09-21'",
        )
        .get(),
    ).toEqual({ status: "failed" });
  });

  it("replaces lap zones with the lap set on a detail refresh", async () => {
    const account = newAccount();
    populate(account);
    const h = await harness(account);
    await h.imports.runGarminSync(undefined, { intent: "latest" });
    const repo = await import("../src/lib/db/repository");
    // A refresh from a changed file with one lap and no zone messages.
    account.files.set(
      "9001",
      fitFor({ laps: [{ index: 0, startOffset: 0, cadence: 77 }] }),
    );
    const { createDetailImports } =
      await import("../src/lib/garmin/detail-import");
    const extra = await import("../src/lib/db/extra-data-repository");
    const { createOfficialReader } =
      await import("../src/lib/garmin/official-reader");
    const local = await import("../src/lib/local-data/composition");
    const api = accountApi(account);
    const details = createDetailImports(
      {
        upsertActivities: repo.upsertActivities,
        listActivityIdsNeedingEffortBackfill:
          repo.listActivityIdsNeedingEffortBackfill,
        upsertActivityHrZoneTime: repo.upsertActivityHrZoneTime,
        getDetailAvailability: (id) =>
          local.getActivityDetailForAnalytics(id).availability,
        upsertActivityDetail: repo.upsertActivityDetail,
        recordActivityDetailAttempt: repo.recordActivityDetailAttempt,
        upsertFitActivityExtras: (id, value) =>
          extra.upsertFitActivityExtras(id, value),
        recordExtraCoverage: (entries) => extra.recordExtraCoverage(entries),
      },
      () =>
        createOfficialReader({
          apiKey: () => "synthetic-key",
          fetch: api.fetch,
          archive: () => undefined,
        }),
    );
    const outcome = await details.backfillActivityDetail("9001", {
      force: true,
    });
    expect(outcome.status).toBe("completed");
    expect(
      h.db
        .prepare(
          "select count(*) as n from activity_lap_hr_zone_time where garmin_id = '9001'",
        )
        .get(),
    ).toEqual({ n: 0 });
    expect(
      h.db
        .prepare(
          "select status from garmin_data_coverage where data_group = 'lap_hr_zones' and subject_id = '9001'",
        )
        .get(),
    ).toEqual({ status: "empty" });
    expect(
      h.db
        .prepare(
          "select lap_number, fit_avg_cadence_cpm from activity_lap where garmin_id = '9001'",
        )
        .all(),
    ).toEqual([{ lap_number: 1, fit_avg_cadence_cpm: 77 }]);
  });
});
