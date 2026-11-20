---
task: T0356
pr: pending
category: Changed
release_note_required: true
---

- Ordinary trainer coaching can discover stored Garmin sleep score and qualifier, weekly HRV and baseline, daily Body Battery charged/drained and high-stress minutes in its recovery preview. Known-activity feedback also receives activity battery delta, source-labelled cadence/stride, historical lap heart-rate zones and snowboarding per-type totals, with missing-data coverage and explicit limits.
  - Reads existing schema-29 data only; no new import, database upgrade, primary activation or backfill is performed. Older history without those fields remains explicitly unknown, not zero. Individual snow runs/lifts are not part of this change.
