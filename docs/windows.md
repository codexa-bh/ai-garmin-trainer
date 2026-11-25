# Windows x64 alpha

The last Windows x64 alpha is [v0.1.4](../../../releases/tag/v0.1.4), with its original _Garmin Trainer_ installer name. Latest is macOS-only 0.1.5 and contains no Windows installer. Windows is experimental and outside supported macOS ARM64. Qualification is **hosted Windows Server 2025 x64 only**: not Windows 11, Windows 10 or ARM support. ARM runner availability is not testing.

The mechanisms and build instructions below describe current `x86_64-pc-windows-msvc` source, including the renamed unsigned per-user NSIS installer, not a newly published or currently qualified Windows build.

## What is the same

[Desktop](desktop.md) owns the private single-user Tauri/loopback Next/Node/SQLite product. Schemas/defaults/formats are shared; no automatic cross-machine data transfer. Settings/keys/tokens are owner-private plaintext, not encryption against same-user/admin processes or backups. Integrations remain separately configured.

## Windows mechanisms

- **Private state:** handle-relative no-reparse opens, pinned parents/file-ID identity, exclusive creation and identity-checked deletion. New objects get protected current-user/SYSTEM DACLs; insecure/foreign existing objects refuse, never repair. Renames replace only when authorized; current-user directory locks release on exit.
- **Paths:** canonical local drive-letter paths only. Refuse UNC/network/device/relative-drive paths, slash spellings, alternate streams, reserved names, trailing dots/spaces and case/8.3/junction/subst aliases.
- **Processes:** start suspended inside kill-on-close Job Objects. Quit drains via the liveness pipe then ends the owned tree; host death causes backend lease settlement and tree exit. Never stop by name, port or parent PID. Child PATH is the system directory; Garmin requires no external Python/uv/uvx.
- **Writers:** canonical leases span aliases/case; an exclusive no-sharing probe refuses other open DB owners.
- **ChatGPT:** a private pipe sends the official URL to native route validation and `ShellExecuteExW`. The app creates no shell/argument/env/file carrier, but Windows passes the URL on the default browser's own command line. Usage uses the same fixed opener.
- **UI:** File → Settings/Exit; native WebView2 Ctrl+Z/Y/X/C/V/A, without a clipboard proxy. Activity images use installed Segoe UI/Consolas; missing fonts fail, never download/bundle. Legacy macOS Keychain adoption refuses with private re-entry guidance and preserved originals.

## Build from source (Windows x64 host)

Install Git, Node 22/npm, Python 3.12 (`python`), Rust 1.98/MSVC with Visual Studio C++ tools, 7-Zip in `Program Files\7-Zip`, and WebView2 Runtime.

```powershell
$env:PYTHONUTF8 = "1"
npm ci
npm run desktop:build
```

Native-host only: pinned Node 22.23.4 archive verification, in-memory Node/SQLite ABI probe and locked app build produce `src-tauri\target\x86_64-pc-windows-msvc\release\bundle\nsis\AI Trainer for Garmin Connect_<version>_x64-setup.exe`. Identity binds platform/source/dependencies/toolchain/inventory, installer and extracted payload. Neither host produces/verifies the other's platform.

## Unsigned per-user installer

Installs without elevation under `%LOCALAPPDATA%\AI Trainer for Garmin Connect`, with shortcuts/uninstaller but no service, startup entry, updater or login item. SmartScreen may warn/refuse: do not disable protections or bypass trust. Missing WebView2 stops before installation; the installer never downloads it.

Uninstall preserves DB/settings/tokens in `%APPDATA%\com.codexa.garmin-trainer.desktop`; the stock delete-data option is removed. Program replacement preserves private state, but qualification covers only reusing the exact same-version installer after owned shutdown. Earlier/development-version upgrades and downgrades remain unqualified; silent/update downgrade refusal is a contract, not normal-use proof. **Windows existing-database migration via the source CLI is not qualified** because maintenance retains POSIX uid/mode assumptions. Startup never migrates.

## Package and verify without installing

```powershell
$REL = "$PWD\src-tauri\target\x86_64-pc-windows-msvc\release"
npm run release -- package --platform windows-x64 --execute --bundle $REL --scratch <private-scratch>
npm run release -- verify --platform windows-x64 --bundle $REL --scratch <private-scratch> --record <printed release-windows-x64.json>
```

