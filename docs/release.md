# Dual-platform release runbook

Published assets/checksums are on [GitHub Releases](https://github.com/codexa-bh/ai-garmin-trainer/releases), with immutable notes in [`release-notes/releases/`](../release-notes/releases/). macOS ARM64 ships an unsigned/non-notarized DMG, not PKG; minimum macOS 12.0 is not minimum-OS certification. [Windows x64 alpha](windows.md) is unsigned NSIS, qualified only on hosted Server 2025. Shared stable/Latest does not expand platform support. No updater, installer hook, service, login item or release worker.

## Release cut runbook

### Four steps

1. **Readiness:** fetch exact `origin/main`, confirm clean source, inspect provider tags/releases and changes since the previous tag, and refresh dependency advisories.
2. **Cut/merge:** use a task worktree from that commit; inspect rendered disclosure with explicit platform/baseline/schema context, then prepare with the same context. Run installed-tree-mutating checks (Vitest/`npm run validate`) before final build. Deliver through a checked PR/exact-head CI and record the merged release SHA.
3. **Build/verify:** build once at that SHA, package and verify using the printed record. Routine macOS metadata-only cuts need artifact verification, not launched smoke; changed behavior needs appropriate current smoke. Dual-platform cuts retain the stronger [qualification procedure](#dual-platform-candidate-and-publication-procedure).
4. **Publish/verify:** plan status/draft, execute draft then publish with identical inputs, and anonymously verify Latest/tag/body/all assets. Reconcile documentation through a normal PR and close only after delivery.

The operator's cut request supplies authority; there is no extra residual-risk/tuple approval pause. Failed guards, unsafe/changed source or bytes, unknown publication effects, provider/protection/review refusal and missing credentials stop. Never edit stamps, move tags or bypass a refusal. Release does not install/open/replace the operator app or change trust. Implementation/dependency/workflow changes need their own normal validation first, not concealment in metadata.

Readiness review covers npm/Cargo/Tauri version/locks, runtime and redistribution inputs/assembly, `.github/`, [redistribution conditions](redistribution.md) and toolchains. Reuse unchanged rights/source material, never skip actual notice/source verification or advisory refresh: unchanged versions can gain advisories. Inspect native closure with `cargo metadata --filter-platform aarch64-apple-darwin`; report broader lock findings separately. Historical receipts/timings never qualify current bytes.

**Bound environment:** keep one shell, unchanged PATH/npm environment/installed `node_modules` through build/package/verify/remote steps. A resumed changed environment requires rebuild, not rebinding. Vitest mutates installed cache, so run JS checks before build; `cargo test` remains supported afterward. Ad hoc admission scripts run through `npm run`.

### Command reference

`$SCRATCH` is the canonical task root, not a category child; `$REPO` is `codexa-bh/ai-garmin-trainer`; `$BUNDLE` is the physical canonical ordinary app, not a worktree alias. COMMIT/VERSION/channels are explicit reviewed values.

```bash
git fetch origin main --tags
npm run release:check
# After cut PR/CI/merge: COMMIT is its full merged SHA.
npm run release -- build --repository "$REPO" --commit "$COMMIT" --version "$VERSION" --scratch "$SCRATCH" --execute
npm run release -- package --scratch "$SCRATCH" --bundle "$BUNDLE" --execute
npm run release -- verify --scratch "$SCRATCH" --bundle "$BUNDLE" --record "$RECORD"
npm run release -- status --repository "$REPO" --commit "$COMMIT" --version "$VERSION" \
  --scratch "$SCRATCH" --bundle "$BUNDLE" --record "$RECORD" --prerelease no --latest yes
# Repeat identical inputs with draft (plan), draft --execute, publish --execute.
```

`status`/`draft`/`publish` recompute `selectedTuple`: repository/version/tag/full commit, notes/public-body hashes, channels, build identities and exact assets (name/size/SHA-256). It is not stored/accepted as input or approval. macOS-only selects three assets; a release set selects its declared assets plus the set.

Each scratch-backed invocation writes private `release-timing-<action>-<uuid>.json`: stages, UTC/monotonic durations, outcomes and error classes only. `incomplete` means killed/unknown effect. Record CI/waits/rework separately; timings are observations, not targets.

## Version and notes

`package.json` version is canonical. `release:check` verifies npm lock, root Cargo manifest/lock, Tauri, current versioned notes and all pending fragments. Source version 0.1.4 is published; `Status: prepared` is metadata, not live visibility/approval. Version0.1.0 is foundation history, not a download. Preparation changes no dependency versions or earlier notes.

Each change supplies a fragment per [fragment contract](../release-notes/README.md), not a shared Unreleased edit:

```bash
npm run release:notes:check
npm run release:notes:preview
npm run release -- preflight --version "$VERSION" --notes "$REVIEWED_TEXT_FILE" --preflight-context "$CONTEXT"
# Plan only unless --execute is supplied:
npm run release -- prepare --version "$VERSION" --notes "$REVIEWED_TEXT_FILE" --preflight-context "$CONTEXT" --execute
npm run release:check
```

Use an unused SemVer, optional prerelease but no build metadata/tag/path. Keep text/context outside the clean checkout. `prepare` validates all mirrors/fragments/context before writes, creates the versioned heading/status/warnings/categorized notes and mirrors, verifies them, then deletes only published required fragments. No-note/support files remain. Reviewed `--notes` text precedes, never replaces, generated changes; edit a fragment to change its wording. With no required fragments, notes say no changes recorded; bookkeeping is not a product entry.

Refusal preserves inputs; partial write failure needs Git inspection/restoration, not blind retry. Pending fragments are never deleted ahead of success. Windows `prepare --platform windows-x64` requires context including Windows; legacy context-free macOS preparation remains supported without claiming stronger disclosure validation. Real preparation/publication belongs to an explicitly scoped release task; tests use temporary repositories.

### Rendered disclosure preflight

`preflight --preflight-context "$CONTEXT"` checks current notes; an unused future `--version` composes exactly what preparation would write from reviewed text/fragments. Read-only/local: no build, artifact, provider, DB access, consumption or write. JSON `body` uses the actual macOS/release-set renderer with unresolved source/digest placeholders—not provenance, selected tuple, approval or eligibility. Inspect the text, not just exit code. Changed notes/fragments/context require another check; prepare revalidates independently.

Context has exactly these fields, using actual prior-release full commit/version/schema:

```json
{
  "version": "0.1.5",
  "platforms": ["macos-arm64", "windows-x64"],
  "baseline": {
    "commit": "02fd82fd9842e93402cdc88e7e2f387fb02d3fde",
    "version": "0.1.4",
    "schema": 30
  },
  "schema": 30
}
```

Baseline must be locally available and an ancestor; fetch it explicitly if absent. Version/schema come from that Git object; current schema from `src/lib/db/migrations.ts`. Unknown/unsupported/contradictory/downgrade context refuses. Update tracked `release-notes/windows-preflight.json` in the same cut diff after preparation: it selects current Windows notes, not inferred Latest or omitted macOS qualification.

Assertions are narrow case-insensitive literals (bold ignored), not an NLP classifier. Preserve these reviewed disclosures and inspect other prose for contradictions:

- Windows: **Windows x64 alpha**, **no Authenticode verified publisher**, **Windows Server 2025 x64**, **not Windows 11, Windows 10 or ARM support**, **nor qualification of trusted input, normal onboarding or real-service access**, plus an unsigned sentence.
- macOS: unsigned/not-notarized warning and **minimum macOS 12.0 is not minimum-OS certification**.
- Matching-source CLI, stopped-owner, verified-backup, no-startup-upgrade and redistribution warnings.
- Changed schema: `Version <baseline-version> uses schema <old>; this release uses schema <new>.` Include **explicit database upgrade**, **prior compatible app**, **database backup and settings**, and for Windows **Windows existing-database migration via the source CLI is not qualified**.
- Unchanged schema: `No database schema change: <old> → <new>.` Unknown is not unchanged; contradictory release-level declarations refuse. Intermediate migration references are not the release transition.

Historical notes/assets remain immutable. Disclosure checks perform no migration and confer no Windows migration/support qualification.

## Build versus downloaded runtime

[Desktop](desktop.md#build-and-run) and [Windows](windows.md#build-from-source-windows-x64-host) own toolchains. macOS packaging additionally uses built-in hdiutil/ditto/lipo/codesign inspection/Git; remote work needs operator-managed authenticated `gh`, never credential acquisition/permission bypass.

Downloads bundle Node/Next/SQLite and need no system Node/Rust/checkout or Garmin Python/uv/uvx. Historical0.1.3 prerequisites remain in its notes. Ollama stays operator-managed; the app installs no tools/models. Offline data needs no Garmin; real services need configured access/funding/network. Matching-source DB upgrades remain the exception below.

## Local build, package and verify

Use physical canonical task checkout/bundle, independent mutable build output and canonical scratch root. Managed packaging allocates bulk in disposable and diagnostics in evidence; outputs survive immediate completion, not scheduler expiry. No worktree/history deletion.

For local developer evidence, `npm ci`, `release:check`, `desktop:build`, then the package/verify commands above. Package never rebuilds/launches/signs/installs/rewrites the producer. It locks and verifies original v2 source/context/inventory, stages exclusively, and uses ditto/hdiutil without overwrite. DMG contains only AI Trainer for Garmin Connect.app, no Applications alias/Finder automation.

Readonly non-browsing mount verification compares all bytes/modes/xattrs, app/version, ARM64 app/Node/SQLite, provenance, required notices and private exclusions. Report unsigned/linker-ad-hoc, not Developer ID; no trust/notarization/quarantine action. DMG above **140,000,000 bytes** refuses before record creation. Retained `size-report.json` reports DMG/app/runtime/Next/redistribution groups for diagnosis, not as a release asset. Raise the budget only through a reviewed measured breakdown.

`release.json` binds Git/dirty state, original build identities, metadata/notes and final DMG name/size/hash without local paths/env. Auxiliary assets are checksum and compact public record only. Dirty artifacts are local evidence, never remotely eligible by committing later.

When launched qualification is required, run native tests, `smoke:ordinary -- ... --release-record "$RECORD"`, affected features and separate `smoke:release`. The ordinary handoff re-admits the original producer under lock and rechecks digest/mounted payload before each boot/settlement, copying unchanged modes/xattrs to usual isolated roots. No imported-record trust, stamp rebind or producer fallback. Full two-instance assertions, preservation, masks and settlement remain; inspect every required image. Debug/probe/static results cannot substitute for final-payload smoke.

Detach only exact owned mounts, never force. Retain mount intent/observations, original failures and unknown effects; inspect exact receipts before separately authorized recovery. Never overwrite, blindly repeat create/attach/upload or delete ambiguous outputs. Preserve useful compact diagnostics before expiry.

## Exact-source release and GitHub operations

At every effect, require exact clean canonical HEAD/full reviewed merged SHA contained in `origin/main`, intended remote/version/prepared notes, unchanged source and artifact bytes. Untracked/deleted/dirty inputs refuse; a later main tip is not a substitute. Check before remote effects and after build/remote work. Build also reads provider state: existing tag/release/draft refuses rebuilding; reconcile the selected artifact instead.

`draft` is dry-run unless `--execute`. Execution creates immutable lightweight `v<version>` at the verified SHA, draft and exact assets, observing each effect. Explicit resume may reuse exact reconciled partial state. Conflicting/annotated tags, duplicate/extra/incomplete/different assets, changed body/channels or unknown/provider failure refuse. No force/tag move/clobber/delete/rebuild/permission automation.

Release-by-tag404 may hide a draft. The helper checks a bounded complete list and unique exact-tag draft ID; absence/ambiguity/truncation/changed ID/contradiction/transport refusal grants no creation/retry authority. Build preflight uses the same observation.

`publish --execute` separately uses identical inputs and explicit `--prerelease yes|no --latest yes|no`. Prerelease versions require yes/no; stable requires prerelease=no with explicit Latest choice. Before PATCH, verify tag/draft/body/warnings/exact asset set/sizes/digests and local bytes; absent provider digest uses bounded download/hash. Exact already-published state is observation, not republishing. Checksums prove integrity, not publisher authenticity.

Private journals are printed before effects, which are recorded unknown **before** requests. Timeout/auth/network/cancellation/lost response is not rollback. Preserve error/journal, then `status` with identical inputs reconciles exact IDs/hashes; matching is observed, conflict needs owner decision, unavailable stays unknown. No blind retry or remote worker. Public bodies contain notes/source/signing/digests, never scratch/DBs/paths/images. Mocked remote tests are not provider certification.

## Multi-platform release sets

Historical macOS-only releases keep their original three assets/schema 1 record. Dual-platform uses `release-set.json` schema 1 with an explicit ordered nonempty supported-platform list, shared repository/clean commit/version/tag/notes hash, and each platform's target/record/build/inventory/payload identities/signing/asset names/sizes/hashes. Omitted platforms are absent, not certified. Verification is portable digests only.

Native package/verify produces macOS `release.json` (schema 1 or2) or Windows `release-windows-x64.json` (schema 2/platform). `release-set --version "$VERSION" --scratch "$SET_DIRECTORY" --platform-record <record> [--platform-record <record>]` checks exact records/assets anywhere, not another host's producer admission. Mixed identities, duplicate/unsupported platforms, name collisions, changed/malformed bytes or Windows notarization claims refuse. Publisher selects exactly declared assets plus the set, preserving separate dry-run/draft/publish/reconciliation semantics. Historical assets are never rewritten.

## Dual-platform candidate and publication procedure

A specifically authorized macOS ARM64 + Windows x64 alpha cut requires current-byte qualification on both native hosts, stronger than routine macOS metadata-cut verification. Never rebuild after tag/draft or substitute later main.

1. Complete [readiness/cut](#release-cut-runbook), preflight both platforms and update Windows context. After checked PRs and requested Windows feedback, freeze one clean merged SHA; keep bound build environment.
2. macOS requires the [final-DMG qualification](#local-build-package-and-verify), not routine artifact-only evidence. Inspect all captures, including wide/narrow Profile over navigation with real masked-layer occlusion.
3. Explicitly dispatch `windows.yml` with `release_export=true`; provider head must equal the frozen SHA, event workflow_dispatch and final attempt successful. Complete the [installed scenario and six-image inspection](windows.md#installed-app-scenario-and-narrow-evidence-exception) on that exact installer.
4. Before expiry, download exact run/attempt/artifact IDs through the [strict export and image consumers](windows.md#explicit-exact-candidate-release-export), retaining sibling ZIP and separate images. No newest-run/wildcard/filename inference or foreign producer-admission claim.

```bash
gh workflow run windows.yml --repo codexa-bh/ai-garmin-trainer --ref "$REVIEWED_REF" -f release_export=true
python3 scripts/desktop/windows_release_export.py download --source "$COMMIT" \
  --run "$RUN" --attempt "$ATTEMPT" --artifact "$ARTIFACT" --directory "$WINDOWS_DIRECTORY"
python3 scripts/desktop/windows_release_export.py verify --source "$COMMIT" --directory "$WINDOWS_DIRECTORY"
npm run release -- release-set --version "$VERSION" --scratch "$SET_DIRECTORY" \
  --platform-record "$MAC_RECORD" --platform-record "$WINDOWS_RECORD"
npm run release -- status --repository codexa-bh/ai-garmin-trainer --commit "$COMMIT" --version "$VERSION" \
  --scratch "$SCRATCH" --bundle "$BUNDLE" --record "$MAC_RECORD" \
  --release-set "$SET_DIRECTORY/release-set.json" --platform-record "$MAC_RECORD" \
  --platform-record "$WINDOWS_RECORD" --prerelease no --latest yes
# Identical inputs: draft (plan), draft --execute, publish --execute.
```

5. Before tag/draft, record coverage/limits for install/startup/onboarding/persistence/replacement/uninstall, evidence classes, selected-schema copy-only backup/migration/refusal/restore, versioned settings and actual/unavailable integrations. Windows source-CLI/older upgrades remain unqualified. Synthetic DOM/native contracts are not trusted-input, normal-onboarding or real-service certification; no primary cutover.
6. Retain accepted outputs in primary-workspace artifacts. Publish exactly seven assets: both platform triples plus release-set, never receipt/import/ZIP/images/logs. Label Windows alpha independently of shared stable/Latest.
7. Apply [remote effect/reconciliation](#exact-source-release-and-github-operations) with current local macOS producer admission, full set and live Windows attribution at every effect.
8. Anonymously check release/Latest, lightweight tag/source/body/channels and full downloads/hashes of all seven assets. API metadata alone is insufficient; earlier releases stay unchanged. Reconcile docs by checked PR and distinguish its later SHA from binary source. No install/restart/trust/migration/rollout/cleanup authority follows.

## Manual download and app placement — only after an actual authorized release

1. Review exact repository/tag/source and signing/rights/upgrade warnings. Download DMG/checksum; run `shasum -a 256 -c AI-Trainer-for-Garmin-Connect-<version>-macos-arm64.dmg.sha256`. Same-site checksums do not authenticate the publisher.
2. Mount and manually copy AI Trainer for Garmin Connect.app to an explicitly chosen Applications destination. Separately approved replacement requires quitting owners and preserving prior compatible app/backups. No release helper installs/opens it.
3. Unsigned software may be refused. Use normal per-app OS controls only if trusted; never globally disable Gatekeeper, strip quarantine, change trust, grant automation or acquire certificates to force launch. Policy refusal needs an approved distribution path.
4. Eject normally; launch only when authorized, then [native setup](settings.md#first-run-and-settings). Private settings are plaintext and originals remain preserved; [adoption](desktop.md#explicit-private-state-adoption) owns details.

Developer synthetic evidence is not clean-machine/minimum-OS/Gatekeeper/singleton/trusted-input/real-service certification. App removal preserves external DBs/backups/settings/tokens/tools; no cleanup script or automatic deletion.

## Existing database upgrades and recovery

Retain prior compatible app/source/settings and a verified WAL-aware backup. Download users need clean source at the release commit, `npm ci` and CLI prerequisites. Maintenance uses explicit approved canonical process-env DB, never Settings/Keychain discovery.

1. Stop/verify every writer, preserving unknown/live leases. Online-backup committed WAL and verify integrity/schema/FKs; never independently copy live main/sidecars. Rehearse on an authored or authorized populated copy in registered disposable storage, not a filename-based ownership claim.
2. Run on the rehearsal from matching source:

```bash
DATABASE_PATH="$REHEARSAL_DB" npm run db:status -- --json
DATABASE_PATH="$REHEARSAL_DB" npm run db:migrate
DATABASE_PATH="$REHEARSAL_DB" npm run db:status -- --json
```

Migration refuses dotenv/relative targets, acquires writer lease and exclusively online-backs-up old/populated data to sibling `backups/trainer-schema-backup-*.sqlite`, verifying before DDL. Current populated data may also receive a backup. Failure retains originals/partial outputs, never blind retry. Status is readonly/non-serving, not smoke proof.

3. Verify integrity/FKs/schema/data preservation and compatible app behavior. Separately approve actual stopped target/cutover/migration/reopen. Startup/Use existing never migrate.
4. Restore the compatible pre-upgrade app/DB/settings pair first to a fresh exclusive disposable target, or use a forward fix. Never downgrade, force old writers, overwrite newer settings/writes or blindly copy back. Preserve/reconcile newer work with its owner; versioned catalog/settings compatibility is independent.

Current 0.1.4 moves schema 28→30; saved history stays offline, future Sync needs the official Personal API key. Keep the schema 28 app/backup/settings recovery pair; extra-data/snow backfill remains separate, not startup/install behavior. Earlier transition details remain in immutable release notes, not current procedure. Windows source-CLI migration remains unqualified.

Release tooling changes no schema/data/sync semantics, so its production back-sync is a no-op. Deterministic maintenance tests prove copy/refusal/preservation seams, not primary or real-service qualification. Keep path-bearing output private.
