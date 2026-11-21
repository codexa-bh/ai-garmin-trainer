import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import {
  deriveSplitHeartRate,
  prepareHeartRateSamples,
  projectSplitHeartRate,
  resolveZoneBoundaries,
  type ZoneBoundaryEvidence,
} from "../src/lib/local-data/split-heart-rate";
import { migrateDatabase } from "../src/lib/db/migrations";
import { upsertSnowSplits } from "../src/lib/db/snow-split-repository";
import { deriveActivitySplitHeartRates } from "../src/lib/db/split-heart-rate-repository";
import { decodeActivityFit } from "../src/lib/garmin/official-fit";
import { normalizeActivityDetail } from "../src/lib/garmin/detail-normalize";
import { buildFit } from "./official-fit-fixture";

const T0 = "2026-01-10T10:00:00Z";
const at = (seconds: number) =>
  new Date(Date.parse(T0) + seconds * 1000).toISOString();
const sampleAt = (seconds: number, hr: number | null) => ({
  timestamp: at(seconds),
  heartRate: hr,
});
const win = (start: number, end: number) => ({
  startTime: at(start),
  endTime: at(end),
});
const bounds: ZoneBoundaryEvidence = {
  status: "available",
  lowers: [100, 120, 140, 160, 180],
};

function derive(
  rows: Array<{ timestamp: string | null; heartRate: number | null }>,
  start: number,
  end: number,
  b: ZoneBoundaryEvidence = bounds,
) {
  return deriveSplitHeartRate(
    prepareHeartRateSamples(rows),
    win(start, end),
    b,
  );
}
const secondsOf = (result: ReturnType<typeof derive>) =>
  result.zones.buckets?.map((bucket) => bucket.seconds);

describe("explicit-zone instants", () => {
  it("sorts by instant, not lexically across offsets", () => {
    const samples = prepareHeartRateSamples([
      { timestamp: "2026-01-10T11:00:10+01:00", heartRate: 120 },
      { timestamp: "2026-01-10T10:00:00Z", heartRate: 100 },
    ]);
    expect(samples.samples.map((s) => s.heartRate)).toEqual([100, 120]);
  });
  it("treats DST-equivalent offsets as the same instant and refuses zone-less or invalid text", () => {
    const rows = [
      { timestamp: "2026-03-29T03:30:00+02:00", heartRate: 100 },
      { timestamp: "2026-03-29T01:30:10Z", heartRate: 100 },
      { timestamp: "2026-03-29T01:30:20Z", heartRate: 100 },
    ];
    const samples = prepareHeartRateSamples(rows);
    const window = {
      startTime: "2026-03-29T01:30:00Z",
      endTime: "2026-03-29T01:30:20Z",
    };
    expect(deriveSplitHeartRate(samples, window, bounds).avgHeartRate).toBe(
      100,
    );
    for (const bad of [
      "2026-01-10T10:00:00",
      "2026-01-10",
      "2026-13-40T10:00:00Z",
      "",
    ])
      expect(
        prepareHeartRateSamples([{ timestamp: bad, heartRate: 100 }]).samples,
      ).toEqual([]);
  });
});

