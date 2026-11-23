---
task: T0372
pr: 260
category: Fixed
release_note_required: true
---

- Reconnect ChatGPT using a saved Garmin Trainer registration instead of creating another connected app; routine test builds cannot register real accounts.
  - Switch account now distinguishes saved connections from an explicitly new account/workspace. Interrupted attempts retain known issued registrations across restarts; unknown registration effects require reconciliation rather than a blind retry.
  - Existing duplicate entries are not removed automatically. Preserve the intended connection; identical names or list order do not identify obsolete entries.
