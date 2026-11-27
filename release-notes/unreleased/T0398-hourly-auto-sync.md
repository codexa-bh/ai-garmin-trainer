---
task: T0398
pr: pending
category: Added
release_note_required: true
---

- Auto-sync refreshes latest Garmin data hourly after history import completes, with one overdue refresh on reopen or wake.
  - On by default while the app runs; change Auto-sync in Settings, then quit and reopen to apply.
  - Cancellation or failure waits for explicit recovery rather than retrying automatically.
