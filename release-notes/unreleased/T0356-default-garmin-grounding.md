---
task: T0356
pr: 241
category: Changed
release_note_required: true
---

- Ordinary trainer coaching can discover stored Garmin sleep score and qualifier, weekly HRV and baseline, daily Body Battery charged/drained and high-stress minutes in its recovery preview. Known-activity feedback also receives activity battery delta, source-labelled cadence/stride, historical lap heart-rate zones and snowboarding per-type totals, with missing-data coverage and explicit limits.
  - Consumes existing normalized extra-data fields; this consumer change adds no import, migration, primary activation or backfill. The build still needs a database matching its current schema. Older history without those fields remains explicitly unknown, not zero. Individual snow runs/lifts are not part of this change.
