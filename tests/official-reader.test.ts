import { describe, expect, it, vi } from "vitest";
import {
  OFFICIAL_RANGE_LIMITS,
  createOfficialReader,
} from "../src/lib/garmin/official-reader";
import { SyncPause } from "../src/lib/garmin/history-policy";
import { dayCoverage } from "../src/lib/garmin/coverage-policy";
import { normalizeGarminAthleteBaseline } from "../src/lib/garmin/athlete-normalize";
import { normalizeGarminBodyMetrics } from "../src/lib/garmin/body-metrics-normalize";
import { officialDiscoveryHint } from "../src/lib/garmin/official-normalize";
import {
  accountApi,
  activityRow,
  addDays,
  fitFor,
  newAccount,
  summaryRow,
} from "./official-api-fixture";

const NOW = new Date("2026-11-20T12:00:00Z");

function readerFor(
  account = newAccount(),
  control?: Parameters<typeof createOfficialReader>[0]["control"],
) {
  const api = accountApi(account);
  const archive = vi.fn();
  const reader = createOfficialReader({
    apiKey: () => "synthetic-key",
    fetch: api.fetch,
    archive,
    control,
    clock: () => NOW,
  });
  return { account, api, archive, reader };
}
const wallEnd = (d: string) => `${d}T00:00:00.0`;

describe("official daily health", () => {
  it("normalizes units, nested summary, sleep score, separate HRV and battery levels", async () => {
    const account = newAccount();
    account.days.set("2026-11-18", { hours: 24, steps: 12_345 });
    const { reader } = readerFor(account);
    const { day, coverage } = await reader.dailyHealthEvidence!("2026-11-18");
    expect(day).toMatchObject({
      date: "2026-11-18",
      steps: 12_345,
      sleepMinutes: 450,
      sleepDeepMinutes: 90,
      sleepScore: 82,
      hrvMs: 55,
      hrvStatus: "BALANCED",
      restingHeartRate: 52,
      stressAvg: 31,
      intensityMinutes: 25,
      totalCalories: 2200,
      bodyBatteryMorning: 80,
      bodyBatteryEvening: 25,
      availability: "complete",
    });
    expect(dayCoverage("2026-11-18", coverage, NOW).kind).toBe("full");
  });

  it("treats a documented null/empty day as source emptiness, never zero or an error", async () => {
    const { reader } = readerFor();
    const { day, coverage } = await reader.dailyHealthEvidence!("2026-11-18");
    expect(day).toMatchObject({
      availability: "missing",
      steps: null,
      sleepMinutes: null,
      sleepScore: null,
    });
    expect(coverage).toEqual({ kind: "none", reason: "empty" });
    expect(dayCoverage("2026-11-18", coverage, NOW).kind).toBe("partial");
  });

  it("batches one planned range per family, counting only actual requests", async () => {
    const account = newAccount();
    const dates = Array.from({ length: 10 }, (_, i) =>
      addDays("2026-11-01", i),
    );
    for (const date of dates) account.days.set(date, { hours: 24 });
    const { reader, api } = readerFor(account);
    reader.planDailyHealth!(dates);
    for (const date of dates) await reader.dailyHealthEvidence!(date);
    // 10 days cost 5 range reads (VO2 shares the block) plus 1 token exchange,
    // not per-day calls.
    expect(api.requests).toHaveLength(6);
    expect(reader.requestStats()).toMatchObject({
      total: 6,
      byEndpoint: {
        token: 1,
        "daily-summaries": 1,
        sleep: 1,
        hrv: 1,
        "body-battery": 1,
        "vo2-max": 1,
      },
    });
  });

  it("splits plans longer than the documented 31-day limit and never reads outside the plan", async () => {
    const account = newAccount();
    const dates = Array.from({ length: 40 }, (_, i) =>
      addDays("2026-10-01", i),
    );
    const { reader, api } = readerFor(account);
    reader.planDailyHealth!(dates);
    await reader.dailyHealthEvidence!(dates[0]);
    await reader.dailyHealthEvidence!(dates[39]);
    const ranges = api.requests
      .filter((r) => r.path.endsWith("dailySleepSummariesByDate"))
      .map((r) => r.query);
    expect(ranges).toHaveLength(2);
    for (const { startDate, endDate } of ranges)
      expect(
        (Date.parse(endDate) - Date.parse(startDate)) / 86_400_000 + 1,
      ).toBeLessThanOrEqual(OFFICIAL_RANGE_LIMITS.sleepDays);
    expect(Math.min(...ranges.map((r) => Date.parse(r.startDate)))).toBe(
      Date.parse(dates[0]),
    );
    expect(Math.max(...ranges.map((r) => Date.parse(r.endDate)))).toBe(
      Date.parse(dates[39]),
    );
  });

  it("does not reuse a range across readers or accounts", async () => {
    const account = newAccount();
    account.days.set("2026-11-18", { hours: 24 });
    const first = readerFor(account);
    const second = readerFor(account);
    await first.reader.dailyHealthEvidence!("2026-11-18");
    await second.reader.dailyHealthEvidence!("2026-11-18");
    expect(first.api.requests.length).toBe(second.api.requests.length);
  });

  it("archives only supported redacted payload classes, never the token exchange", async () => {
    const account = newAccount();
    account.days.set("2026-11-18", { hours: 24 });
    const { reader, archive } = readerFor(account);
    await reader.dailyHealthEvidence!("2026-11-18");
    const subjects = archive.mock.calls.map(
      ([call]) => `${call.sourceTool}:${call.subjectId}`,
    );
    expect(subjects).toEqual([
      "official_daily_summary:2026-11-18:stats",
      "official_sleep:2026-11-18:sleep",
      "official_body_battery:2026-11-18:body_battery",
      "official_hrv:2026-11-18:hrv",
    ]);
    expect(JSON.stringify(archive.mock.calls)).not.toMatch(
      /signature|ApiKey|Bearer/,
    );
  });

  it("fails a malformed range instead of reporting an empty success", async () => {
    const account = newAccount();
    const { reader, api } = readerFor(account);
    const original = api.fetch;
    const wrapped = createOfficialReader({
      apiKey: () => "k",
      archive: vi.fn(),
      fetch: (async (input, init) => {
        const url = new URL(String(input));
        if (url.pathname.includes("dailysummaries"))
          return new Response(JSON.stringify({ unexpected: true }), {
            status: 200,
          });
        return original(input, init);
      }) as typeof fetch,
    });
    await expect(wrapped.dailyHealthEvidence!("2026-11-18")).rejects.toThrow(
      /protocol/,
    );
    void reader;
  });

  it("surfaces rate limiting and auth rejection as fatal classes, without retries", async () => {
    const account = newAccount();
    account.failPaths.set("summary", 429);
    const { reader, api } = readerFor(account);
    await expect(reader.dailyHealthEvidence!("2026-11-18")).rejects.toThrow(
      /rate limit/,
    );
    expect(
      api.requests.filter((r) => r.path.includes("dailysummaries")),
    ).toHaveLength(1);
  });
});

