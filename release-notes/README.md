# Release notes

Each change records its own operator-facing note as a fragment in `unreleased/` (created by the first fragment after a release), so parallel branches never edit one shared file. Published and prepared version notes live in [`releases/<version>.md`](releases/) and are never rewritten.

`npm run release -- prepare --version X.Y.Z --execute` promotes the required fragments into `releases/X.Y.Z.md` and deletes exactly those fragments; see [Version and notes](../docs/release.md#version-and-notes). Preparing a version is not a release.

## Fragment filename

Use the task ID and a short kebab-case slug, for example `unreleased/T0345-verified-last-used-upload-finality.md`. The ID is four digits, nonzero and equal to the front-matter `task`. A task with several unrelated shippable changes uses one file per change (`T0123-first-change.md`, `T0123-second-change.md`).

## Required format

```markdown
---
task: T0123
pr: pending
category: Changed
release_note_required: true
---

- Operator-facing summary of the change.
```

| Field                   | Value                                                                 |
| ----------------------- | --------------------------------------------------------------------- |
| `task`                  | `T` plus four digits, matching the filename                           |
| `pr`                    | `pending` until known, then the PR number; `none` when there is no PR |
| `category`              | `Added`, `Changed`, `Fixed`, `Removed`, `Security` or `Internal`      |
| `release_note_required` | `true` for a published note, `false` for a no-note marker             |
| `reason`                | Only on `false`: why no note is required                              |

Every field is one `key: value` line; unknown and duplicate fields are refused. A required fragment must have a body, which is copied verbatim under its category. Write one bullet with the outcome for the operator, plus at most two short sub-bullets for a required action (such as a migration or recovery step) or a limitation. Leave the implementation story to the PR, and keep task IDs out of the bullet text. Mention a migration or recovery step when there is one.

## When no note is required

Do not add a required fragment for release-only bookkeeping: version bumps, note promotion, and build, package or publish execution. Actual changes to release tooling or policy still need an outcome-focused entry. For test-only, internal-only or non-shipping work, record the decision in the task. A maintainer who wants an auditable marker can add a fragment with `release_note_required: false` and a `reason`. Markers are validated, never published and never consumed.

`unreleased/README.md` and `unreleased/TEMPLATE.md` are supporting files and are ignored. Other files, symlinks and subdirectories are refused.

## Commands

```bash
npm run release:notes:check     # validate every fragment; no effects (also part of npm run release:check)
npm run release:notes:preview   # print the generated categorized text; no effects
```

Notes are ordered by category (Added, Changed, Fixed, Removed, Security, Internal), then by filename. With no required fragments, the prepared note says `No changes recorded since the previous release.`
