type PointsRule = NonNullable<
  import("../src/lib/weekly/kpi-contracts").KpiTrack["pointsRule"]
>;
import { expect, it } from "vitest";
import type {
  KpiRead,
  KpiSetInput,
  KpiTrack,
} from "../src/lib/weekly/kpi-contracts";
import { latestKpiScore, validateKpiSet } from "../src/lib/weekly/kpis";

function fixture(
  rule: PointsRule = { kind: "proportional" },
  value: number | null = 5,
): KpiRead {
  const track: KpiTrack = {
    key: "volume",
    kind: "numeric",
    unit: "km",
    meaning: "Authored volume",
    target: { comparator: "at-least", value: 10 },
    availablePoints: 10,
    pointsRule: rule,
  };
  return {
    weekStart: "2026-11-09",
    revision: "r",
    timeZone: "UTC",
    originalId: "s",
    latestId: "s",
    reviewDefinedId: null,
    complete: true,
    sets: [
      {
        id: "s",
        savedAt: "2026-11-09T00:00:00Z",
        origin: "planned",
        items: [{ id: "i", conceptId: "c", label: "Volume", tracks: [track] }],
      },
    ],
    assessments: [],
    availableSets: [],
    measured: {
      weekStart: "2026-11-09",
      timeZone: "UTC",
      revision: "m",
      concepts: {
        c: {
          success: {
            recipeVersion: 1,
            status: "measured",
            values: { volume: value },
            signatures: {
              volume: JSON.stringify([track.kind, track.unit, track.meaning]),
            },
            measuredAt: "2026-11-10T12:00:00Z",
            asOf: "2026-11-10T11:00:00Z",
            basis: "authored",
          },
        },
      },
    },
  };
}
function review(
  read: KpiRead,
  award: number | null,
  qualification?: boolean | null,
) {
  read.assessments = [
    {
      setId: "s",
      revision: "a",
      savedAt: "2026-11-10T10:00:00Z",
      asOf: "2026-11-10T09:00:00Z",
      status: "supported",
      items: [
        {
          itemId: "i",
          status: "supported",
          actuals: [
            { trackKey: "volume", value: 5, awardedPoints: award },
            ...(qualification !== undefined
              ? [{ trackKey: "qualified", value: qualification }]
              : []),
          ],
          evidence: { origin: "user-report", references: [] },
        },
      ],
      extras: [],
      totalPoints: award,
    },
  ];
}
function condition(read: KpiRead) {
  read.sets[0].items[0].tracks[0].requiresCondition = "qualified";
  read.sets[0].items[0].tracks.push({
    key: "qualified",
    kind: "qualifying",
    unit: "boolean",
    meaning: "Reviewed eligibility",
    target: { comparator: "equal", value: true },
  });
}
it.each([
  [{ kind: "proportional" }, 5, 5],
  [{ kind: "proportional" }, 20, 10],
  [{ kind: "proportional" }, 0, 0],
  [{ kind: "proportional" }, null, 0],
  [{ kind: "perUnit", points: 1, cap: 2 }, 1.5, 1.5],
  [{ kind: "perUnit", points: 1, cap: 2 }, 20, 2],
  [{ kind: "perUnit", points: 0, cap: 0 }, 20, 0],
  [{ kind: "threshold" }, 10, 10],
  [{ kind: "threshold" }, 9, 0],
] as [PointsRule, number | null, number][])(
  "executes declared %j at %s without writes",
  (rule, value, expected) => {
    const read = fixture(rule, value);
    const before = JSON.stringify(read);
    expect(latestKpiScore(read)).toMatchObject({
      total: expected,
      percentage: expected * 10,
      automatic: true,
      provisional: true,
    });
    expect(JSON.stringify(read)).toBe(before);
  },
);
it.each(["at-most", "equal", "range"] as const)(
  "threshold supports %s but never turns absent evidence into reward-bearing zero",
  (comparator) => {
    const read = fixture({ kind: "threshold" }, 0);
    read.sets[0].items[0].tracks[0].target = {
      comparator,
      value: 0,
      ...(comparator === "range" ? { upper: 2 } : {}),
    };
    expect(latestKpiScore(read).total).toBe(10);
    read.measured!.concepts.c.success!.values.volume = null;
    expect(latestKpiScore(read).total).toBeNull();
  },
);
it("keeps reviewed zero, partial/above-allocation awards and wholly reviewed saved totals authoritative", () => {
  for (const award of [0, 3, 15]) {
    const read = fixture();
    review(read, award);
    read.assessments[0].totalPoints = 77;
    expect(latestKpiScore(read)).toMatchObject({
      total: 77,
      automatic: false,
      tracks: [{ amount: award, source: "reviewed" }],
    });
    read.assessments[0].totalPoints = null;
    expect(latestKpiScore(read).total).toBeNull();
    read.assessments[0].items[0].status = "unavailable";
    expect(latestKpiScore(read).total).toBeNull();
  }
});
it("keeps null awards eligible for fallback and exact-set extras counted once in mixed totals", () => {
  const read = fixture();
  review(read, null);
  read.assessments[0].totalPoints = 99;
  read.assessments[0].extras = [
    {
      label: "Extra",
      points: 2,
      explanation: "Reviewed",
      evidence: { origin: "user-report", references: [] },
    },
  ];
  expect(latestKpiScore(read).total).toBe(7);
  read.sets[0].items.push({
    id: "other",
    conceptId: "other",
    label: "Other",
    tracks: [{ ...read.sets[0].items[0].tracks[0], pointsRule: undefined }],
  });
  expect(latestKpiScore(read).total).toBeNull(); // never a subtotal or redistributed denominator
  read.assessments[0].items.push({
    ...structuredClone(read.assessments[0].items[0]),
    itemId: "other",
    actuals: [{ trackKey: "volume", value: 0, awardedPoints: 0 }],
  });
  expect(latestKpiScore(read).total).toBe(7);
  read.measured!.concepts.c.success!.values.volume = 8;
  expect(latestKpiScore(read).total).toBe(10); // midweek review freezes only other/volume
});
it.each([true, false, null, undefined])(
  "retains reviewed qualification %s and its own cutoff",
  (qualification) => {
    const read = fixture();
    condition(read);
    review(read, null, qualification);
    const point = latestKpiScore(read);
    expect(point.total).toBe(qualification === false ? 0 : 5);
    expect(point.provisional).toBe(true);
    expect(point.tracks[0]).toMatchObject({
      status: typeof qualification === "boolean" ? "provisional" : "pending",
      qualificationAsOf: "2026-11-10T09:00:00Z",
    });
    read.assessments[0].items[0].status = "unavailable";
    expect(latestKpiScore(read).tracks[0].status).toBe("pending");
  },
);
it("does not use stale/failed/incompatible/assessed actuals or older-set awards as fresh arithmetic", () => {
  for (const mutate of [
    (r: KpiRead) => {
      r.measured!.concepts.c.failure = {
        recipeVersion: 1,
        reason: "failed",
        at: "2026-11-10T13:00:00Z",
      };
    },
    (r: KpiRead) => {
      r.measured!.timeZone = "Europe/London";
    },
    (r: KpiRead) => {
      r.measured!.weekStart = "2026-11-02";
    },
    (r: KpiRead) => {
      r.measured!.concepts.c.success!.signatures.volume = "other";
    },
    (r: KpiRead) => {
      r.measured = null;
    },
    (r: KpiRead) => {
      r.complete = false;
    },
    (r: KpiRead) => {
      r.measured!.concepts.c.success!.values.volume = -1;
    },
    (r: KpiRead) => {
      r.measured!.concepts.c.success!.values.volume = Infinity;
    },
  ]) {
    const read = fixture();
    review(read, null);
    mutate(read);
    expect(latestKpiScore(read).total).toBeNull();
  }
  const read = fixture();
  review(read, 0);
  read.assessments[0].setId = "obsolete";
  expect(latestKpiScore(read).total).toBe(5);
});
it("allows an incomplete numeric candidate but never substitutes zero for incomplete missing data", () => {
  const read = fixture();
  read.measured!.concepts.c.success!.status = "incomplete";
  expect(latestKpiScore(read).tracks[0]).toMatchObject({
    amount: 5,
    status: "provisional",
    reason: "Measurement incomplete",
  });
  read.measured!.concepts.c.success!.values.volume = null;
  expect(latestKpiScore(read).total).toBeNull();
});
it("preserves no-rule and legacy pool behavior", () => {
  const read = fixture();
  delete read.sets[0].items[0].tracks[0].pointsRule;
  expect(latestKpiScore(read).total).toBeNull();
  read.sets[0].items[0].availablePoints = 10;
  read.sets[0].items[0].tracks[0].pointsRule = { kind: "proportional" };
  expect(latestKpiScore(read).automatic).toBe(false);
});
it("rejects invalid rule parameters, combinations, unknown fields and cross-item/numeric conditions", () => {
  const invalid: unknown[] = [
    { kind: "other" },
    { kind: "threshold", formula: "anything" },
    { kind: "perUnit", points: -1, cap: 2 },
    { kind: "perUnit", points: 1, cap: 11 },
    { kind: "perUnit", points: Infinity, cap: 2 },
  ];
  for (const rule of invalid) {
    const read = fixture();
    read.sets[0].items[0].tracks[0].pointsRule = rule as PointsRule;
    expect(() => validateKpiSet(read.sets[0] as KpiSetInput)).toThrow();
  }
  for (const mutate of [
    (t: KpiTrack) => {
      t.availablePoints = null;
    },
    (t: KpiTrack) => {
      t.target = null;
    },
    (t: KpiTrack) => {
      t.target!.value = 0;
    },
    (t: KpiTrack) => {
      t.target!.comparator = "at-most";
    },
    (t: KpiTrack) => {
      t.requiresCondition = "volume";
    },
    (t: KpiTrack) => {
      t.requiresCondition = "other-item";
    },
    (t: KpiTrack) => {
      t.kind = "qualifying";
    },
  ]) {
    const read = fixture();
    mutate(read.sets[0].items[0].tracks[0]);
    expect(() => validateKpiSet(read.sets[0] as KpiSetInput)).toThrow();
  }
});
