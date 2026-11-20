---
task: T0352
pr: 237
category: Added
release_note_required: true
---

- The trainer can now analyse more of your Garmin data in chat: sleep sub-scores and timing, HRV weekly average and baseline, dated VO2 max readings, daily and per-activity Body Battery with its events, stress time per level, per-lap heart-rate zones, running cadence/stride and other running dynamics, and snowboarding run/lift totals. New syncs import them automatically. Missing data is reported as missing, not as zero.
  - Requires the explicit database upgrade to schema 29 (`npm run db:migrate` on a backed-up, stopped database); older builds refuse the upgraded database.
  - Existing history gains these fields only through the separate explicit `npm run backfill:garmin-extra` maintenance run with a fresh Personal API key; see `docs/garmin-extra-data.md` for backup, rehearsal and recovery.
  - Snowboarding values are per-type totals (all runs together), not individual runs. Advanced running dynamics appear only when a compatible sensor recorded them.
