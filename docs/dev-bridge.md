# Isolated programmatic native smoke

The first route for routine smoke is the **real macOS ARM64 Tauri/WebView**, driven through an explicitly admitted debug-only bridge. No browser launcher, Vite/HMR, fake backend, OS mouse/keyboard events, Accessibility, Apple Events, Screen Recording, app activation or focus restoration is used. Ordinary product setup/singleton/Keychain behavior is unchanged.

## Run the representative scenario

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

## Narrow protocol and result semantics

`src-tauri/src/dev_bridge.rs` exists only with Rust debug assertions. Ordinary development has no listener without validated `TRAINER_SMOKE_CONFIG`. Native-installed `src-tauri/debug/smoke.js` is outside packaged UI resources; it works with the production-built Next app. Native build gating, not `NODE_ENV` or an environment flag alone, controls availability.

- `GET /identity`: authenticated schema/run/source/native PID/app/copy/origin plus fixed renderer-diagnostic booleans. Does not imply readiness.
- `POST /command`: `{requestId,expectedRunId,command}`. UUID request/run identities, exact `Host: 127.0.0.1:<port>`, bearer capability and `X-Smoke-Run` are mandatory. Capability stays in private config/client memory/header, never argv/URL/logs/receipts. Every browser Origin/Sec-Fetch-Site is refused; no CORS grant.
- Closed commands: `observe`; `click` for exact main navigation/back/Profile-&-data-close/Profile-save/reload names; `input`/`assert` for **Goals synthetic sentinel only**; `capture` with no arbitrary selector/path. Missing, hidden, disabled, readonly, ambiguous, private or prehydration targets refuse before dispatch. No credential/login/setup form, general select/scroll, eval/invoke, state injection, HTTP proxy, filesystem/process or shutdown command.
- Observations return allowlisted view/navigation/headings and readiness/saved booleans, never copied values, chat/transcript/diagnostic text or private credentials. Assertions return match booleans. Rendered actions are synthetic events, not trusted native input.
- Only the exact admitted debug trainer origin/window receives the result-only custom permission. Existing setup/auth privileges remain local-only. The callback validates run/window/origin, bound and exact pending request. Debug permission metadata is also absent from ordinary release manifests.
- One request at a time; 16 KiB total request; two-second total read deadline; no duplicate/chunked framing; 4096 unique request IDs/run; five-second renderer deadline; 2 MiB result; four-second/4 MiB PNG bound. Unknown fields/commands refuse. Late/duplicate/unknown results cannot complete newer requests. Complete PNG framing and dimensions are checked; native publishes an exclusive 0600 temporary atomically without replacing an existing capture, confined to the run's `screenshots/`.
- Correlated `{requestId,result:{ok:true,...}}` means actual renderer completion. Failed assertions/actions return HTTP 409, malformed commands 400, access/framing denial 403, deadline 504. **Timeout means effect unknown, not rollback.** The client exits nonzero and never blindly retries mutation. Only bounded read-only readiness/observation may poll. Inspect retained state before any fresh explicit action.

## Production exclusion and required artifact evidence

After sufficient final validation and an ordinary unsigned ARM64 `npm run desktop:build`:

```bash
npm run smoke:release -- --scratch "$scratch" --input-file "$scratch/selected-database.json"
```

This audits every file in the **actual ordinary bundled `.app`** for debug/bootstrap/callback/config/probe markers, then separately builds an explicit `release-probe` executable. The latter changes only run-local paths/app identity/incognito/nonactivation and fixed denial observation. It has no listener/control/capture implementation or result callback. In a copied `.app` with read-only resources it supplies enabling environment, observes no endpoint and a fixed internal WebView request being denied (`command-not-found` or earlier ACL refusal). It reports that reason truthfully, reaps only its live child and verifies the original production artifact inventory unchanged. The unbundled release executable may now be the instrumented variant; ordinary `desktop:build` never enables the feature and its bundled app remains unchanged.

**Static audit plus launch-only-instrumented release denial is not ordinary-artifact launch.** Required real outside-checkout ordinary `.app` smoke remains independent. The normal app intentionally retains focus-taking singleton/window behavior and does not accept smoke isolation controls. Never launch it against an operator singleton, normal config/Keychain or primary data to satisfy this gate. Arrange an explicitly approved safe ordinary-artifact window/disposable configuration when noninterference cannot otherwise be established; record that gate, not an invented pass. Source delivery grants no signing/install/release/primary restart.

## Evidence and recovery

Keep original failed logs/observations alongside later repairs. Each private run retains provenance, native/readiness/failure/observation/scenario/restart/shutdown records and screenshots; the task receipt records original integrity and focus-sampling limits. Profile sentinels exist only in task-owned populated copies and are intentionally deferred to scratch expiry; never copy back. Schema/back-sync is a verified no-op, not a new fixture system. See [developer process](developer-process.md) and the epic runbook.

Use `npm run smoke:test`, focused DOM tests and `npm run desktop:test:native` for cheap boundary regressions, then the normal aggregate/reliability/build/native gates and current real smoke. Do not repeatedly rebuild/rerun unchanged heavy inputs to wait for hosted CI. Recurring CI runs only the separately documented synthetic quick scenario, not this full private populated-copy/release suite.

Mouse/native input is a **last resort** for genuine OS-only behavior: trusted keyboard/mouse events, drag-and-drop, native dialogs or operator-entered sign-in/MFA. Arrange an explicitly owned safe instance and direct private input; this bridge cannot drive or certify those operations. Keyless navigation/Profile smoke does not certify provider coaching, Garmin auth, sync, Keychain, native dialogs or platforms not tested.
