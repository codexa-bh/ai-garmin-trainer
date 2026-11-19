// Independently retained authored test inputs; not a product implementation seam.

import type {
  WeeklyKpis,
  KpiSet,
  KpiAssessment,
} from "../src/lib/weekly/kpi-contracts";

// Independently authored finite presentation corpus. No operator-derived values.
export function authoredWeeklyKpis(now = new Date()): WeeklyKpis {
  const savedAt = "2026-11-01T12:00:00.000Z";
  const original: KpiSet = {
    id: "T0319-original",
    origin: "planned",
    savedAt,
    provenance: "T0319 authored synthetic agreement",
    items: [
      {
        id: "sessions",
        conceptId: "authored-sessions",
        label: "T0319 authored sessions",
        definition: "Fictional selected outdoor sessions",
        selection:
          "Count and duration describe the same sessions; no duplicate credit",
        evidenceRequired: "Authored user report, not Garmin verification",
        scoring:
          "Per-measurement allocations agreed with the user; full achievement is 100 points",
        tracks: [
          {
            key: "count",
            kind: "numeric",
            unit: "sessions",
            meaning: "Selected session count",
            target: { comparator: "at-least", value: 3 },
            availablePoints: 60,
          },
          {
            key: "duration",
            kind: "numeric",
            unit: "minutes",
            meaning: "Selected session duration",
            target: { comparator: "at-least", value: 90 },
            availablePoints: 40,
          },
        ],
      },
    ],
  };
  const adapted: KpiSet = JSON.parse(JSON.stringify(original));
  adapted.id = "T0319-adapted";
  adapted.origin = "adaptation";
  adapted.items[0].tracks[0].target!.value = 5;
  adapted.items[0].tracks[0].availablePoints = 50;
  adapted.items[0].tracks[1].availablePoints = 30;
  const assessment: KpiAssessment = {
    setId: original.id,
    revision: "T0319-assessment",
    savedAt,
    asOf: now.toISOString(),
    status: "provisional",
    totalPoints: 112.5,
    explanation:
      "Authored explained extra credit; unsupported portions remain visible",
    items: [
      {
        itemId: "sessions",
        actuals: [
          { trackKey: "count", value: 4, awardedPoints: 60 },
          { trackKey: "duration", value: null, awardedPoints: 40 },
        ],
        explanation: "Authored model interpretation, not automatic attainment",
        status: "provisional",
        evidence: {
          origin: "user-report",
          references: ["T0319 synthetic report"],
          qualification: "Qualification remains provisional",
          limitations: "Duration unavailable, not zero",
        },
      },
    ],
    extras: [
      {
        label: "Authored additional work",
        points: 12.5,
        explanation: "Authored relevant partial credit without double counting",
        evidence: {
          origin: "model-interpretation",
          references: ["T0319 synthetic report"],
          qualification: "Explained relevance",
          limitations: "Not fresh Garmin evidence",
        },
      },
    ],
  };
  return {
    revision: "T0319-state",
    timeZone: "UTC",
    originalId: original.id,
    latestId: adapted.id,
    reviewDefinedId: null,
    sets: [original, adapted],
    assessments: [assessment],
  };
}
export function authoredAssessedLatestKpis(now = new Date()): WeeklyKpis {
  const state = authoredWeeklyKpis(now);
  const latest = structuredClone(state.assessments[0]);
  latest.setId = state.latestId!;
  latest.revision = "T0321-latest-assessment";
  latest.items[0].actuals[0].awardedPoints = 50;
  latest.items[0].actuals[1].awardedPoints = 30;
  state.sets
    .find((set) => set.id === state.latestId)!
    .items[0].tracks.push({
      key: "condition",
      kind: "qualifying",
      unit: "qualification",
      meaning: "Authored saved condition, not a separate numeric measurement.",
      target: { comparator: "equal", value: true },
    });
  latest.items[0].actuals.push({ trackKey: "condition", value: true });
  const context: KpiSet["items"][number] = {
    id: "context",
    conceptId: "authored-context",
    label: "T0321 authored context",
    definition: "Independent fictional monitoring values",
    selection: "Authored context only, never a scored allocation",
    evidenceRequired: "Authored synthetic input",
    scoring: "",
    tracks: [
      {
        key: "load",
        kind: "numeric",
        unit: "index",
        meaning: "Authored monitoring index A",
        target: null,
      },
      {
        key: "recovery",
        kind: "numeric",
        unit: "index",
        meaning: "Authored monitoring index B",
        target: null,
      },
    ],
  };
  state.sets.find((set) => set.id === state.latestId)!.items.push(context);
  latest.items.push({
    itemId: context.id,
    actuals: [
      { trackKey: "load", value: 7.5 },
      { trackKey: "recovery", value: null },
    ],
    explanation: "Context is not scored",
    status: "provisional",
    evidence: structuredClone(latest.items[0].evidence),
  });
  state.assessments.push(latest);
  return state;
}
