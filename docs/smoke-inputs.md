# Local smoke inputs

Routine `smoke:native` and `smoke:ordinary` use authored synthetic SQLite, never personal selections/settings/env/credentials or normal-state fallback. Quick/nightly retains its separate minimal recipe. Preparation and `--prepare-only` launch nothing; runtime proof requires a [native scenario and inspected captures](dev-bridge.md). Sync/import has a [build/run card](synthetic-sync-smoke.md).

```bash
npm run smoke:prepare -- --scratch '/canonical/0700/task-scratch' --task-id T0252 --anchor 2026-11-01
npm run smoke:native -- --scratch '/canonical/0700/task-scratch' --task-id T0252 --health-comparison
npm run smoke:ordinary -- --scratch '/canonical/0700/task-scratch' --task-id T0252 --bundle '/absolute/ordinary/AI Trainer for Garmin Connect.app'
```

`--task-id` defaults from `PIVAN_TASK_PATH`, otherwise `local`. The recorded anchor defaults once to UTC today; an explicit real date reproduces logical contents, not output UUIDs or the product clock. Use a current anchor for current Health navigation.

## Finite recipe and verification

The recipe uses authoritative migrations in memory, typed inserts and exclusive private publication. It covers fictional chats, Profile, activities and Health, including absent/partial/zero values, additional-Garmin coverage states, multisport/HRV/sleep/stress/battery evidence, lap HR and snow runs. `scripts/desktop/smoke_recipe.ts` owns exact rows and values; no personal example is copied. Snow cases distinguish aggregate totals from individual runs, unsupported/unknown/latest-failed coverage, proven UTC/lap-file limits from unproven clocks, and null from zero.

`--conversation-selection` defaults to `empty-chat`: verify the complete authored recipe first, remove only its new in-memory chat/message rows, check the empty shape, then publish with `syntheticVariant: empty-chat`. Other fields stay identical. Explicit private input must already be empty under its own grant; borrowed input is never cleared.

The verifier checks exact schema inventory/version, integrity/FKs, counts, types, Profile JSON and route coverage; extra tables/triggers refuse. Private coverage permits only bounded numeric summaries, Health and synthetic Profile, with at least fourteen Health rows spanning fourteen dates. It does not certify absent-date/chart cases that are not present. Unreviewed metadata, auth/session/account/verification, raw/detail/GPS, memory, plans and private chats refuse. No selected input is migrated. Finite fractional duration/average-HR values remain valid despite INTEGER affinity; counters/timestamps stay integral, invalid/nonfinite values refuse, and verification never rounds or rewrites data.

Preparation requires existing canonical uid-owned `0700` directories and bounded `0600` regular single-link files. Aliases, hardlinks, insecure/foreign files, unknown/duplicate JSON keys and reused destinations refuse; never chmod/adopt. Each fresh UUID output contains database-only `selection.json` (`{"database":"/canonical/prepared/input.sqlite"}`) and private provenance. Copy through SQLite online backup, never a live main-file copy. Validate sidecars too; rollback journals refuse recovery. Compare original identity, DB/WAL bytes and logical state; SHM lock/read marks get safety validation, not an immutability claim.

