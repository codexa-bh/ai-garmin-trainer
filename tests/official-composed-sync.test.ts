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
 * Composed proof: official reader → real import application → real SQLite file.
 * Only the HTTP transport is authored; storage, policy and application are real.
 */
const NOW = new Date("2026-09-21T12:00:00Z");
let directory: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "official-composed-"));
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

async function harness(
  account: Account,
  options: { limit?: string; cancelAfter?: number } = {},
) {
  const repo = await import("../src/lib/db/repository");
  const local = await import("../src/lib/local-data/composition");
  const { createGarminImports } = await import("../src/lib/garmin/sync-import");
  const { createOfficialReader } =
    await import("../src/lib/garmin/official-reader");
  const api = accountApi(account);
  const readers: Array<ReturnType<typeof createOfficialReader>> = [];
  const archived: Array<{ sourceTool: string; subjectId: string }> = [];
  const imports = createGarminImports({
    historyStartDate: () => options.limit,
    clock: () => new Date(),
    wait: async () => undefined,
    createReader: (control) => {
      const reader = createOfficialReader({
        control,
        apiKey: () => "synthetic-key",
        fetch: api.fetch,
        clock: () => new Date(),
        archive: (entry) => {
          archived.push(entry);
          repo.upsertGarminRawPayload(entry);
        },
      });
      readers.push(reader);
      return reader;
    },
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
      writeGarminAthleteBaselineRefresh: repo.writeGarminAthleteBaselineRefresh,
      writeGarminBodyMetricsRefresh: repo.writeGarminBodyMetricsRefresh,
      getDetailAvailability: (id) =>
        local.getActivityDetailForAnalytics(id).availability,
    },
  });
  const { getDatabase } = await import("../src/lib/db/connection");
  const { FRESHNESS_CHECKPOINT } =
    await import("../src/lib/garmin/latest-policy");
  const { normalizeDailyHealth } = await import("./legacy-normalize");
  return {
    api,
    imports,
    readers,
    archived,
    repo,
    db: getDatabase(),
    FRESHNESS_CHECKPOINT,
    normalizeDailyHealth,
    options,
  };
}
function populate(account: Account) {
  // Three weeks of whole days, one ZIP-wrapped file per activity.
  for (let i = 0; i < 21; i += 1)
    account.days.set(addDays("2026-08-31", i), { hours: 24, steps: 5000 + i });
  account.activities.push(
    activityRow(9001, "2026-09-18 07:00:00", {
      hrTimeInZone_1: 60,
      hrTimeInZone_2: 120,
      hrTimeInZone_3: 180,
      hrTimeInZone_4: 240,
      hrTimeInZone_5: 300,
    }),
    activityRow(9002, "2026-09-20 18:30:00"),
  );
  account.files.set(
    "9001",
    fitFor({
      sessionZones: [0, 10, 20, 30, 40, 50],
      highBoundaries: [100, 115, 130, 145, 160, 175],
      zonesTarget: { max: 190 },
    }),
  );
  account.files.set(
    "9002",
    fitFor({ highBoundaries: [100, 115, 130, 145, 160, 175] }),
  );
  account.weighIns.push({ calendarDate: "2026-09-10", grams: 70_200 });
}