describe("activity-local UTC preparation", () => {
  const legacy = (second: number, hr: number | null = 120) => ({
    timestamp: at(second).replace("T", " ").replace(".000Z", ""),
    heartRate: hr,
  });
  it("admits matching legacy clock once per activity, preserving explicit offset instants", () => {
    const rows = [
      legacy(0, null),
      legacy(10),
      { timestamp: "2026-01-10T11:00:20+01:00", heartRate: 140 },
    ];
    const prepared = prepareHeartRateSamples(rows, Date.parse(T0));
    expect(prepared.unavailableReason).toBeNull();
    expect(
      deriveSplitHeartRate(prepared, win(10, 20), bounds).avgHeartRate,
    ).toBe(120);
  });
  it.each([null, NaN, Infinity, Date.parse(T0) + 1])(
    "refuses missing/invalid/mismatching start %s",
    (start) => {
      expect(
        prepareHeartRateSamples([legacy(0), legacy(10)], start)
          .unavailableReason,
      ).toBe("unproven-sample-timezone");
    },
  );
  it("accepts millisecond-precise legacy fractions only with exact equality", () => {
    const rows = [
      { timestamp: "2026-01-10 10:00:00.123", heartRate: 120 },
      { timestamp: "2026-01-10T10:00:01.123", heartRate: 120 },
    ];
    expect(
      prepareHeartRateSamples(rows, Date.parse(T0) + 123).unavailableReason,
    ).toBeNull();
    expect(
      prepareHeartRateSamples(rows, Date.parse(T0)).unavailableReason,
    ).toBe("unproven-sample-timezone");
  });
  it.each([
    "2026-02-29 10:00:00",
    "2026-04-31 10:00:00",
    "2026-01-10 24:00:00",
    "2026-01-10 10:60:00",
    "2026-01-10 10:00:60",
    "01/10/2026 10:00:00",
    "2026-01-10 10:00:00.1234",
  ])("refuses calendar/grammar-invalid legacy text %s", (timestamp) => {
    expect(
      prepareHeartRateSamples([{ timestamp, heartRate: 120 }], Date.parse(T0))
        .unavailableReason,
    ).toBe("invalid-sample-time");
  });
  it("accepts a leap day but rejects rolled-over explicit-zone days and window endpoints", () => {
    const timestamp = "2024-02-29 10:00:00";
    expect(
      prepareHeartRateSamples(
        [{ timestamp, heartRate: 120 }],
        Date.parse("2024-02-29T10:00:00Z"),
      ).unavailableReason,
    ).toBeNull();
    expect(
      prepareHeartRateSamples([
        { timestamp: "2026-02-29T10:00:00Z", heartRate: 120 },
      ]).unavailableReason,
    ).toBe("invalid-sample-time");
    expect(
      deriveSplitHeartRate(
        prepareHeartRateSamples([]),
        { startTime: "2026-02-29T10:00:00Z", endTime: "2026-03-01T10:00:10Z" },
        bounds,
      ).unavailableReason,
    ).toBe("invalid-window");
  });
  it("prioritizes invalid window, then clock, then stored/window/HR availability", () => {
    const prepared = prepareHeartRateSamples([
      legacy(0),
      sampleAt(5, 120),
      sampleAt(10, 120),
    ]);
    expect(
      deriveSplitHeartRate(
        prepared,
        { startTime: null, endTime: at(10) },
        bounds,
      ).unavailableReason,
    ).toBe("invalid-window");
    expect(
      deriveSplitHeartRate(prepared, win(5, 10), bounds).unavailableReason,
    ).toBe("unproven-sample-timezone");
    expect(
      deriveSplitHeartRate(
        prepareHeartRateSamples([
          sampleAt(0, 120),
          { timestamp: null, heartRate: 120 },
          sampleAt(10, 120),
        ]),
        win(0, 10),
        bounds,
      ).unavailableReason,
    ).toBe("invalid-sample-time");
  });
});

