# Local macOS desktop runtime

Tauri supervises a private loopback Next.js/Node backend on **macOS Apple Silicon**, retaining React/HTTP/NDJSON/Next after()/SQLite/tools. It is not a browser product or Rust domain rewrite. [Release](release.md) owns unsigned/non-notarized distribution; [Windows alpha](windows.md) is experimental/unsupported. No auto-update, login item or background service.

## Build and run

Use ARM64 macOS, Xcode/CLT, Rust, Node 22/npm and Python 3.12 for developer scripts. The app bundles Node and needs no Python/uv/uvx; Ollama is independently operator-managed.

```bash
npm ci
npm run desktop:build
open 'src-tauri/target/aarch64-apple-darwin/release/bundle/macos/AI Trainer for Garmin Connect.app'
```

Bundle runs outside checkout. `desktop:dev` rebuilds production resources and opens native development host, not HMR/browser server. Rebuild changes; quit/reopen startup-only settings. Native Settings/error HTML works without backend and retains startup status. Maintenance CLIs neither serve nor configure desktop.

Build uses `--no-sign --no-binary-patching`; never disable Gatekeeper/sign/install to bypass errors. Keep stripping disabled for Rust proc-macro compatibility. [Nightly](validation.md#change-gated-native-nightly) reuses one production backend build with assembler-only `desktop:assemble`; this is not release packaging/ordinary smoke. Assemble-only requires same inputs; `desktop:resources` builds and assembles.

### Reproducible resources

Locked runtime inputs pin Node 22.23.4/archive hashes for native macOS ARM64/Windows x64. Assembly checks target, archive/SQLite ABI and launcher imports. Production Next/SQLite/launcher/OAuth resources exclude private env/data/keys/logs and development material. Garmin HTTPS/FIT is in-process, not packaged Python. [Redistribution](redistribution.md) owns required license/source/patch inventory.

Resources are immutable: no ISR disk flush/image optimization, bounded memory cache. Trusted config survives Next env reset; provider values never enter serialized build config. Private/WebView state stays outside bundle. Vendor/framework output is discarded except bounded startup vocabulary. [Ordinary identity/reuse](smoke/ownership.md#ordinary-build-identity-and-current-driver-reuse) binds source/build context/full inventory; rebuild legacy artifacts, never relabel them.

## Explicit private-state adoption

Settings replaces env loading. No cwd/home/adjacent discovery, old pointer import or generic env editor. Re-enter supported values; preserve originals.

**Create new database** requires genuine blank installation and unused destination outside source/bundle under existing private parent. Migrate in memory, then native stages/fsyncs/readonly-verifies/exclusively publishes under pinned parent/target lease. Never replace files/sidecars/aliases/unknown leases or migrate a selected existing file writable.

**Use existing data** requires canonical absolute compatible DB, no alias/expansion/URL/relative path. It becomes writable: **first quit other owners**, **evaluate on a disposable populated backup**, then obtain separate primary-cutover approval. Existing selection/startup checks schema/integrity readonly; missing/corrupt/old/unsupported refuses, never initializes/migrates.

Source/desktop share `<database>.trainer-writer`; macOS also rejects other open-file owners. Never steal unknown/stale leases, delete live leases or kill listeners to force admission. Inspect exact ownership.

### Private document and catalog

Canonical app-config `com.codexa.garmin-trainer.desktop/settings-v3.json` stores version 3 fields/keys/chatCatalog and optional Garmin key. Older builds refuse unsupported additions. Retired connector/token/executable fields remain inert preserved compatibility metadata, never forwarded/editable.

Require directory 0700/file 0600, current uid, regular single-link/no alias, max 128KiB. Pinned no-follow reads, exclusive staging/fsync/atomic rename protect publication; insecure existing objects refuse, never chmod/adopt. It is **plaintext, not encryption**: same-user/privileged processes/backups can read it. Never log/export/commit it; no Garmin password/MFA/token payloads.

Catalog max 32 entries, durable ID 80/model ID 256/optional legacy name 80 characters; names hidden but round-trip. Invalid names/duplicates/compatibility refuse. Trainer's DB-persisted explicit choice is independent, not a default ([runtime](local-runtime.md#runtime-trainer-model-preference)). Shared validation/readonly DB checks precede writes. Removed technical editors/five executable overrides persist hidden/inert. No arbitrary command/env/transport/origin/identity settings. Debug traces are always enabled by policy, not a misleading toggle.

### History and memory controls

History limit On reveals required YYYY-MM-DD; Off hides/disables, preserves toggled draft but Off-and-Save clears saved limit. No manufactured date. Invalid saved text stays visible for correction; blank selects automatic discovery after reopen, not proven remote inception.

[Settings](settings.md) owns model/key/Memory controls; [memory](memory.md) owns use/privacy. Catalog and key controls persist through row edits/correction/reconciliation. Setup-only identity-bound `read_memory_status` returns active metadata, never content/probes/provider work. Normal Settings has no diagnostic timer/button/automatic read. Draft/saved is not active readiness; missing/stale status is unknown.

### First-run commit and retry

Native captures genuine absence once; corrupt/unsupported/crashed installations do not become blank. Finish validates required config before DB creation, commits DB/settings separately and waits owned readiness, with no cloud/login/Sync/fallback. Duplicate operations serialize.

Cancel/quit is not rollback. Retry reconciles exact committed DB identity or opens committed settings only. After DB-only commit/relaunch, select retained file as existing. Unknown versions remain untouched; use compatible build/forward fix, not deletion/permissions/env fallback.

### Save and live activation

Save commits privately **before** live-applying only catalog/three shared provider-key slots. Require exact boot/generation/revision acknowledgment; admitted work retains its captured snapshot and Trainer choice is never rewritten. Everything else waits explicit quit/reopen.

No backend/busy/refusal means saved/not-applied; deadline/disconnect means saved/live outcome unknown. Reload reconciles metadata without replay. Unresolved uncertainty refuses another write; stale/invalid/precommit failure preserves prior bytes.

Restart notice requires confirmed durable commit and a field changed by this Save still differing from effective startup. Default-equivalent/repeated/live-only Saves with old pending state, or restoration to active values, do not prompt. Unknown commit/projection/failed reload suppresses notice but retains warnings. Modal focuses OK, traps Tab, dismisses via OK/Escape and restores focus; never restarts. Close/reload clears stale notice. First-run Finish keeps separate same-session behavior.

### Legacy settings and Keychain

Presence precedence is v3→v2→v1 even if unreadable/corrupt/aliased; unknown versions refuse downgrade/overwrite. Explicit v2 Save exclusively publishes v3 and preserves v2 forever. Startup compatibility is readonly: explicit provider intent survives missing keys; legacy auto captures determinable DeepSeek-first/OpenAI intent, not ongoing fallback. Empty catalog permits offline views with chat unselected; inactive embeddings need no service.

V1 startup validates fields/SLOT-UUID references without Keychain access and opens migration-required setup, not blank authority. Ordinary startup/menu/Save/Finish never query Keychain, even metadata.

**Adopt referenced Keychain keys once** reads only referenced accounts in the fixed provider-v1 service. Respect OS denial; never automate/bypass. Serialize with Save/Finish/activation, resolve every unchanged slot, validate complete frame and exclusively publish v3. Optional slots must resolve or be explicitly replaced/cleared; partial retrieval is discarded without auto-retry.

After denial/locked/missing values, privately replace/clear **every configured legacy slot**, then **Save private re-entry without Keychain**; keyless v1 uses this action too. No legacy reads. Both preserve v1 and all Keychain items indefinitely, with no cleanup/enumeration/env import/cloud probe/background adoption.

Rename is commit/selection point. Cancel before it preserves legacy authority; interruption afterward reconciles v3 without rereading Keychain. Postrename sync/verification failure is committed/durability-uncertain, not rollback/retry permission. Whole-form revisions compare file identity/mtime/ctime/size under serialization; any intervening edit requires reload. Never overwrite existing v3 or force fallback.

### Key intent and choice compatibility

Reads expose slot status, never keys. Fixed mask means presence, not a DOM secret/sentinel. Untouched/focus stays unchanged; typing/paste replaces; Backspace/Delete saved presence or emptying replacement clears. Absent-slot draft emptied stays unchanged. Save/Finish/adoption/re-entry share these intents. Submit/error/cancel/close clear drafts without deletion; retry needs fresh entry. Failed metadata refresh disables editing/writes.

Before replacing old catalog inputs, preserve private immutable `selectionCompatibility:{database,catalog}`. First old-v3 overwrite exclusively archives exact bytes in `settings-v3-before-single-choice.json`; v1/v2 remain. Clear defaults, never reassign on deletion. Compatibility stays renderer-private and seeds only its matching DB once, never newly selected DB. Archive conflict/uncertainty refuses. Older incompatible builds must not write current state; source revert is not cutover authority.

### Private backend transport

One bounded private startup stdin frame carries catalog/keys/compatibility to owned Node; pipe stays open for liveness. No secret argv/env file/URL/renderer readback. Garmin becomes a process-owned capability, never live projection. Older activation formats remain supported as specified in code.

Live `/__desktop/live-settings` POST/GET requires owned port/auth and rejects browser Origin/Sec-Fetch. Closed projection max 96KiB, monotonic generation,2s receive/3s native deadlines, acknowledgment only after atomic publication. Missing slots delete credentials, not ambient fallback. Garmin fingerprint changes and frozen compatibility remain restart-only; no whole-config reload. Changed DB/identity fails closed. Activation sets umask 077; existing insecure objects are never adopted.

### Schema upgrades

Separately approve exact target, make/integrity-check WAL-consistent online backup, rehearse process-env migration on independent populated copy, stop every owner, migrate stopped target, verify integrity/FKs/version/preservation, then controlled reopen. [Readiness](source-beta-readiness.md) owns operations. Startup/Use-existing never migrate. Recovery is compatible forward fix or separately reconciled restore, never downgrade/older writer/blind copy-back.

Saved conversation selection resolves beyond sidebar paging, otherwise stable most-recent; empty startup creates nothing and never imports browser selection. Explicit New chat creates. [History](conversation-history.md) owns replay/privacy and migration; domain deletion scopes remain separate.

## Optional ChatGPT subscription

[ChatGPT](chatgpt.md) owns registration/token/broker/epochs/recovery. Returning authorization reuses explicitly selected retained registration; New account/workspace is separate. Protected pending identity survives restart; unknown remote effects refuse fresh registration/replay. Connection commit, catalog Save and backend acknowledgment are distinct. Unsupported records preserve originals/unrelated routes. Ordinary smoke stays keyless; debug/release-probe refuse real credential owners. Fictional presentation grants no sign-in.

## Integrations and GUI execution

Cleared backend PATH=/usr/bin:/bin; official Garmin HTTPS/FIT needs no external tools. [Garmin connection](garmin-auth.md) owns native key entry/startup-only activation/Verify/recovery. Legacy token files stay unread/unchanged; offline views work without key. Draft cancellation preserves saved connection/provider drafts. Browser key creation is operator-only; Key saved proves configuration, not validity. Never paste keys in chat.

Provider/chat/memory choices remain independent; missing key/funding/model/network/auth never silently substitutes. Ollama stays operator-owned. Debug can contain private context; redacted archives are not unrestricted model evidence.

## Lifecycle and local security

Native owns one fresh process group/ephemeral 127.0.0.1 listener (Windows [Job Object](windows.md#windows-mechanisms)). Private random readiness identity plus composition/DB-lease proof precedes Trainer; HTTP 200 is insufficient. Reject foreign Host/Origin/cross-site requests. Loopback is single-user, not protection from same-user processes.

Only local setup has Settings/auth IPC. Trainer/remote pages have none except admitted smoke's closed correlated results. Fixed ChatGPT usage opener is not generic; external navigation/new windows refuse. Second launch focuses singleton and ignores arguments, no second writer. Startup bound 90s, actionable setup on failure without hidden retry.

Quit drains HTTP/Next≤5s and bounds owned-group termination≤8s; never stop Ollama/unrelated listeners. Host death closes liveness pipe. Cancellation is not rollback: committed turns/plans/checkpoints persist; unfinished work may remain. Force-kill/power loss can leave leases needing exact inspection. Relaunch reads stored state.

## Validation and recovery

[Validation](validation.md) and [smoke](dev-bridge.md) own checks/evidence. Full desktop path:

```bash
CI=true npm run validate
npm run eval:reliability
npm run desktop:build
npm run desktop:test:native
```

Native tests need assembled resources. Actual ordinary smoke uses outside-checkout bundles/populated copies and affected setup/adoption/Save/restart/commit-uncertainty/saved-feature scenarios. Real keys need separate authority/operator entry; unavailable proof stays explicit. Keep inspected captures local.

On failure inspect version/privacy/explicit paths, readonly integrity/schema and exact owners; rebuild bad resources/ABI on ARM64. Source diagnostics never read native settings/Keychain. Do not share credentials/private paths/raw logs. Recovery needs compatible state/backups, not browser fallback/reset/env import/automatic downgrade.
