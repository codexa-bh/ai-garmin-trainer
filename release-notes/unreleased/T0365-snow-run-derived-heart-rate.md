---
task: T0365
pr: pending
category: Changed
release_note_required: true
---

- Snow activity runs now show an average heart rate and an HR-zone bar (with exact times) for each measured run, derived from the stored heart-rate samples during that run; they may differ slightly from Garmin per-lap totals, and show a reason instead of a number when samples or the activity's own zone limits are missing (T0365).
  - Runs and lifts totals are one compact line, run Ascent is no longer shown, and the redundant Lap details table is hidden for snow activities that have individual runs; other activities and snow activities without runs keep their laps.
  - The trainer can use the same per-run and per-lift heart rate for known activities. Nothing is stored or imported: existing history shows it immediately where samples exist.