describe("deriveSplitHeartRate", () => {
  it("weights by supported duration, not by sample count", () => {
    // 100 bpm for 2 s, 160 bpm for 8 s => 148, while the sample mean is 130.
    const result = derive(
      [sampleAt(0, 100), sampleAt(2, 160), sampleAt(10, 160)],
      0,
      10,
    );
    expect(result.avgHeartRate).toBeCloseTo(148, 6);
    expect(result.supportSeconds).toBe(10);
    expect(secondsOf(result)).toEqual([0, 2, 0, 0, 8, 0]);
  });

  it("clips at the window and never takes HR from outside samples", () => {
    const rows = [
      sampleAt(-20, 60),
      sampleAt(-1, 60),
      sampleAt(0, 120),
      sampleAt(5, 120),
      sampleAt(10, 120),
      sampleAt(11, 200),
      sampleAt(30, 200),
    ];
    const result = derive(rows, 0, 10);
    expect(result.avgHeartRate).toBe(120);
    expect(result.supportSeconds).toBe(10);
  });

  it("keeps adjacent runs and lifts isolated and never double counts a shared boundary", () => {
    const rows = [
      sampleAt(0, 100),
      sampleAt(5, 100),
      sampleAt(10, 170),
      sampleAt(15, 170),
      sampleAt(20, 170),
    ];
    const first = derive(rows, 0, 10);
    const second = derive(rows, 10, 20);
    expect(first.avgHeartRate).toBe(100);
    expect(second.avgHeartRate).toBe(170);
    expect(first.supportSeconds! + second.supportSeconds!).toBe(20);
    expect(secondsOf(first)).toEqual([0, 10, 0, 0, 0, 0]);
    expect(secondsOf(second)).toEqual([0, 0, 0, 0, 10, 0]);
  });

  it("supports irregular cadence within the hold bridge", () => {
    const result = derive(
      [
        sampleAt(0, 110),
        sampleAt(1, 130),
        sampleAt(11, 150),
        sampleAt(20, 150),
      ],
      0,
      20,
    );
    // 110*1 + 130*10 + 150*9 = 2760 over 20 s.
    expect(result.avgHeartRate).toBeCloseTo(138, 6);
  });

  it("uses exact inclusive zone floors and keeps below zone 1 separate", () => {
    const result = derive(
      [
        sampleAt(0, 99),
        sampleAt(1, 100),
        sampleAt(2, 119),
        sampleAt(3, 120),
        sampleAt(4, 180),
        sampleAt(5, 250),
        sampleAt(6, 250),
      ],
      0,
      6,
    );
    expect(secondsOf(result)).toEqual([1, 2, 1, 0, 0, 2]);
    expect(result.zones.buckets![1]).toMatchObject({
      lowerBpm: 100,
      upperBpm: 119,
    });
    expect(result.zones.buckets![5]).toMatchObject({
      lowerBpm: 180,
      upperBpm: null,
    });
  });

  it("keeps a valid zero-duration bucket as zero, distinct from unavailable", () => {
    const result = derive([sampleAt(0, 130), sampleAt(10, 130)], 0, 10);
    expect(secondsOf(result)).toEqual([0, 0, 10, 0, 0, 0]);
    expect(result.zones.unavailableReason).toBeNull();
  });

  it("holds the last sample only to the window end and no further", () => {
    const result = derive([sampleAt(0, 120), sampleAt(4, 140)], 0, 8);
    expect(result.supportSeconds).toBe(8);
    expect(result.avgHeartRate).toBeCloseTo((120 * 4 + 140 * 4) / 8, 6);
  });

  it("refuses significant gaps instead of presenting a partial result", () => {
    const middle = derive(
      [
        sampleAt(0, 120),
        sampleAt(5, 120),
        sampleAt(60, 120),
        sampleAt(65, 120),
      ],
      0,
      65,
    );
    expect(middle).toMatchObject({
      avgHeartRate: null,
      unavailableReason: "significant-gap",
    });
    expect(middle.zones.buckets).toBeNull();
  });

  it("accepts the maximum hold and refuses just beyond it", () => {
    expect(
      derive([sampleAt(0, 120), sampleAt(30, 120)], 0, 30).avgHeartRate,
    ).toBe(120);
    expect(
      derive([sampleAt(0, 120), sampleAt(31, 120)], 0, 31).unavailableReason,
    ).toBe("significant-gap");
  });

  it("refuses a lone sample and a window without samples", () => {
    expect(derive([sampleAt(3, 120)], 0, 10).unavailableReason).toBe(
      "insufficient-samples",
    );
    expect(derive([sampleAt(50, 120), sampleAt(60, 120)], 0, 10)).toMatchObject(
      {
        avgHeartRate: null,
        unavailableReason: "no-window-samples",
      },
    );
    expect(derive([], 0, 10).unavailableReason).toBe("no-heart-rate-samples");
  });

  it("treats null, zero and out-of-range HR as missing support, never as measured zero", () => {
    const rows = [
      sampleAt(0, 120),
      sampleAt(10, null),
      sampleAt(20, 0),
      sampleAt(30, 500),
      sampleAt(40, 120),
      sampleAt(50, 120),
    ];
    const result = derive(rows, 0, 50);
    expect(result.avgHeartRate).toBeNull();
    expect(
      derive([sampleAt(0, null), sampleAt(5, null)], 0, 5).unavailableReason,
    ).toBe("no-usable-heart-rate");
  });

  it("requires enough support even without one long gap", () => {
    const rows = [
      sampleAt(0, 120),
      sampleAt(5, null),
      sampleAt(10, 120),
      sampleAt(15, null),
      sampleAt(20, 120),
      sampleAt(25, null),
      sampleAt(30, 120),
      sampleAt(35, null),
      sampleAt(40, 120),
      sampleAt(45, null),
      sampleAt(50, 120),
    ];
    expect(derive(rows, 0, 50)).toMatchObject({
      avgHeartRate: null,
      unavailableReason: "insufficient-support",
    });
  });

  it("refuses invalid, missing, reversed and zero-length windows without inventing an end", () => {
    const rows = prepareHeartRateSamples([sampleAt(0, 120), sampleAt(10, 120)]);
    for (const window of [
      { startTime: at(0), endTime: null },
      { startTime: null, endTime: at(10) },
      { startTime: at(10), endTime: at(0) },
      { startTime: at(5), endTime: at(5) },
      { startTime: "2026-01-10T10:00:00", endTime: at(10) },
    ])
      expect(deriveSplitHeartRate(rows, window, bounds).unavailableReason).toBe(
        "invalid-window",
      );
  });

  it("keeps the first duplicate but never bridges rejected zone-less points", () => {
    const rows = [
      sampleAt(0, 120),
      sampleAt(0, 999),
      { timestamp: "2026-01-10T10:00:05", heartRate: 50 },
      sampleAt(10, 120),
    ];
    expect(derive(rows, 0, 10).unavailableReason).toBe(
      "unproven-sample-timezone",
    );
    expect(
      derive(
        rows.filter((row) => row.timestamp !== "2026-01-10T10:00:05"),
        0,
        10,
      ).avgHeartRate,
    ).toBe(120);
  });

  it("matches the same window expressed in a different offset", () => {
    const rows = prepareHeartRateSamples([
      sampleAt(0, 100),
      sampleAt(10, 140),
      sampleAt(20, 140),
    ]);
    const result = deriveSplitHeartRate(
      rows,
      {
        startTime: "2026-01-10T11:00:00+01:00",
        endTime: "2026-01-10T11:00:20+01:00",
      },
      bounds,
    );
    expect(result.avgHeartRate).toBe(120);
  });

  it("keeps Avg HR when zone boundaries are unavailable, with a distinct reason", () => {
    const result = derive([sampleAt(0, 120), sampleAt(10, 120)], 0, 10, {
      status: "unavailable",
      reason: "conflicting-zone-boundaries",
    });
    expect(result.avgHeartRate).toBe(120);
    expect(result.zones).toEqual({
      buckets: null,
      unavailableReason: "conflicting-zone-boundaries",
    });
  });
});

