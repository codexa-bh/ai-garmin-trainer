import { afterEach, describe, expect, it } from "vitest";
import {
  downloadedHealth,
  latestFreshness,
  latestHealthDates,
  localDate,
} from "../src/lib/garmin/latest-policy";
const timezone = process.env.TZ;
afterEach(() => {
  process.env.TZ = timezone;
});
const known = (uploadedAt: string) => ({
  kind: "known" as const,
  primaryId: "watch",
  uploadedAt,
});

describe("local daily-health finality", () => {
  it("requires strictly post-midnight upload and a subsequent successful download, independently of completeness", () => {
    process.env.TZ = "UTC";
    expect(
      downloadedHealth(
        "2026-11-15",
        known("2026-11-16T00:00:00Z"),
        new Date("2026-11-16T12:00:00Z"),
      ).final,
    ).toBe(false);
    expect(
      downloadedHealth(
        "2026-11-15",
        known("2026-11-16T01:00:00Z"),
        new Date("2026-11-16T12:00:00Z"),
      ).final,
    ).toBe(true);
    expect(
      downloadedHealth(
        "2026-11-15",
        known("2026-11-16T13:00:00Z"),
        new Date("2026-11-16T12:00:00Z"),
      ).final,
    ).toBe(false);
    expect(
      downloadedHealth(
        "2026-11-16",
        known("2026-11-16T01:00:00Z"),
        new Date("2026-11-16T12:00:00Z"),
      ).final,
    ).toBe(false);
    expect(
      downloadedHealth(
        "2026-11-15",
        { kind: "unknown", reason: "ambiguous-primary" },
        new Date("2026-11-16T12:00:00Z"),
      ).final,
    ).toBe(false);
  });
  it.each([
    ["America/New_York", "2026-03-08", "2026-03-09T04:00:00Z"],
    ["America/New_York", "2026-11-01", "2026-11-02T05:00:00Z"],
    ["Pacific/Auckland", "2026-12-31", "2027-01-01T00:00:00+13:00"],
    ["Europe/Prague", "2024-02-29", "2024-03-01T00:00:00+01:00"],
  ])(
    "uses next local midnight through DST/leap/year rollover (%s %s)",
    (zone, date, midnight) => {
      process.env.TZ = zone;
      const end = Date.parse(midnight);
      expect(
        downloadedHealth(
          date,
          known(new Date(end).toISOString()),
          new Date(end + 7200000),
        ).final,
      ).toBe(false);
      expect(
        downloadedHealth(
          date,
          known(new Date(end + 1000).toISOString()),
          new Date(end + 7200000),
        ).final,
      ).toBe(true);
    },
  );
  it("finalizes an imprecise interval only when its earliest instant follows day end and its latest precedes download", () => {
    process.env.TZ = "Europe/Prague";
    const interval = (second: string) => ({
      kind: "known" as const,
      primaryId: "watch",
      uploadedAt: new Date(Date.parse(second)).toISOString(),
      uploadedThrough: new Date(Date.parse(second) + 999).toISOString(),
      via: "last-used" as const,
    });
    // Local midnight after 2026-03-28 is 2026-03-28T23:00:00Z (CET); DST next day.
    const end = "2026-03-28T23:00:00Z";
    const at = (iso: string) => new Date(iso);
    expect(
      downloadedHealth("2026-03-28", interval(end), at("2026-03-29T10:00:00Z"))
        .final,
    ).toBe(false);
    const after = downloadedHealth(
      "2026-03-28",
      interval("2026-03-28T23:00:01Z"),
      at("2026-03-29T10:00:00Z"),
    );
    expect(after).toMatchObject({
      final: true,
      uploadedAt: "2026-03-28T23:00:01.000Z",
      uploadedThrough: "2026-03-28T23:00:01.999Z",
    });
    // Download inside the possible upload second, or exactly at its end, fails closed.
    for (const download of [
      "2026-03-28T23:00:01.500Z",
      "2026-03-28T23:00:01.999Z",
    ])
      expect(
        downloadedHealth(
          "2026-03-28",
          interval("2026-03-28T23:00:01Z"),
          at(download),
        ).final,
      ).toBe(false);
    expect(
      downloadedHealth(
        "2026-03-28",
        interval("2026-03-28T23:00:01Z"),
        at("2026-03-28T23:00:02.000Z"),
      ).final,
    ).toBe(true);
    // Persisted interval evidence round-trips through the validator.
    const state = {
      version: 1,
      startDate: "2026-03-20",
      days: { "2026-03-28": after },
      profileDay: null,
      ftpDay: null,
      fitActivity: null,
    };
    expect(
      latestFreshness(JSON.stringify(state), [], "2026-03-29", null),
    ).toEqual(state);
    for (const bad of [
      { ...after, uploadedThrough: "2026-03-28T23:00:00.000Z" },
      { ...after, uploadedThrough: "2026-03-29T10:00:00.000Z" },
      { ...after, uploadedThrough: "not-an-instant" },
      { ...after, uploadedAt: null, final: false },
    ])
      expect(() =>
        latestFreshness(
          JSON.stringify({ ...state, days: { "2026-03-28": bad } }),
          [],
          "2026-03-29",
          null,
        ),
      ).toThrow();
  });
  it("initializes only stored older days once; preserves a >14-day forward backlog and missing gaps", () => {
    const state = latestFreshness(
      null,
      ["2025-01-01", "2026-11-01", "2026-11-15"],
      "2026-11-16",
      null,
    );
    expect(state.days["2025-01-01"]).toEqual({ final: true, source: "legacy" });
    expect(state.days["2026-11-01"].final).toBe(true);
    expect(state.days["2026-11-15"]).toBeUndefined();
    expect(state.startDate).toBe("2026-11-03");
    expect(
      latestFreshness(JSON.stringify(state), [], "2026-12-20", null),
    ).toEqual(state);
    const dates = latestHealthDates(
      state,
      ["2025-01-01", "2026-11-01", "2026-11-15"],
      "2026-12-20",
      null,
    );
    expect(dates).toHaveLength(48);
    expect(dates[0]).toBe("2026-11-03");
    expect(dates.at(-1)).toBe("2026-12-20");
    state.days["2026-11-20"] = { final: true, source: "legacy" };
    expect(
      latestHealthDates(state, ["2026-11-20"], "2026-12-20", "2026-11-10"),
    ).toContain("2026-11-19");
  });
  it("rejects corrupt/new state unchanged and never reattributes UTC day keys", () => {
    for (const raw of [
      "{",
      '{"version":2}',
      '{"version":1,"startDate":"2026-02-30"}',
    ])
      expect(() => latestFreshness(raw, [], "2026-11-16", null)).toThrow();
    process.env.TZ = "America/Los_Angeles";
    expect(localDate(new Date("2026-01-01T01:00:00Z"))).toBe("2025-12-31");
  });
});