Keep the build's npm environment; direct `release.py` context mismatches refuse. Package copies the stamped installer to `AI-Trainer-for-Garmin-Connect-<version>-windows-x64-setup.exe` and creates checksum/record, never rebuilds/relabels. Verify validates member names before owned 7-Zip extraction, then exact payload/x64 PE/resources/licenses/private exclusions. It never executes the installer. No macOS size budget applies.

## On-demand execution

`windows.yml` is manual-only and non-required in protection; PRs/pushes allocate nothing. Ubuntu Validate/macOS nightly triggers are unchanged.

```bash
gh workflow run windows.yml --ref <branch>
gh run list --workflow windows.yml --event workflow_dispatch --branch <branch> --limit 5
gh run view <run-id> --json headSha,event,status,conclusion,url
```

Default `release_export=false` omits binary export, **not qualification**. Explicit `-f release_export=true` selects the separate export below, not publication.

Before dependencies/Rust/resources/native builds, [rendered preflight](release.md#rendered-disclosure-preflight) checks `release-notes/windows-preflight.json`. It remains frozen at 0.1.4 after the macOS-only 0.1.5 cut, so the manual Windows job refuses current source before expensive preparation. A future explicitly scoped Windows cut must update its prior-release/source/schema context and review current Windows disclosures; never infer Windows qualification from Latest or weaken the guard. Unknown/contradictory context or missing disclosure refuses early; placeholders are not artifact identities.

Dispatch resolves once to immutable `github.sha`; checkout/HEAD/`TESTED_SOURCE` must match. Compare provider `headSha` with the intended head. Later branch pushes require a new explicitly requested run; absent automatic Windows checks are not green evidence.

## Installed-app scenario and narrow evidence exception

After build/package/verify/backend checks, `npm run smoke:windows` uses that exact verified installer/record. It refuses non-hosted/non-Windows, dirty/mismatched source, existing registration/program/app-data/shortcuts, aliases, changed payload or missing WebView2. NSIS uses `/S /NS /D=<exclusive-runner-program-directory>`, with `/D` last and unquoted, including spaces. Installer/uninstaller start suspended in an invocation-owned job; wait for all descendants, including the forwarded temporary uninstaller. Timeout settles only that job. Installed bytes must match the payload; only generated `uninstall.exe` is additionally admitted and inventoried.

The ordinary app uses schema-v2 admission, run-local ACL/file-ID/namespace owners, explicit settings/app-data/WebView/temp/DB roots and ownership stdin pipe. Never replace HOME/USERPROFILE or select normal singleton/settings. In-memory authored input drives actual hydrated Trainer/Sync/Profile navigation, controlled Goals Save, shutdown and fresh-boot restart/readback. Reject wrong-run/stale-boot access and preserve unrelated Profile fields.

Mandatory JS/file-publication and native input/settings/validator/backend preflights complement, never replace, installed/UI proof. Native tests use isolated unmodified resources outside checkout, canonical paths with spaces, GUI/no-console and private TEMP/TMP; source/tests own those mechanics. Node's equivalent DOS entry spelling changes no native resource identity or ownership check. Diagnostics expose fixed codes/booleans/counts only, never raw text/paths/private state; validator stderr is capped at 64KiB, classified then discarded. Failure probes never warm/retry admission. Settlement covers all owned WebViews, including hidden setup.

Six Trainer/Sync/Profile × wide 1280×850/narrow 420×850 logical own-WebView PNGs use `CapturePreview`, hide-by-default geometry masks and confirmed restoration before private publication. Native/image dimensions must agree; unsupported DPI refuses rather than stretches. Bounded PNG framing/CRC/deflate/filter/nonuniform-pixel checks do not replace individual inspection. Failure/timeout never publishes raw pixels.

After native/backend/WebView/endpoints/writer/namespace settlement, rerun the exact same-version installer. Verify unchanged payload, registration/shortcuts, synthetic DB/settings and app-data marker, then uninstall. Verify program/uninstall-registration removal, no `/NS` shortcuts and preserved synthetic state/marker. Stock `Software\codexa\AI Trainer for Garmin Connect` install-location metadata remains inventoried unchanged, not falsely reported deleted. Never adopt/delete unrelated state. Synthetic data expires with the runner; no primary access/copy-back.

**Upload exception:** successful complete scenarios alone may upload exactly six masked synthetic PNGs and one closed sanitized source/runtime/scenario manifest, explicitly named, with three-day requested retention. No binaries, DB/sidecars, settings/keys/tokens, descriptors/capabilities, raw/unverified captures or logs. Public-repository artifacts must be disclosure-safe; retention is not privacy or immediate erasure. Other images, including macOS, remain no-upload.

Download the exact run/attempt/source artifact via Actions, not a mirror; treat ZIP/manifest as untrusted:

```bash
python3 scripts/desktop/windows_smoke_evidence.py --archive <downloaded.zip> \
  --directory <new-task-evidence-directory> --source <40-char-tested-SHA> \
  --run <GitHub-run-id> --attempt <run-attempt>
```

The destination must be absent. Validate exact members/types/bounds before exclusive extraction, then manifest/identities/hashes/PNGs. **Open all six images individually** and retain source/run/boot/view/preset/hash plus textual layout/masking/defect findings before expiry. Missing/expired images need fresh evidence. Never commit/mirror them. Masked blanks conceal data; own-WebView pixels prove neither chrome/focus/trusted input nor real services. Current manifest schema 2 includes programReplacement; schema 1 remains historical, not new-candidate qualification.

## Explicit exact-candidate release export

`release_export=true` separately permits four public-safe files after native verification and the complete installed scenario: installer, `.exe.sha256`, `release-windows-x64.json` and `windows-release-export.json`. The closed v1 receipt binds source/run/attempt, installer/payload/member digests/sizes, scenario-manifest digest and passed outcomes. No private data or images. Artifact name binds run/attempt/full source; observe actual expiry despite three-day requested retention. This transports the exercised installer, never rebuilds/publishes it.

```bash
python3 scripts/desktop/windows_release_export.py download --source <SHA> \
  --run <id> --attempt <attempt> --artifact <id> --directory <fresh-canonical-task-destination>
python3 scripts/desktop/windows_release_export.py verify --source <SHA> --directory <destination>
```

The consumer checks live successful manual workflow/attempt/head/artifact, provider ZIP digest/size, exact safe bounded regular members, exclusive extraction and checksum/record/readback. Retain directory, sibling ZIP and import correlation: requalification compares current members with the live provider-attributed archive; editable receipt booleans confer nothing. Missing/expired/mismatched evidence refuses, never choose another run or rebuild after a tag. Foreign evidence is portable digests plus attributed native run, not local producer admission.

[Dual-platform release](release.md#dual-platform-candidate-and-publication-procedure) owns set assembly, original macOS admission, seven-asset publication and recovery. Receipt/import/ZIP/images are not release-set assets; download grants no installation/data authority.

## Proposed manual development feedback path (design only)

**No fast mode is implemented.** Both `release_export` values retain full qualification. Proposed `windows-dev.yml`, **Windows development feedback — nonqualifying**, is manual-only/non-required: no PR/push/schedule/workflow-call trigger. Bind immutable `github.sha` across checkout/HEAD/summary; use Server 2025 x64, existing pinned tools, contents-read, no secrets/services, fresh job state and only lock-keyed npm download cache. No shared writable build output/verification cache.

Proposed workload: toolchain facts, locked npm install, release/disclosure/identity/private-file/process tests, production resources/Node-SQLite probe, focused platform/ownership/renderer JS, locked native tests and synthetic packaged-backend smoke. Report actual stage/verdict/queue/runner times with failed/skipped/unavailable distinct; timeout stops rather than reducing coverage into success.

Omit release/NSIS build, producer/package/final-installer qualification and every installed scenario/image/record/set/export/import/publication stage above. No `release_export` input, upload, candidate/qualification output or minted successful installed manifest/record. Always state **Development feedback only — not release qualification**. Resources or development receipts cannot substitute for the full workflow's current final installer, source/run/attempt, strict download and individual image inspection; real services, normal onboarding/trusted input/chrome and Windows 11/ARM remain unqualified.

Before implementation, prove manual least privilege, immutable source, useful workload enrollment and refusal/absence of qualification/export routes. Release consumers reject this workflow, missing manifest and forged/copied claims. Integration observes honest failed/skipped summaries and qualification only from a separate full success. Design grants no implementation/dispatch authority.

## Evidence and deferred qualification

Rely on actual stage outcomes and individually inspected current-head captures, not build/backend-only health. The finite scenario uses no credentials/private services. Deferred: real Windows 11 per-user install/upgrade/uninstall/SmartScreen/WebView2/data preservation; native Settings/onboarding/menus/keys/focus/image labels; real provider/ChatGPT/Garmin access. Synthetic DOM actions are not OS input. The full ordinary macOS runner remains platform-specific; Windows has only the finite installed scenario above.
