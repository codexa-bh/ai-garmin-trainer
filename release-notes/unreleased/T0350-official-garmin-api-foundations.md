---
task: T0350
pr: pending
category: Internal
release_note_required: true
---

- Adds a tested but **inactive** foundation for reading Garmin through its official Personal API: bounded HTTPS and key exchange, in-process activity-file decoding with exact HR time in zones, range-based daily/history/discovery reads, and whole-day coverage finality. Sync still uses the existing connector; nothing changes for current users until the separate cutover (T0351 / T0350).
