# Dual-platform release runbook

**[0.1.4 is published](https://github.com/codexa-bh/ai-garmin-trainer/releases/tag/v0.1.4)** as stable/Latest (prerelease=no), with macOS ARM64 and **Windows x64 alpha** from one reviewed source. [0.1.3](https://github.com/codexa-bh/ai-garmin-trainer/releases/tag/v0.1.3), [0.1.2](https://github.com/codexa-bh/ai-garmin-trainer/releases/tag/v0.1.2) and the initial [0.1.1](https://github.com/codexa-bh/ai-garmin-trainer/releases/tag/v0.1.1) remain unchanged. Source builds remain supported. Windows qualification is Server2025 x64 CI-only; the declared minimum macOS12.0 is not minimum-OS certification. There is no updater, installer hook, service, login item or background release worker. macOS builds are **unsigned/non-notarized** and ship as a DMG, not a PKG; Windows alpha uses an unsigned NSIS installer.

## Published 0.1.4

Published 2026-11-23T10:26:55Z as [v0.1.4](https://github.com/codexa-bh/ai-garmin-trainer/releases/tag/v0.1.4), release 455261892. Binary source is [`02fd82fd9842e93402cdc88e7e2f387fb02d3fde`](https://github.com/codexa-bh/ai-garmin-trainer/tree/02fd82fd9842e93402cdc88e7e2f387fb02d3fde), merged [PR #255](https://github.com/codexa-bh/ai-garmin-trainer/pull/255) after [PR #254](https://github.com/codexa-bh/ai-garmin-trainer/pull/254) prepared the version and notes. Later documentation commits are not binary source. Anonymous API and HTML Latest, lightweight tag, exact body/channel, and all seven complete downloads were verified. Prior v0.1.1–v0.1.3 tags, bodies and assets were unchanged; all 13 prior assets were also downloaded and rehashed.

| Download                                                                                                                                              |     Bytes | SHA-256                                                            |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | --------: | ------------------------------------------------------------------ |
| [macOS ARM64 DMG](https://github.com/codexa-bh/ai-garmin-trainer/releases/download/v0.1.4/Garmin-Trainer-0.1.4-macos-arm64.dmg)                       | 132427592 | `089cf19cf0f07b7b576f85a98c70d13761810090ec50fa710f0ede4e665fbd92` |
| [DMG checksum](https://github.com/codexa-bh/ai-garmin-trainer/releases/download/v0.1.4/Garmin-Trainer-0.1.4-macos-arm64.dmg.sha256)                   |       103 | `410c1f580b59bea9446e205c11b5144878005ba3c6b7bed50fcbc318c7ab18d6` |
| [Windows x64 **alpha** installer](https://github.com/codexa-bh/ai-garmin-trainer/releases/download/v0.1.4/Garmin-Trainer-0.1.4-windows-x64-setup.exe) | 107228501 | `f63ddd038cad9bfa62f841c0f6413d0bdc061ac53326504b1bcbe234c8d6bd0c` |
| [Installer checksum](https://github.com/codexa-bh/ai-garmin-trainer/releases/download/v0.1.4/Garmin-Trainer-0.1.4-windows-x64-setup.exe.sha256)       |       109 | `7d816badd5eb950ce5687320504e754b3c88327c23c4622118cab9267d495672` |
| [release.json](https://github.com/codexa-bh/ai-garmin-trainer/releases/download/v0.1.4/release.json)                                                  |      1001 | `d076a813cf97ee8237a1b20fb84cff842b4147c3201281058c967a6d1e781550` |
| [release-windows-x64.json](https://github.com/codexa-bh/ai-garmin-trainer/releases/download/v0.1.4/release-windows-x64.json)                          |      1078 | `4f39cdb9ce48642dc248a550e058fa7d96b0845bb863af44e7d6a4eae406838f` |
| [release-set.json](https://github.com/codexa-bh/ai-garmin-trainer/releases/download/v0.1.4/release-set.json)                                          |      2999 | `ddcc7eebb75a4e5056e5ca1bfd7a193ee47df58716f5040f7f675ea243d7aea7` |

Notes SHA-256: `83ed7f5b4bd15a0272d1d822da52bf1150ebc019b708857483b347729dcdf24e`. Public body SHA-256: `057fe62aeedf579ba761300ea546e86c3d201f20be654fc7087feaf96d9f5c5b`. Both binaries are unsigned; macOS is non-notarized and Windows has no Authenticode verified publisher. Do not disable OS protection.

- **macOS:** final DMG payload, resource and notice verification passed within the 140 MB budget; 121 locked native tests passed. Full two-instance final-DMG synthetic navigation, Goals save and restart, conversation selector and denial coverage passed. Thirty masked wide/narrow captures were inspected; the Profile overlay covers navigation as intended. The separate release exclusion/denial smoke passed. No clean-machine, minimum-OS, Gatekeeper, normal singleton or trusted-input certification.
- **Windows:** [Server 2025 x64 run 45149572845, attempt 1](https://github.com/codexa-bh/ai-garmin-trainer/actions/runs/45149572845) verified the exact installed package, hydration, navigation, Goals save and restart, same-version replacement and preserving uninstall. Six masked images were individually inspected. See [Windows alpha limits](windows.md#published-014-evidence).
- **Dependencies and data:** npm production audit reported zero findings; 14 moderate dev-tool findings remained. The locked native `url` patch removes RUSTSEC-2026-0592 from the target inputs. The `cookie` advisory's affected private-cookie feature is not compiled for either target, and `chrono` had no active normal/build dependency edge on either target. This is not general security clearance. No account, real service, primary app, private data, migration or rollout was exercised.

## Published 0.1.3

Published 2026-11-18T16:57:37Z at [v0.1.3](https://github.com/codexa-bh/ai-garmin-trainer/releases/tag/v0.1.3), release 450283855, non-draft/non-prerelease and Latest. Binary source is [`c298ece763f32680b5237302a7e52b45761756ba`](https://github.com/codexa-bh/ai-garmin-trainer/tree/c298ece763f32680b5237302a7e52b45761756ba) (merged [PR223](https://github.com/codexa-bh/ai-garmin-trainer/pull/223)); later documentation commits are **not** binary source. Anonymous API/HTML Latest, lightweight tag target, exact body/channel and complete downloads of **all seven** assets were verified. Both checksums/records/set identities match. All six prior-release assets were also completely downloaded/rehashed, with their refs/bodies/IDs/digests unchanged.

| Download                                                                                                                                              |     Bytes | SHA-256                                                            |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | --------: | ------------------------------------------------------------------ |
| [macOS ARM64 DMG](https://github.com/codexa-bh/ai-garmin-trainer/releases/download/v0.1.3/Garmin-Trainer-0.1.3-macos-arm64.dmg)                       | 132484544 | `41a79291284707e7873ef23fe8b79938c20ae242356a53621d3da6f11daa2c8f` |
| [DMG checksum](https://github.com/codexa-bh/ai-garmin-trainer/releases/download/v0.1.3/Garmin-Trainer-0.1.3-macos-arm64.dmg.sha256)                   |       103 | `4aa87745f388279f514d91cd4dafdc8adc663664d23a498c8d35c74be5a05285` |
| [Windows x64 **alpha** installer](https://github.com/codexa-bh/ai-garmin-trainer/releases/download/v0.1.3/Garmin-Trainer-0.1.3-windows-x64-setup.exe) | 107170223 | `253094b37a3154956c86c0fcb09a4d9584d30e3e8beda5a538ceff1285560aed` |
| [Installer checksum](https://github.com/codexa-bh/ai-garmin-trainer/releases/download/v0.1.3/Garmin-Trainer-0.1.3-windows-x64-setup.exe.sha256)       |       109 | `f72edd6983636247a357281e826fbc0558fd64eee491f5896008ad83ace34cf4` |
| [release.json](https://github.com/codexa-bh/ai-garmin-trainer/releases/download/v0.1.3/release.json)                                                  |      1001 | `11014460165823193261b04f357c070d307baff14e845dbbb7ac3f663f8d57cf` |
| [release-windows-x64.json](https://github.com/codexa-bh/ai-garmin-trainer/releases/download/v0.1.3/release-windows-x64.json)                          |      1078 | `0ddc96606117ce782c2925eeb75f167dd290df454b06b84fd3f1a86992c0abfd` |
| [release-set.json](https://github.com/codexa-bh/ai-garmin-trainer/releases/download/v0.1.3/release-set.json)                                          |      2999 | `7da3f731716cc4fe32df2abd5c745b6e0252e50228cf4e1b57a1dcc25dfa4bb8` |

Public body SHA-256: `365ca878cfef84f34ab977106b8ddb8538c478549f50d054de5d04866a2df4df`. Notes SHA-256: `d84d443fb6dd6af999fa2a99a3eba74842f569ac438e35d87489100e66bdd0c6`. `Status: prepared` in immutable source notes is the historical metadata contract, not current GitHub visibility. Shared stable/Latest does **not** make Windows fully supported; the installer remains **alpha**. Both are unsigned; macOS is non-notarized and Windows has no Authenticode verified publisher. Do not disable OS protection.

### Exact-byte qualification and unavailable limits

| Surface                          | Passed evidence                                                                                                                                                                                                                                                                                        | Not certified                                                                                                                                                |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| macOS final bytes                | Complete DMG/payload/resources/notices/exclusions/modes/xattrs verification, 140M size budget; 121 locked native tests; full two-instance selected-DMG admission/navigation/Goals/restart/settlement; separate exclusion/denial                                                                        | Primary installation, normal singleton, clean machine, minimum OS, Gatekeeper/trusted input/menu/dialogs                                                     |
| Windows final bytes              | Native Server2025 x64 [run44340877109/attempt1](https://github.com/codexa-bh/ai-garmin-trainer/actions/runs/44340877109): package/payload verification, actual installed hydration/navigation/Goals/restart, exact same-version replacement/payload/registration preservation and preserving uninstall | Windows11/ARM/Win10, normal onboarding/Settings, trusted input/menu/dialogs, SmartScreen acceptance, older/dev-install upgrade                               |
| Included feature/lifecycle risks | Final-DMG two-week KPI Refresh/grid/restart, synthetic KPI chat write/read correction, actual keyless paused-summary lifecycle; fresh Create-new/Use-existing/Finish/restart and optional-limit save/clear; authored-stdio latest/history/cancel/discovery/mixed failure                               | Full KPI historical/period presentation, model/inference quality or real Garmin equivalence                                                                  |
| Visual                           | Twelve baseline and 69 selected feature/setup macOS captures plus six current Windows images individually inspected; Profile paint faithfully occludes navigation and visible controls wrap safely                                                                                                     | Redacted own-WebView pixels, not full chrome/unmasked private state. Technical details stay hidden; some scrolled/masked frames cannot prove unseen surfaces |
| Upgrade/recovery                 | Authored populated schema 27 active-WAL online copy → explicit matching-source CLI 28, backup/integrity/FK/preserved rows, older-source schema-28/newer-schema-99 refusal, compatible schema-27 restore/reopen in distinct target; original settings-v3 unchanged                                      | Windows source-CLI migration (POSIX maintenance assumptions), historical native-installer upgrade, DB downgrade/overwriting newer writes                     |
| Real integrations                | Unavailable: no private provider/ChatGPT/Garmin account/platform/budget route authorized; public CI stayed keyless                                                                                                                                                                                     | No login/MFA, private account discovery, paid requests or real Sync; synthetic outcomes are not service proof                                                |

Pre-freeze full validation passed 2977 Vitest tests (two existing skips), 419 desktop Python tests (four Windows-only skips on macOS), format/lint/type/architecture/CI contracts and production build; exact-head trusted Validate and manual Windows feedback preceded PR223 merge. Earlier different-byte feedback did not substitute final-package qualification. One outer-budget-interrupted synthetic-history invocation remains failed/unknown; after exact owned actor/mount reconciliation, a sufficient-budget fresh invocation passed with originals preserved. No assertion was weakened or candidate rebuilt for recovery. Successful invocations have independent preservation/settlement/disposition evidence; standalone/rehearsal/failed scratch keeps normal expiry, not cleanup authority.

Rights/notices, plaintext-state/prerequisite limits and fresh npm/target-native OSV/auth advisories are disclosed in [unchanged notes](../release-notes/releases/0.1.3.md). macOS needs manual app placement; Windows needs preinstalled WebView2 ([alpha limits and retained attribution](windows.md#published-013-evidence)). No primary app/settings/data activation, migration or copy-back occurred; production back-sync is a no-op. See the [repeatable procedure](#dual-platform-candidate-and-publication-procedure) and [compatible recovery](#existing-database-upgrades-and-recovery).

## Published 0.1.2

Published on 2026-11-14 at [v0.1.2](https://github.com/codexa-bh/ai-garmin-trainer/releases/tag/v0.1.2) from source [`08d2229e85037609868c9a44b4ecdf8b603fe2ef`](https://github.com/codexa-bh/ai-garmin-trainer/tree/08d2229e85037609868c9a44b4ecdf8b603fe2ef). Anonymous release/Latest facts, the lightweight tag target and complete downloads of all three assets were verified; v0.1.1 is unchanged.

| Asset                                                                                                                                                              |     Bytes | SHA-256                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------: | ------------------------------------------------------------------ |
| [Garmin-Trainer-0.1.2-macos-arm64.dmg](https://github.com/codexa-bh/ai-garmin-trainer/releases/download/v0.1.2/Garmin-Trainer-0.1.2-macos-arm64.dmg)               | 394242865 | `fb5910e30fd52eee0d1cab8423ae69f7b548dd279e1c7117a3f09fb27b74acc4` |
| [Garmin-Trainer-0.1.2-macos-arm64.dmg.sha256](https://github.com/codexa-bh/ai-garmin-trainer/releases/download/v0.1.2/Garmin-Trainer-0.1.2-macos-arm64.dmg.sha256) |       103 | `3e03c266f14261254a8bae2c03f2c6ad9a7d0624025b4d13244f1ab5e5fe8d1a` |
| [release.json](https://github.com/codexa-bh/ai-garmin-trainer/releases/download/v0.1.2/release.json)                                                               |      1001 | `ff5bfef19c7a84199fba354c986c7d7cdd4f411251c6df88475ce63b29a92e9f` |

The public body SHA-256 is `57d93b94d85675fd0e09c1752d859803b387387952f8377da4baf5efd27c1084`. The release is unsigned/linker-ad-hoc, not notarized, with no verified publisher. A same-source candidate with different bytes passed 108 native tests, full two-instance and Memory lifecycle launched runs, the chat-deletion scenario and exclusion/denial coverage; the published bytes were then rebuilt and verified (package/DMG/record/status) without repeating the launched runs, under the operator's artifact-only smoke decision. The schema moves from 26 to 27 (see [upgrades](#existing-database-upgrades-and-recovery)). Dependency findings and untested clean-machine/minimum-OS/Gatekeeper/real-service cases are as disclosed in its notes. Downloading does not authorize installation, database migration or replacement of an existing app.

## Published 0.1.1

Published on 2026-11-13 at [v0.1.1](https://github.com/codexa-bh/ai-garmin-trainer/releases/tag/v0.1.1). Anonymous release/Latest pages and complete downloads were verified. The immutable selected source is [`60ba04ecc9b7c26f483f17d87c69a621f77ad9f4`](https://github.com/codexa-bh/ai-garmin-trainer/tree/60ba04ecc9b7c26f483f17d87c69a621f77ad9f4).

| Asset                                                                                                                                                              |     Bytes | SHA-256                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------: | ------------------------------------------------------------------ |
| [Garmin-Trainer-0.1.1-macos-arm64.dmg](https://github.com/codexa-bh/ai-garmin-trainer/releases/download/v0.1.1/Garmin-Trainer-0.1.1-macos-arm64.dmg)               | 394339362 | `a40de4da1642c5c1cca5a4f6c1cffd93b6df9c6ae0de8a570a215a368969c5db` |
| [Garmin-Trainer-0.1.1-macos-arm64.dmg.sha256](https://github.com/codexa-bh/ai-garmin-trainer/releases/download/v0.1.1/Garmin-Trainer-0.1.1-macos-arm64.dmg.sha256) |       103 | `6628e486c2cb599e9c5129702f5c92b9c46233fc0721813b42b238507e581641` |
| [release.json](https://github.com/codexa-bh/ai-garmin-trainer/releases/download/v0.1.1/release.json)                                                               |      1001 | `e9cfea93ce2f93ea55cd70dd5266792bc9c994970811291461a3f6c5c84ae813` |

This DMG passed final-payload verification, 108 locked native tests, full isolated two-instance authored-synthetic ordinary smoke and separate exclusion/denial coverage; all 12 required masked captures were inspected. It is **unsigned/linker-ad-hoc and not notarized**, with no verified publisher. Dependency findings, source-reconstruction limits and untested clean-machine/minimum-OS/Gatekeeper/real-service cases remain as disclosed in its approved notes; this is not security, legal or integration clearance.

The approved source notes/public body retain `Status: prepared` as the historical metadata contract, not a statement of live GitHub visibility. They and all three assets remain unchanged. Later `main` updates, including the draft-observation helper correction, are not part of the binary's source identity. Downloading does not authorize installation, database migration or replacement of an existing app.

## Release cut runbook

The standard process for a routine version/notes cut, after the same four steps the Pivan epic uses. Source, dependency, workflow or packaging implementation changes follow their normal validation and PR workflow first; do not hide them in a cut. This routes to the owners below and adds no pipeline, cache or automatic stage advance. First-release setup (source/notice corpus, first-party MIT license, helpers) is settled and reused. A previous release's receipts, timings or summaries never qualify a new candidate.

### Four steps

| Step                      | Required outcome                                                                                                                                                                                                                                                                                                                   |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1. Check readiness**    | Record the exact current `origin/main` SHA, clean source and read-only provider tags/releases. Review the range since the previous tag against the readiness inputs below and refresh the dependency advisory evidence.                                                                                                            |
| **2. Cut and merge**      | Create a task worktree from that commit, check the rendered prospective body with explicit platform/baseline/schema context, then `prepare` with that same context. Run installed-tree-mutating checks (Vitest, `npm run validate`) now and deliver through a checked PR with exact-head hosted CI. Record the merged release SHA. |
| **3. Build and verify**   | Build once at the recorded SHA, package the DMG, and `verify` it with the printed record. Smoke is artifact-only: no launched ordinary smoke is required for a routine cut unless the app's behaviour changed.                                                                                                                     |
| **4. Publish and verify** | `status` and `draft` plan, then `draft --execute` and `publish --execute` with identical inputs. Verify the public release anonymously: Latest, tag target, body and all three asset digests. Reconcile docs by an ordinary PR and close the task.                                                                                 |

**Gates.** Authority for the cut comes from the operator's request for it; there is no separate residual-risk or tuple approval step. Failed checks or guardrails, unsafe or changed source or bytes, publication ambiguity, protection or review refusals, and missing credentials stop. Never bypass them, edit a stamp, or retarget a tag.

**No local app side effects.** A release never installs, opens or replaces the operator's app or changes system trust. Unsigned means no signing identity, no notarization and no PKG: the DMG is the only macOS binary asset.

**Platforms.** Artifact commands take `--platform macos-arm64|windows-x64`; the default keeps every existing command's macOS meaning. Each platform's artifact is built, packaged and verified only on its own native host. The [Windows x64 alpha path](windows.md) has Server-only CI evidence. A stable shared release does not make Windows fully supported; disclose unavailable Windows 11, trusted-input and normal-use qualification; see [dual-platform procedure](#dual-platform-candidate-and-publication-procedure).

**Readiness inputs.** `package.json`, `package-lock.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, `src-tauri/tauri.conf.json`, `scripts/desktop/runtime-inputs.json`, `scripts/desktop/redistribution-inputs.json`, `scripts/desktop/redistribution.py`, `scripts/desktop/assemble.mjs`, `docs/redistribution.md`, `.github/` and the local toolchain versions. An unchanged set means the settled [redistribution basis](redistribution.md) is reused and only the version mirrors differ; it never skips the assembler's notice and source checks or the advisory refresh. Unchanged lock versions can still have new advisories. Query the native crates in the macOS ARM64 build closure (`cargo metadata --filter-platform aarch64-apple-darwin`), not every lock-file crate, and record any wider result separately.

**Environment is bound.** The build stamp binds the process `PATH`, the npm environment and the installed `node_modules` bytes. Build, package, verify and every later step must run from one shell with an unchanged `PATH`; a resumed or restarted shell can change it, in which case the owners refuse and the candidate is rebuilt, never rebound. Vitest rewrites its cache inside `node_modules`, so run JavaScript tests at step 2, before the build. `cargo test` is a supported post-build check. Start any ad hoc script that must pass admission through `npm run`.

### Command reference

<details>
<summary>Expand exact commands and handoff details</summary>

Run the steps in one shell with a fixed `PATH`. `$SCRATCH` is the task scratch root, `$REPO` is `codexa-bh/ai-garmin-trainer`, and `$BUNDLE` is the physical canonical `src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Garmin Trainer.app` (not a symlinked alias).

```bash
# 1 readiness
git fetch origin main --tags && git rev-parse origin/main && npm run release:check
# 2 cut: see Version and notes, then PR, exact-head CI, checked merge; record COMMIT
# 3 build, package, verify
npm run release -- build --repository "$REPO" --commit "$COMMIT" --version "$VERSION" --scratch "$SCRATCH" --execute
npm run release -- package --scratch "$SCRATCH" --bundle "$BUNDLE" --execute
npm run release -- verify --scratch "$SCRATCH" --bundle "$BUNDLE" --record "$RECORD"
# 4 plan, then effects
npm run release -- status --repository "$REPO" --commit "$COMMIT" --version "$VERSION" --scratch "$SCRATCH" --bundle "$BUNDLE" --record "$RECORD" --prerelease no --latest yes
npm run release -- draft   ... same inputs ... --execute
npm run release -- publish ... same inputs ... --execute
```

**One handoff.** `status`, `draft` and `publish` print one `selectedTuple` line: repository, version, tag, full commit, notes and public-body SHA-256, channel flags, build identities and exactly three assets with name, size and SHA-256. It is recomputed from the inputs that invocation just requalified, is never stored or accepted as input by any command, and records no approval. Compare it with the public facts afterwards.

**Timings.** Each scratch-backed invocation writes a private `release-timing-<action>-<uuid>.json` in the evidence root and prints its path last: stage names, UTC stamps, monotonic durations, outcomes and error class names only. An `incomplete` record means the process was killed and the effect is unknown. Spans the helper cannot see (CI, waits, rework) are recorded by the operator. No duration is a target.

**Optional launched qualification.** When app behaviour changed, `npm run desktop:test:native`, `npm run smoke:ordinary -- ... --release-record "$RECORD"` and `npm run smoke:release` run isolated authored-synthetic launches against the packaged candidate; inspect every capture. They are not required for a routine cut.

**Public verification.** Without credentials, read the release by tag and Latest, the tag ref (lightweight, at the commit), the body hash, and download all three assets, hashing them against the tuple. Previous releases must be unchanged. Mismatches stop; never replace, delete or re-upload.

</details>

## Version and notes

`package.json` → `version` is canonical. `npm run release:check` checks the root npm lock/version, root crate Cargo manifest/lock, Tauri version, `release-notes/releases/<version>.md` and the syntax of every pending fragment in `release-notes/unreleased/`. The current source version is **0.1.4**, published above; `Status: prepared` is the historical metadata contract, not a statement of live GitHub visibility. 0.1.0 remains unreleased foundation history, not an earlier download. No dependency versions are changed by metadata preparation.

**Release notes are written per change.** Each change adds one fragment to `release-notes/unreleased/` (format, categories and the no-note marker: [release-notes/README.md](../release-notes/README.md)); nothing edits a shared Unreleased section. Before a cut, review what will be published:

```bash
npm run release:notes:check     # validate fragments; no effects
npm run release:notes:preview   # print the generated categorized text; no effects
```

Metadata preparation is local, requires clean source and produces an ordinary reviewable PR diff, not a release:

```bash
npm run release -- preflight --version "$VERSION" --notes "$REVIEWED_TEXT_FILE" --preflight-context "$CONTEXT"
# Inspect the rendered body before freezing source or starting any native build.
# Plans only and names the fragments it would promote; add --execute to write the diff:
npm run release -- prepare --version "$VERSION" --notes "$REVIEWED_TEXT_FILE" --preflight-context "$CONTEXT" --execute
npm run release:check
```

`prepare` validates the version, every mirror, every fragment and any supplied disclosure context before writing. Windows preparation (`--platform windows-x64`) requires the context and its Windows inclusion; legacy macOS-only callers without context retain their existing behavior, not a claim that the stronger disclosure check ran. It writes `releases/$VERSION.md` (Trainer heading, `Status: prepared`, the signing/upgrade/rights warnings, then the required fragments by category) and the owned version mirrors, re-checks the result and only then deletes the fragments it published. No-note markers and supporting files stay. A refusal leaves every input unchanged; if a write fails midway, inspect the partial diff with `git status` and restore it with Git, because pending fragments are never deleted ahead of success. With no required fragments the note states that no changes were recorded; routine cut bookkeeping is never a product entry.

To add reviewed wording, pass `--notes "$REVIEWED_TEXT_FILE"`: its text is placed before the generated changes and never replaces them. Edit a fragment instead when its own wording should change. Use an unused SemVer (optional explicit prerelease; no build metadata), never a tag or path as the version. The helper preserves earlier version notes. Review all generated changes, then deliver/merge through the normal feature PR route. `Status: prepared` means notes prepared, not published or approved. Tests use temporary fixture repositories. Real preparation/publication belongs only to its explicitly scoped release task.

### Rendered disclosure preflight

`npm run release -- preflight --preflight-context "$CONTEXT"` checks the current versioned notes. With an unused future `--version` it composes the prospective prepared notes from `--notes` plus all required fragments, exactly as preparation will. This is a cheap read-only local check: no native build, artifact, provider access, fragment consumption or source write. The JSON `body` is the actual publisher's macOS or release-set renderer with conspicuous unresolved source/digest placeholders. It is **not** a selected tuple, approval, provenance or release eligibility. Review the rendered text, not just the exit code. A notes, fragment or context change requires another check; executed preparation revalidates rather than accepting an earlier pass.

The explicit context JSON has exactly these fields (use the actual prior-release full source commit/version/schema, never inferred Latest or a guessed no-change):

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

Keep prospective context and reviewed text outside the clean checkout (for example in task scratch): executed preparation still refuses dirty input. After preparation, update the tracked Windows job context in the same cut diff before its PR. The baseline must be locally available and an ancestor of HEAD; its package version and source schema are read from that exact Git object. Current schema is read from `src/lib/db/migrations.ts`. Missing/unknown, unsupported platform, contradictory version/schema or downgrade contexts refuse. Fetch the explicit baseline before checking if absent. `release-notes/windows-preflight.json` is the maintained Windows job selection for the current notes, **not** an automatically selected release baseline; update it deliberately when preparing the next notes. It checks Windows only, not omitted macOS qualification.

Disclosure assertions are narrow literal, case-insensitive phrases (Markdown bold is ignored), not an NLP classifier of fragment prose. Include the following reviewed wording when applicable; free-form changes remain free-form and human review still owns contradictory or overstated support prose elsewhere:

- Windows: **Windows x64 alpha**, **no Authenticode verified publisher**, **Windows Server 2025 x64**, **not Windows 11, Windows 10 or ARM support**, and **nor qualification of trusted input, normal onboarding or real-service access**. An unsigned sentence must remain. Shared stable/Latest is not full-platform support.
- macOS: retain the generic unsigned/not-notarized warning, and **minimum macOS 12.0 is not minimum-OS certification**. These prospective requirements do not rewrite immutable historical notes or retroactively change legacy macOS records.
- Retain the generic matching-source CLI, stopped-owner, verified-backup, no-startup-upgrade and redistribution warnings.
- For changed schema, state exactly `Version <baseline-version> uses schema <old>; this release uses schema <new>.` Include **explicit database upgrade**, **prior compatible app**, **database backup and settings** recovery wording, and, with Windows, **Windows existing-database migration via the source CLI is not qualified**. These assertions concern the release-level transition, not intermediate migrations mentioned in fragments.
- With no schema change, explicitly state `No database schema change: <old> → <new>.` Unknown context is never no-change. Contradictory release-level transition declarations refuse.

No DB is opened or migrated. The check generates no unsupported support claim and does not turn source-CLI instructions into Windows qualification. Historical notes/assets stay byte-for-byte unchanged.

## Build versus downloaded runtime

Builders need macOS ARM64, Xcode/Command Line Tools, Rust/Cargo, Node 22+/npm, Python 3 for the local helpers, locked dependencies and network for pinned build inputs. Packaging needs built-in `hdiutil`, `ditto`, `lipo`, `codesign` inspection and Git. Future remote operations also need operator-managed authenticated `gh` with the appropriate repository rights. Never acquire credentials or change permissions to bypass a refusal.

Downloaded ordinary use needs **neither system Node, Rust nor a source checkout for normal launch**: Node 22.23.4, Next and native SQLite are bundled. The 0.1.4 downloads and builds from current source need **no Python, uv or uvx** for Garmin: access uses the official Personal API with a user-created key, and activity files are decoded in-process. (The published 0.1.3 artifacts predate this and still use the earlier unofficial connector with its external uv/Python prerequisites.) Optional Ollama needs its separately managed daemon/model. The app does not install tools, start Ollama or download models. Offline saved data does not require Garmin. A provider or Garmin request needs separately configured access/funding/network; no real service is certified by synthetic smoke.

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

**Size budget.** Package also writes a local `size-report.json` beside the record (DMG bytes, app logical bytes, and Node/runtime/Next/redistribution groups) and prints it. It is a review aid, not a release asset. A DMG above the accepted **140,000,000-byte** budget refuses before any record is written; the report is retained for diagnosis. The budget was accepted in T0333 against a measured 132,262,024-byte candidate (0.1.2 shipped 394,242,865 bytes). Raise it only by a reviewed change that includes the new measured breakdown.

`release.json` binds exact Git/source dirty state, original build source/context/inventory, full metadata identity, notes hash and final DMG name/size/SHA-256. The adjacent `.dmg.sha256` and public compact record are the only auxiliary assets. The record contains no local paths/environment. Development dirty artifacts are honest local evidence, **ineligible for remote release**. A dirty-built artifact cannot become release-qualified merely by committing later.

The optional ordinary `--release-record` is a finite handoff, not imported-artifact trust: it keeps revalidating the legitimate original stamped producer under its existing lock, rechecks the final DMG digest and mounted payload before every boot/final settlement, copies that payload with unchanged modes/xattrs into the usual isolated roots, and preserves ordinary native admission. No stamp is rebound, no arbitrary caller `verified` claim is accepted, and failure never falls back to the producer. Full two-instance authored-synthetic navigation, Goals save/restart/preservation, denials, masked wide/narrow captures and owned settlement remain unchanged. Inspect every required capture. Debug/probe/static success cannot replace final-payload smoke.

Only exact owned mounts are detached, never forced. Mount intent/observations are saved beside the verification allocation. Failure/timeout/cancellation retains artifacts and unknown effects; inspect those exact mounts/receipts before separately choosing recovery. Never blindly repeat create/attach/upload or delete an ambiguous mount/output. No output is overwritten. Preserve the original failure and useful compact diagnostics in evidence before expiry.

## Exact-source release and GitHub operations

These commands run under the operator's request for the cut (see Gates above); tooling delivery or prepared notes alone do not start one. Retain task/PR/protection gates. Review all [redistribution conditions and packaged source material](redistribution.md) before binary publication. No tag-push workflow publishes anything.

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

For an authorized cut, add `--execute` to **draft** only. It creates an immutable lightweight `v<version>` ref at the verified SHA, then a draft, then uploads the exact selected DMG, checksum and compact `release.json`. It observes exact state after each effect. Existing exact partial state may be explicitly resumed after read-only reconciliation; conflicting/annotated tags, duplicate/extra/incomplete/different assets, changed body/channel or unknown/provider failures refuse. No force push, tag move, asset clobber, replacement/deletion, rebuild or permission automation exists.

GitHub may return 404 from release-by-tag for an existing authorized draft. The helper then reads a bounded complete release list and the unique exact-tag draft's ID; absence, ambiguity, truncation, changed ID, contradictory published state or transport refusal never grants creation/retry authority. Both build preflight and release observation use this route, so hidden drafts still prevent rebuilding and can be explicitly reconciled without duplicate creation.

**Publication is separate**: repeat the same inputs with `publish` and `--execute`, selecting `--prerelease yes|no` and `--latest yes|no` explicitly. A prerelease version requires prerelease=yes and latest=no. Stable versions require prerelease=no; choosing latest is still explicit. Publication verifies tag target, draft/body/warnings, complete exact asset set, each size/digest (bounded download/hash fallback when provider digest is absent), and unchanged local bytes before PATCH. Matching already-published state is only an observation, never republished. The checksum is integrity evidence, not authentication of the publisher.

Every remote invocation prints a private evidence journal path before effects. Mutations are recorded as **unknown until reconciled** before issuing the request; timeout, auth/network failure, cancellation or lost publication response is not rollback. Do not blindly retry. Preserve journal and original error, then use `status` with the same inputs to observe exact tag/ref/release/asset IDs and hashes. A matching outcome is observed, conflicting state requires an owner decision, unavailable state stays unknown. No automatic closer/remote retry worker exists. Public GitHub release bodies include reviewed notes plus source, signing caveat and digest, never whole scratch, private paths, DBs or screenshots. All foundation remote tests are mocked, not provider certification.

## Multi-platform release sets

Published 0.1.1/0.1.2 are macOS-only and keep their single `release.json` (record `schemaVersion` 1, DMG, checksum); they are never rewritten. The dual-platform 0.1.3 release is described by a versioned `release-set.json` (`schemaVersion` 1):

- an explicit, nonempty, ordered `platforms` list (`macos-arm64`, `windows-x64`); omitted platforms are not present or certified;
- one canonical repository, full clean commit, version/tag and notes SHA-256 shared by every platform;
- per platform: its record name, target, original-source/build-source/build-context/inventory/payload identities, signing text (Windows: unsigned, no Authenticode; never "notarized") and every asset's exact name, size and SHA-256 (installer/DMG, checksum, record);
- `verification`: portable digests only.

Per-platform records (`release.json` for macOS, schema 1 or 2; `release-windows-x64.json`, schema 2 with `platform`) come from `package` and `verify` on each native host, where the original producer is re-admitted. `npm run release -- release-set --version "$VERSION" --scratch "$SCRATCH" --platform-record <record> [--platform-record <record>]` assembles a set anywhere by checking the exact bytes of those records and assets. That check is digest-only: it does not re-admit another host's producer and gives a copied record no producer authority. Mixed source/version/notes, duplicate or unsupported platforms, colliding asset names, changed bytes, malformed records and Windows "notarization" claims refuse. The existing publisher selects exactly the set's assets plus `release-set.json`, writes one body listing each platform's artifact digest and signing text, and keeps dry-run defaults, separate draft/publish, no overwrite or tag movement, and read-only reconciliation of unknown effects. The 0.1.3 set exercised the actual separate tag/draft/seven-upload/publication owners and complete anonymous downloads. Fake-provider refusal/unknown-effect tests remain separate from that provider result.

## Dual-platform candidate and publication procedure

The four-step macOS recipe above remains the legacy three-asset route. For a specifically authorized macOS ARM64 + Windows x64 **alpha** cut, both final packages require actual current-byte qualification, not routine-cut artifact-only smoke or historical images. Never rebuild after a tag/draft or substitute a later main tip.

1. Before version preparation or source freeze, run and inspect the rendered disclosure preflight above with both platforms and the actual prior-release baseline/schema, then prepare using the same context. Recheck the prepared notes and update the Windows job context. Complete reviewed tooling/version/notes PRs, exact-head trusted Validate and manually requested Windows feedback; select one full clean **merged** SHA. Refresh actual range, target-specific rights/notices/corpus, prerequisites and dependency findings. Run `npm run validate` before final native production (Vitest changes installed cache bytes). Record native toolchains/locks and keep the same npm/PATH context through build/package/verify/remote operations. Neither host may produce the other's architecture.
2. macOS: use exact-source `release build`, `package`, `verify` above. Run locked native tests, full two-instance final-DMG `smoke:ordinary --release-record`, affected feature smoke and separate `smoke:release`. Open every required current image individually, including wide/narrow Profile over navigation; masked layer painting must retain real occlusion. Check actual payload/resources/notices/private exclusions, signing profile and 140,000,000-byte budget. Preserve only owned mount/process/lease settlement; never force-detach or activate the operator app.
3. Windows: explicitly dispatch `windows.yml` at the selected reviewed ref with `release_export=true` (default is false). Require the observed immutable `headSha` to equal the frozen merged SHA, event workflow_dispatch, and successful final run/attempt. The job builds/packages/verifies natively, exercises the **same installer** in the actual installed app, captures six masked synthetic views with restoration, shuts down owned processes, replaces program files with that exact same-version installer, rechecks payload/registration/DB/settings preservation, then preserving uninstall/settlement. It exports the exact public-safe triple plus receipt separately from the six-image artifact; both request three-day retention. It does not publish a release. Retain the exact artifact IDs/expiry and download before runner/artifact expiry.
4. Transport from that exact successful run, using physical canonical task destinations. Do not select the newest run, wildcard download or trust archive filenames/receipt booleans. The consumer checks live workflow/run/attempt/head/artifact identity, provider archive digest/size, exact bounded regular ZIP members, exclusive extraction and all record/checksum/current-byte identities. Preserve its sibling ZIP: later requalification compares local members with that provider-authenticated archive, so a self-consistent edited record/receipt cannot forge native attribution. Foreign checks are **portable digests + attributed native run**, never native producer admission. Download the separate image artifact through its existing strict consumer and inspect all six images individually.

```bash
# Explicit dispatch only; compare actual run headSha with the frozen COMMIT.
gh workflow run windows.yml --repo codexa-bh/ai-garmin-trainer --ref "$REVIEWED_REF" -f release_export=true
# Select exact RUN / ATTEMPT / ARTIFACT from provider facts, not a latest-run guess.
python3 scripts/desktop/windows_release_export.py download --source "$COMMIT" \
  --run "$RUN" --attempt "$ATTEMPT" --artifact "$ARTIFACT" --directory "$WINDOWS_DIRECTORY"
python3 scripts/desktop/windows_release_export.py verify --source "$COMMIT" --directory "$WINDOWS_DIRECTORY"
# WINDOWS_RECORD = "$WINDOWS_DIRECTORY/release-windows-x64.json"
# SET_DIRECTORY is a new task-owned existing directory. The set is never overwritten.
npm run release -- release-set --version "$VERSION" --scratch "$SET_DIRECTORY" \
  --platform-record "$MAC_RECORD" --platform-record "$WINDOWS_RECORD"
# Keep original macOS producer admission, plus all seven current assets and Windows attribution.
npm run release -- status --repository codexa-bh/ai-garmin-trainer --commit "$COMMIT" --version "$VERSION" \
  --scratch "$SCRATCH" --bundle "$BUNDLE" --record "$MAC_RECORD" \
  --release-set "$SET_DIRECTORY/release-set.json" --platform-record "$MAC_RECORD" \
  --platform-record "$WINDOWS_RECORD" --prerelease no --latest yes
# Repeat IDENTICAL inputs with draft (plan), draft --execute, then publish --execute.
# status is read-only reconciliation; publication never rebuilds/retags/replaces bytes.
```

5. Before tag/draft, finish the coverage matrix: installation/startup/onboarding/persistence/program-replacement/uninstall, exact native/ordinary/debug/synthetic evidence, copy-only backup/migration/refusal/compatible restore for the selected schema transition, unchanged versioned settings, actual available integrations or exact unavailable access. Native contracts and DOM actions are not trusted input, normal onboarding or real-service certification. Windows source-CLI existing-DB migration remains unqualified due POSIX maintenance assumptions; same-version replacement does not qualify older-version upgrades. Keep originals/private account state untouched; no primary back-sync/activation follows.
6. Assemble/requalify the set and retain accepted release outputs under primary workspace artifacts, independently of runner/worktree expiry. Seven public assets only: macOS DMG/checksum/`release.json`, Windows installer/checksum/`release-windows-x64.json`, and `release-set.json`. The receipt/import/ZIP/images/logs are not public release assets. Notes/download labels say **Windows x64 alpha**; stable/no-prerelease/Latest applies to the shared GitHub release.
7. Use existing separate status/draft/publish owners. Every effect rechecks original local macOS admission, clean exact merged source/notes, entire stored set/current bytes and live Windows attribution. Dry run is the default. Record original unknown-effect journals, reconcile exact provider IDs/assets with status before an explicit resumed action; never blindly retry uploads, overwrite/delete assets, move/force a tag or rebuild as recovery. Authority for this cut comes from its task, not a receipt; no extra per-cut approval pause is implied, and actual failed guards/provider/private/scope gates still bind.
8. After publication, anonymously verify release and Latest, lightweight tag target, exact body/channel/source and **complete downloads of all seven assets**, both checksums/records and set/shared identities. API metadata alone is insufficient. Verify previous 0.1.1/0.1.2 tags/bodies/assets unchanged. Reconcile final runbook/download/result facts by checked docs PR; distinguish that later docs SHA from binary source. No operator installation, restart, trust change, private migration, rollout or worktree disposal is part of release publication.

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

**0.1.4 moves schema 28 (0.1.3) to 30.** The official Garmin Personal API replaces the old connector; saved history remains available offline, but future sync requires a Personal API key. Existing data requires the stopped, backed-up, matching-source CLI upgrade above. Historical Garmin extra-data and snow backfill are separate explicit operations, not startup or installation behavior. Keep the compatible schema-28 app, database backup and settings as the recovery pair. Windows source-CLI migration remains unqualified.

**0.1.3 moves schema 27 (0.1.2) to 28** by adding weekly recipe/measurement tables without transforming existing rows. Startup/Use existing refuse 27 until explicit migration, and 0.1.2 refuses 28. Rehearse the existing procedure on authored/disposable online copies and retain the pre-upgrade compatible 27 backup/build pair. Settings version 3 compatibility is independent; originals/legacy settings remain preserved. Windows source-CLI migration is not qualified: current maintenance code has POSIX uid/mode assumptions. This release grants no primary migration or Windows older/dev-install upgrade claim.

**0.1.2 moves the schema from 26 (0.1.1) to 27** ([details](cross-chat-summary.md#local-debug-revisions)): an additive change with no row transformation. A 0.1.1 database is refused by 0.1.2 until explicitly upgraded with the procedure above from the 0.1.2 release commit, and schema 27 is refused by 0.1.1; keep the 0.1.1 app and pre-upgrade backup as the recovery pair. Authored populated 26→27 regressions cover preservation, integrity/FK and idempotent reopen; no real database was used. Publishing a release upgrades no existing database: primary activation stays a separately approved, backed-up exact-target step.

The release tooling itself changes no schema, normalized data shape or sync/backfill semantics: production back-sync is a no-op. Deterministic maintenance regressions exercise explicit targets, old populated schema backup/preservation, refusal and compatible copy restore; synthetic ordinary smoke proves only its stated artifact scenario. Keep path-bearing CLI output private. No primary data or real provider/Garmin access is needed to validate this foundation.
