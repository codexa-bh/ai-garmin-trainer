# Local macOS desktop runtime

The source-built **macOS Apple Silicon** app is a thin Tauri host with an owned loopback Next.js service. React, HTTP/NDJSON, Next `after()`, guarded tools, SQLite and connector policies remain the application, not a remote website wrapper or Rust domain rewrite. In ordinary builds only the local settings document has native commands; trainer/remote pages have no IPC grant. An explicitly admitted isolated debug smoke instance has only its exact-origin correlated-result callback, never settings/auth privileges; see [programmatic smoke](dev-bridge.md).

Local unsigned builds only: no signing/notarization, installer/release channel, auto-update, login item or background service. Public source grants none of these operations. Intel, Windows, Linux and universal bundles are unsupported.

## Build and run

Build prerequisites: ARM64 macOS, Xcode/Command Line Tools, Rust/Cargo and Node 22/npm. Runtime integrations need separately managed uv/uvx and Python 3.12; optional Ollama is external. No Python/software/model installation or Ollama startup is performed by the app. Explicit integration use may acquire locked Python packages through uv.

```bash
npm ci
npm run desktop:build
```

Open `src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Garmin Trainer.app`, including outside the checkout. `desktop:dev` uses the same rebuilt production resources, no HMR/browser dev server. Source edits require rebuilding; settings edits need only explicit quit/reopen. Tauri is the sole product launcher. Retained doctor/status/migration/private-terminal-auth tools are non-serving maintenance, not desktop configuration sources.

The native crate enables `custom-protocol` by default so local settings/error HTML works without a backend. Native Settings remains available from the **Settings…** native menu regardless of backend readiness. Startup status is persisted in memory to avoid listener races.

`desktop:build` passes `--no-sign --no-binary-patching`; no codesign/notarization runs. Do not disable Gatekeeper or install/sign to bypass errors. Keep release stripping disabled: Homebrew Rust 1.98 proc-macro metadata failed with release stripping (`E0463`); the supported no-strip build preserves compiler output.

