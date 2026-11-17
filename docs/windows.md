# Windows x64 build foundation

The source tree builds a **Windows x64 (`x86_64-pc-windows-msvc`)** desktop app and an **unsigned per-user NSIS installer** next to the existing macOS ARM64 app. This is a CI-tested build foundation, **not** qualified Windows 11 support: no Windows 11 machine has run the installer or the native app, and nothing has been released. Windows 10 and Windows ARM64 are not targets.

## What is the same

The app is the same private, single-user Tauri host with its owned loopback Next.js/Node/SQLite backend, native Settings/onboarding, separately managed integrations and explicit existing-data upgrade procedure ([desktop runtime](desktop.md)). Settings, provider keys and tokens remain owner-private plaintext files protected by OS access control (same-user and administrator processes and backups can read them; there is no encryption). Schemas, defaults and data formats do not change by platform, and no data moves between machines automatically.

## Windows mechanisms

| Concern                                        | Windows implementation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Private settings, database publication, tokens | Handle-relative opens that never traverse junctions/symlinks/reparse points; new private files/directories get a protected DACL for the current user and SYSTEM only (inherited by files later created inside); existing objects must be user-owned with no ordinary foreign access and are never repaired; file-ID identity; exclusive creation; renames of the held handle relative to the pinned parent (no-replace unless replacement is already authorized); identity-checked deletes; a per-directory current-user lock released on process exit. |
| Paths                                          | Local drive-letter canonical paths only (`C:\…`). UNC/network shares, `\\?\`/device paths, relative-drive, `/` spellings, alternate data streams, reserved device names, trailing dots/spaces and case/8.3/junction/subst aliases are refused.                                                                                                                                                                                                                                                                                                          |
| Owned processes                                | Bundled `node.exe`, helpers and tools start suspended inside a kill-on-close Job Object; their descendants cannot escape it. Quit closes the backend's liveness pipe (graceful drain), then the job ends the whole tree. If the host dies, the backend settles its database lease and exits, which ends the rest of the tree. Nothing is stopped by name, port or parent PID.                                                                                                                                                                           |
| Database writers                               | The canonical writer lease is shared across case/alias spellings, and a database open in another process is refused (an exclusive no-sharing probe replaces macOS `lsof`).                                                                                                                                                                                                                                                                                                                                                                              |
| Tools                                          | uv/uvx are found only at the official per-user locations (`%USERPROFILE%\.local\bin`, `%USERPROFILE%\.cargo\bin`) or an explicit validated absolute `.exe`; never through PATH, a shell, `.cmd` or `.bat`. Child PATH is the system directory only.                                                                                                                                                                                                                                                                                                     |
| ChatGPT sign-in                                | The helper sends the official authorization URL to the native host over its private pipe; the host re-validates the exact route and opens it with `ShellExecuteExW`. No app-created shell, argument list, environment or file carries the URL, but Windows then hands it to the user's default browser on that browser's own command line (OS behaviour). The usage page uses the same fixed opener.                                                                                                                                                    |
| Legacy Keychain adoption                       | macOS-only. On Windows it refuses and explains private re-entry; originals are untouched.                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Menus and editing                              | A **File** menu with **Settings…** and **Exit**. WebView2 keeps its native editing shortcuts (Ctrl+Z/Y/X/C/V/A); no clipboard/shortcut proxy is added.                                                                                                                                                                                                                                                                                                                                                                                                  |
| Activity image labels                          | Installed Segoe UI and Consolas from `%SystemRoot%\Fonts`; no fonts are bundled or downloaded. Missing fonts fail explicitly.                                                                                                                                                                                                                                                                                                                                                                                                                           |

## Build from source (Windows x64 host)

Prerequisites: Windows x64, Git, Node.js 22 with npm, Python 3.12 (`python`), Rust 1.98 with the MSVC toolchain (Visual Studio Build Tools "Desktop development with C++"), 7-Zip installed in `Program Files\7-Zip` (used to read, never run, the installer), and the Microsoft Edge WebView2 Runtime. Runtime integrations need separately managed uv/uvx and Python 3.12, as on macOS.

```powershell
$env:PYTHONUTF8 = "1"   # Python UTF-8 text I/O, as on macOS/Linux
npm ci
npm run desktop:build
```

Builds are native-host only: Windows artifacts are produced and verified on Windows, macOS artifacts on macOS ARM64; any other host refuses. The build downloads and verifies the official checksum-pinned `node-v22.23.4-win-x64.zip`, probes the bundled Node and `better-sqlite3` ABI in memory, builds the locked native app and produces `src-tauri\target\x86_64-pc-windows-msvc\release\bundle\nsis\Garmin Trainer_<version>_x64-setup.exe`. Build identity binds the platform, source, installed dependencies, actual toolchain versions, resource inventory, the installer bytes and its extracted payload.

## Unsigned per-user installer

The installer installs for the current user under `%LOCALAPPDATA%\Garmin Trainer` without administrator elevation, adds Start Menu/desktop shortcuts and an uninstaller. It adds no service, startup entry, updater or login item. It is **unsigned**: Windows SmartScreen may warn about an unknown publisher. Do not disable SmartScreen or other protection to proceed; this project provides no signing or trust bypass.

- **WebView2** is a prerequisite. If it is missing, the installer stops with guidance and installs nothing; it never downloads or installs WebView2 itself.
- **Uninstall never deletes your data.** Settings, databases and tokens under `%APPDATA%\com.codexa.garmin-trainer.desktop` remain until you manage them yourself. (The stock Tauri "delete app data" option is removed.)
- **Upgrades** replace program files in the same install directory and never touch private data or databases; downgrades over a newer install are refused in silent/update modes. Existing databases still require the matching source CLI upgrade procedure with stopped owners and verified backups ([release runbook](release.md#existing-database-upgrades-and-recovery)); the app never upgrades a database at startup.

## Package and verify without installing

```powershell
$REL = "$PWD\src-tauri\target\x86_64-pc-windows-msvc\release"
npm run release -- package --platform windows-x64 --execute --bundle $REL --scratch <private-scratch>
npm run release -- verify  --platform windows-x64 --bundle $REL --scratch <private-scratch> --record <printed release-windows-x64.json>
```

Use the same `npm run` entry as `npm run desktop:build`: the bound build context includes npm's environment, so invoking `release.py` directly refuses with a context mismatch. Package copies the stamped installer (never rebuilds or relabels it) to `Garmin-Trainer-<version>-windows-x64-setup.exe`, writes its SHA-256 file and a `release-windows-x64.json` record. Package and verify extract the installer payload with 7-Zip into owned scratch after validating every member name, require exactly the producer's binary and resources, x64 PE binaries, the Node license and notices, and the excluded/private-content refusals. The installer is never executed. No macOS size budget applies to Windows.

## On-demand execution

The entire `Windows x64` workflow is **manual-only** (`workflow_dispatch`): PR updates and pushes do not allocate it. Ubuntu Validate and the macOS nightly keep their existing triggers. Windows remains non-required in repository protection.

Select the intended feature branch or main in Actions → Windows x64 → Run workflow, or explicitly dispatch it:

```bash
gh workflow run windows.yml --repo codexa-bh/ai-garmin-trainer --ref <branch>
gh run list --repo codexa-bh/ai-garmin-trainer --workflow windows.yml --event workflow_dispatch --branch <branch> --limit 5
gh run view <run-id> --repo codexa-bh/ai-garmin-trainer --json headSha,event,status,conclusion,url
```

The selected ref is resolved to the dispatch's immutable `github.sha`; checkout and the recorded `TESTED_SOURCE` use that SHA, and the job refuses a different HEAD. Compare the observed run `headSha` with the intended PR head before relying on evidence. A later branch push does not update an earlier dispatch's evidence; explicitly request a new run when needed. Missing automatic Windows PR checks are expected, not a green Windows result.

## Installed-app scenario and narrow evidence exception

After the existing build/package/verify/backend stages, `npm run smoke:windows` consumes that exact verified release record and installer. It refuses non-hosted/non-Windows, dirty or mismatched source, existing registration/program/app-data/shortcuts, aliases, changed payloads and missing WebView2. NSIS runs directly with `/S /NS /D=<exclusive-runner-program-directory>` (`/D` last and unquoted as NSIS requires, including destinations with spaces); it never elevates or downloads prerequisites. Installer/uninstaller processes start suspended inside a fresh invocation-owned kill-on-close Job Object before resuming. The runner waits for the whole tree, including NSIS's forwarded temporary uninstaller child, not just its exiting parent; timeout fails and settles only that owned job. The installed executable/resources must match the verified payload exactly, with only NSIS's generated `uninstall.exe` additionally allowed and bound into native admission's complete installed inventory.

The installed ordinary app uses schema-v2 native admission and run-local private ACL/file-ID/namespace owners, explicit settings/app-data/WebView/temp/DB roots, and an ownership stdin pipe. HOME/USERPROFILE and the normal singleton/settings are never replaced or selected. The existing authored representative recipe is serialized in memory, with no private input. Actual hydrated round trips precede Trainer/Sync/Profile navigation, synthetic controlled-input Goals Save, owned pipe shutdown and restart/readback with fresh capability/boot. Wrong-run/stale-boot access refuses; unrelated Profile fields must remain unchanged. Startup failures report only fixed refusal-stage enums/booleans and numeric child exit status to CI; raw native logs, paths, settings and capabilities are never forwarded. A Windows native contract checks Python-created private state and its live directory pin before the expensive installed scenario. Settlement observes all WebViews under the UUID-owned run root, including the hidden setup profile.

Six fixed Trainer/Sync/Profile × wide (1280×850) and narrow (420×850) **logical own-WebView** captures use WebView2 `CapturePreview`, the existing hide-by-default geometry-preserving masks and confirmed restoration before private publication. Native diagnostic and image dimensions must agree; unsupported DPI/geometry fails rather than stretching pixels. Every PNG is fully bounded/CRC/deflate/filter-decoded and checked for nonuniform pixels; **these checks do not replace individual visual inspection**. Failure or timeout cannot publish raw pixels.

Only after owned native/backend/profile-WebView/endpoints/writer/namespace settlement does the installed uninstaller run. The scenario verifies program and uninstall-registration removal, no shortcuts under `/NS`, unchanged saved synthetic DB/settings and an exact marker in the newly owned real `%APPDATA%\\com.codexa.garmin-trainer.desktop` boundary. Stock NSIS retains the manufacturer `Software\\codexa\\Garmin Trainer` install-location metadata; it is inventoried and must remain unchanged, not falsely reported deleted. No unrelated registration/data is adopted or removed. Synthetic state remains only until runner expiry; no primary access or copy-back.

**Task-scoped publication exception:** GitHub Actions may retain exactly the six already-masked synthetic PNGs plus one closed sanitized source/runtime/scenario manifest for **three days**. The pinned upload step names all seven files explicitly. No binaries/installers, DBs/sidecars, settings/keys/tokens, descriptors/capabilities, raw/unverified captures or logs are eligible. A failed/incomplete scenario uploads nothing. This public repository's artifacts must be safe to disclose; three days is requested retention, not guaranteed private access or immediate erasure. All other smoke images, including macOS captures, retain their no-upload rule. No release, image mirror or broader standing exception follows.

Download the exact run/attempt/source artifact, treat the archive/manifest as untrusted, verify the exact allowlist/hashes/identity, then **open each of the six images individually** and record durable textual state/layout/masking/defect findings before expiry. Missing or expired images need fresh evidence, never an invented inspection. Masked blanks conceal chats/facts/paths/diagnostics; own-WebView pixels do not prove window chrome, focus, trusted input or real services.

For an artifact ZIP downloaded from that exact Actions run (use the Actions artifact download API, not an image mirror), validate before inspecting:

```bash
python3 scripts/desktop/windows_smoke_evidence.py --archive <downloaded.zip> \
  --directory <new-task-evidence-directory> --source <40-char-tested-SHA> \
  --run <GitHub-run-id> --attempt <run-attempt>
