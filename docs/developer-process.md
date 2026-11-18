# Developer process guardrails

These rules apply to Pivan tasks changing the local Garmin trainer. Read the applicable section when planning and before handoff. They complement the E0007 catalog/runbook and grant no primary mutation, fixture infrastructure, publication or deployment authority.

## Same-task local data back-sync

A change to schema, normalized/derived data, repository semantics, sync/import/detail behavior or anything that can leave existing SQLite data stale must include same-task reconciliation before handoff:

1. Name the affected structures and intended DB target: primary for read-only/current-data verification, disposable copy for destructive or uncertain validation.
2. Plan the migration, backfill, back-sync, re-sync, detail refresh, checkpoint reset or explicit no-op in the task checklist/plan.
3. Confirm the selected path privately before execution. Never print secrets, token contents, raw connector/SQLite/GPS/stream data or env values.
4. Verify with bounded schema/status/count/coverage or smoke evidence, not raw data.
5. If safe reconciliation cannot finish, record an explicit blocker or follow-up gate; never close as though stale data was handled.

Destructive migration, reset/import rewrite, Garmin deletion and ambiguous-target work require a disposable copy unless the task explicitly scopes operator-approved primary mutation. Use an online SQLite backup for active WAL and verify integrity; never use lazy app DB construction as a read-only migration probe.

Desktop runtime/packaging, configuration, private-provider-file/key/token adoption, auth and current-schema fresh onboarding alone change no data shape and need no backfill. Fresh initialization runs authoritative migrations **in memory**, never upgrades selected existing data. Desktop refuses unsupported schemas rather than implicitly migrating primary state. Native settings/private plaintext storage, explicit legacy adoption/re-entry, preserved originals and separate maintenance CLIs follow [desktop adoption](desktop.md#explicit-private-state-adoption); desktop never loads/imports user env files.

## Task-created smoke/test/mock data cleanup

Tasks creating chats, conversations, mock Profile/memory rows, Garmin test artifacts or other app-managed artifacts must clean up after evidence capture or record an explicit deferral before handoff:

1. Record task ID, route/UI action, artifact ID/title, DB target and any mixed user-authored/ambiguous content at creation.
2. Capture validation logs, bounded status/response excerpts, sanitized summaries and inspected screenshot analysis when applicable.
3. Use the least-destructive existing app behavior only for unambiguous task-created artifacts. Destructive validation uses a disposable DB. External tokens/provider keys, raw SQLite files and ambiguous operator data require separate explicit approval.
4. Record scope, identifiers, result/deferral, primary preservation and why any artifacts remain.

The E0007 runbook's **QA test-data cleanup protocol** owns deletion classification, evidence-first ordering, approval stops and disposable-copy safeguards. Its prospective exception is [verified invocation-owned disposal](dev-bridge.md#preparation-reuse-and-owned-disposal): only newly exclusive enrolled DB/executable/bundle copies after final settlement, original preservation and compact evidence. It grants no deletion of primary/borrowed/ambiguous SQLite, historical scratch, worktrees/aliases or accepted outputs.

Input preparation and original-copy verification belong to [smoke inputs](smoke-inputs.md#finite-recipe-and-verification); native [evidence classes](dev-bridge.md#keep-evidence-classes-distinct) distinguish debug Profile-subtree capture, ordinary geometry-preserving masks, synthetic input and real integration. Goals are task/run-attributed, other copied Profile fields stay unchanged, originals are fingerprint-verified, and copy-only edits are never copied back. Inspect images: creation alone proves nothing. Safe task-needed runner/bridge changes follow the [before-use extension recipe](dev-bridge.md#task-needed-bridge-and-runner-extensions), not an automatic separate ticket or a waiver of these safeguards.

## No new isolated fixture environment for this stage

Do not introduce a new isolated test-data/fixture environment merely to meet these rules. Prefer existing local live smoke, deterministic tests, task-local artifacts and disposable SQLite copies. A durable fixture framework needs its own implementation task and justification.

Only these finite exceptions apply; none grants production migration, global fixture deployment or unrelated recurring workload:

- **Local native recipe:** [Authored preparation](smoke-inputs.md) feeds the existing isolated populated-copy flow, not a durable environment. Keyless success is not provider/Garmin/private-settings/adoption proof.
- **Representative native/ordinary default (Authority: T0252):** Authored Profile/chat/activity/Health input or an explicitly applicable current private grant. No personal input by default; standing reuse does not extend retention or relax original preservation/native mode exclusions.
- **Presentation-only tables:** [Table scenario](dev-bridge.md#finite-synthetic-markdown-table-scenario) uses the existing seed with fixed plan/review/chat documents and one Profile, ordinary artifact/copy/ownership owners. No personal input/consent is needed; seed/documents/Goals/captures remain task-attributed under evidence-first disposal or diagnostic retention, not a real-integration certificate.
- **CI quick:** `smoke:quick` / `scripts/ci/seed.ts`: one job-local synthetic current-schema Profile through existing migrations/typed schema in canonical private scratch. No operator input, app auto-migration or fixture framework. Native settings/schema/preflight/ownership still bind; task/run-attributed seed/copy/Goals/logs follow the same disposal/retention contract, never back-sync. No data-shape change means verified primary back-sync no-op.
- **Hosted Windows installed:** Same authored recipe through in-memory serialization and exclusive private runner state. Goals/DB/settings and real app-data preservation marker survive only to runner expiry, never copy-back or existing registration/data adoption. Only the [three-day Windows exception](windows.md#installed-app-scenario-and-narrow-evidence-exception) permits six synthetic PNGs and closed sanitized manifest as Actions artifacts; no other images/logs/private state may be published.
