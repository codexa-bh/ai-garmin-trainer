# Local macOS desktop runtime

The source-built **macOS Apple Silicon** app is a thin Tauri window plus an owned loopback Next.js service. React, HTTP/NDJSON routes, Next `after()` titles, guarded tools, storage and connector policies remain the application. This is not a remote website wrapper or a Rust backend rewrite.

Local builds only: no installer channel, signing identity, notarization, auto-update, login item, background service, release or distribution is provided. Public source availability grants none of those operations. Intel, Windows, Linux and universal desktop bundles are not supported by this path.

## Build and run

Build prerequisites: macOS ARM64, Xcode/Command Line Tools, Rust/Cargo and Node 22/npm. Runtime prerequisites for Garmin remain separately installed **uv/uvx and Python 3.12**. Ollama is optional and separately managed. The app does not install software, download Python/models, start Ollama or stop independent services. uv may acquire the existing pinned connector/Python packages on first integration use.

```bash
npm ci
npm run desktop:build
```

The result is `src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Garmin Trainer.app`. Open that local app; it can be copied outside the checkout. `desktop:dev` uses the same assembled production backend at the explicit development assembly directory with the native development host; frontend changes require resource rebuilding. It is not a second Next development server. The source/browser commands remain supported independently.

The native crate enables `custom-protocol` by default so local setup/error HTML is actually embedded, independently of external-backend navigation. Setup reads a persisted sanitized status after subscribing, so a fast startup refusal is not lost before the UI loads.

`desktop:build` explicitly passes `--no-sign --no-binary-patching`. No codesign/notarization command runs; the compiler-produced executable is preserved rather than patched after linking. This is an unsigned local app bundle, not a trusted distributed installer. Do not disable Gatekeeper or sign/install it to work around an error. Keep release stripping disabled: the supported Homebrew Rust 1.98 toolchain failed proc-macro metadata loading with release stripping (`E0463`), while the recorded no-strip build passed.

### Reproducible resources

`scripts/desktop/runtime-inputs.json` pins Node 22.23.4 ARM64, its official archive URL and SHA-256. Assembly verifies the archive before extracting it, probes **the bundled** Node/SQLite ABI in memory and checks launcher imports. `Cargo.lock` and `package-lock.json` lock native/JavaScript dependencies; Tauri direct versions are exact.

The resource tree contains production standalone output, static/public assets, the complete pinned production Next package needed by its custom-server API, native SQLite, bundled launcher/Zod and the five first-party Python resources (four FIT helpers plus their token-location module). Stock standalone tracing alone is insufficient for custom-server preparation. It never copies source `.env.local`, application data, tokens, backups or runtime logs. `provenance.json`, `NODE-LICENSE.txt` and `THIRD-PARTY-NOTICES.txt` accompany the local resources; dependency metadata is not a redistribution/legal certification. No system Node/npm, source checkout or development server is needed at runtime.

Resources are immutable inputs: desktop disables ISR disk flushing/image optimization, keeps a bounded in-memory Next cache and disables Python bytecode writes. Database/state stay at selected external paths; WebView storage uses the platform WebView store. Runtime does not write a config or DB into the app bundle. Next telemetry is disabled by the native child environment. Raw backend stdout/stderr are not a public diagnostic channel: the native supervisor accepts only bounded allowlisted readiness/failure messages.

## Explicit private-state adoption

First launch shows a **native file picker**, not a password form or arbitrary path/command API. Select the existing owner-private env file **only after quitting any backend using its database**. Selecting it authorizes normal application writes to its configured DB. Evaluate on a disposable populated backup first; source delivery itself grants no primary-data cutover.

- The file must be an absolute, regular, owner-private (`0600`) file, not a symlink/alias. It must explicitly configure an existing `DATABASE_PATH`; there is no empty/default DB fallback.
- Exactly that file is read with Next dotenv expansion. Relative database/token references resolve against its original parent directory before framework/DB construction. No adjacent env files, home-token scans or account/provider fallback are used. Originals are never rewritten or relocated.
- The native app stores only `{ "version": 1, "env_file": "/absolute/private/config" }` in its owner-private `configuration-v1.json` under the platform app-config directory for `com.codexa.garmin-trainer.desktop`. The directory is `0700`, the pointer `0600`. Do not paste actual values/paths into issues. Use the native **Configuration…** menu to show setup again. If a backend is running, selection saves only the next-launch reference; quit/reopen to adopt it. A running instance never switches DBs in place.
- Readonly integrity/current-schema checks precede normal DB construction. Unsupported/older schemas, missing/corrupt/aliased targets and uncertain ownership are refused. Desktop does **not** run migrations or bootstrap. Use the source backed-up migration workflow explicitly on an approved target; validate a disposable copy before any separately authorized primary upgrade. Automatic downgrade/copy-back is unsupported.
- Source and desktop share a cooperative `<database>.trainer-writer` admission lease. On macOS, admission also refuses another process with the existing DB open, covering older source backends without the lease. The lease records only process identity, not credentials. A stale/unknown lease is **never auto-stolen**. Quit the owner and inspect exact process/open-file ownership before an explicitly approved stale-lease recovery; do not delete a live lease or kill a listener to force adoption.

