# Redistribution review — foundation, not approval

**Future binary publication remains gated.** Public source availability, package-license metadata, this review and generated notices do not grant redistribution rights. Do not select a project license or publish a binary to resolve missing authorization.

## Inspected owners and shipped material

- No root project LICENSE/COPYING/NOTICE is supplied at the foundation baseline. An owner must establish rights for the first-party TypeScript, Rust, UI/assets and bundled Python helpers before binary distribution. Public GitHub visibility is not a license grant.
- `runtime-inputs.json` pins the official Node 22.23.4 Darwin ARM64 archive and checksum. Assembly copies its **actual LICENSE** to `NODE-LICENSE.txt`; it includes Node and bundled third-party notices, not just the npm package name. Preserve/review that complete text for the selected archive.
- Assembly copies the complete production Next package and traced standalone dependencies, native better-sqlite3 and bundled runtime/Zod. `THIRD-PARTY-NOTICES.txt` enumerates non-dev npm lock entries with versions and declared licenses, intentionally a conservative superset, not a verified list of every shipped object. Installed better-sqlite3 and React include LICENSE files; Next supplies `license.md`; completeness of notices for its bundled/compiled transitive code is unverified. Trace omission and embedded/bundled dependencies require a release-time check of the **actual app inventory and notice texts**. Package metadata alone is insufficient, particularly for native SQLite, sharp/libvips and Next compiled dependencies.
- The native app statically links the Cargo.lock closure, including Tauri (Apache-2.0 OR MIT), dialog/single-instance plugins, serde, sha2, uuid, libc, ctrlc and macOS objc2/block2. The short generated Tauri attribution is **not a complete Rust license/NOTICE corpus**. Review the selected locked source licenses and embed all required notices/texts before binary publication. Do not call a successful Cargo build a license audit.
- The actual packaged helper sources are the five `garmin_token_location`/FIT helpers plus `garmin_auth.py` and its uv lock. Python, uv, the pinned stdio Garmin connector and `garminconnect==0.3.2`/FIT packages are acquired separately on explicit use, not bundled Python distributions. Their upstream license/API/usage obligations still need review for the intended distribution/integration. No Garmin endorsement or official OAuth approval is implied.
- Apple frameworks/system tools are external platform prerequisites, not copied installations. No certificate/key or trust profile is redistributed.

## Required future owner decisions

1. Establish first-party project/asset redistribution authority; retain actual owner/legal source, not an agent-selected license.
2. Audit the selected final artifact against pinned Node/npm/native/Rust/helper source licenses, required copyright/NOTICE texts and attribution/source-offer conditions. Add missing texts to assembly through reviewed source changes, rebuild and reverify. Current generated notices expressly disclose incompleteness; **do not publish this foundation artifact as legally cleared**.
3. Independently approve public binary visibility, exact version/source/channel and unsigned/non-notarized limitations, plus ordinary task/protection/release gates. No foundation test, source merge or lifecycle Done supplies that approval.

Local packaging and isolated synthetic evidence may proceed without inventing legal certification. The [release runbook](release.md) separates those observations from future draft/upload/publication authority. Preserve actual final notices and resource-inventory hashes in compact local evidence; do not upload private diagnostics or whole scratch.
