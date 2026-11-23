---
task: T0371
pr: none
category: Changed
release_note_required: true
---

- Maintainers can check the actual rendered release body before source freeze or native builds with `npm run release -- preflight --preflight-context <context.json>`. Explicit platform and prior-release/current schema context catches missing Windows alpha, signing, qualification and applicable database upgrade/recovery disclosures. Preparation rechecks supplied context before writing notes or consuming fragments; the manual Windows workflow checks current Windows notes before expensive preparation. This is a content check, not release approval or artifact qualification.