describe("resolveZoneBoundaries", () => {
  const good = [100, 120, 140, 160, 180];
  it("accepts matching file sources and never a current baseline", () => {
    expect(
      resolveZoneBoundaries({ session: good, laps: [good, good] }),
    ).toEqual({
      status: "available",
      lowers: good,
    });
    expect(resolveZoneBoundaries({ session: null, laps: [good] }).status).toBe(
      "available",
    );
    expect(resolveZoneBoundaries({ session: null, laps: [] })).toEqual({
      status: "unavailable",
      reason: "missing-zone-boundaries",
    });
  });
  it("rejects incomplete, non-ascending and conflicting sets", () => {
    expect(
      resolveZoneBoundaries({ session: [100, null, 140, 160, 180], laps: [] }),
    ).toEqual({ status: "unavailable", reason: "missing-zone-boundaries" });
    expect(
      resolveZoneBoundaries({ session: [100, 100, 140, 160, 180], laps: [] }),
    ).toEqual({ status: "unavailable", reason: "conflicting-zone-boundaries" });
    expect(
      resolveZoneBoundaries({
        session: good,
        laps: [[100, 120, 140, 160, 181]],
      }),
    ).toEqual({ status: "unavailable", reason: "conflicting-zone-boundaries" });
  });
});

describe("projectSplitHeartRate", () => {
  it("carries only derived values and closed reasons", () => {
    const result = derive([sampleAt(0, 120), sampleAt(10, 120)], 0, 10);
    const projected = projectSplitHeartRate({
      ...result,
      leaked: at(0),
    } as typeof result);
    expect(JSON.stringify(projected)).not.toContain("2026-");
    expect(Object.keys(projected).sort()).toEqual([
      "avgHeartRate",
      "supportSeconds",
      "unavailableReason",
      "windowSeconds",
      "zones",
    ]);
  });
});