Use SQLite's online backup API for a consistent copy when WAL may be active; a raw main-file copy from a running app is not a backup. Verify the copy's integrity and preserve pre-upgrade rollback data. No domain schema/data-shape change or Garmin backfill is introduced by this runtime migration.

The WebView has independent transient active-conversation storage. Its initial selection need not match a browser tab, but saved conversation content, Profile, memories, Trainer preference and general/original/latest weekly documents remain in SQLite. Deletion scopes and interruption semantics are unchanged.

## Integrations and GUI execution

The native child uses a cleared environment and a fixed GUI executable search (`/opt/homebrew/bin`, `/usr/local/bin`, `/usr/bin`). Explicit absolute configured command paths are supported; relative command paths and shell command strings are not expanded. Existing `GARMIN_MCP_COMMAND` and four `GARMIN_FIT_*_COMMAND` overrides can name durable external uvx/uv paths when installed elsewhere. No terminal initialization file is executed. Missing tools or non-reviewed connector arguments are reported as unavailable; persisted/offline views remain usable. Desktop admits only the reviewed normalized connector arguments, never an alternate package/pin.

Garmin remains the pinned stdio-only, read-allowlisted connector with exact `mcp==1.28.1`; auth is the existing out-of-band private-terminal flow. The same external token-reference policy and password-environment stripping apply to MCP and all packaged FIT helpers. Token-file metadata is not proof of live authentication. For smoke, use a private token **copy** so upstream credential refresh cannot change originals; never relocate/delete the durable store as cleanup.

Chat provider selection and saved Trainer preference remain independent of extraction/embeddings. Missing credentials, funding, models, network or auth failures never silently select another account/provider. Optional Ollama readiness can be degraded while offline views/chat remain usable. The app neither downloads models nor owns an existing daemon. Existing local debug traces are currently always enabled by tested application policy, regardless of `LLM_DEBUG_TRACES`; they can contain private context and must stay local. Redacted local payload archives remain supported; they are not unrestricted model/renderer evidence.

## Lifecycle and local security

Native owns a fresh child process group and an ephemeral `127.0.0.1` listener, never a browser/source backend. An HTTP 200 is insufficient: a random launch identity is verified over the native readiness connection and never included in a public URL. Before displaying the trainer, startup warms real production composition and proves that the selected DB lease belongs to its child. The validated env overlay is retained across Next's environment reset; changing it fails startup instead of creating a blank DB.

Foreign Origin, cross/same-site fetch and mismatched Host (including DNS rebinding) are refused at the desktop HTTP boundary. Loopback remains a single-user operational boundary, not protection against other processes running as that user. The trainer WebView has no remote native capability grant; only the local setup document can invoke its narrow native picker. Navigation is restricted to the verified local origin; new windows/external links are refused, not given native commands. Open external references separately in your browser. No shell/filesystem/process API is exposed to page JavaScript.

Repeated launches focus the existing verified native instance and ignore launch arguments; they do not start a second DB writer. Port zero allocation coexists with unrelated listeners; nothing is killed to free a port. Startup has a 90-second bound. Backend exit shows actionable setup failure and cleans owned descendants; it does not silently restart/retry work.

Quit/termination drains the local HTTP/Next work for at most five seconds, with native owned-group termination bounded at eight seconds. Only owned Node/connector/FIT descendants are stopped, not source apps, listeners or Ollama. Cancellation is not transactional rollback: persisted user/assistant turns, guarded planning writes and sync checkpoints remain; interrupted generation/import may be incomplete. Best-effort title work may be lost without retry. Relaunch reads persisted state. Native host death also closes an ownership pipe, causing bounded backend/group termination even if native callbacks cannot run. A force-kill/power loss can leave a stale admission lease; inspect ownership before recovery.

## Validation and recovery

Run `CI=true npm run validate`, `npm run eval:reliability`, `npm run desktop:test:native` and `npm run desktop:build`. Desktop unit coverage includes private references, aliases, relative paths, framework env reset, origin policy, schema/integrity admission and lease refusal/release. Native tests cover unsafe pointers and foreign readiness. Existing feature/architecture tests remain blocking.

The actual ARM64 `.app` must also launch outside the checkout on a disposable populated copy with bundled Node/native SQLite and available real integrations. Verify saved state, JSON/NDJSON/title settlement, SQL/math/missing evidence, Activities/Health/settings/plans, connector lifecycle, repeated launch, bounded quit/relaunch and unrelated-service preservation. Record unavailable integrations precisely, not as passed. Follow the epic live-smoke runbook and developer-process evidence-first cleanup; local screenshots require actual inspection and sanitization and are never uploaded/committed.

For failure: check selected file privacy/existence and original-base paths; use source `doctor` and readonly `db:status` on the approved copy; verify schema/integrity and quit other DB owners; rebuild missing resources/ABI on ARM64. Do not paste private config/token contents, paths, raw rows/streams or framework/provider logs. The source/browser launch remains rollback: quit desktop first, restore only the intended source/config selection and launch the source app explicitly. Never automatically downgrade, reset, overwrite or delete user data/credentials to recover.
