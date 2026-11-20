import { describe, expect, it } from "vitest";
import {
  dayCoverage,
  type DayCoverageEvidence,
} from "../src/lib/garmin/coverage-policy";
import {
  coveredHealth,
  latestFreshness,
  latestHealthDates,
  transitionToCoverage,
  type LatestFreshness,
} from "../src/lib/garmin/latest-policy";

/** Full day for an account at a fixed UTC offset (minutes), as the API reports it. */
function chronology(
  date: string,
  offsetMinutes = 0,
  overrides: Partial<Extract<DayCoverageEvidence, { kind: "chronology" }>> = {},
): DayCoverageEvidence {
  const start = Date.parse(`${date}T00:00:00Z`);
  const iso = (ms: number) => new Date(ms).toISOString().slice(0, 19) + ".0";
  const offset = offsetMinutes * 60_000;
  return {
    kind: "chronology",
    startGmt: iso(start - offset),
    endGmt: iso(start + 86_400_000 - offset),
    startLocal: iso(start),
    endLocal: iso(start + 86_400_000),
    durationMs: 86_400_000,
    ...overrides,
  };
}
const AFTER = new Date("2026-11-20T12:00:00Z");

describe("official daily coverage judgement", () => {
  it("accepts an ended whole local day", () => {
    expect(
      dayCoverage("2026-11-18", chronology("2026-11-18"), AFTER),
    ).toMatchObject({
      kind: "full",
    });
    expect(
      dayCoverage("2026-11-18", chronology("2026-11-18", 120), AFTER).kind,
    ).toBe("full");
  });

  it("derives a 23-hour spring-forward and 25-hour fall-back day from real offsets", () => {
    // Local wall clock still spans 24h; the GMT span is 23h/25h.
    const spring = chronology("2026-03-08", -300, {
      endGmt: "2026-03-09T04:00:00.0",
      durationMs: 82_800_000,
      startGmt: "2026-03-08T05:00:00.0",
    });
    expect(dayCoverage("2026-03-08", spring, AFTER).kind).toBe("full");
    const fall = chronology("2026-11-01", -240, {
      startGmt: "2026-11-01T04:00:00.0",
      endGmt: "2026-11-02T05:00:00.0",
      durationMs: 90_000_000,
    });
    expect(dayCoverage("2026-11-01", fall, AFTER).kind).toBe("full");
  });

  it("does not accept 86,400,000 ms as proof when the span is not the whole local day", () => {
    // Exactly 24h of GMT but ending 1h short of local midnight (a skewed span).
    const skewed = chronology("2026-11-18", 0, {
      endLocal: "2026-11-18T23:00:00.0",
    });
    expect(dayCoverage("2026-11-18", skewed, AFTER)).toMatchObject({
      kind: "partial",
      reason: "ends-before-midnight",
    });
    const late = chronology("2026-11-18", 0, {
      startLocal: "2026-11-18T06:00:00.0",
      startGmt: "2026-11-18T06:00:00.0",
      durationMs: 64_800_000,
    });
    expect(dayCoverage("2026-11-18", late, AFTER).kind).toBe("partial");
  });

  it.each([
    ["wrong day", () => chronology("2026-11-17"), "day-identity-mismatch"],
    [
      "inconsistent duration",
      () => chronology("2026-11-18", 0, { durationMs: 86_000_000 }),
      "duration-mismatch",
    ],
    [
      "reversed bounds",
      () =>
        chronology("2026-11-18", 0, {
          endGmt: "2026-11-17T00:00:00.0",
          durationMs: 1,
        }),
      "inconsistent-chronology",
    ],
    [
      "impossible offset",
      () => chronology("2026-11-18", 0, { startGmt: "2026-11-17T22:07:00.0" }),
      "duration-mismatch",
    ],
    [
      "malformed time",
      () => chronology("2026-11-18", 0, { startGmt: "yesterday" }),
      "malformed-chronology",
    ],
    [
      "non-finite duration",
      () => chronology("2026-11-18", 0, { durationMs: Number.NaN }),
      "malformed-chronology",
    ],
  ])("treats %s as unknown, never guessed full", (_label, build, reason) => {
    expect(dayCoverage("2026-11-18", build(), AFTER)).toMatchObject({
      kind: "unknown",
      reason,
    });
  });

  it("keeps a partial upload, an unended day and source emptiness retryable", () => {
    const partial = chronology("2026-11-18", 0, {
      endLocal: "2026-11-18T14:12:00.0",
      endGmt: "2026-11-18T14:12:00.0",
      durationMs: 51_120_000,
    });
    expect(dayCoverage("2026-11-18", partial, AFTER).kind).toBe("partial");
    expect(
      dayCoverage(
        "2026-11-18",
        chronology("2026-11-18"),
        new Date("2026-11-18T10:00:00Z"),
      ),
    ).toMatchObject({ kind: "partial", reason: "day-not-ended" });
    expect(
      dayCoverage("2026-11-18", { kind: "none", reason: "empty" }, AFTER).kind,
    ).toBe("partial");
    expect(
      dayCoverage("2026-11-18", { kind: "none", reason: "malformed" }, AFTER)
        .kind,
    ).toBe("unknown");
  });
});

