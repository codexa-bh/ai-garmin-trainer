# Local smoke inputs

Routine `smoke:native` and `smoke:ordinary` default to **entirely authored synthetic** SQLite. They do not open personal selections, receipts, env, settings, tokens or credentials. Normal app state is never a fallback. Quick/nightly remains its independent minimal Profile-only recipe; no additional recurring native workload is enrolled.

```bash
npm run smoke:prepare -- --scratch '/canonical/0700/task-scratch' --task-id T0252 --anchor 2026-11-01
npm run smoke:native -- --scratch '/canonical/0700/task-scratch' --task-id T0252 --health-comparison
npm run smoke:ordinary -- --scratch '/canonical/0700/task-scratch' --task-id T0252 --bundle '/absolute/ordinary/Garmin Trainer.app'
```

`smoke:prepare` has no launch capability. Runner `--prepare-only` also launches nothing. Only actual [native scenarios and inspected captures](dev-bridge.md) prove runtime behavior. A bundle must still match final source/artifact identity. `--task-id` defaults from `PIVAN_TASK_PATH`, otherwise `local`; `--anchor` defaults once to **UTC** today and is recorded. An explicit real YYYY-MM-DD date reproduces logical contents, not the UUID output path. Use a current anchor for current Health navigation; no product clock is overridden.

## Finite recipe and verification

Recipe v1 uses authoritative migrations in memory and typed schema inserts, then exclusively publishes owner-private SQLite. It contains three distinguishable fictional conversations/twelve user-assistant turns, eight activity summaries, a Profile and twenty Health rows spanning twenty-one UTC dates. The previous seven-date page contains one absent date, one partial row and real zero steps/intensity. Absent is not zero. Conversation storage uses the existing repository's millisecond convention, and migration metadata is anchored too. Nothing is copied or derived from personal examples.

`smoke_recipe.ts` verifies exact current schema inventory (including rejection of extra triggers/tables), version, integrity, FK checks, bounded row counts, declared numeric/text types, Profile JSON and route-specific coverage. Synthetic coverage additionally verifies ordered turns and missing/partial/zero cases. Private coverage requires bounded numeric-summary/Health/Profile classes and at least fourteen Health rows spanning fourteen dates; it does not falsely certify missing-date/chart coverage if absent. Unreviewed metadata, auth/session/account/verification, raw/detail/GPS, memory, plans and private chat/message populations refuse. No selected input is migrated. Numeric verification preserves finite fractional
`activity.duration_sec` and `activity.avg_heart_rate` values, as accepted by the
existing importer despite SQLite INTEGER affinity; counters/timestamps remain
integral and nonnumeric/nonfinite values still refuse. No rounding or data rewrite
is performed.

The Python preparation owner requires existing canonical uid-owned `0700` directories and bounded `0600` regular single-link files; aliases, hardlinks, unknown/duplicate JSON keys, insecure/foreign files and reused destinations refuse, never chmod/adopt. A fresh private UUID output holds database-only `selection.json` (`{"database":"/canonical/prepared/input.sqlite"}`) and bounded private preparation provenance. Private copying uses SQLite online backup with a deadline and original logical/identity/DB-WAL byte checks, not a live main-file copy. Implicit SQLite sidecars must also be canonical/private/single-link; rollback journals refuse recovery. SHM lock/read marks are validated for file safety, not certified immutable. Native owners then make independent writable run copies. All copies, Goals, provenance, logs and images are task-attributed, scratch-expiry deferred, never back-synced or uploaded. Partial outputs are retained for exact reconciliation, not overwritten/retried blindly.

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

Synthetic navigation/save/restart and masked geometry are not real provider/Garmin/auth/default-window/trusted-input certification. Private presence/preparation also proves none of those. Exact fixture values/coverage belong to deterministic checks; masks cannot prove hidden values. Read every required PNG and retain concise source/artifact/scenario/hash/layout/privacy analysis locally; upload nothing. See [developer process](developer-process.md) for final-diff schema/back-sync no-op and attributed artifact cleanup/deferral, and [validation](validation.md) for sufficient local/macOS/build/native evidence.
