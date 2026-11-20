# Local smoke inputs

Routine `smoke:native` and `smoke:ordinary` default to **entirely authored synthetic** SQLite: no personal selections, receipts, env, settings, tokens or credentials, and no normal-state fallback. Quick/nightly keeps its independent minimal Profile-only recipe and workload.

Read **Finite recipe and verification** for routine input; **Explicit private route** only for authorized private use; **Task-owned rehearsal** only for backup/restore preparation. Sync/import tasks can start with the [one-page Sync card](synthetic-sync-smoke.md), not unrelated chat/onboarding scenarios. [Developer process](developer-process.md#no-new-isolated-fixture-environment-for-this-stage) owns the no-new-fixture rule and finite exceptions.

```bash
npm run smoke:prepare -- --scratch '/canonical/0700/task-scratch' --task-id T0252 --anchor 2026-11-01
npm run smoke:native -- --scratch '/canonical/0700/task-scratch' --task-id T0252 --health-comparison
npm run smoke:ordinary -- --scratch '/canonical/0700/task-scratch' --task-id T0252 --bundle '/absolute/ordinary/Garmin Trainer.app'
```

`smoke:prepare` has no launch capability. Runner `--prepare-only` also launches nothing. Only actual [native scenarios and inspected captures](dev-bridge.md) prove runtime behavior. A bundle must still match final source/artifact identity. `--task-id` defaults from `PIVAN_TASK_PATH`, otherwise `local`; `--anchor` defaults once to **UTC** today and is recorded. An explicit real YYYY-MM-DD date reproduces logical contents, not the UUID output path. Use a current anchor for current Health navigation; no product clock is overridden.

## Finite recipe and verification

Recipe v1 uses authoritative migrations in memory and typed schema inserts, then exclusively publishes owner-private SQLite. It contains three distinguishable fictional conversations/twelve user-assistant turns, ten activity summaries (eight plain summaries, one four-lap run, one snowboard day), a Profile and twenty Health rows spanning twenty-one UTC dates. The previous seven-date page contains one absent date, one partial row and real zero steps/intensity. Absent is not zero. It also carries finite authored additional-Garmin evidence for the Health and Activity views, anchored to the same dates: HRV baseline on some dates, lower-only and absent on others; sleep qualifiers including qualifier-only parts and a measured zero score; complete and partial stress buckets; Body Battery charged 0 with drained null; four sparse multisport VO2 readings; every coverage state; a four-lap run with zones on two laps, none on one and a recorded all-zero lap; signed battery delta with list and FIT cadence; and aggregate snow totals (12 runs) beside five stored individual runs and lifts. The verifier allows exactly those relations and nothing else beyond the existing classes. Conversation storage uses the existing repository's millisecond convention, and migration metadata is anchored too. Nothing is copied or derived from personal examples.

Ordinary `--conversation-selection` uses an explicit `empty-chat` authored variant by default: the same complete synthetic recipe is verified first, then only its new in-memory chat/message rows are removed and the existing empty-chat data-shape checks run before exclusive publication. Profile/activities/Health remain identical; provenance records `syntheticVariant: empty-chat`. Standard defaults retain all three chats/twelve messages. This neither clears a selected/borrowed input nor fabricates private authority: explicit private selections still require the unchanged current grant/provenance and already-empty chat classes. Renderer admission still refuses unrelated titles.

`smoke_recipe.ts` verifies exact current schema inventory (including rejection of extra triggers/tables), version, integrity, FK checks, bounded row counts, declared numeric/text types, Profile JSON and route-specific coverage. Synthetic coverage additionally verifies ordered turns and missing/partial/zero cases. Private coverage requires bounded numeric-summary/Health/Profile classes and at least fourteen Health rows spanning fourteen dates; it does not falsely certify missing-date/chart coverage if absent. Unreviewed metadata, auth/session/account/verification, raw/detail/GPS, memory, plans and private chat/message populations refuse. No selected input is migrated. Numeric verification preserves finite fractional
`activity.duration_sec` and `activity.avg_heart_rate` values, as accepted by the
existing importer despite SQLite INTEGER affinity; counters/timestamps remain
integral and nonnumeric/nonfinite values still refuse. No rounding or data rewrite
is performed.

The Python preparation owner requires existing canonical uid-owned `0700` directories and bounded `0600` regular single-link files; aliases, hardlinks, unknown/duplicate JSON keys, insecure/foreign files and reused destinations refuse, never chmod/adopt. A fresh private UUID output holds database-only `selection.json` (`{"database":"/canonical/prepared/input.sqlite"}`) and bounded private preparation provenance. Private copying uses SQLite online backup with a deadline and original logical/identity/DB-WAL byte checks, not a live main-file copy. Implicit SQLite sidecars must also be canonical/private/single-link; rollback journals refuse recovery. SHM lock/read marks are validated for file safety, not certified immutable. Native owners then make independent writable run copies. Copies, Goals, provenance, logs and images stay task-attributed, never back-synced/uploaded. The [resource owner](smoke/ownership.md#preparation-reuse-and-owned-disposal) places managed mutable synthetic/authorized numeric-copy DBs in registered disposable and compact provenance in evidence; it owns final-settlement/evidence-first disposal and unchanged lifetime. Standalone/prepare-only/borrowed outputs retain their immediate-disposal exclusions. Partial/failed outputs require exact reconciliation, never adoption, overwrite or blind retry. Input grants remain independent.

## Task-owned rehearsal, restore and run-backup placement

Standalone `smoke:prepare` configures the [resource owner](smoke/ownership.md#preparation-reuse-and-owned-disposal) **before input access** and retains successful outputs. Parse stdout JSON records by key: one prepared result and one resource disposition, not a fixed line order. A readable managed root may contain private allocator-created categories without chmod; explicit external private scratch stays independent of ambient tasks. Incompatible tooling/invalid proof refuses, never root/evidence fallback or directory adoption.

For a future operational rehearsal, name the actual owning task and separately
authorize the exact source/use **before DB access**. Do not execute or adopt an old
ad-hoc script/allocation as an owner. The finite recipe is:

1. Resolve canonical root and both categories using compatible installed tooling:
   `pivan-harness task-scratch path "$PIVAN_TASK_PATH" --create`, then the same
   command with `--category evidence --create` and `--category disposable --create`.
   Use only their verified returned paths. For authored preparation, pass the
   **root** to `smoke:prepare`, not the evidence/disposable path. `--task-id` is a
   provenance label, not category authority. Real grants retain the private route below.
2. Create a new exclusive `0700` UUID child under returned disposable for rehearsal,
   restore and run-owned backup DBs and their run-owned WAL/SHM. Validate canonical
   no-follow uid/private/single-link source files/sidecars using the existing
   `smoke_input.database_state` boundary; refuse journals, changed/replaced parents,
   aliases, hardlinks and reused destinations. Never chmod/adopt an input.
3. For each copy, exclusively create a `0600` regular destination with
   `O_CREAT | O_EXCL | O_NOFOLLOW`, then use a read-only SQLite source connection
   and `source.backup(destination, pages=128, sleep=.01, progress=deadline_check)`
   with the existing ten-second preparation deadline. Never independently copy
   active WAL/SHM or use a live main-file copy. Each restore/run-backup copy uses
   another exclusive destination; failure/cancellation retains partial outputs
   and the original error, not an overwrite/retry or a recovery hold.
4. Compare original identity/DB-WAL bytes and logical fingerprint before/after;
   verify destination integrity, schema version/inventory, foreign keys, bounded
   counts and source-equal logical state. Keep only compact non-sensitive outcomes,
   provenance and failure facts in returned evidence. Source paths/grants/DB contents
   are not public support evidence. Retain all promised standalone/prepare-only
   outputs; consumption does not enroll borrowed inputs for deletion.
5. Record purpose, source preservation, receipt and expiry/cleanup deferral in the task. [Resource lifetime](smoke/ownership.md#preparation-reuse-and-owned-disposal) is independent of immediate disposal: normally disposable six hours after canonical close and evidence seven days, subject to actual App policy; failure extends neither. Placement grants no deletion, migration, install or production use.

The executable authored proof is
`python3 -m unittest discover -s scripts/desktop -p smoke_prepare_test.py`: actual
CLI/adapter routing, refusal and lifetime plus fresh active-WAL rehearsal → restore
→ run-backup copies, original preservation and compact-only evidence. Its allocator
is a test stand-in; a real-task CLI run with compatible tooling is separately
required for producer evidence. It is not a general migration executable.

A genuine operator/pre-upgrade backup is **not** a disposable rehearsal backup.
The stopped-target migration CLI's sibling-backup contract remains unchanged;
production restore/migration and existing or borrowed backup disposition require
separate exact authority. See [local data lifecycle](source-beta-readiness.md#local-data-lifecycle).

## Explicit private route

Private use is optional. **Before opening selection values, artifact provenance or a DB**, the already-authorized caller must explicitly select an attributable current authority record for that exact artifact/use. Neither a record discovered beside a fixture nor historic preparation consent creates authority. For Pivan E0007, the selected workspace's `content/private-smoke-fixture-inventory.md` is the single policy owner for approval, artifact-owner availability and retention. This implementation introduces no real personal grant, permission service, signature/authentication claim or general authorization store.

```bash
npm run smoke:native -- --scratch '/canonical/0700/task-scratch' --task-id T0252 \
  --input-file '/canonical/0700/selected-database.json' \
  --grant-file '/canonical/0700/current-authority.json' \
  --provenance-file '/canonical/0700/exact-artifact-provenance.json'
```

Use the same options with `smoke:ordinary`; ordinary still requires `--bundle` and denies debug Health/Settings/auth controls. The existing explicit `--input-file` spelling and database-only shape remain, but authority/provenance must now be supplied. One-off approval uses the same narrow record with an exact consumer task; standing approval does **not** require a new HITL solely because the task changes. Do not turn historical consent into a grant without actual explicit operator authority. Other specialized legacy runners keep their separately scoped input contracts, not automatic new grant support.

An explicit private refusal is nonzero **before native launch**, never silently replaced with synthetic or another private source. Missing/expired/revoked/changed/unknown authority, source, scope or retention refuses. The independent safe synthetic option remains available by omitting private options; that is not private verification success.

### Grant v1 fields

No extra fields are accepted. This is a serialization contract, **not a real grant template to self-approve**:

| Field                                                 | Required value/meaning                                                                                                             |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `schemaVersion`, `grantId`, `revision`, `status`      | Integer `1`; opaque bounded identity; positive integer; current `active` (anything else, including `revoked`, refuses)             |
| `kind`, `consumerTask`                                | `standing` with `null`, or `one-off` with the exact consuming `Tnnnn`                                                              |
| `approval`                                            | Exactly nonempty bounded `operator` and `evidence` strings referencing actual explicit approval, not fixture provenance            |
| `artifactId`, `artifactVersion`                       | Exact bounded selected artifact/version identities                                                                                 |
| `selectionSha256`, `provenanceSha256`, `logicalHash`  | Lowercase 64-hex exact selection bytes, exact provenance bytes, and whole logical SQLite fingerprint from the existing smoke owner |
| `epic`                                                | Exactly `E0007`                                                                                                                    |
| `scenarios`                                           | Nonempty unique subset of `native`, `ordinary`, `health-comparison`; must include requested use                                    |
| `dataClasses`                                         | Exactly ordered `["numeric-activity-summaries","daily-health","synthetic-profile"]`; excluded populated classes still refuse       |
| `validFrom`, `expiresAt`, `retentionUntil`            | Explicit UTC `YYYY-MM-DDTHH:MM:SSZ`; start ≤ now < expiry ≤ owner-approved retention bound                                         |
| `originalReadOnly`                                    | `true`                                                                                                                             |
| `primaryWrite`, `credentials`, `externalTransmission` | Each exactly `false`                                                                                                               |

Grant/selection/provenance JSON are each at most 8192 bytes. The selected SQLite is at most 16 MiB with at most 256 rows per table; this finite seam is not a full personal-backup importer. Artifact provenance has exactly `schemaVersion:1`, `artifactId`, `artifactVersion`, `logicalHash`, the same `dataClasses`, and `originalPreserved:true`. Its claim must originate from reviewed artifact preparation; a hash match alone does not prove anonymity, appropriate consent or owner lifetime. Numeric/date data can remain personal. A changed source or additional data classes require fresh exact authority, not widening a saved grant to force compatibility.

### Current revision, revocation and preservation

The operator/artifact owner retains the **current grant file** at its explicit canonical path. To revoke, publish a new revision with non-active status (or make the record unavailable); do not leave consumers pointed at a stale copied approval. To revise scope/identity/lifetime, publish the actual newly approved revision. Consumers re-read the current record before preparation/copy and every owned boot, and reject any changed revision/hash/selection/provenance/source during a prepared run. A fresh preparation may use a newly approved current record. Record the checked revision privately. Revocation prevents subsequent use; it is not rollback of already completed effects or a process-kill grant.

Owner resource/retention controls remain independent: a standing grant never extends scratch lifetime, authorizes deletion/relocation or overrides unavailable ownership. Unknown owner/retention means no private use. Only exact originals are opened read-only and copied; comparisons cover DB identity/logical content before/after preparation. Run-owned writable copies and seed/original preservation remain separately verified. No primary change, provider acquisition, transmission or normal-app takeover is authorized.

## Evidence limits

Preparation/private presence is not runtime proof. The bridge's [evidence classes](smoke/protocol.md#keep-evidence-classes-distinct) own synthetic/debug/ordinary/real-service limits: synthetic or isolated success alone is not provider/Garmin/auth/default-window/trusted-input certification. Deterministic checks prove exact fixture values/coverage, not masked images. Inspect every required PNG and retain local source/artifact/scenario/hash/layout/privacy analysis; upload nothing. [Developer process](developer-process.md) owns final-diff back-sync no-op and attributed cleanup/deferral; [validation](validation.md) owns applicable local/macOS/build/native requirements.