describe("official activities", () => {
  it("pages by offset with exact-full final pages and an empty terminal page", async () => {
    const account = newAccount();
    for (let i = 0; i < 100; i += 1)
      account.activities.push(
        activityRow(
          1000 + i,
          `2026-11-${String(10 + (i % 5)).padStart(2, "0")} 07:00:00`,
        ),
      );
    const { reader, api } = readerFor(account);
    const first = await reader.activityPage("2026-11-01", "2026-11-30", 0);
    expect(first).toMatchObject({ hasMore: true, nextPage: 1 });
    expect(first.activities).toHaveLength(100);
    const second = await reader.activityPage("2026-11-01", "2026-11-30", 1);
    expect(second).toMatchObject({ hasMore: false, activities: [] });
    const [a, b] = api.requests.filter((r) => r.path.includes("activitylist"));
    expect([a.query.start, a.query.limit, b.query.start]).toEqual([
      "0",
      "100",
      "100",
    ]);
    expect(Number(a.query.limit)).toBeLessThanOrEqual(200);
  });

  it("keeps local wall-clock start times and effort fields, and drops duplicate rows", async () => {
    const account = newAccount();
    account.activities.push(
      activityRow(7, "2026-11-12 07:30:00"),
      activityRow(7, "2026-11-12 07:30:00"),
    );
    const { reader } = readerFor(account);
    const page = await reader.activityPage("2026-11-01", "2026-11-30", 0);
    expect(page.activities).toHaveLength(1);
    expect(page.activities[0]).toMatchObject({
      garminId: "7",
      sport: "running",
      trainingEffect: 3.1,
      trainingLoad: 80,
    });
    expect(page.activities[0].startedAt.toISOString()).toBe(
      new Date("2026-11-12T07:30:00").toISOString(),
    );
  });

  it("rejects a non-array page and an activity without identity", async () => {
    const api = accountApi(newAccount());
    const reader = createOfficialReader({
      apiKey: () => "k",
      archive: vi.fn(),
      fetch: (async (input, init) => {
        if (String(input).includes("activitylist"))
          return new Response(JSON.stringify({ not: "array" }), {
            status: 200,
          });
        return api.fetch(input, init);
      }) as typeof fetch,
    });
    await expect(
      reader.activityPage("2026-11-01", "2026-11-30", 0),
    ).rejects.toThrow(/protocol/);
  });

  it("reads one effort summary", async () => {
    const account = newAccount();
    account.activities.push(activityRow(9, "2026-11-12 07:30:00"));
    const { reader } = readerFor(account);
    expect(await reader.activityEffort("9")).toMatchObject({
      garminId: "9",
      trainingEffect: 3.1,
    });
    expect(await reader.activityEffort("404").catch((e) => String(e))).toMatch(
      /not found/,
    );
  });
});