describe("actual FIT → normalized stream → stored window", () => {
  it("aligns official split endpoints with stored record timestamps and isolates adjacent splits", async () => {
    // Authored FIT: records at 1 Hz, run 0–10 s at 100 bpm, lift 10–20 s at 170 bpm.
    const records = Array.from({ length: 21 }, (_, second) => ({
      at: second,
      hr: second < 10 ? 100 : 170,
    }));
    const fit = await decodeActivityFit(
      buildFit({
        sport: 14,
        records,
        highBoundaries: [100, 120, 140, 160, 180, 200],
        snowSplits: [
          { index: 1, type: 29, start: 0, end: 10 },
          { index: 2, type: 28, start: 10, end: 20 },
        ],
      }),
    );
    const db = new Database(":memory:");
    migrateDatabase(db);
    db.pragma("foreign_keys=ON");
    db.prepare(
      "insert into activity(id,garmin_id,sport,started_at) values('a','a','resort_snowboarding',1)",
    ).run();
    const detail = normalizeActivityDetail("a", fit.detail);
    const insert = db.prepare(
      "insert into activity_stream_point (garmin_id, elapsed_sec, timestamp, heart_rate) values ('a', ?, ?, ?)",
    );
    for (const point of detail.stream)
      insert.run(point.elapsedSec, point.timestamp, point.heartRate);
    upsertSnowSplits(db, "a", fit.extras.snowSplits!);
    for (const [index, lower] of [100, 120, 140, 160, 180].entries())
      db.prepare(
        `insert into activity_hr_zone_time (garmin_id, zone, fetched_at, source, status, seconds, source_lower_bpm, source_total_seconds)
         values ('a', ?, 1, 'garmin_official_fit', 'available', 0, ?, 0)`,
      ).run(index + 1, lower);

    const before = db
      .prepare("select count(*) n from activity_snow_split")
      .get();
    const derived = deriveActivitySplitHeartRates(db, "a");
    expect(derived.map((s) => [s.splitType, s.heartRate.avgHeartRate])).toEqual(
      [
        ["run", 100],
        ["lift", 170],
      ],
    );
    expect(derived[0].heartRate.zones.buckets!.map((b) => b.seconds)).toEqual([
      0, 10, 0, 0, 0, 0,
    ]);
    expect(derived[1].heartRate.zones.buckets!.map((b) => b.seconds)).toEqual([
      0, 0, 0, 0, 10, 0,
    ]);
    // Read-only: no write, and another activity's samples never enter.
    expect(
      db.prepare("select count(*) n from activity_snow_split").get(),
    ).toEqual(before);
    expect(deriveActivitySplitHeartRates(db, "other")).toEqual([]);
    db.close();
  });
});