```

The destination must not already exist. This validates member paths/types/bounds before exclusive extraction and then checks the closed manifest, hashes and PNGs; it still reports visual inspection as required separately. Retain source/run/boot/view/preset/hash plus actual per-image findings in task/PR text, never copy these images into public Git or a long-lived mirror.

## Evidence and deferred qualification

The `Windows x64` job uses hosted **Windows Server 2025** x64. Its summary reports actual separate prerequisite/build/package/backend/installed/upload outcomes; skipped or failed stages are not covered. The installed scenario above must succeed on the intended current head, and downloaded captures must be individually inspected, before relying on installed-render evidence. Builds or backend-only health are not equivalent. No credentials, private data or real services are used.

Not yet covered, and deferred to a later explicitly requested qualification:

1. Install, upgrade and uninstall the unsigned installer on a real **Windows 11 x64** machine (per-user, SmartScreen, WebView2 present/missing, data preserved on uninstall).
2. Native window, Settings/onboarding UI, menus, editing keys, focus and image labels on Windows 11.
3. Real provider, ChatGPT browser sign-in, Garmin sign-in and uv/Python integrations on Windows.
4. Trusted native input/menu/focus behavior remains unavailable to this finite ordinary controller. Navigation, controlled inputs and save/restart are synthetic DOM actions in the actual installed app, not OS keyboard/mouse/menu evidence. The separate full ordinary macOS runner remains macOS-specific; Windows has only the finite installed scenario above.
