# Schema activation history (schemas 19–26)

> **History.** Per-schema notes recorded when each migration was delivered. The current rule for any schema upgrade is in [desktop runtime → schema upgrades](../desktop.md#schema-upgrades) and the [release runbook](../release.md#existing-database-upgrades-and-recovery).

## Schemas 19–22

Schema19 added the incremental producer; additive schema20 integrates sealed chat
pins, manual/import state and independent title spend. Migrations18/19 are unchanged.
Native Memory fields SUMMARY_ENABLED, SUMMARY_MODEL and SUMMARY_CHAR_LIMIT remain
restart-only, default Off/unselected/6000. SUMMARY_MODEL selects future titles and
summaries independently of Trainer chat. Its dropdown derives from the configured
catalog, labels provider/exact ID and preserves unavailable choices without substitution.
The existing scalar stores legacy unselected/Luna or version1 JSON with entryId,
provider and modelId; subscription version2 additionally binds registrationId. Catalog edits/removal never retarget that exact choice; reselect
explicitly. A legacy scalar with one exact OpenAI/gpt-6-luna catalog match has one
ordinary option. Rendering and untouched Save preserve the scalar; **Use this catalog
entry on Save** changes only the draft, and explicit Save adopts that exact entry
identity. Cancel/reload never adopts it. Ambiguous/missing/different-case matches do
not select an arbitrary catalog row; edited/removed saved JSON stays unavailable.
The uncapped automatic-processing warning is beside Remember across chats.
Old enums refuse new JSON values, not downgrade. Summary Off does not
disable titles. Missing configuration/provider capability retains an explicit
unavailable result or title excerpt, never chat/extractor fallback. Existing API-key routes reuse their private ownership/live-key snapshots. Subscription has its separate protected credential owner and fixed private metadata protocol; it never turns tokens into API-key fields. Explicit Save includes hidden
SUMMARY_CONTRACT_VERSION=2 so old field parsers refuse changed semantics; schema19
admission refuses20. Preserve originals and use a compatible build/forward fix.
Rehearse authored copy migration first; no primary upgrade/restart is implied.
Schema21 prospectively adds size-aware summary reservation/basis/day accounting;
old pin payloads, gross spend, usage and unknown effects are preserved. Explicit
migration must be rehearsed on an authored populated online copy first; schema20
builds refuse21. Startup/Use existing never migrate. No primary migration, installation
or restart authority is implied. Summary, titles and local compaction have no app-imposed spending/attempt caps or
capacity/tokenizer/pricing qualification. The chosen provider may refuse a request;
full memory is never silently clipped or sent to a fallback. Historical reservations
and unknown costs remain distinct and retained. Settings discloses cost implications;
Disable stops new summary work. Two-second native activity wakeups/serialized backlog drain
and bounded eight-second explicit adoption replace delayed small-turn polling.
Trainer Memory distinguishes latest versus selected-chat pin/use; native fixed
status observes configuration/producer metadata, not actual selected-chat use.
Schema22 adds staged explicit-history rebuild and an original-message authority
watermark. It changes neither native settings/key protocol nor active summary/pin
formats. Rehearse migration on an authored populated copy; schema21 builds refuse22.
Startup/Use existing remain non-migrating. Pre-existing unlinked originals are
conservatively fenced because earlier Clear operations recorded no such authority.
No automatic backfill/regeneration, primary migration, restart or installation is
authorized by source delivery; preserve compatible backups and use a forward fix,
not an older writer/downgrade or blind copy-back.

## Schema23 recovery activation (separately authorized)

Source delivery is not installed adoption or recovered primary memory. Schema23
adds a known future-Clear floor, initialized to zero without inventing historical
Clear provenance; schema22 migration bytes and existing floor remain unchanged.
New recovery operations seal selected-chat/legacy intent; active memory/pin formats
and unrelated data are unchanged. Schema22 readers refuse23 through existing exact
version admission. Startup/Use existing never migrate.

For actual primary activation, separately approve the exact private DB/settings,
qualified artifact and current owners without publishing private values. First
make and integrity-verify a durable WAL-consistent recovery backup; rehearse the
explicit migration/reopen/restore on an independent populated disposable copy and
verify originals/manual/restrictions/accounting. Obtain exact target mutation and
artifact replacement/stop/reopen authority before migrating the stopped primary.
Use compatible forward recovery, never downgrade or blind copy-back. After launch,
review All retained or selected conversations and explicitly permit uncertain old
history only if wanted; confirm exact provider/export/spend/rebuild authority before
a live recovery. Verify scope/exclusions, meaningful saved content and next-turn
consumption separately. Nothing here grants primary access, migration, restart,
provider spending, installation or historical cleanup.

## Schema24 whole-summary activation (separately authorized)

Generated memory now uses one version2 complete text and separate preferences; the
character target guides generated text only; it is not an output ceiling. Schema24 preserves historical
migration bytes, originals, restrictions and accounting. Proven standalone legacy
authored notes map losslessly; source-linked/ambiguous manual edits or corrupt/
unsupported state refuse the transition unchanged. Old active pins/staged drafts
are invalidated/interrupted, not reported completed or refunded. Old schema23
readers refuse24. Startup/Use existing never migrate a selected database.

Rehearse on independent authored and actual-derived WAL-consistent copies, verify
source/settings/manual/restriction/accounting preservation, integrity/FK and reopen.
Source delivery grants no primary migration, install, stop/restart or copy-back.
Any actual activation still needs the exact-target/backup/artifact/owner/stop/
migration/reopen approvals above; use a compatible forward fix, never downgrade.

## Schema25 freshness activation (separately authorized)

Source delivery adds a forward24→25 migration dropping only ordinary-correction and
Profile erasure triggers. It changes no stored rows. Valid generated text, preferences,
originals, compacts and accounting remain; old24 readers refuse25. Installed24 retains
its old effective triggers until this migration is deliberately applied; rebuild/restart
alone does not change SQL. No lost historical summary is reconstructed.

Future activation requires explicit authority for the exact DB/settings target, a verified
WAL-consistent pre-upgrade backup, stopped/reaped app and writer owners, an exact-source
qualified ARM64 artifact, the explicit process-env migration against that target, then
integrity/FK/version/effective-trigger and preserved-state checks before controlled reopen.
Startup/Use existing never migrates. Prefer compatible roll-forward; never downgrade or
blindly copy new writes back.

## Schema26 structured weekly KPIs (separately authorized)

Schema26 adds separate structured weekly state/signatures without rewriting narrative or unrelated rows. Old25 builds refuse26; existing selection/startup never migrate. Finite semantic backfill remains a separate reviewed maintenance command, not DDL/startup/model extraction. The migration CLI now obtains the existing stopped-writer lease and verifies an exclusive SQLite-online sibling backup, including committed WAL, as a standalone DELETE-journal recovery file before DDL. Explicit canonical fresh initialization remains available without adopting env files; unknown/partial output is retained, never overwritten or blindly restored. These source safety corrections do not prove an actual installed target or grant its mutation.

Rehearse first and follow the exact target/read/copy/backup/stop/install/mutation/reopen approvals and integrity/reference/source-preservation checks in [weekly KPI migration](../weekly-kpis.md#storage-migration-and-recovery). Source delivery alone is not installed adoption; preserve newer writes and prefer a compatible forward fix, not an older writer or blind backup copy-back.
