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
export function seedWeeklyKpis(db: Database.Database) {
  const now = new Date();
  const week = weeklyCalendar(
    now,
    Intl.DateTimeFormat().resolvedOptions().timeZone,
  ).weekStart;
  const state = authoredWeeklyKpis(now);
  db.prepare("insert into weekly_kpi values (?,?)").run(
    week,
    JSON.stringify(state),
  );
  const previous = JSON.parse(JSON.stringify(state)) as WeeklyKpis;
  previous.revision = "T0319-previous";
  previous.latestId = previous.originalId;
  previous.sets = [previous.sets[0]];
  previous.assessments[0].items[0].actuals[0].value = 0;
  previous.assessments[0].totalPoints = null;
  db.prepare("insert into weekly_kpi values (?,?)").run(
    addDays(week, -7),
    JSON.stringify(previous),
  );
}
