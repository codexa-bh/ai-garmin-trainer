import type Database from "better-sqlite3";
import type {
  WeeklyKpis,
  KpiSet,
  KpiAssessment,
} from "../../src/lib/weekly/kpi-contracts";
import { weeklyCalendar, addDays } from "../../src/lib/weekly/calendar";

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
        availablePoints: 100,
        scoring: "One model-defined allocation; full achievement is 100 points",
        tracks: [
          {
            key: "count",
            kind: "numeric",
            unit: "sessions",
            meaning: "Selected session count",
            target: { comparator: "at-least", value: 3 },
          },
          {
            key: "duration",
            kind: "numeric",
            unit: "minutes",
            meaning: "Selected session duration",
            target: { comparator: "at-least", value: 90 },
          },
        ],
      },
    ],
  };
  const adapted: KpiSet = JSON.parse(JSON.stringify(original));
  adapted.id = "T0319-adapted";
  adapted.origin = "adaptation";
  adapted.items[0].tracks[0].target!.value = 5;
  adapted.items[0].availablePoints = 80;
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
          { trackKey: "count", value: 4 },
          { trackKey: "duration", value: null },
        ],
        awardedPoints: 100,
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
    availablePoints: null,
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
    awardedPoints: null,
    explanation: "Context is not scored",
    status: "provisional",
    evidence: structuredClone(latest.items[0].evidence),
  });
  state.assessments.push(latest);
  return state;
}
export function seedWeeklyKpis(db: Database.Database) {
  const now = new Date();
  const week = weeklyCalendar(
    now,
    Intl.DateTimeFormat().resolvedOptions().timeZone,
  ).weekStart;
  const state = authoredAssessedLatestKpis(now);
  const note = {
    title: "T0321 authored plan",
    contentMarkdown:
      "Independently authored coaching notes: keep sessions comfortable and take breaks when needed.",
    revision: "T0321-plan",
    savedAt: now.toISOString(),
  };
  const record = {
    weekStart: week,
    timeZone: "UTC",
    revision: "T0321-narrative",
    original: {
      ...note,
      revision: "T0321-original",
      contentMarkdown:
        "Earlier authored notes remain stored, not a competing report.",
    },
    latest: note,
    review: {
      ...note,
      title: "T0321 authored review",
      contentMarkdown:
        "Authored review notes: saved evidence remains provisional.",
      asOf: now.toISOString(),
      planRevision: note.revision,
    },
  };
  state.sets[0].planRevision = record.original.revision;
  state.sets[1].planRevision = record.latest.revision;
  db.prepare("insert into weekly_artifact values (?,?)").run(
    week,
    JSON.stringify(record),
  );
  db.prepare("insert into weekly_kpi values (?,?)").run(
    week,
    JSON.stringify(state),
  );
  const previous = JSON.parse(JSON.stringify(state)) as WeeklyKpis;
  previous.revision = "T0319-previous";
  previous.latestId = previous.originalId;
  previous.sets = [previous.sets[0]];
  previous.sets[0].planRevision = "T0321-previous-plan";
  const previousNote = { ...note, revision: "T0321-previous-plan" };
  db.prepare("insert into weekly_artifact values (?,?)").run(
    addDays(week, -7),
    JSON.stringify({
      ...record,
      weekStart: addDays(week, -7),
      original: previousNote,
      latest: previousNote,
      review: { ...record.review, planRevision: previousNote.revision },
    }),
  );
  previous.assessments = [previous.assessments[0]];
  previous.assessments[0].items[0].actuals[0].value = 0;
  previous.assessments[0].items[0].awardedPoints = 0;
  previous.assessments[0].extras = [];
  previous.assessments[0].totalPoints = 0;
  db.prepare("insert into weekly_kpi values (?,?)").run(
    addDays(week, -7),
    JSON.stringify(previous),
  );
  const earlier = structuredClone(previous);
  earlier.revision = "T0321-earlier-saved-score";
  earlier.assessments[0].totalPoints = 37.5;
  earlier.assessments[0].items[0].awardedPoints = 25;
  earlier.assessments[0].items[0].actuals[0].value = 1;
  earlier.assessments[0].extras = structuredClone(state.assessments[0].extras);
  db.prepare("insert into weekly_kpi values (?,?)").run(
    addDays(week, -21),
    JSON.stringify(earlier),
  );
  const unassessed = structuredClone(state);
  unassessed.revision = "T0321-latest-unassessed";
  unassessed.assessments = [unassessed.assessments[0]];
  db.prepare("insert into weekly_kpi values (?,?)").run(
    addDays(week, -14),
    JSON.stringify(unassessed),
  );
}