describe("coverage finality records", () => {
  const full = dayCoverage("2026-11-18", chronology("2026-11-18"), AFTER);
  it("finalizes only ended days, never today, and never fabricates upload evidence", () => {
    const final = coveredHealth("2026-11-18", full, "2026-11-20", AFTER);
    expect(final).toMatchObject({
      final: true,
      source: "coverage",
      coverage: "full",
    });
    expect(JSON.stringify(final)).not.toMatch(/primaryId|uploadedAt/);
    expect(
      coveredHealth("2026-11-20", full, "2026-11-20", AFTER),
    ).toMatchObject({
      final: false,
      coverage: "partial",
      reason: "day-not-ended",
    });
    expect(
      coveredHealth(
        "2026-11-18",
        { kind: "partial", reason: "late-start" },
        "2026-11-20",
        AFTER,
      ),
    ).toMatchObject({
      final: false,
      coverage: "partial",
      reason: "late-start",
    });
  });

  it("round-trips through the validated freshness checkpoint", () => {
    const state: LatestFreshness = {
      ...latestFreshness(null, [], "2026-11-20", null),
      days: {
        "2026-11-18": coveredHealth("2026-11-18", full, "2026-11-20", AFTER),
      },
    };
    expect(
      latestFreshness(JSON.stringify(state), ["2026-11-18"], "2026-11-20", null)
        .days,
    ).toEqual(state.days);
    const corrupt = JSON.stringify({
      ...state,
      days: {
        "2026-11-18": {
          source: "coverage",
          final: true,
          downloadedAt: AFTER.toISOString(),
          coverage: "partial",
        },
      },
    });
    expect(() => latestFreshness(corrupt, [], "2026-11-20", null)).toThrow(
      /Invalid latest health evidence/,
    );
  });
});

describe("old-to-coverage transition", () => {
  const download = (final: boolean) => ({
    source: "download" as const,
    final,
    downloadedAt: "2026-11-19T10:00:00.000Z",
    dayEndedAt: "2026-11-19T00:00:00.000Z",
    primaryId: final ? "watch" : null,
    uploadedAt: final ? "2026-11-19T01:00:00.000Z" : null,
  });
  const before = (): LatestFreshness => ({
    version: 1,
    startDate: "2026-11-07",
    days: {
      "2026-06-01": { final: true, source: "legacy" },
      "2026-09-01": download(true),
      "2026-11-10": download(true),
      "2026-11-18": download(true),
      "2026-11-17": download(false),
    },
    profileDay: null,
    ftpDay: null,
    fitActivity: null,
  });
  const NOW = new Date("2026-11-20T12:00:00Z");

  it("rechecks the recent 14 days, keeps older finals as legacy and non-final days open", () => {
    const next = transitionToCoverage(before(), "2026-11-20", NOW);
    expect(next.days["2026-06-01"]).toEqual({ final: true, source: "legacy" });
    expect(next.days["2026-09-01"]).toEqual({ final: true, source: "legacy" });
    expect(next.days["2026-11-10"]).toBeUndefined();
    expect(next.days["2026-11-18"]).toBeUndefined();
    expect(next.days["2026-11-17"]).toMatchObject({ final: false });
    expect(next.coverageTransition).toMatchObject({
      version: 1,
      recheckedFrom: "2026-11-07",
    });
    // Recent dates become selectable again; legacy finals with stored rows do not.
    const dates = latestHealthDates(
      next,
      ["2026-06-01", "2026-09-01", "2026-11-10", "2026-11-18"],
      "2026-11-20",
      null,
    );
    expect(dates).toEqual(
      expect.arrayContaining(["2026-11-10", "2026-11-18", "2026-11-20"]),
    );
    expect(dates).not.toContain("2026-06-01");
    expect(dates).not.toContain("2026-09-01");
  });

  it("is idempotent and replays safely after interruption", () => {
    const once = transitionToCoverage(before(), "2026-11-20", NOW);
    expect(
      transitionToCoverage(
        once,
        "2026-11-21",
        new Date("2026-11-21T00:00:00Z"),
      ),
    ).toBe(once);
    // Replaying from the original saved bytes gives the same result.
    expect(transitionToCoverage(before(), "2026-11-20", NOW)).toEqual(once);
  });

  it("never rewrites corrupt or unsupported state", () => {
    expect(() =>
      latestFreshness('{"version":2}', [], "2026-11-20", null),
    ).toThrow(/Unsupported latest freshness/);
    expect(() =>
      latestFreshness(
        JSON.stringify({ ...before(), coverageTransition: { version: 9 } }),
        [],
        "2026-11-20",
        null,
      ),
    ).toThrow(/Unsupported latest freshness/);
  });
});