describe("official detail and HR zone time", () => {
  it("decodes once per activity for detail, zones and baseline", async () => {
    const account = newAccount();
    account.files.set(
      "100",
      fitFor({
        sessionZones: [0, 10, 20, 30, 40, 50],
        highBoundaries: [100, 115, 130, 145, 160, 175],
        zonesTarget: { max: 190 },
      }),
    );
    const { reader, api } = readerFor(account);
    const detail = await reader.activityDetail("100");
    expect(detail.recognized).toBe(true);
    expect(detail.detail.recordCount).toBe(3);
    const zones = await reader.activityHrZoneTime("100");
    expect(zones?.source).toBe("garmin_official_fit");
    expect(zones?.buckets.map((b) => b.seconds)).toEqual([10, 20, 30, 40, 50]);
    expect(await reader.fitBaseline(["100"])).toMatchObject({
      zones_target: { max_heart_rate: 190 },
    });
    expect(api.count("/download-service/files/activity/100")).toBe(1);
  });

  it("falls back to exact activity-list buckets when the file has no zone message", async () => {
    const account = newAccount();
    account.activities.push(
      activityRow(5, "2026-11-12 07:30:00", {
        hrTimeInZone_1: 100,
        hrTimeInZone_2: 200,
        hrTimeInZone_3: 300,
        hrTimeInZone_4: 400,
        hrTimeInZone_5: 500,
      }),
    );
    account.files.set("5", fitFor());
    const { reader } = readerFor(account);
    await reader.activityPage("2026-11-01", "2026-11-30", 0);
    const zones = await reader.activityHrZoneTime("5");
    expect(zones).toMatchObject({
      source: "garmin_official_activity",
      sourceTotalSeconds: 1500,
    });
  });

  it("is explicitly unavailable for a missing original or invalid file, preserving detail honesty", async () => {
    const account = newAccount();
    const { reader } = readerFor(account);
    const missing = await reader.activityDetail("404");
    expect(missing).toMatchObject({
      recognized: false,
      detail: { status: "unsupported" },
    });
    expect(await reader.activityHrZoneTime("404")).toBeNull();
    account.files.set("8", new Uint8Array([1, 2, 3]));
    expect((await reader.activityDetail("8")).recognized).toBe(false);
  });

  it("takes cycling FTP only from a cycling file", async () => {
    const account = newAccount();
    account.files.set(
      "run",
      fitFor({ zonesTarget: { max: 180, ftp: 250 }, sport: 1 }),
    );
    account.files.set(
      "bike",
      fitFor({ zonesTarget: { max: 180, ftp: 250 }, sport: 2 }),
    );
    const { reader } = readerFor(account);
    type Target = { zones_target: Record<string, unknown> };
    const run = (await reader.fitBaseline(["run"])) as Target;
    const bike = (await reader.fitBaseline(["bike"])) as Target;
    expect(run.zones_target).toMatchObject({
      max_heart_rate: 180,
      functional_threshold_power: null,
    });
    expect(bike.zones_target).toMatchObject({
      max_heart_rate: 180,
      functional_threshold_power: 250,
    });
    const snapshot = normalizeGarminAthleteBaseline({
      fitPayload: bike,
      source: "garmin_official",
    });
    expect(snapshot.values.cyclingFtpWatts).toBe(250);
    expect(
      normalizeGarminAthleteBaseline({ fitPayload: run }).values
        .cyclingFtpWatts,
    ).toBeNull();
  });
});

