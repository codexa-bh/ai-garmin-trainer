---
task: T0357
pr: pending
category: Added
release_note_required: true
---

- Health and Activity now show more of your stored Garmin data, read-only and without starting a sync (T0357).
  - Health (Daily): Garmin's HRV baseline range, sleep-score qualifiers, a stress breakdown in minutes, Body Battery charged and drained, and dated VO2 max readings. Missing values say whether Garmin returned none, the source was unavailable, the read failed or it was never imported; nothing is filled in or averaged.
  - Activity: signed Body Battery change, cadence and stride with their Garmin sources and units, an HR-zone column in the lap table, and snowboard run and lift totals plus the individual runs and lifts when they have been imported.
  - Data is unchanged, nothing needs migrating, and reverting the app version is the rollback.
