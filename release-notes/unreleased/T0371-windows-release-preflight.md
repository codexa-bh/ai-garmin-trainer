---
task: T0371
pr: 258
category: Changed
release_note_required: true
---

- Maintainers can check the actual public release body before source freeze or native builds with `npm run release -- preflight --preflight-context <context.json>`, catching missing Windows alpha, signing, qualification and applicable schema/recovery disclosures.
  - Supply explicit platform and prior-release/current schema context. Preparation rechecks it before writing notes or consuming fragments, and the manual Windows job checks current notes before expensive preparation. This is a content check, not release approval.
  - Full qualification reports phase/subphase timings and reduces repeated dependency/payload inventory overhead while still hashing current bytes. No extraction/verification cache or check is skipped; installed lifecycle and exact-installer qualification remain required. The separate fast-development path is documented only, not implemented.
