# macOS ARM64 release runbook

**[0.1.1 is published](https://github.com/codexa-bh/ai-garmin-trainer/releases/tag/v0.1.1)** as the initial stable macOS ARM64 release (prerelease=no, Latest=yes at publication). Exact source/artifacts and residual risks received release-specific operator approval; that approval does not extend to another cut. Source builds remain supported. Only macOS Apple Silicon is targeted; the declared minimum macOS 12.0 is not minimum-OS certification. There is no updater, installer hook, service, login item or background release worker.

## Published 0.1.1

Published on 2026-11-13 at [v0.1.1](https://github.com/codexa-bh/ai-garmin-trainer/releases/tag/v0.1.1). Anonymous release/Latest pages and complete downloads were verified. The immutable selected source is [`60ba04ecc9b7c26f483f17d87c69a621f77ad9f4`](https://github.com/codexa-bh/ai-garmin-trainer/tree/60ba04ecc9b7c26f483f17d87c69a621f77ad9f4).

| Asset                                                                                                                                                              |     Bytes | SHA-256                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------: | ------------------------------------------------------------------ |
| [Garmin-Trainer-0.1.1-macos-arm64.dmg](https://github.com/codexa-bh/ai-garmin-trainer/releases/download/v0.1.1/Garmin-Trainer-0.1.1-macos-arm64.dmg)               | 394339362 | `a40de4da1642c5c1cca5a4f6c1cffd93b6df9c6ae0de8a570a215a368969c5db` |
| [Garmin-Trainer-0.1.1-macos-arm64.dmg.sha256](https://github.com/codexa-bh/ai-garmin-trainer/releases/download/v0.1.1/Garmin-Trainer-0.1.1-macos-arm64.dmg.sha256) |       103 | `6628e486c2cb599e9c5129702f5c92b9c46233fc0721813b42b238507e581641` |
| [release.json](https://github.com/codexa-bh/ai-garmin-trainer/releases/download/v0.1.1/release.json)                                                               |      1001 | `e9cfea93ce2f93ea55cd70dd5266792bc9c994970811291461a3f6c5c84ae813` |

This DMG passed final-payload verification, 108 locked native tests, full isolated two-instance authored-synthetic ordinary smoke and separate exclusion/denial coverage; all 12 required masked captures were inspected. It is **unsigned/linker-ad-hoc and not notarized**, with no verified publisher. Dependency findings, source-reconstruction limits and untested clean-machine/minimum-OS/Gatekeeper/real-service cases remain as disclosed in its approved notes; this is not security, legal or integration clearance.

The approved source notes/public body retain `Status: prepared` as the historical metadata contract, not a statement of live GitHub visibility. They and all three assets remain unchanged. Later `main` updates, including the draft-observation helper correction, are not part of the binary's source identity. Downloading does not authorize installation, database migration or replacement of an existing app.

## Version and notes

`package.json` → `version` is canonical. `npm run release:check` checks the root npm lock/version, root crate Cargo manifest/lock, Tauri version and `release-notes/<version>.md`. The selected numeric version is **0.1.1** with `Status: prepared` notes; 0.1.0 remains unreleased foundation history, not an earlier download. No dependency versions are changed by metadata preparation.

Metadata preparation is local, requires clean source and produces an ordinary reviewable PR diff, not a release:

```bash
npm run release -- prepare --version "$VERSION" --notes "$REVIEWED_BODY"
# Only with separately approved cut authority:
npm run release -- prepare --version "$VERSION" --notes "$REVIEWED_BODY" --execute
npm run release:check
```

Use an unused SemVer (optional explicit prerelease; no build metadata), never a tag or path as the version. The helper preserves the old version's notes and adds signing/upgrade/rights warnings. Review all generated changes, then deliver/merge through the normal feature PR route. `Status: prepared` means notes prepared, not published or approved. Tests use temporary fixture repositories. Real preparation/publication belongs only to its explicitly scoped release task.

## Build versus downloaded runtime

Builders need macOS ARM64, Xcode/Command Line Tools, Rust/Cargo, Node 22+/npm, Python 3 for the local helpers, locked dependencies and network for pinned build inputs. Packaging needs built-in `hdiutil`, `ditto`, `lipo`, `codesign` inspection and Git. Future remote operations also need operator-managed authenticated `gh` with the appropriate repository rights. Never acquire credentials or change permissions to bypass a refusal.

Downloaded ordinary use needs **neither system Node, Rust nor a source checkout for normal launch**: Node 22.23.4, Next and native SQLite are bundled. Integration-specific external tools remain separate: native Garmin sign-in needs uv and installed Python 3.12; Sync uses uvx and compatible Python >=3.10 for the pinned connector; FIT helpers use uv/Python 3.12 when requested. Optional Ollama needs its separately managed daemon/model. The app does not install these tools, start Ollama or download models. Offline saved data does not require Garmin tools. A provider request needs separately configured access/funding/network; no real service is certified by synthetic smoke.

**Existing DB upgrades are an advanced exception:** matching source and its CLI dependencies are still necessary; see [upgrade/recovery](#existing-database-upgrades-and-recovery). There is no standalone migrator or in-app upgrade.

## Local build, package and verify

For developer artifact evidence, build in a supported task worktree and use the actual physical canonical paths returned by task tooling, not source aliases. Keep each worktree's build state independent. `$SCRATCH` is the canonical private task scratch root allocated by `task-scratch`, not its evidence/disposable child. Managed packaging allocates bulk in registered disposable and diagnostics in evidence; outputs survive immediate completion and remain subject to scheduler retention. It does not remove worktrees or historical scratch.

```bash
npm ci
npm run release:check
npm run desktop:build
# BUNDLE = canonical physical .../src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Garmin Trainer.app
npm run release -- package --scratch "$SCRATCH" --bundle "$BUNDLE" --execute
# RECORD = the exact release.json printed by package; do not select a different image
npm run release -- verify --scratch "$SCRATCH" --bundle "$BUNDLE" --record "$RECORD"
npm run smoke:ordinary -- --scratch "$SCRATCH" --task-id "$TASK_ID" \
  --bundle "$BUNDLE" --release-record "$RECORD"
npm run desktop:test:native
```

Package never rebuilds, launches, signs, installs or rewrites the producer. It holds the original ordinary preparation lock, verifies its v2 stamp/context/inventory, exclusively allocates staging and runs `ditto` plus `hdiutil create` without overwrite. The image contains **only Garmin Trainer.app** (no Applications alias or Finder automation). The finalized compressed DMG is mounted read-only, with no auto-open/browse, then checked against the producer's complete bytes, directory/file modes, xattrs, app ID/version, ARM64 native app/Node/SQLite, resource provenance and required notices/private exclusions. It reports unsigned/linker-ad-hoc, not a Developer ID identity. No certificate, trust, notarization or quarantine operation occurs.

`release.json` binds exact Git/source dirty state, original build source/context/inventory, full metadata identity, notes hash and final DMG name/size/SHA-256. The adjacent `.dmg.sha256` and public compact record are the only auxiliary assets. The record contains no local paths/environment. Development dirty artifacts are honest local evidence, **ineligible for remote release**. A dirty-built artifact cannot become release-qualified merely by committing later.

The optional ordinary `--release-record` is a finite handoff, not imported-artifact trust: it keeps revalidating the legitimate original stamped producer under its existing lock, rechecks the final DMG digest and mounted payload before every boot/final settlement, copies that payload with unchanged modes/xattrs into the usual isolated roots, and preserves ordinary native admission. No stamp is rebound, no arbitrary caller `verified` claim is accepted, and failure never falls back to the producer. Full two-instance authored-synthetic navigation, Goals save/restart/preservation, denials, masked wide/narrow captures and owned settlement remain unchanged. Inspect every required capture. Debug/probe/static success cannot replace final-payload smoke.

Only exact owned mounts are detached, never forced. Mount intent/observations are saved beside the verification allocation. Failure/timeout/cancellation retains artifacts and unknown effects; inspect those exact mounts/receipts before separately choosing recovery. Never blindly repeat create/attach/upload or delete an ambiguous mount/output. No output is overwritten. Preserve the original failure and useful compact diagnostics in evidence before expiry.

## Exact-source release and GitHub operations

These commands are **not authorized by tooling delivery or prepared notes**. Every cut needs current exact-source/artifact and residual-security approval **before tag, draft, upload or publication**. The published 0.1.1 record above describes that delivered cut, not permission for future effects. Retain task/PR/protection and human gates. Review all [redistribution conditions and packaged source material](redistribution.md) before binary publication. No tag-push workflow publishes anything.

Fetch main, record a full 40-character reviewed merged SHA, and create/verify the clean canonical release task worktree at exactly that SHA. `origin/main` must contain it; a later main tip alone never substitutes another release commit. Inspect incoming/local/dependency/toolchain impact, run the required tests/native/artifact smoke, and preserve evidence. The helper refuses a different HEAD, remote, untracked/deleted/dirty inputs or unprepared notes. It checks source again before each remote effect, after build and after remote work. Future release builds also perform a read-only GitHub preflight: conflicting tags or any existing release/draft refuse building; reconcile and reuse the already selected artifact instead of rebuilding during recovery.

```bash
git fetch origin main
# COMMIT, VERSION, REPO and channels are explicit reviewed inputs, not inferred defaults
# REPO must be codexa-bh/ai-garmin-trainer
npm run release -- build --repository "$REPO" --commit "$COMMIT" --version "$VERSION" --scratch "$SCRATCH" --execute
# Package/verify/smoke the resulting ordinary producer using the local commands above.
# Store RECORD/DMG/checksum unchanged. Build is never repeated by draft/publish.
npm run release -- status --repository "$REPO" --commit "$COMMIT" --version "$VERSION" \
  --scratch "$SCRATCH" --bundle "$BUNDLE" --record "$RECORD" --prerelease no --latest yes
# Plan only: even draft/publish omit all mutations unless --execute is supplied.
npm run release -- draft --repository "$REPO" --commit "$COMMIT" --version "$VERSION" \
  --scratch "$SCRATCH" --bundle "$BUNDLE" --record "$RECORD" --prerelease no --latest yes
```

After actual scoped release approval, add `--execute` to **draft** only. It creates an immutable lightweight `v<version>` ref at the verified SHA, then a draft, then uploads the exact selected DMG, checksum and compact `release.json`. It observes exact state after each effect. Existing exact partial state may be explicitly resumed after read-only reconciliation; conflicting/annotated tags, duplicate/extra/incomplete/different assets, changed body/channel or unknown/provider failures refuse. No force push, tag move, asset clobber, replacement/deletion, rebuild or permission automation exists.

GitHub may return 404 from release-by-tag for an existing authorized draft. The helper then reads a bounded complete release list and the unique exact-tag draft's ID; absence, ambiguity, truncation, changed ID, contradictory published state or transport refusal never grants creation/retry authority. Both build preflight and release observation use this route, so hidden drafts still prevent rebuilding and can be explicitly reconciled without duplicate creation.

**Publication is separate**: repeat the same inputs with `publish` and independently approved `--execute`, selecting `--prerelease yes|no` and `--latest yes|no` explicitly. A prerelease version requires prerelease=yes and latest=no. Stable versions require prerelease=no; choosing latest is still explicit. Publication verifies tag target, draft/body/warnings, complete exact asset set, each size/digest (bounded download/hash fallback when provider digest is absent), and unchanged local bytes before PATCH. Matching already-published state is only an observation, never republished. The checksum is integrity evidence, not authentication of the publisher.

Every remote invocation prints a private evidence journal path before effects. Mutations are recorded as **unknown until reconciled** before issuing the request; timeout, auth/network failure, cancellation or lost publication response is not rollback. Do not blindly retry. Preserve journal and original error, then use `status` with the same inputs to observe exact tag/ref/release/asset IDs and hashes. A matching outcome is observed, conflicting state requires an owner decision, unavailable state stays unknown. No automatic closer/remote retry worker exists. Public GitHub release bodies include reviewed notes plus source, signing caveat and digest, never whole scratch, private paths, DBs or screenshots. All foundation remote tests are mocked, not provider certification.

## Manual download and app placement — only after an actual authorized release

1. Check the exact repository/tag/source and signing/rights/upgrade warnings. Download its DMG and checksum; in their directory run `shasum -a 256 -c Garmin-Trainer-<version>-macos-arm64.dmg.sha256`. A checksum hosted beside a download does not authenticate its publisher.
2. Mount that DMG and manually copy **Garmin Trainer.app** to an explicitly chosen Applications destination. Quit existing owners before any separately approved replacement; preserve a prior compatible app and backups. No helper here installs, opens or replaces the operator app.
3. Unsigned/non-notarized software can trigger Gatekeeper warnings or be refused by macOS/organizational policy. Review the particular app through normal per-app OS security controls only if you trust it. Do not globally disable Gatekeeper, strip quarantine, change system trust, grant automation permissions or acquire certificates merely to make it open. If policy refuses, stop and obtain an approved distribution path.
4. Eject the image normally. Launch only when authorized, then follow [native Settings setup](../README.md#2-enter-settings). Settings are owner-private **plaintext**, not encryption; same-user/privileged processes and backups can read them. Never share keys/tokens/settings. Originals are preserved, not imported/deleted. See [desktop adoption](desktop.md#explicit-private-state-adoption).

No clean-machine/minimum-OS/Gatekeeper/normal-singleton/trusted-input/real-service certification follows from a developer-machine isolated synthetic artifact pass. Removing the app preserves external DBs, backups, versioned settings, tokens and independently managed tools. There is no cleanup/uninstaller script or automatic data deletion.

## Existing database upgrades and recovery

**Before switching a populated DB to a new build:** retain the old compatible app/source identity, original settings and a verified WAL-aware backup. Download users must obtain a clean checkout **at the release's recorded commit** and run `npm ci` with builder/CLI prerequisites. Source CLI tools deliberately do not read native Settings or Keychain. Explicitly select the canonical approved DB path in the process environment; never discover private paths or copy keys from Settings for this procedure.

1. Quit all writers and verify exact ownership; preserve unknown/live leases rather than deleting them. Obtain a consistent SQLite online backup (including committed WAL state), verify integrity/schema/foreign keys, and retain it privately. Never independently copy a live main file and its sidecars. Rehearse first on a fresh authored/disposable or authorized WAL-consistent populated copy in registered disposable storage; a filename containing `backup` alone grants no ownership.
2. Against the **rehearsal target**, from matching source:

   ```bash
   DATABASE_PATH="$REHEARSAL_DB" npm run db:status -- --json
   DATABASE_PATH="$REHEARSAL_DB" npm run db:migrate
   DATABASE_PATH="$REHEARSAL_DB" npm run db:status -- --json
   ```

   The migration command requires an explicit canonical absolute path in process env, never dotenv. It acquires the writer lease and creates an exclusive private sibling `backups/trainer-schema-backup-*.sqlite` for existing old/populated data, uses SQLite online backup, verifies integrity/schema/FK, then migrates. Preserve original/backup/partial output on failure; no blind retry. A current populated DB may also receive a recovery backup. `db:status` is non-serving readonly maintenance, not upgrade or smoke evidence.

3. Verify upgraded copy integrity/FK/schema and preserved high-level original data, then exercise the compatible app on that copy. Obtain separate explicit approval for the exact actual target and stop/cutover/migration/reopen. Repeat the reviewed procedure only on that approved stopped target. Foundation delivery grants none of those operations. Native startup and **Use existing data never migrate**: an old/unsupported DB refuses until explicitly prepared.
4. Recovery is a **prior compatible build plus its compatible pre-upgrade DB/settings**, or a forward fix. Verify backup via readonly status/integrity and restore only to a new exclusive disposable target first. Never downgrade a DB, overwrite newer settings/writes, blindly copy a backup back, delete originals or force an old build onto new state. If newer writes exist, preserve both versions and reconcile them with the owner before choosing recovery. A rollback backup is earlier data, not authority to discard new work. Use native Settings to select only a compatible explicitly approved stopped target; account for versioned plaintext settings/catalog compatibility separately.

The release foundation changes no schema, normalized data shape or sync/backfill semantics: production back-sync is a no-op. Deterministic maintenance regressions exercise explicit targets, old populated schema backup/preservation, refusal and compatible copy restore; synthetic ordinary smoke proves only its stated artifact scenario. Keep path-bearing CLI output private. No primary data or real provider/Garmin access is needed to validate this foundation.
