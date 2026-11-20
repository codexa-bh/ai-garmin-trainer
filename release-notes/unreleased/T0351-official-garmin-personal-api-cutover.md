---
task: T0351
pr: pending
category: Changed
release_note_required: true
---

- Garmin now connects only through Garmin's official Personal API. Create a Personal API key in Garmin Connect, paste it in **Settings → Garmin connection**, Save, then quit and reopen. The key is stored privately on this device and never shown again. Existing installations show **Reconnect needed**: saved history stays available offline and old token files are left untouched. Activity details and exact heart-rate time in zones come from each activity's original file, and ended days become final when Garmin reports whole-day coverage (T0351).