A separate [change-gated nightly profile](validation.md#change-gated-native-nightly)
uses full validation's single backend build, assembler-only `desktop:assemble`,
locked Rust checks/tests and one synthetic `smoke:quick` debug run. It does not run
optimized release packaging or replace ordinary actual-artifact/integration smoke.
Only use assembler-only immediately after a same-input production build; existing
`desktop:resources` still builds then assembles.

### Reproducible resources

`scripts/desktop/runtime-inputs.json` pins Node 22.23.4 ARM64 and its official archive checksum. Assembly verifies it and probes bundled Node/SQLite ABI plus launcher imports. Cargo/npm locks pin their inputs; Tauri direct versions are exact.

Resources include production standalone output/static assets, the complete pinned production Next custom-server package, native SQLite, bundled launcher/Zod, four FIT Python helpers/token-location module, and the first-party `garmin_auth.py` plus its uv script lock. Auth uses reviewed `garminconnect==0.3.2` directly, not the upstream CLI. External uv/Python remain operator-owned. Private env/data/tokens/logs are never packaged. `provenance.json`, Node license and third-party notices accompany local builds; metadata is not redistribution authorization.

Resources are immutable: desktop disables ISR disk flushing/image optimization, bounds memory cache and disables Python bytecode writes. Private state/WebView storage stays outside the bundle. The supervisor drains and discards incidental output, accepting only bounded allowlisted startup messages; vendor/framework stdout/stderr are not diagnostics.

## Explicit private-state adoption

**Settings** replaces env-file selection/loading entirely. Upgrades do not import the old pointer or env files. Users re-enter supported settings; originals are retained unchanged for rollback. No cwd/home/adjacent env discovery or generic environment editor exists.

- Genuine first run has Data → Provider → optional Garmin → Review steps. Explicit **Create new database** uses a visible unused owner-private app-data destination outside source/bundle; a custom destination needs an existing private parent. Bootstrap runs authoritative migrations in memory, then native writes/fsyncs/read-only verifies and exclusively publishes fresh bytes under a pinned parent descriptor/shared target lease. Existing files, sidecars, aliases and unknown leases are never replaced. No writable selected-file migration or initialization WAL is involved.
- **Use existing data** selects a compatible DB and optional existing owner-private token directory using canonical absolute paths. No aliases, shell expansion, URLs or relative paths. Selected DB will be writable: first quit other owners, evaluate on a disposable populated backup, and obtain separate approval before primary cutover.
- `settings-v1.json` under the platform config directory for `com.codexa.garmin-trainer.desktop` stores `{version:1,fields,keys}`: allowlisted non-secret settings and opaque Keychain account references. Directory `0700`, file `0600`, owner-owned regular/unaliased inputs, bounded size and atomic replacement. No raw provider keys, Garmin email/password/MFA or token contents.
- Normal settings cover DB/tokens/history and configured provider/models. Advanced settings cover supported memory/extraction/embedding choices and five executable overrides. Shared application validators/defaults remain authoritative; native invokes bundled validation and readonly DB schema/integrity checks before Keychain changes. No connector pin/args/transport/allowlist, port/origin/identity or arbitrary command/env controls are editable. Debug traces remain always enabled by tested policy; no misleading off toggle.
- Eligible first-run **Finish and open Trainer** validates required provider configuration before creation, commits DB/settings/Keychain separately, and uses the existing owned-backend readiness path in this session. No cloud probe, automatic login/sync or fallback. Native captures genuine settings absence once; crashed/invalid/unsupported existing installations do not gain first-run authority. Duplicate operations serialize natively. Cancel/quit is bounded; already committed DB/settings/independent tokens remain saved. Explicit retry reconciles exact DB identity or, after settings commit, opens only the committed configuration. After an interrupted DB-only commit/relaunch, explicitly choose that retained file as existing data.
- Ordinary **Save for next launch** still needs explicit quit/reopen. Cancellation/invalid saves preserve prior settings/current backend. Settings never switch an active DB/provider/account or restart the app. Trainer model preference remains independently persisted; configured default and saved preference are not conflated.
- Missing/corrupt/unsupported settings or unavailable required Keychain entries reopen sanitized actionable settings. Unknown versions are not overwritten/downgraded. Preserve the record for recovery and use a compatible build; do not delete data, relax permissions or fall back to env files.

Provider secrets use native macOS Security-framework generic passwords under service `com.codexa.garmin-trainer.desktop.provider.v1`, with explicit provider-slot/UUID accounts. Reads expose metadata-only configured/unavailable indicators, never saved values. Blank fields mean unchanged; replace/clear require intent. New accounts are copy-on-write: validation first, new Keychain items next, atomic settings rename as commit, then superseded-item cleanup. Before commit, failure preserves prior settings/keys and compensates new items. Cleanup denial is reported; inspect only the named service in Keychain Access, not unrelated credentials. There is no plaintext fallback. Unsigned development/production binaries can have different Keychain access prompts/identity after rebuild; actual access may be denied or locked. Do not bypass an OS refusal.

At startup native resolves keys into **one bounded private stdin frame** for its owned Node child, never argv, inherited secret environment, a generated env file, renderer readback or URL. Internal backend environment remains an adapter only. The pipe stays open after the frame for parent-death/liveness. Next's reset retains the validated snapshot; DB/identity checks fail closed if it changes. Provider keys are removed from ordinary MCP/FIT child environments.

Readonly existing-file/schema/integrity checks precede ordinary DB construction. Missing/corrupt/old/unsupported DBs are refused, never created/migrated by ordinary startup or existing selection. Only explicit eligible first-run Create new initializes a fresh target; it is not an upgrade/adoption path. Explicit backed-up source migration on a stopped approved target is separate. Source/desktop share `<database>.trainer-writer`; macOS also refuses another process holding the DB open, including older backends without a lease. Unknown/stale leases are never stolen. Inspect the exact owner; never kill listeners or delete a live lease to force admission.

Use SQLite online backup for active-WAL copies, verify integrity and retain pre-upgrade rollback data. No schema/backfill change is introduced here. WebView transient active selection can differ, but saved chat, Profile, memory, Trainer preference and general/original/latest weekly documents remain in SQLite. Deletion scopes/interruption semantics are unchanged.

## Integrations and GUI execution

The cleared child environment uses fixed GUI tool search `/opt/homebrew/bin`, `/usr/local/bin`, `/usr/bin`. Overrides accept canonical absolute executable paths or the supported uv/uvx names, never shell text/relative commands. No terminal init scripts run. Missing tools degrade integrations, not offline saved views. Ordinary Garmin remains pinned commit `3610be6feed93088d85b0f35aba9d7d07c2505a7`, exact `mcp==1.28.1`, local stdio/read allowlist; no inherited password/email/file or provider-key fallback reaches MCP/FIT.

Prefer an explicitly selected existing private token store. Metadata alone never proves authentication/expiry. For new login, explicitly start **Garmin sign-in** in the trusted local settings document; never enter credentials in trainer chat. This desktop-only transient entry is the narrowly approved exception to the former no-password-in-app policy, not permission for model/HTTP/trainer credential access. The retained private-terminal CLI remains TTY-only and is not scraped by UI.

One native UUID-bound session runs the locked first-party adapter with private JSON pipes, a 180-second absolute deadline, one MFA submission and explicit cancel. Only allowlisted authenticating/MFA/verifying/success/failure states reach UI. Rejection, expired/incorrect MFA, unsupported/repeated challenges, tooling, network/service, rate limits, timeout and protocol failures do not auto-retry or bypass challenges. Password/email/MFA never enter argv/env/files/logs; controls/references are cleared promptly. Managed runtimes cannot promise perfect memory zeroization.

New login requires a **nonexistent destination** under a canonical owner-private parent; no existing-store replacement/force reauth. Worker writes private native-owned staging and performs independent token login/profile-presence verification without emitting the profile. Native serializes cancel versus commit and atomically publishes with exclusive rename; stale events cannot commit after cancel. Compatible `garmin_tokens.json`/`garmin_tokens.base64` are `0600` in a `0700` directory. Failed/owned staging is cleaned; originals remain untouched. Success does not promise expiry/future availability. Select the new store in the form and continue to first-run Review/Finish, or Save then quit/reopen for an existing installation. Token publication is an independent committed result and is retained if later setup fails/cancels. It never changes a running import's account.

This is unofficial international Garmin login, not official OAuth or guaranteed challenge support; no new region/provider/CAPTCHA bypass. See [Garmin auth](garmin-auth.md) and [risk](garmin-risk.md). For smoke use token copies so library refresh cannot mutate originals.

Cloud provider/Trainer preference and memory extraction/embedding choices remain independent. Missing key/funding/model/network/auth never silently selects another provider/account. Optional Ollama is not app-owned. Local debug traces may contain private chat/Garmin context and must not enter screenshots/support artifacts; redacted local payload archives are not unrestricted model evidence.

## Lifecycle and local security

Native owns a fresh process group and ephemeral `127.0.0.1` backend, never an unrelated source service. A private random readiness identity plus actual composition/selected DB lease proof precede trainer display; HTTP 200 alone is insufficient. Identity never enters a public URL. Foreign Origin/Host/cross-site requests are refused. Loopback is a single-user operational boundary, not isolation from other same-user processes.

Only local setup has narrow settings/auth IPC. Trainer/remote pages have no native privileges; new windows/external navigation are refused. Second launch focuses the existing native instance and ignores arguments, never starts a second writer. Port zero coexists with unrelated listeners. Startup is bounded at 90 seconds; failure shows settings without hidden retry.

Quit drains HTTP/Next work for at most five seconds; owned-group termination is bounded at eight seconds. Auth is cancelled and only native-owned Node/connector/FIT/auth descendants are stopped, not listeners/Ollama/primary processes. Host death closes the pipe and causes bounded child termination; auth also detects pipe EOF. Cancellation is not DB rollback: saved turns/planning writes/checkpoints remain, generation/import/title work may be incomplete. Force-kill/power loss can leave a lease requiring exact ownership inspection. Relaunch reads persisted state.

## Validation and recovery

Routine development smoke is [programmatic-first on real isolated native instances](dev-bridge.md): `npm run smoke:native -- --scratch <canonical-task-scratch> --input-file <private-explicit-db-selection.json>`. It uses existing populated-copy practices, no provider/Keychain/login or primary mutation, two simultaneous nonactivating instances and actual Goals save/restart/capture. Read and inspect the sanitized actual Profile-subtree PNGs; capture success alone is not evidence. Mouse/native input is last resort for trusted input, drag-and-drop and native dialogs, not routine navigation.

Run `CI=true npm run validate`, `npm run eval:reliability`, `npm run desktop:build`, then `npm run desktop:test:native`. Fresh native tests require assembled resources; build first or assemble `desktop:resources`. Focused settings/UI/Python/native tests cover validators/defaults, masking/intents/compensation, private protocol, MFA/rejection/cancel/timeout/late events, no-overwrite publication, env retirement, Next reset, DB admission/origin/lease/resource safety and connector stripping. No skipped/weakened guardrails.

Actual unsigned ARM64 production smoke must run outside checkout on WAL-consistent populated DB/private token copies, with inspected sanitized local screenshots. Exercise settings/advanced fields, Keychain save/deny/reload, blank Create/Finish/relaunch and populated Use-existing, partial-commit/cancel/retry, ordinary save/restart-required, admission/quit/relaunch, saved feature parity, available real providers and Garmin token reads. Operator enters any real new password/MFA privately in the local UI; simulated challenge tests never become live MFA evidence. Record exact unavailable evidence. Follow developer-process/epic evidence-first cleanup; no screenshot upload/commit.

Failure recovery: check settings version/privacy and explicit paths, Keychain access/status, readonly selected-target DB status/integrity/schema and exact other owners; rebuild missing resources/ABI on ARM64. Source CLI diagnostics do not read settings/Keychain. Do not share private settings/paths/keys/tokens/raw vendor/framework logs. Rollback is a prior compatible desktop build with preserved compatible private state/backups, not automatic downgrade, env import, browser fallback, reset or copy-back. Source delivery grants no primary restart/cutover, installation, release or scheduler-owned worktree deletion.