Native owners create independent writable copies, never back-sync/upload. [Resource ownership](smoke/ownership.md#preparation-reuse-and-owned-disposal) governs categories, settlement, evidence-first disposal and expiry. Standalone/prepare-only/borrowed outputs are excluded from immediate disposal. Partial failures remain for exact reconciliation, not adoption/overwrite/blind retry; input authority remains independent.

## Task-owned rehearsal, restore and run-backup placement

Standalone preparation configures resource ownership before input access and retains successful outputs. Parse stdout objects by key (`prepared` versus resource disposition), not line order. A readable managed root may contain private allocated children; external private scratch remains independent of ambient tasks. Invalid tooling/proof refuses without fallback/adoption.

For a rehearsal, name its owning task and separately authorize the exact source/use before DB access. An old script/allocation is not an owner:

1. Resolve root with `pivan-harness task-scratch path "$PIVAN_TASK_PATH" --create`, then evidence/disposable with `--category evidence` or `--category disposable`. Use verified returned paths; pass root to authored preparation. `--task-id` labels provenance, not authority.
2. Exclusively create a `0700` UUID child in disposable. Use `smoke_input.database_state` to validate canonical no-follow uid/private/single-link source and sidecars; refuse journals, replaced parents, aliases, hardlinks and existing destinations.
3. Exclusively create each `0600` destination with `O_CREAT | O_EXCL | O_NOFOLLOW`. Use a read-only source and `source.backup(destination, pages=128, sleep=.01, progress=deadline_check)` with the existing ten-second deadline. Restore and run-backup each need a fresh destination. Never copy active WAL/SHM independently. Failure/cancellation retains partial output and original error, not a retry or recovery hold.
4. Compare original identity/DB-WAL bytes/logical fingerprint; verify destination integrity, schema inventory/version, FKs, bounded counts and source-equal logical state. Evidence holds compact non-sensitive outcomes/provenance/failures, not source paths/grants/contents. Retain promised outputs; consumption never enrolls borrowed input for deletion.
5. Record purpose, preservation, receipt and expiry/deferral. Actual App policy controls lifetime: normally disposable six hours after canonical close and evidence seven days; failure extends neither. Placement grants no deletion, migration, install or production use.

`python3 -m unittest discover -s scripts/desktop -p smoke_prepare_test.py` covers this copy chain and preservation with a test allocator. Producer evidence additionally needs a real-task CLI run with compatible tooling; it is not a migration executable. Genuine operator/pre-upgrade backups are not disposable rehearsal copies. The stopped-target sibling-backup contract and separate production restore/migration/disposition authority remain [unchanged](source-beta-readiness.md#local-data-lifecycle).

## Explicit private route

Before opening selection values, provenance or a DB, the authorized caller explicitly selects a current attributable authority record for that exact artifact/use. Discovered records or historical preparation consent are not authority. E0007's selected-workspace `content/private-smoke-fixture-inventory.md` owns approval, artifact availability and retention; this format is not a permission service, authenticated grant store or actual personal grant.

```bash
npm run smoke:native -- --scratch '/canonical/0700/task-scratch' --task-id T0252 \
  --input-file '/canonical/0700/selected-database.json' \
  --grant-file '/canonical/0700/current-authority.json' \
  --provenance-file '/canonical/0700/exact-artifact-provenance.json'
```

The same flags work with ordinary plus `--bundle`, without enabling debug Health/Settings/auth controls. Specialized legacy runners retain their own contracts. One-off grants name the exact consumer; standing approval needs no new HITL merely because the task changes. Never manufacture a grant from historical consent.

Missing/expired/revoked/changed/unknown authority, scope, source or retention refuses nonzero before launch, without private-to-synthetic fallback. Omitting private options remains an independent synthetic choice, not successful private verification.

### Grant v1 fields

Exact serialization, not a self-approval template; extra fields refuse:

- `schemaVersion`: integer 1; `grantId`: bounded opaque identity; `revision`: positive integer; `status`: `active` only.
- `kind`/`consumerTask`: `standing`/null or `one-off`/exact consuming `Tnnnn`.
- `approval`: exactly bounded nonempty `operator` and `evidence` strings referencing actual approval, not fixture provenance.
- `artifactId`/`artifactVersion`: exact bounded identities.
- `selectionSha256`/`provenanceSha256`/`logicalHash`: lowercase 64-hex hashes of exact selection/provenance bytes and whole logical SQLite state.
- `epic`: `E0007`; `scenarios`: nonempty unique subset of `native`, `ordinary`, `health-comparison`, including requested use.
- `dataClasses`: exactly ordered `["numeric-activity-summaries","daily-health","synthetic-profile"]`; excluded populated classes still refuse.
- `validFrom`/`expiresAt`/`retentionUntil`: explicit UTC `YYYY-MM-DDTHH:MM:SSZ`, start ≤ now < expiry ≤ owner-approved retention bound.
- `originalReadOnly`: true; `primaryWrite`/`credentials`/`externalTransmission`: false.

Each JSON file is at most 8192 bytes; SQLite at most 16 MiB and 256 rows/table. Provenance contains exactly `schemaVersion:1`, artifact identities, `logicalHash`, the same `dataClasses` and `originalPreserved:true`, originating from reviewed preparation. Hash equality proves neither anonymity nor consent/lifetime; numeric dates may be personal. Changed source/classes need fresh exact authority, not a widened saved record.

### Current revision, revocation and preservation

The operator/artifact owner maintains the current canonical grant file. Revocation publishes a new non-active revision or makes it unavailable; do not point consumers to stale copied approval. Scope/identity/lifetime changes require an actually approved revision. Consumers reread before copying and every boot; any changed revision/hash/selection/provenance/source during a prepared run refuses. New preparation may use a newly approved record; record the checked revision privately. Revocation prevents later use, not completed effects, and grants no process kill.

Standing grants never extend resource lifetime or authorize deletion/relocation. Unknown owner/retention blocks use. Exact originals stay read-only and compared before/after copying; writable-run preservation remains independently checked. No primary change, provider acquisition, transmission or normal-app takeover follows.

## Evidence limits

[Evidence classes](smoke/protocol.md#keep-evidence-classes-distinct) own debug/ordinary/synthetic/real-service distinctions. Exact fixture checks do not prove masked image contents; inspect required PNGs and retain local source/artifact/scenario/hash/layout/privacy analysis, uploading nothing. [Developer process](developer-process.md) owns back-sync no-op and attributed cleanup/deferral; [validation](validation.md) owns applicable build/native gates. [Finite fixture exceptions](developer-process.md#no-new-isolated-fixture-environment-for-this-stage) do not authorize a new fixture environment.
