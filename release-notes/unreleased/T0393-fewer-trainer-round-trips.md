---
task: T0393
pr: pending
category: Changed
release_note_required: true
---

- Trainer chat can batch independent reads and starts with current planning context to avoid redundant model round trips, while preserving guarded saves and clearer long-turn timing diagnostics.
