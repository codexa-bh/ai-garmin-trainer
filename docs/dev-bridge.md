# Isolated programmatic native smoke

Routine smoke uses the **real macOS ARM64 Tauri/WebView** through explicit native admission. Prefer the ordinary-artifact isolated scenario below when ordinary artifact/layout evidence is required; debug and default CI quick retain their narrower contracts. No browser launcher, Vite/HMR, fake backend, global OS mouse/keyboard events, Accessibility, Apple Events, Screen Recording, activation or focus restoration is used. Only the separately opt-in debug disclosure scenario forwards fixed Enter/Space NSEvents directly to its owned non-key WebView, never the OS queue; ordinary mode rejects those controls. Ordinary product setup/singleton behavior remains independent. Private settings/auth and legacy adoption remain outside this closed bridge.

## Ordinary-artifact isolated scenario

Build once from final reviewed inputs with `npm run desktop:build`. Then:

```bash
npm run smoke:ordinary -- --scratch '/absolute/canonical/private-task-scratch' \
  --input-file '/absolute/private/database-selection.json' \
  --bundle '/absolute/checkout/src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Garmin Trainer.app'
```

Selection is a private `0600` single-link JSON document containing only `database`, an explicitly selected canonical compatible populated SQLite file. Scratch must already be canonical, owned and `0700`; the command does not chmod/adopt insecure inputs. Never discover normal settings/env/keys/tokens or use another task's private inputs. A bounded data-derived fixture needs explicit operator/task approval, stays private and must not become a new persistent fixture framework or public personal-data asset.

The runner online-backs up the selected input into two exclusive `ordinary-<UUID>` roots, copies the **unmodified ordinary bundle** outside checkout and verifies every inventory byte. No binary, Info.plist, bundle identity or packaged resource is replaced. It directly launches each owned child with `--isolated-smoke-run <root/launch.json>`; capability is private, not argv/env/URL/log output. `--prepare-only` records independent copies/provenance with zero launches, not smoke success.

Native admits strict schema-v1 descriptor/source/resource/artifact identity before framework state, plugins or windows. It pins private root/subdirectory identities, holds an exclusive lifetime run-directory lock, requires existing compatible v2 settings/run-local DB and keeps ordinary DB preflight/writer leases. Derived config, app-data, trainer/setup WebView storage and temp stay in the run; HOME is unchanged. Optional selected tokens must be a separately prepared run-local copy. It never imports saved provider keys or provisions login. Invalid intent fails nonzero without normal singleton/config fallback. Same-root live owners refuse; restart requires reaped ownership, settled endpoints/DB lease and a fresh native boot. Default launch still uses normal settings/singleton and installs **no** controller/bootstrap/result grant; second-instance arguments never retarget an existing process.

Two authenticated release-native/source/artifact/boot/selected-copy identities and actual hydrated renderer round trips precede navigation, synthetic Goals save and owned restart/persistence. Cross-run, browser, wrong boot, duplicate and private-control rejection are exercised. Capture covers fixed Trainer/Sync/Profile views at wide 1280×850 and narrow 420×850 logical viewports. Masks hide everything by default and reveal only reviewed static labels/controls and this run's saved synthetic Goals. Geometry is preserved: no Profile repositioning or resize/reflow is used. Restoration is unconditional with a bounded renderer expiry. PNGs are local-only, not uploaded; **read/inspect every required image** and record what it verifies. Blank masked areas conceal transcripts, copied facts, paths, diagnostics and private inputs. This is redacted layout evidence, not full unmodified-window or trusted OS-input certification.

The baseline is keyless. No real provider/Garmin success is implied; separately provisioned run-native settings and explicit token copies are required for available real integration checks through the verified owned backend. Never read back keys, copy normal settings, generate env files or automate sign-in/MFA. Existing debug, quick and release-probe regressions remain independent. Focus is sampled every 10ms without activation/restoration; absence of a live operator instance must be disclosed, not manufactured. Only live child handles authorize shutdown; verify native reaping, backend/control endpoints and DB/run lease settlement. Copies/Goals stay task-attributed until scratch expiry; no primary mutation/copy-back or worktree disposal.

## Run the representative scenario

This existing **debug-only** populated-copy command remains unchanged:

Prerequisites: `npm ci`, supported Node/Rust/Xcode tools, Python 3 and an explicitly approved existing compatible populated SQLite input. External providers, Garmin tokens, Keychain and Ollama are unnecessary: this scenario never invokes them. It does not certify their availability.

Create a private input-selection file **outside source control**, containing only the explicitly selected canonical `database` path, not settings, tokens or keys. Use the existing task scratch directory (Pivan: `pivan-harness task-scratch path "$PIVAN_TASK_PATH" --create`). Do not use symlink aliases or search HOME/config to find input.

```bash
# Existing canonical task scratch, not a new persistent fixture environment:
scratch='/absolute/canonical/task-scratch'
(umask 077; set -C; printf '%s\n' '{"database":"/absolute/approved/populated.sqlite"}' > "$scratch/selected-database.json")
npm run smoke:native -- --scratch "$scratch" --input-file "$scratch/selected-database.json"
```

The command assembles production Next/Node resources and builds a debug native host under a worktree-local preparation lock. It hashes tracked, staged/unstaged and untracked nonignored source inputs and refuses changes during preparation/execution. Build/test caches are worktree-local; never share mutable state across worktrees. It copies the prepared executable to scratch and uses it for two simultaneous uniquely owned native instances. A run directory/endpoint is never reused or stolen. `--prepare-only` exercises private online-backup/provenance preparation with **zero launches**; it is not smoke success.

The runner:

1. Creates fresh owner-private UUID directories with independent config/HOME/temp/WebView profile, capability, DB and output. Uses SQLite online backup, compares whole logical fingerprints/counts and integrity, and preserves originals. Never makes an empty DB or migrates it.
2. Validates exact run/source/build/app/PID/selected-copy/backend origin plus a read-only **hydrated renderer** round trip. Listening/native Ready/HTTP 200/server-rendered HTML alone are insufficient. A DOM-only readiness marker is set by the normal dashboard effect; no feature state is read/injected.
3. Navigates Trainer → Activities/Health/Training Plan/Sync → Trainer, then Profile & data without provider/sync/deletion actions. Inputs only a synthetic `T0231-smoke-<UUID>` Goals value via React-compatible DOM events, saves through the existing Profile owner and verifies other copied Profile fields unchanged. Quits/relaunches the same owned copy, checks new native PID and persisted Goals through rendered UI, then verifies the other fields again.
4. Captures an actual own-WKWebView PNG after fixed temporary sanitization hides every private copied surface except Profile heading/saved badge, synthetic Goals and Save/Reload controls. This is explicitly a **sanitized Profile subtree**, not a normal full-window screenshot or layout-fidelity/native-input certificate. Never upload/commit images. Read/inspect each required image and record scenario/source/hash/visible-state analysis separately from capture success; Pivan tasks use `pr-smoke-assets` after inspection.
5. Retains live child handles, stops/reaps only owned processes on success/error/interruption, and verifies backend/bridge endpoints and the copy writer lease settle. Receipts/PIDs never authorize later kills. No broad name-based process kill, operator restart, primary cutover, Keychain reset or worktree disposal.

A read-only Swift observer samples frontmost PID/pointer every 10ms and refuses commands if an owned native process became frontmost. Pointer variation can be normal operator activity and is reported separately; sampling cannot exclude shorter transitions. The app is Accessory/nonfocused/nonactivating and uses incognito WebViews. This is routing/lifecycle isolation, not a sandbox against arbitrary same-user code.

## CI-only synthetic quick scenario

`npm run smoke:quick -- --scratch <canonical-owner-private-task-scratch>` reuses
the delivered `Run` admission/client/lifecycle and exact keyless settings. It
creates one fresh UUID synthetic seed through existing migrations and typed Profile
schema, verifies current schema/integrity and the real settings validator, then
uses an independent online backup. No operator database/env/token/Keychain is read.
It drives only Profile & data Goals save through the ordinary UI, quits/relaunches
the same owned state and asserts persistence plus unchanged other Profile fields.
It retains authenticated source/native/backend/hydrated renderer and shutdown
receipts. Existing sentinel protocol is reused; no new native command or production
bypass is added. Seed/copy Goals are CI synthetic and expire with scratch/runner.

