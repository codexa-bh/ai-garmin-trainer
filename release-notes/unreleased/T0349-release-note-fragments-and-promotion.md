---
task: T0349
pr: 229
category: Changed
release_note_required: true
---

- Release notes are now written per change in `release-notes/unreleased/` and promoted into the next version's note by `npm run release -- prepare`, which removes only the fragments it published. Published version notes moved unchanged to `release-notes/releases/` (T0349 / PR #229).
  - Maintainer action: run `npm run release:notes:preview` before a cut and review the generated text. `--notes` is now optional reviewed text placed before the generated changes.
