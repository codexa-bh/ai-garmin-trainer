---
task: T0371
pr: 258
category: Changed
release_note_required: true
---

- Maintainers can check the actual public release body before source freeze or native builds with `npm run release -- preflight --preflight-context <context.json>`, checking signing, qualification and schema/recovery disclosures for the explicitly selected platforms.
  - Supply prior-release/current schema context. Preparation rechecks it before consuming fragments. This macOS-only cut has no current Windows qualification; the manual Windows job remains blocked by its frozen 0.1.4 preflight context until a future Windows cut.
  - Qualification reports phase/subphase timings and reduces repeated inventory overhead while still hashing current bytes; no verification is skipped. Windows installed lifecycle and exact-installer checks remain required for a future Windows cut. The separate fast-development path is documented only, not implemented.