describe("official reader composed with import and SQLite", () => {
  it("imports activities, health, body facts and required details with official provenance", async () => {
    const account = newAccount();
    populate(account);
    const h = await harness(account, { limit: "2026-09-01" });
    const result = await h.imports.runGarminSync(undefined, {
      intent: "latest",
    });
    expect(result).toMatchObject({
      status: "completed",
      detailsRemaining: 0,
      detailsProcessed: 2,
      detailsFailed: 0,
    });
    expect(h.db.prepare("pragma integrity_check").get()).toEqual({
      integrity_check: "ok",
    });
    expect(h.db.prepare("pragma foreign_key_check").all()).toEqual([]);
    expect(h.db.prepare("select count(*) as n from activity").get()).toEqual({
      n: 2,
    });
    const health = h.db
      .prepare(
        "select date, steps, sleep_minutes as sleep, hrv_ms as hrv, availability from daily_health order by date",
      )
      .all() as Array<Record<string, unknown>>;
    expect(health.length).toBeGreaterThanOrEqual(14);
    expect(health.at(-1)).toMatchObject({ date: "2026-09-21" });
    expect(health.find((row) => row.date === "2026-09-19")).toMatchObject({
      steps: 5019,
      sleep: 450,
      hrv: 55,
    });
    // Exact FIT zones for 9001; list buckets are only the fallback, FIT estimate for 9002 has no zones in file.
    const zones = h.db
      .prepare(
        "select garmin_id as id, zone, seconds, source from activity_hr_zone_time order by garmin_id, zone",
      )
      .all() as Array<{
      id: string;
      zone: number;
      seconds: number;
      source: string;
    }>;
    expect(
      zones.filter((z) => z.id === "9001").map((z) => [z.seconds, z.source]),
    ).toEqual([10, 20, 30, 40, 50].map((s) => [s, "garmin_official_fit"]));
    expect(
      h.db.prepare("select count(*) as n from activity_stream_point").get(),
    ).toEqual({ n: 6 });
    expect(h.repo.getGarminAthleteBaseline()).toMatchObject({
      source: "garmin_official",
      values: {
        configuredMaxHeartRateBpm: 188,
        availableTrainingDays: ["monday", "wednesday"],
      },
    });
    expect(h.repo.getGarminBodyMetrics()).toMatchObject({
      source: "garmin_official",
      values: { weightKg: 70.2 },
    });
    expect(
      h.archived.every((entry) => entry.sourceTool.startsWith("official_")),
    ).toBe(true);
    // No token exchange, key, bearer or ZIP/FIT binary is archived.
    const stored = JSON.stringify(
      h.db
        .prepare("select payload_json, payload_text from garmin_raw_payload")
        .all(),
    );
    expect(stored).not.toMatch(/signature|ApiKey|synthetic-key/);
    expect(
      h.api.requests.some((r) => r.query.limit && Number(r.query.limit) > 200),
    ).toBe(false);
  });

  it("finalizes only whole ended days by coverage, never fabricating upload evidence, and skips settled days on repeat", async () => {
    const account = newAccount();
    populate(account);
    account.days.set("2026-09-19", { hours: 14 });
    const h = await harness(account, { limit: "2026-09-01" });
    await h.imports.runGarminSync(undefined, { intent: "latest" });
    const fresh = JSON.parse(h.repo.getCheckpoint(h.FRESHNESS_CHECKPOINT)!);
    expect(fresh.days["2026-09-18"]).toMatchObject({
      source: "coverage",
      final: true,
      coverage: "full",
    });
    expect(fresh.days["2026-09-19"]).toMatchObject({
      final: false,
      coverage: "partial",
      reason: "ends-before-midnight",
    });
    expect(fresh.days["2026-09-21"]).toMatchObject({ final: false });
    expect(JSON.stringify(fresh)).not.toMatch(/primaryId|uploadedAt/);
    const before = h.api.requests.length;
    const detailBefore = h.api.requests.filter((r) =>
      r.path.includes("download-service"),
    ).length;
    await h.imports.runGarminSync(undefined, { intent: "latest" });
    const second = h.api.requests.slice(before);
    // Only mutable days are read again; settled days cost no daily range requests.
    const summaryRanges = second.filter((r) =>
      r.path.endsWith("dailysummaries"),
    );
    expect(summaryRanges.length).toBeGreaterThan(0);
    for (const { query } of summaryRanges)
      expect(query.startDate >= "2026-09-19").toBe(true);
    // Details are drained once. The only repeat download is the existing rule that
    // retries the FIT baseline for the newest activity until it yields a target.
    const repeated = second.filter((r) => r.path.includes("download-service"));
    expect(repeated.map((r) => r.path)).toEqual([
      "/download-service/files/activity/9002",
    ]);
    expect(detailBefore).toBe(2);
  });

  it("is idempotent on repeat: counts and normalized facts are unchanged", async () => {
    const account = newAccount();
    populate(account);
    const h = await harness(account, { limit: "2026-09-01" });
    await h.imports.runGarminSync(undefined, { intent: "latest" });
    const snapshot = () =>
      JSON.stringify([
        h.db.prepare("select * from daily_health order by date").all(),
        h.db
          .prepare(
            "select garmin_id, name, started_at, duration_sec from activity order by garmin_id",
          )
          .all(),
        h.db
          .prepare(
            "select garmin_id, zone, seconds from activity_hr_zone_time order by 1, 2",
          )
          .all(),
        h.db.prepare("select count(*) from activity_stream_point").all(),
      ]);
    const first = snapshot();
    await h.imports.runGarminSync(undefined, { intent: "latest" });
    expect(snapshot()).toBe(first);
  });

  it("preserves good prior facts when a source read fails or reports emptiness", async () => {
    const account = newAccount();
    populate(account);
    const h = await harness(account, { limit: "2026-09-01" });
    await h.imports.runGarminSync(undefined, { intent: "latest" });
    const before = h.db
      .prepare(
        "select steps, sleep_minutes from daily_health where date = '2026-09-19'",
      )
      .get();
    account.days.set("2026-09-19", { hours: 0 });
    account.failPaths.set("activities", 500);
    const result = await h.imports.runGarminSync(undefined, {
      intent: "latest",
    });
    expect(result.status).toBe("failed");
    expect(
      h.db
        .prepare(
          "select steps, sleep_minutes from daily_health where date = '2026-09-19'",
        )
        .get(),
    ).toEqual(before);
    expect(h.db.prepare("select count(*) as n from activity").get()).toEqual({
      n: 2,
    });
    expect(h.repo.getGarminBodyMetrics().values.weightKg).toBe(70.2);
  });

  it("transitions legacy MCP state: recent 14 and non-final rechecked, older finals kept as legacy, other data untouched", async () => {
    const account = newAccount();
    populate(account);
    const h = await harness(account, { limit: "2026-09-01" });
    // MCP-era state: stored days, upload-based finals, an unrelated profile row and chat data.
    h.repo.upsertDailyHealth([
      h.normalizeDailyHealth("2026-09-02", { stats: { total_steps: 1111 } }),
      h.normalizeDailyHealth("2026-09-18", { stats: { total_steps: 2222 } }),
    ]);
    const download = (final: boolean) => ({
      source: "download",
      final,
      downloadedAt: "2026-09-19T06:00:00.000Z",
      dayEndedAt: "2026-09-18T00:00:00.000Z",
      primaryId: final ? "w" : null,
      uploadedAt: final ? "2026-09-19T00:00:00.000Z" : null,
    });
    h.repo.saveCheckpoints([
      [
        h.FRESHNESS_CHECKPOINT,
        JSON.stringify({
          version: 1,
          startDate: "2026-09-07",
          days: {
            "2026-09-02": download(true),
            "2026-09-18": download(true),
            "2026-09-17": download(false),
          },
          profileDay: null,
          ftpDay: null,
          fitActivity: null,
        }),
      ],
      ["garmin_history_v1", '{"retained":"unsupported-history"}'],
    ]);
    h.db
      .prepare(
        "insert into trainer_profile (id, goals_json, sports_json, preferences_json, constraints_json, updated_at) values ('default','[\"goal\"]','[]','{}','[]',1)",
      )
      .run();
    await h.imports.runGarminSync(undefined, { intent: "latest" });
    const fresh = JSON.parse(h.repo.getCheckpoint(h.FRESHNESS_CHECKPOINT)!);
    expect(fresh.coverageTransition).toMatchObject({ version: 1 });
    expect(fresh.days["2026-09-02"]).toEqual({ final: true, source: "legacy" });
    expect(fresh.days["2026-09-18"]).toMatchObject({
      source: "coverage",
      final: true,
    });
    expect(
      h.db
        .prepare("select steps from daily_health where date = '2026-09-02'")
        .get(),
    ).toEqual({ steps: 1111 });
    expect(
      h.db
        .prepare("select steps from daily_health where date = '2026-09-18'")
        .get(),
    ).toEqual({ steps: 5018 });
    expect(h.repo.getCheckpoint("garmin_history_v1")).toBe(
      '{"retained":"unsupported-history"}',
    );
    expect(
      h.db
        .prepare("select goals_json from trainer_profile where id = 'default'")
        .get(),
    ).toEqual({ goals_json: '["goal"]' });
    const dayRequests = h.api.requests
      .filter((r) => r.path.endsWith("dailysummaries"))
      .map((r) => r.query.startDate);
    expect(dayRequests.every((date) => date >= "2026-09-07")).toBe(true);
  });

  it("refuses corrupt freshness bytes and leaves them intact", async () => {
    const account = newAccount();
    populate(account);
    const h = await harness(account, { limit: "2026-09-01" });
    h.repo.saveCheckpoints([[h.FRESHNESS_CHECKPOINT, '{"version":99}']]);
    await expect(
      h.imports.runGarminSync(undefined, { intent: "latest" }),
    ).rejects.toThrow(/Unsupported latest freshness/);
    expect(h.repo.getCheckpoint(h.FRESHNESS_CHECKPOINT)).toBe('{"version":99}');
    expect(h.api.requests).toHaveLength(0);
  });

  it("stops on cancellation without further writes or finality, then replays without duplicates", async () => {
    const account = newAccount();
    populate(account);
    const h = await harness(account, { limit: "2026-09-01" });
    const run = h.imports.runGarminSync(undefined, {
      intent: "latest",
      cancelled: () => h.api.requests.length >= 3,
    });
    const result = await run;
    expect(result.status).toBe("cancelled");
    const final = JSON.parse(
      h.repo.getCheckpoint(h.FRESHNESS_CHECKPOINT) ?? '{"days":{}}',
    );
    expect(
      Object.values(final.days).some((d) => (d as { final: boolean }).final),
    ).toBe(false);
    const after = await h.imports.runGarminSync(undefined, {
      intent: "latest",
    });
    expect(after.status).toBe("completed");
    expect(h.db.prepare("select count(*) as n from activity").get()).toEqual({
      n: 2,
    });
    expect(
      h.db
        .prepare(
          "select count(*) as n from (select distinct date from daily_health)",
        )
        .get(),
    ).toEqual(h.db.prepare("select count(*) as n from daily_health").get());
  });

  it("runs history through ranges: one request per range, finite progress, no per-day network loop", async () => {
    const account = newAccount();
    // A full year of whole days plus activities spread across two windows.
    for (let i = 0; i < 400; i += 1)
      account.days.set(addDays("2025-08-18", i), {
        hours: 24,
        steps: 4000 + i,
      });
    account.activities.push(
      activityRow(7001, "2026-08-10 07:00:00"),
      activityRow(7002, "2026-07-02 07:00:00"),
    );
    account.files.set("7001", fitFor());
    account.files.set("7002", fitFor());
    const h = await harness(account, { limit: "2026-06-01" });
    await h.imports.runGarminSync(undefined, { intent: "latest" });
    const requestsAfterLatest = h.api.requests.length;
    const result = await h.imports.runGarminSync(undefined, {
      intent: "history",
      interactive: true,
    });
    expect(["completed", "budget-limited"]).toContain(result.status);
    const history = h.api.requests.slice(requestsAfterLatest);
    const stats = h.readers.at(-1)!.requestStats();
    expect(stats.total).toBe(history.length);
    // Daily health cost is bounded by ranges, not by the number of days covered.
    const dailyDays = h.db
      .prepare("select count(*) as n from daily_health")
      .get() as { n: number };
    const dailyRequests = history.filter((r) =>
      /dailysummaries|dailySleepSummariesByDate|hrv\/daily|bodyBattery/.test(
        r.path,
      ),
    );
    expect(dailyDays.n).toBeGreaterThan(14);
    // 4 range families per ≤31 dates, so well under one request per two days.
    expect(dailyRequests.length).toBeLessThanOrEqual(dailyDays.n / 2);
    for (const request of history.filter((r) =>
      r.path.includes("dailySleepSummariesByDate"),
    ))
      expect(
        (Date.parse(request.query.endDate) -
          Date.parse(request.query.startDate)) /
          86_400_000 +
          1,
      ).toBeLessThanOrEqual(31);
    expect(h.db.prepare("select count(*) as n from activity").get()).toEqual({
      n: 2,
    });
    // Selected limit is honoured: nothing older than the floor was requested.
    expect(
      history.filter(
        (r) => r.query.startDate && r.query.startDate < "2026-06-01",
      ),
    ).toEqual([]);
    expect(h.db.prepare("pragma integrity_check").get()).toEqual({
      integrity_check: "ok",
    });
  });

  it("preserves saved MCP history pages: page identity is unchanged and no cursor is reset", async () => {
    const account = newAccount();
    for (let i = 0; i < 250; i += 1)
      account.activities.push(activityRow(2000 + i, "2026-08-15 07:00:00"));
    for (let i = 0; i < 40; i += 1)
      account.days.set(addDays("2026-08-01", i), { hours: 24 });
    const h = await harness(account, { limit: "2026-08-01" });
    const { historyState, HISTORY_CHECKPOINT } =
      await import("../src/lib/garmin/history-policy");
    const saved = historyState(null, "2026-08-01", "2026-09-21");
    saved.activities.page = 1;
    saved.activities.windowEnd = "2026-08-31";
    saved.health.nextDate = "2026-07-31";
    h.repo.saveCheckpoints([[HISTORY_CHECKPOINT, JSON.stringify(saved)]]);
    await h.imports.runGarminSync(undefined, {
      intent: "history",
      interactive: true,
    });
    const offsets = h.api.requests
      .filter((r) => r.path.includes("activitylist"))
      .map((r) => r.query.start);
    // A saved MCP page 1 is read as offset 100 under the same 100-row page identity.
    expect(offsets).toContain("100");
    // Head refresh (0), the saved page (100) and its successor (200): no row is lost or duplicated.
    expect(
      ["0", "100", "200"].every((offset) => offsets.includes(offset)),
    ).toBe(true);
    expect(h.db.prepare("select count(*) as n from activity").get()).toEqual({
      n: 250,
    });
    expect(JSON.parse(h.repo.getCheckpoint(HISTORY_CHECKPOINT)!).version).toBe(
      1,
    );
  });

  it("uses year-long daily summaries for automatic discovery with finite limits and no step-tool read", async () => {
    const account = newAccount();
    for (let i = 0; i < 60; i += 1)
      account.days.set(addDays("2026-07-15", i), { hours: 24 });
    const h = await harness(account);
    await h.imports.runGarminSync(undefined, { intent: "latest" });
    const result = await h.imports.runGarminSync(undefined, {
      intent: "history",
      interactive: true,
    });
    expect(["completed", "budget-limited", "failed"]).toContain(result.status);
    const discovery = JSON.parse(
      h.repo.getCheckpoint("garmin_discovery_v1") ?? "null",
    );
    expect(discovery?.hint?.source).toBe("official_daily_summaries");
    const hints = h.api.requests.filter(
      (r) =>
        r.path.endsWith("dailysummaries") &&
        Math.round(
          (Date.parse(r.query.endDate) - Date.parse(r.query.startDate)) /
            86_400_000,
        ) +
          1 ===
          364,
    );
    expect(hints.length).toBeGreaterThan(0);
    expect(h.api.requests.some((r) => r.path.includes("steps"))).toBe(false);
  });
});
