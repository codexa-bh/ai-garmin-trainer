# Developer process guardrails

These rules apply to local Trainer changes and complement the E0007 runbook. They grant no primary mutation, publication, deployment or fixture-infrastructure authority.

## Same-task local data back-sync

Changes to schema, data/derivations, repository semantics or sync/import/detail behavior must reconcile potentially stale SQLite data in the same task:

1. Name affected structures and the intended target: primary for read-only verification, disposable copy for destructive/uncertain work.
2. Put migration, backfill, back-sync, re-sync, detail refresh, checkpoint reset or verified no-op in the plan/checklist.
3. Privately confirm the exact target; never print secrets, env values or raw connector/SQLite/GPS/stream data.
4. Verify bounded schema/status/count/coverage or smoke evidence. Record unresolved reconciliation as a blocker/follow-up gate, not completed work.

Destructive migration, reset/import rewrite, Garmin deletion and ambiguous-target work require a disposable copy unless operator-approved primary mutation is explicitly scoped. Use online SQLite backup for active WAL and verify integrity; lazy app DB construction is not a read-only migration probe.

Packaging/configuration/auth/private-state adoption and current-schema fresh onboarding alone need no backfill. Fresh initialization migrates in memory; desktop never upgrades selected existing data or loads user env files. [Desktop adoption](desktop.md#explicit-private-state-adoption) owns private storage, preserved originals and separate maintenance CLIs.

## Task-created smoke/test/mock data cleanup

At creation, record task, route/action, artifact ID/title, DB target and mixed/ambiguous user content. After evidence capture, clean only unambiguous task-created artifacts through the least-destructive existing app behavior, or record a deferral with identifiers, result and primary-preservation reason. Destructive validation uses disposable data. External keys/tokens, raw SQLite and ambiguous operator data require separate approval.

The E0007 **QA test-data cleanup protocol** owns classification/approval. [Invocation-owned disposal](smoke/ownership.md#preparation-reuse-and-owned-disposal) is its finite exception: only newly exclusive enrolled copies after settlement, original preservation and compact evidence. It never covers primary/borrowed/ambiguous data, historical scratch, worktrees/aliases or accepted outputs.

[Inputs](smoke-inputs.md) owns preparation/fingerprints; [evidence classes](smoke/protocol.md#keep-evidence-classes-distinct) owns inspected captures and synthetic/debug/ordinary/real-service limits. [Image selection](smoke/ownership.md#full-baseline-and-captures) separates image demand from behavioral coverage; record actual generated counts, relied-on original inspection or justified nonvisual N/A, not omitted-image passes. Goals are task/run-attributed; other copied Profile fields stay unchanged and no edits copy back. [Before-use extension](smoke/protocol.md#task-needed-bridge-and-runner-extensions) allows safe task-needed runner changes without an automatic second ticket or safeguard waiver.

## No new isolated fixture environment for this stage

Use existing local smoke, deterministic tests, task artifacts and disposable copies. A durable fixture framework requires a separate justified implementation task. Only these finite exceptions apply:

- **Native/ordinary default (T0252):** existing populated-copy flow with authored input or a current exact private grant. Standing reuse extends neither lifetime nor native-mode authority. [Input owner](smoke-inputs.md).
- **Tables:** fixed authored documents/Profile under existing ordinary ownership; no private-input approval or real-integration claim. [Scenario](smoke/features.md#finite-synthetic-markdown-table-scenario).
- **CI quick:** `smoke:quick` / `scripts/ci/seed.ts`, one job-local current-schema Profile through in-memory migrations/typed inserts in private scratch. No operator input, auto-migration or fixture framework. Existing settings/schema/ownership and attributed disposal apply; no data-shape change means verified back-sync no-op.
- **Hosted Windows:** authored input through in-memory serialization and exclusive private state. Goals/DB/settings and app-data preservation marker expire with the runner; no copy-back or existing registration/data adoption. Only [six synthetic PNGs and the sanitized manifest](windows.md#installed-app-scenario-and-narrow-evidence-exception) have a three-day upload exception; no other images/logs/private state.

None authorizes production migration, global fixture deployment or unrelated recurring workload.
