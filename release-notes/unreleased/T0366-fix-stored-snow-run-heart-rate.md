---
task: T0366
pr: pending
category: Fixed
release_note_required: true
---

- Existing snow history can now show sample-derived run heart rate when its stored UTC clock is proven by the activity start, using consistent historical activity-file zone limits. Unsupported runs explain the missing time, HR support or zone-limit evidence instead of misleadingly saying there are no HR samples. No re-import or stored-data rewrite is needed; sparse runs can still be unavailable.