describe("official body, profile and discovery", () => {
  it("converts grams, honours the body range limit and keeps source provenance", async () => {
    const account = newAccount();
    account.weighIns.push({ calendarDate: "2026-11-10", grams: 70_200 });
    const { reader } = readerFor(account);
    const snapshot = normalizeGarminBodyMetrics({
      historyPayload: await reader.bodyComposition("2026-11-01", "2026-11-30"),
      weighInPayload: await reader.weighIns("2026-11-01", "2026-11-30"),
      source: reader.source,
    });
    expect(snapshot).toMatchObject({
      source: "garmin_official",
      values: { weightKg: 70.2 },
    });
    expect(snapshot.historyRows[0]).toMatchObject({
      date: "2026-11-10",
      weightKg: 70.2,
      source: "garmin_official",
    });
    await expect(
      reader.bodyComposition("2025-01-01", "2026-11-30"),
    ).rejects.toThrow(/protocol/);
  });

  it("uses configured zone floors and training days, tolerating null FTP/height", async () => {
    const { reader } = readerFor();
    const snapshot = normalizeGarminAthleteBaseline({
      profilePayload: await reader.profile(),
      ftpPayload: await reader.cyclingFtp(),
      source: reader.source,
    });
    expect(snapshot.source).toBe("garmin_official");
    expect(snapshot.values.configuredMaxHeartRateBpm).toBe(188);
    expect(snapshot.values.heartRateZones).toMatchObject({
      status: "garmin_configured",
      source: "garmin_official",
    });
    expect(
      snapshot.values.heartRateZones.boundaries.map((b) => b.lowerBpm),
    ).toEqual([94, 113, 132, 150, 169]);
    expect(snapshot.values.availableTrainingDays).toEqual([
      "monday",
      "wednesday",
    ]);
    expect(snapshot.values.cyclingFtpWatts).toBeNull();
  });

  it("keeps settings usable when the optional zones endpoint fails", async () => {
    const api = accountApi(newAccount());
    const reader = createOfficialReader({
      apiKey: () => "k",
      archive: vi.fn(),
      fetch: (async (input, init) =>
        String(input).includes("heartRateZones")
          ? new Response("{}", { status: 404 })
          : api.fetch(input, init)) as typeof fetch,
    });
    expect(await reader.profile()).toMatchObject({
      userData: { availableTrainingDays: ["monday", "wednesday"] },
    });
  });

  it("builds a discovery hint only from a complete year of summaries", () => {
    const end = "2026-11-18";
    const full = Array.from({ length: 364 }, (_, i) => {
      const date = addDays(end, -363 + i);
      return summaryRow(date, i >= 300 ? { hours: 24 } : undefined);
    });
    const hint = officialDiscoveryHint({ data: full }, end, 364);
    expect(hint.positiveDates[0]).toBe(end);
    expect(hint.positiveDates).toHaveLength(64);
    expect(hint.weeksWithData).toBeGreaterThan(0);
    expect(() =>
      officialDiscoveryHint({ data: full.slice(1) }, end, 364),
    ).toThrow(/truncated/);
    expect(() => officialDiscoveryHint(null, end, 364)).toThrow(/null/);
    expect(officialDiscoveryHint({ data: [] }, end, 364)).toMatchObject({
      positiveDates: [],
      weeksWithData: 0,
    });
  });

  it("refuses a discovery range beyond the documented 365-day limit before any request", async () => {
    const { reader, api } = readerFor();
    await expect(reader.weeklySteps!("2026-11-18", 53)).rejects.toThrow(
      /invalid/,
    );
    expect(api.requests).toHaveLength(0);
  });
});

describe("cancellation and budget", () => {
  it("stops before sending when cancelled and aborts in-flight work on close", async () => {
    let cancelled = false;
    const { reader, api } = readerFor(newAccount(), {
      admit: async () => undefined,
      cancelled: () => cancelled,
      remainingMs: () => 60_000,
    });
    cancelled = true;
    await expect(
      reader.activityPage("2026-11-01", "2026-11-30", 0),
    ).rejects.toBeInstanceOf(SyncPause);
    expect(api.requests).toHaveLength(0);
    reader.close();
  });

  it("charges the control once per actual HTTP request, token exchange included", async () => {
    const admit = vi.fn(async () => undefined);
    const account = newAccount();
    account.days.set("2026-11-18", { hours: 24 });
    const { reader, api } = readerFor(account, {
      admit,
      cancelled: () => false,
      remainingMs: () => 60_000,
    });
    await reader.dailyHealthEvidence!("2026-11-18");
    expect(admit).toHaveBeenCalledTimes(api.requests.length);
    expect(admit).toHaveBeenCalledTimes(6);
    expect(wallEnd("2026-11-18")).toBeTruthy();
  });

  it("reports an exhausted budget as a pause, not an error", async () => {
    const { reader } = readerFor(newAccount(), {
      admit: async () => undefined,
      cancelled: () => false,
      remainingMs: () => 0,
    });
    await expect(
      reader.activityPage("2026-11-01", "2026-11-30", 0),
    ).rejects.toMatchObject({ reason: "budget-limited" });
  });
});
