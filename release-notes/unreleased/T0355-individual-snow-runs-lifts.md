---
task: T0355
pr: pending
category: Added
release_note_required: true
---

- Trainer analytics can compare individual measured ski/snowboard runs separately from lifts, with source duration, distance, speed, descent and honest import coverage. Per-type totals remain separate; run heart rate is unavailable without a proven lap link.
  - Existing data requires explicit schema-30 migration and the separately authorized `backfill:garmin-extra --snow-only` operation, after a verified recovery backup and full-history disposable rehearsal. Source delivery never automatically upgrades or backfills the primary app.
