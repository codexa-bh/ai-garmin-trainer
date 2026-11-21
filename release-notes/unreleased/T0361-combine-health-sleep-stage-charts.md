---
task: T0361
pr: 244
category: Changed
release_note_required: true
---

- Health now shows Deep, Light and REM sleep together in one stacked-bar card in Daily, Weekly and Monthly (T0361 / PR #244).
  - Bars stack REM at the bottom, then Deep, then Light. Point to, focus or tap a date or period to read each stage and the independently recorded sleep duration; the order is a display choice, not a ranking of sleep quality.
  - Awake and Nap stay separate charts, as does sleep score. Missing stage values are never drawn as zero: an incomplete night shows no stack but keeps every known value, and Weekly and Monthly keep their existing per-stage daily averages.
  - Data is unchanged, nothing needs migrating, and reverting the app version is the rollback.