One instance, no capture, full navigation matrix, parallel/security/release suite,
real integrations or trusted native input. Missing/aliased/reused/escaping scratch
or seed, wrong architecture, readiness/save/restart/cleanup failure is nonzero, with
no fallback to user state or blind mutation retry. Existing `smoke:native` retains
two populated private copies, navigation and capture; this command does not narrow it.
The explicit `--resources-ready` option verifies same-source resource inventory for
[one-build full nightly reproduction](validation.md#change-gated-native-nightly).

### Opt-in synthetic LLM disclosure evidence

`npm run smoke:quick -- --scratch <canonical-owner-private-task-scratch> --llm-debug`
extends the existing seed with exactly two saved synthetic assistant turns (one
trace and one missing-trace fallback). Default quick/nightly remains Profile-only;
this opt-in adds no private database selection or recurring CI workload. The normal
resource-ready option retains its exact-source/inventory checks.

The scenario observes native closed/open/inner-open/outer-close/remount states,
actual descendant visibility, native list-item marker, focus and focus-visible.
Fixed Enter/Space events are sent directly to the owned non-key WKWebView after
focusing only its outer debug summary. A trusted DOM key receipt and resulting
state plus continued nonactivation are checked; these are **native-generated local
events, not hardware input**, and never certify OS dialogs or global keyboard routing.
An intentionally non-key WebView has `document.hasFocus() === false` and suppresses
`:focus`/`:focus-visible` even with its summary as `activeElement`. The receipt
records `activeWindowFocusCertified: false`; actual active-window focus-ring evidence
remains separate. Never activate the app or fabricate a focus style to obtain it. No activation or global
posting occurs; a key/frontmost instance refuses rather than taking over.

Four actual WKWebView PNGs show default-closed, outer-open/inner-closed, independent
inner-open and Profile-reopened states. The sanitizer exposes only the debug card,
repositioned on an opaque background; it is subtree evidence, not normal full-window
layout fidelity. Before capture it verifies the complete fixed synthetic content
and structure, refusing private/unexpected previews, JSON or nodes. Observations
return only booleans/expanded-state arrays, never trace text. Inspect each image;
`debug-disclosure.json`/quick receipt retain source/state/capture/keyboard provenance.
Seed/copy/Goals/trace data expire with task scratch and are never copied back.
Ordinary-artifact launch, private data/integrations and hardware-input evidence
remain independent; this path grants no settings, secret or general eval controls.

## Narrow protocol and result semantics

`src-tauri/src/dev_bridge.rs` shares closed transport/result validation for the independently admitted debug and supported ordinary modes; `isolated_run.rs` owns ordinary admission. Legacy `smoke_config.rs` and its HOME/keyless policy remain debug/probe-only. Native-installed `src-tauri/debug/smoke.js` stays outside packaged UI resources. The ordinary binary contains the supported controller, but default launches never install it, manage bridge state or grant a result callback. An enabling environment alone cannot activate ordinary control.

- `GET /identity`: authenticated schema/run/source/native PID/app/copy/origin plus fixed renderer-diagnostic booleans. Does not imply readiness.
- `POST /command`: `{requestId,expectedRunId,command}`. UUID request/run identities, exact `Host: 127.0.0.1:<port>`, bearer capability and `X-Smoke-Run` are mandatory. Ordinary requests also require exact `expectedBoot`; result callbacks bind that same native boot. Capability stays in private config/client memory/header, never argv/URL/logs/receipts. Every browser Origin/Sec-Fetch-Site is refused; no CORS grant.
- Shared closed actions: `observe`; exact main navigation/back/Profile-close/save/reload clicks; **synthetic Goals only** input/assert. Ordinary adds only fixed `setViewport`/`captureView` presets. Debug alone retains Profile `capture`, synthetic `captureDebug`, outer **LLM debug traces**/**First LLM trace** summary clicks and fixed **Enter**/**Space** `debugKey`. Native input module/variants are compiled out of ordinary release; ordinary native and renderer guards reject those debug actions. No arbitrary selector/path/key, credential/login/setup, general scroll/select/eval/invoke, state injection, HTTP/filesystem/process proxy or shutdown command. Hidden/disabled/ambiguous/private/prehydration targets refuse before dispatch.
- Ordinary observations retain only fixed view/navigation/headings/readiness/saved booleans. Debug alone may add closed metadata-only disclosure booleans and three same-length boolean arrays (at most128 entries); unknown keys, text, inconsistent shapes and bounds refuse natively. No copied values/transcripts/trace text/private credentials leave the renderer. Clicks/Goals are synthetic DOM events. Opt-in debug keys are native-generated WebView-local events, never hardware/global input; ordinary never uses them.
- Only the exact admitted trainer origin/window receives its result-only permission (`allow-isolated-result` for ordinary; legacy debug permission remains debug-only). No remote settings/auth grant is added. Callback validates run/boot/window/origin, bound and exact pending request; native validates closed result keys, allowlisted enums/booleans and command correspondence, never arbitrary renderer JSON/text. Ordinary Goals must equal this run's sentinel. Capture selectors/geometry/paths are never caller supplied; debug subtree captures do not certify ordinary layout.
- One request at a time; 16 KiB total request; two-second total read deadline; no duplicate/chunked framing; 4096 unique request IDs/run; five-second renderer deadline; 16 KiB callback result; four-second/4 MiB PNG bound. Unknown fields/commands refuse. Late/duplicate/unknown results cannot complete newer requests. Complete PNG framing and dimensions are checked; native publishes an exclusive 0600 temporary atomically without replacing an existing capture, confined to the run's `screenshots/`.
- Correlated `{requestId,result:{ok:true,...}}` means actual renderer completion. Failed assertions/actions return HTTP 409, malformed commands 400, access/framing denial 403, deadline 504. **Timeout means effect unknown, not rollback.** The client exits nonzero and never blindly retries mutation. Only bounded read-only readiness/observation may poll. Inspect retained state before any fresh explicit action.

## Production exclusion and required artifact evidence

After sufficient final validation and an ordinary unsigned ARM64 `npm run desktop:build`:

```bash
npm run smoke:release -- --scratch "$scratch" --input-file "$scratch/selected-database.json"
```

This inventories every file in the **actual ordinary bundled `.app`**, requires supported isolated admission/control markers and rejects precise legacy debug admission/grant/probe markers. Shared controller/callback code is intentionally present, not proof it is enabled on default launches. The command then separately builds an explicit `release-probe` executable. The latter changes only run-local paths/app identity/incognito/nonactivation and fixed denial observation. It has no listener/control/capture implementation or result callback. In a copied `.app` with read-only resources it supplies enabling environment, observes no endpoint and a fixed internal WebView request being denied (`command-not-found` or earlier ACL refusal). It reports that reason truthfully, reaps only its live child and verifies the original production artifact inventory unchanged. The unbundled release executable may now be the instrumented variant; ordinary `desktop:build` never enables the feature and its bundled app remains unchanged.

**Static audit plus launch-only-instrumented release denial is not ordinary-artifact launch.** Use `smoke:ordinary` for admitted unmodified outside-checkout ordinary-artifact evidence. Default no-argument app behavior still uses the focus-taking singleton and normal settings, and remains independent: never launch it against an operator singleton/config/primary data merely for certification. Native admission/default-routing regression tests do not claim a live ordinary-default UI certificate. Manual private settings/auth evidence still needs an explicitly arranged noninterfering operator window. Source delivery grants no signing/install/release/primary restart.

## Evidence and recovery

Keep original failed logs/observations alongside later repairs. Each private run retains provenance, native/readiness/failure/observation/scenario/restart/shutdown records and screenshots; the task receipt records original integrity and focus-sampling limits. Profile sentinels exist only in task-owned populated copies and are intentionally deferred to scratch expiry; never copy back. Schema/back-sync is a verified no-op, not a new fixture system. See [developer process](developer-process.md) and the epic runbook.

Use `npm run smoke:test`, focused DOM tests and `npm run desktop:test:native` for cheap boundary regressions, then the normal aggregate/reliability/build/native gates and current real smoke. Do not repeatedly rebuild/rerun unchanged heavy inputs to wait for hosted CI. Recurring CI runs only the separately documented synthetic quick scenario, not this full private populated-copy/release suite.

Mouse/native input is a **last resort** for genuine OS-only behavior: trusted keyboard/mouse events, drag-and-drop, native dialogs or operator-entered sign-in/MFA. Arrange an explicitly owned safe instance and direct private input; this bridge cannot drive or certify those operations. Keyless navigation/Profile smoke does not certify provider coaching, Garmin auth, sync, private provider-file settings/adoption, native dialogs or platforms not tested.
