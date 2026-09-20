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

## Task-created smoke/test/mock data cleanup

A task that creates smoke chats, test conversations, mock profile/memory rows, Garmin test artifacts, or other app-managed local artifacts must clean up those artifacts after evidence capture, or record an explicit deferral before handoff.

Required cleanup evidence:

1. Record provenance while creating the artifact: task ID, route/UI action, conversation ID/title or artifact identifier, DB target, and whether any user-authored or ambiguous content is mixed in.
2. Capture evidence first: validation logs, bounded response/status excerpts, sanitized summaries, and screenshot analysis when applicable.
3. Clean up only task-created, unambiguous artifacts using the least-destructive existing app behavior. Use a disposable DB copy for destructive validation, and never delete external Garmin token files, provider keys, raw SQLite files, or ambiguous operator data without an explicitly approved task.
4. Record the cleanup result or deferral in task state: scope used, artifact identifiers, whether primary DB was untouched, and why any remaining artifact is intentionally left in place.

The E0007 QA test-data cleanup protocol remains authoritative for deletion classification, evidence-first ordering, approval stops, and disposable-copy safeguards.

## No new isolated fixture environment for this stage

Do not introduce a new isolated test-data or fixture environment just to satisfy these process rules at the current local-only stage. Prefer the existing local live-smoke flow, deterministic tests, task-local artifacts, and disposable SQLite copies for destructive validation. A future fixture framework or durable test-data environment requires its own implementation task and justification.