describe("trainer split heart-rate evidence", () => {
  function seeded(runCount: number) {
    const db = new Database(":memory:");
    migrateDatabase(db);
    db.pragma("foreign_keys=ON");
    db.prepare(
      "insert into activity(id,garmin_id,sport,started_at) values('a','a','resort_snowboarding',1)",
    ).run();
    const point = db.prepare(
      "insert into activity_stream_point (garmin_id, elapsed_sec, timestamp, heart_rate) values ('a', ?, ?, ?)",
    );
    const split = db.prepare(
      `insert into activity_snow_split (garmin_id, split_key, message_index, source_order, split_type, start_time, end_time, timer_seconds, fetched_at)
       values ('a', ?, ?, ?, ?, ?, ?, 10, 1)`,
    );
    // Split i spans [20i, 20i+10] (run) and [20i+10, 20i+20] (lift).
    for (let second = 0; second <= runCount * 20; second += 1)
      point.run(second, at(second), 100 + (second % 20 < 10 ? 0 : 70));
    for (let i = 0; i < runCount; i += 1) {
      split.run(
        `index:${i * 2}`,
        i * 2,
        i * 2,
        "run",
        at(i * 20),
        at(i * 20 + 10),
      );
      split.run(
        `index:${i * 2 + 1}`,
        i * 2 + 1,
        i * 2 + 1,
        "lift",
        at(i * 20 + 10),
        at(i * 20 + 20),
      );
    }
    for (const [index, lower] of [100, 120, 140, 160, 180].entries())
      db.prepare(
        `insert into activity_hr_zone_time (garmin_id, zone, fetched_at, source, status, seconds, source_lower_bpm, source_total_seconds)
         values ('a', ?, 1, 'garmin_official_fit', 'available', 0, ?, 0)`,
      ).run(index + 1, lower);
    return db;
  }

  it("covers both types, with per-type counts and honest omissions", async () => {
    const { snowActivityEvidence } =
      await import("../src/lib/db/snow-split-repository");
    const db = seeded(25);
    const evidence = snowActivityEvidence(db, "a", { splitHeartRate: true });
    expect(evidence.hrAssociation).toBe("no-proven-lap-link");
    const { types, zoneLowerBpm, perTypeLimit } = evidence.splitHeartRate!;
    expect(zoneLowerBpm).toEqual([100, 120, 140, 160, 180]);
    expect(perTypeLimit).toBe(20);
    for (const type of types)
      expect(type).toMatchObject({
        sourceCount: 25,
        returnedCount: 20,
        omittedCount: 5,
      });
    expect(types[0].rows[0]).toMatchObject({
      avgHeartRate: 100,
      zoneSeconds: [0, 10, 0, 0, 0, 0],
    });
    expect(types[1].rows[0]).toMatchObject({
      avgHeartRate: 170,
      zoneSeconds: [0, 0, 0, 0, 10, 0],
    });
    // Overview-only: the ordinary known-ID summary stays small and unchanged.
    expect(snowActivityEvidence(db, "a").splitHeartRate).toBeUndefined();
    const text = JSON.stringify(evidence);
    expect(text).not.toMatch(/2026-|start_lat|latitude|timestamp/);
    expect(text.length).toBeLessThan(12_000);
    db.close();
  });

  it("keeps missing support missing and never fills a window it cannot support", async () => {
    const { snowActivityEvidence } =
      await import("../src/lib/db/snow-split-repository");
    const db = seeded(1);
    db.prepare(
      "delete from activity_stream_point where elapsed_sec between 0 and 9",
    ).run();
    const run = snowActivityEvidence(db, "a", { splitHeartRate: true })
      .splitHeartRate!.types[0].rows[0];
    expect(run).toMatchObject({
      avgHeartRate: null,
      zoneSeconds: null,
      hrUnavailableReason: "insufficient-samples",
    });
    db.close();
  });
});
