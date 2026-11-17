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

## Evidence and deferred qualification

The `Windows x64` GitHub Actions job runs on a hosted **Windows Server 2025** x64 image. It records the exact source, image, OS build and toolchain, then runs the Windows-native private-state/process tests, focused JS/TS and release tests, the full build, non-installing package/verify and a synthetic packaged-backend smoke (fresh initialization, nonce-bound readiness, writer lease and second-writer refusal, graceful stop and restart). It uploads nothing and uses no credentials, private data or real services.

Not yet covered, and deferred to a later explicitly requested qualification:

1. Install, upgrade and uninstall the unsigned installer on a real **Windows 11 x64** machine (per-user, SmartScreen, WebView2 present/missing, data preserved on uninstall).
2. Native window, Settings/onboarding UI, menus, editing keys, focus and image labels on Windows 11.
3. Real provider, ChatGPT browser sign-in, Garmin sign-in and uv/Python integrations on Windows.
4. Isolated ordinary-artifact launch smoke and trusted input on Windows (the current smoke runners are macOS-specific).
