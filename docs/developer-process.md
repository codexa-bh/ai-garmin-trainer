# Developer process guardrails

These guardrails apply to Pivan tasks that change this local-only Garmin trainer. They complement the E0007 repo catalog and local live-smoke runbook; they do not authorize primary SQLite mutation, new fixture infrastructure, remote publication, or deployment.

## Same-task local data back-sync

When a task changes schema, normalized data shape, derived fields, repository semantics, sync/import/detail behavior, or anything else that can make existing local SQLite data stale or incomplete, the task must include a same-task phase to bring the intended local DB target back into shape before handoff.

Required planning and close evidence:

1. Name the affected data structures and the intended DB target: primary local DB for read-only/current-data verification, or a disposable DB copy for destructive or uncertain validation.
2. Define the needed migration, backfill, back-sync, re-sync, detail refresh, checkpoint reset, or explicit no-op rationale in the same task plan/checklist.
3. Run the operation against the selected target only after confirming the target path without printing secrets, token paths contents, raw connector payloads, raw SQLite rows, precise GPS/stream data, or `.env.local` values.
4. Verify with bounded evidence such as schema/status output, high-level row/count/coverage summaries, route status, or smoke results. Do not paste raw local data.
5. If safe back-sync cannot be completed in the same task, stop with an explicit blocker or follow-up gate. Do not close as if stale local data was handled.

Destructive migrations, reset flows, import rewrites, Garmin deletion, and ambiguous DB-target work require a disposable DB copy unless the task explicitly scopes primary-data mutation and the operator approved it.

Desktop runtime/private-provider-file/adoption/auth/fresh-onboarding work keeps the same DB schema/data shapes: no backfill is required solely for packaging, configuration, token adoption or current-schema fresh initialization. The first-run fresh initializer uses authoritative migrations in memory; it never upgrades selected existing data. Desktop uses UI settings and a native owner-private plaintext provider file, with explicit legacy adoption/re-entry and preserved originals; it never imports/loads user env files; retained explicit maintenance CLIs remain separate. Use an online SQLite backup for active-WAL copies and verify integrity; never use normal lazy app DB construction as a read-only migration probe. Desktop refuses unsupported schemas instead of implicitly migrating the primary. See [desktop adoption](desktop.md#explicit-private-state-adoption).

## Task-created smoke/test/mock data cleanup

A task that creates smoke chats, test conversations, mock profile/memory rows, Garmin test artifacts, or other app-managed local artifacts must clean up those artifacts after evidence capture, or record an explicit deferral before handoff.

Required cleanup evidence:

1. Record provenance while creating the artifact: task ID, route/UI action, conversation ID/title or artifact identifier, DB target, and whether any user-authored or ambiguous content is mixed in.
2. Capture evidence first: validation logs, bounded response/status excerpts, sanitized summaries, and screenshot analysis when applicable.
3. Clean up only task-created, unambiguous artifacts using the least-destructive existing app behavior. Use a disposable DB copy for destructive validation, and never delete external Garmin token files, provider keys, raw SQLite files, or ambiguous operator data without an explicitly approved task.
4. Record the cleanup result or deferral in task state: scope used, artifact identifiers, whether primary DB was untouched, and why any remaining artifact is intentionally left in place.

The E0007 QA test-data cleanup protocol remains authoritative for deletion classification, evidence-first ordering, approval stops, and disposable-copy safeguards.

The [programmatic native smoke runner](dev-bridge.md) automates this same populated-copy flow, not a new synthetic dataset/environment: the Goals sentinel is task/run-attributed, other copied Profile fields remain unchanged, originals are fingerprint-verified, and copy-only edits are explicitly deferred to scratch expiry without copy-back. Its keyless scenario does not certify live provider/Garmin behavior or private settings/adoption. Debug capture is a sanitized actual Profile subtree; supported ordinary-artifact capture instead preserves real geometry under fixed hide-by-default masks at wide/narrow Trainer/Sync/Profile views. Neither reveals copied facts/transcripts or certifies trusted native input. Image inspection and textual source/scenario evidence remain separate from file creation.

The explicitly scoped CI exception is `smoke:quick` / `scripts/ci/seed.ts`: one
fresh job-local synthetic current-schema Profile, created via existing migrations
and typed schema under canonical private scratch. It reads no operator input and
adds no application auto-migration or fixture framework. The existing native
settings/schema/preflight/ownership checks still bind. Synthetic Goals/seed/copy/logs
are task/run-attributed and deferred to runner/task-scratch expiry, never back-synced.
No production schema or data-shape change means primary back-sync is a verified no-op.

## No new isolated fixture environment for this stage

Do not introduce a new isolated test-data or fixture environment just to satisfy these process rules at the current local-only stage. Prefer the existing local live-smoke flow, deterministic tests, task-local artifacts, and disposable SQLite copies for destructive validation. A future fixture framework or durable test-data environment requires its own implementation task and justification.
