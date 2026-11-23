# Local validation and smoke checklist

After [local tool setup](#local-tool-setup), the comprehensive gate is
`npm ci && CI=true npm run validate`. Routine Ubuntu PR/main `validate:ci` runs
Prettier, pinned rustfmt, tracked Ruff format/lint, production Vulture, ESLint,
architecture, full-project and production Knip, fresh `next typegen && tsc --noEmit`,
Vitest and Python contracts, cheap format/lint/dead-code checks first. It compiles
**no production backend or native host**; full `validate` adds the Next production
build. A checked PR merge needs every saved required hosted check to succeed on the exact current head; pending, skipped or neutral is not success. See [project guardrails](project-guardrails.md) for coverage, dynamic-entry
modelling and the no-debt-list/dead-code rules. Test-only product code has no
production consumer; live behavior coverage stays through existing entrypoints.

## Local tool setup

Use Node 22.23.4, Python 3.12 and Rust 1.98.0, with the same Ruff/Vulture pins as
CI/nightly. Keep the Python tool environment **outside the checkout** (for Pivan,
allocated task disposable scratch); it is development tooling, not app/fixture state.
Activate it before npm commands so `python3` and its tool modules match:

```bash
python3.12 -m venv '/absolute/outside-checkout/python-quality'
. '/absolute/outside-checkout/python-quality/bin/activate'
python3 -m pip install --disable-pip-version-check --no-cache-dir --only-binary=:all: --no-deps -r scripts/python-quality-requirements.txt
rustup toolchain install 1.98.0 --profile minimal --component rustfmt --component clippy
export RUSTUP_TOOLCHAIN=1.98.0
export PATH="$(dirname "$(rustup which cargo --toolchain 1.98.0)"):$PATH"
```

Checks never install tools or rewrite source. Missing modules/toolchains fail.
Ruff requires 0.17.5; Vulture is pinned to 2.16. CI/nightly select Rust 1.98.0 with
`RUSTUP_TOOLCHAIN`; local setup puts the exact rustup-selected Cargo/rustc binaries
on PATH (rather than an unrelated Homebrew Cargo). Keep that environment unchanged
through validation, build and smoke. The Python runner selects tracked files from Git:
format/lint include tests, Vulture excludes `tests/` and `*_test.py` from both usage
and definitions at confidence 60. Its narrow analysis-only protocol/public-entry
model has reasons; name matching is not reachability proof. There is no Python
or plain JS/MJS type-checking claim. Clippy is hosted **post-merge macOS only**;
Windows-only Rust is formatted, not linted, and needs separate Windows qualification.

## Windows x64 job

The prepared 0.1.3 cut labels Windows x64 **alpha**, accepting Server 2025-only proof, not Windows 11/ARM/trusted-input/normal onboarding or real integrations. Default-off manual `release_export` is a separate exact public-safe installer/checksum/record/receipt contract; image publication remains six masked PNGs plus manifest for three days. Schema 2 images include exact same-version program replacement and preservation before uninstall. Older/dev upgrades and Windows source-CLI DB migration remain unqualified. See [Windows export](windows.md#explicit-exact-candidate-release-export) and [release qualification](release.md#dual-platform-candidate-and-publication-procedure).

The `Windows x64` workflow runs **only on explicit `workflow_dispatch`**, on a selected ref's immutable SHA, using a hosted Windows Server 2025 x64 runner (not Windows 11). PR updates and pushes never allocate it; Windows remains non-required. See [dispatch and SHA verification](windows.md#on-demand-execution). It records exact source, image, OS build and toolchain, then runs Python release/identity contract tests, `desktop:resources` with the pinned Windows Node/SQLite probe, locked native tests (Windows private ACL/handle/rename/lock and Job Object process-tree tests), focused JS/TS tests, `desktop:build` (unsigned per-user NSIS installer), non-installing `release.py package/verify --platform windows-x64` and the synthetic `windows_backend_smoke.py`. It additionally runs the finite installed-app navigation/Goals restart/capture/data-preserving-uninstall scenario. Only its six validated synthetic masked PNGs and sanitized manifest have a task-scoped three-day upload exception; no other artifacts, credentials, private inputs or real services are used. Downloaded images still require individual inspection; trusted native input/menu/focus, full chrome, Windows 11 and upgrade/downgrade qualification remain unavailable. See [scenario and publication boundary](windows.md#installed-app-scenario-and-narrow-evidence-exception) and [evidence limits](windows.md#evidence-and-deferred-qualification).

## Change-gated native nightly

`Nightly macOS` runs daily at **02:17 UTC** or manually on main. A Linux metadata
job precedes macOS allocation. First source/changed exact main SHA runs; the same
SHA skips after an allocated native attempt (including failure/cancel/timeout) or
a carried successful unchanged decision. Cancellation before allocation is not an
attempt. Skips are cost control, **not green validation or repair**. Manual dispatch
does not force an unchanged retry. Inspect/repair failures before a new source
revision; no automatic same-content retries are added.

The gate considers at most 20 workflow runs and 20 jobs per considered run,
10-second/1-MiB API bounds, and exact job identities. Insufficient/malformed/denied
history fails cheaply without macOS. Only the gate has Actions-read permission;
all jobs have Contents-read. Comparison SHA is emitted and used for native checkout
and verified against HEAD, so moving main cannot change the selected revision.

The `macos-15` ARM64 image (verified against the runner-images catalog, with actual
Darwin/arm64 checks), Node 22.23.4 and Rust 1.98.0 run full validation, reliability,
one production Next build/resource assembly, locked all-targets Clippy (warnings denied),
native tests and one real
native synthetic Profile Goals save/restart. No optimized desktop packaging, full
parallel/navigation/capture/release suite, provider/Garmin/Keychain calls or native
dialog certification. Summary status/source/platform are observations, not promises
that stages after a failed step ran. Hosted allocation/cron/skip results must be
observed separately from fixture/local tests.

Reproduce on macOS ARM64 in a dedicated worktree after the pinned tool setup,
with unchanged inputs between steps. Clippy replaces the standalone Cargo check:

```bash
npm ci
CI=true npm run validate
npm run eval:reliability
npm run desktop:assemble
npm run lint:rust
rustup run 1.98.0 npm run desktop:test:native
rustup run 1.98.0 npm run smoke:quick -- --scratch '/absolute/canonical/private-task-scratch' --resources-ready
```

`desktop:assemble` is assembler-only: call it immediately after the same-input
successful Next build, never against stale `.next` output. `--resources-ready`
verifies the assembled source fingerprint and every inventoried resource hash
before building the debug native host; mismatch fails, with no rebuild fallback.
Without that flag `smoke:quick` builds resources itself. Existing `desktop:resources`,
`desktop:build`, `smoke:native` and `smoke:release` retain their full meanings.

Routine superseded PR/ref runs cancel; nightly runs serialize without cancelling
an allocated native attempt. Actions are SHA-pinned, installs locked, and the only
caches are existing nightly/Windows npm download tarballs keyed by lockfile.
Push Validate has no cache. No node_modules/build/app state cache or binary/SQLite uploads. macOS images remain local-only; the separate
Windows scenario has only the narrow three-day synthetic masked-image exception
linked above. Fresh synthetic state is job-private,
disposed only through [verified invocation ownership](smoke/ownership.md#preparation-reuse-and-owned-disposal) after final settlement/evidence; retained diagnostics expire with the runner or local task scratch.
Failures retain bounded receipt/source/owned shutdown facts; never dump private
config, DOM or database contents. Pivan registers PR/main CI asynchronously;
no polling loop or skipped/pending-as-green claim. Ordinary checked merge/protection
and explicit task gates remain independent.

Rendered smoke contracts keep independent navigation, mode-persistence and
privacy scenarios in separate tests under the default per-test deadline. They
still exercise the real components and bridge; splitting cumulative render work
does not justify extending timeouts, dropping assertions or mocking the boundary.
Independent CLI refusal scenarios likewise keep separate default-deadline cases
so cumulative subprocess startup does not consume one shared test deadline; each
case still executes the real CLI and checks its refusal.
For load-sensitive failures, run the affected file first and then the full Vitest
suite to check behavior under normal worker concurrency. Serialized SQLite
preservation/idempotency checks use `Buffer.equals` for exact byte equality rather
than generic per-entry deep equality; the online-backup and migration assertions
remain unchanged.

Automated validation:

```bash
npm run doctor -- --json
npm run db:status -- --json
npm run format
npm run format:rust
npm run format:python
npm run lint:python
npm run deadcode:python
npm run lint
npm run architecture
npm run knip
npm run typecheck
npm run test
npm run eval:reliability
npm run deps:evidence -- --output ./tmp/dependency-evidence.json
npm run build
```

`npm run doctor`, `npm run db:status -- --json`, and dependency evidence output are allowlisted support artifacts. They report versions, schema readiness, current/migration decisions, selected chat provider readiness including loopback Ollama chat when configured, loopback readiness, and that Garmin access is the native-Settings-owned official Personal API (doctor never reads the key or contacts Garmin). Review before sharing; they must not contain credentials, the Garmin key, token contents, provider keys, provider base URLs, prompts, precise GPS streams, raw API payloads, vectors, or `.env.local` values.

## Individual snow split validation

`npx vitest run tests/snow-splits.test.ts tests/snow-split-storage.test.ts tests/snow-backfill.test.ts tests/official-extra-sync.test.ts tests/garmin-extra-backfill-cli.test.ts` covers authored FIT bytes (including the Python native Sync fixture), single-decode foreground persistence, explicit populated schema-29 upgrade, stable identity/reorder/refusals, preservation/coverage, full authored historical selection and independent resume/repeat/target/writer admission. `split-heart-rate.test.ts` and `stored-split-heart-rate.test.ts` cover read-time split HR (unrounded exact/near-80% duration admission despite long gaps, no first-30-second fill of rejected spans, leading/middle/trailing/multiple/null-chain warnings, supported-only weighting and zone sums, stationary run/lift isolation, clipping, strict calendar/clock admission, exact activity-local legacy UTC proof through the real millisecond activity writer, authored FIT alignment, MCP-excluding lap-only limits, incomplete/conflicting bounds beyond UI caps, read-only preservation and dashboard/trainer reasons/privacy) and trainer evidence caps; `activity-supplement.test.tsx` covers the run table, compact totals line and the lap-visibility matrix. Adjacent `sql-analysis`, `kpi-recipe-execution`, `local-data-wiring` and trainer instruction cases cover guarded evidence and freshness. Run current full ordinary native plus [Snow runs](smoke/features.md#finite-authored-snow-runs), synthetic Sync and `smoke:chat --extra-data`; the finite Snow `--compact-captures` option selects changed HR/coverage/warning/Times and narrow-right images before generation while retaining full automated two-instance assertions. Record selected/omitted capture proof explicitly; these are authored app wiring, not Garmin/provider semantic proof. Primary history requires separate current private/backup/full-range rehearsal/explicit-go authority under [the maintenance contract](garmin-extra-data.md).

## macOS desktop validation

For local DMG tooling, follow the [release foundation](release.md): cheap metadata/packaging/remote-mock tests first, then an actual ordinary ARM64 build, final mounted payload verification and full ordinary smoke with `--release-record`. Each boot retains the original producer lock/stamp plus final image/transport identity; no debug/probe pass substitutes. No real tag/draft/upload/publication or operator installation is part of foundation validation. `npm run release:check` and the cheap `release_test.py` contracts are included in deterministic coverage.

On macOS ARM64, run `npm run desktop:build` then `npm run desktop:test:native` (unsigned app only; no signing/notarization/installer publication). On fresh worktrees the native build/test build-script requires assembled `src-tauri/resources`; build first, or use `desktop:resources` before native tests. The production app must launch outside the source checkout with bundled Node/SQLite and explicit disposable populated state, not just a browser/development server. Exercise native lifecycle, configuration/ownership/resource failures, repeated launch, persisted feature parity and inspected sanitized local screenshots; disclose unavailable real integrations. See [desktop build and recovery](desktop.md) and the epic live-smoke runbook.

Ordinary provenance/admission v2 separates the original whole-source build snapshot from conservative build/context identity and fresh current-driver/fixture evidence. See the [exact reuse/invalidation contract](smoke/ownership.md#ordinary-build-identity-and-current-driver-reuse); existing full validation/build commands, debug/probe semantics and private/provider gates are unchanged. `smoke:test` includes cheap real classifier/context/producer/consumer mutation, fresh-failure and concurrency contracts; these do not substitute for actual current-artifact smoke.

Ordinary smoke supports explicit [risk-selected feature scope](smoke/ownership.md#risk-selected-ordinary-feature-smoke)
and [source-attributed Python compositions](smoke/protocol.md#importable-guarded-compositions).
The callable entry point uses the same admission, observer, preservation and final
settlement owner as CLI execution; composition assertions and whole-run success
remain distinct. Shared execution changes still require current full two-instance
regression plus affected compositions, not a narrow-example pass alone.
Default/full and legacy feature flags keep broad simultaneous two-instance regression.
Reviewed local feature changes may select their named scenario and useful captures;
summary actual lifecycle/control proof and fixed presentation families are separately
selectable. Shared/native/controller/identity/mask risk or uncertain impact requires
full plus affected features. Every actual boot retains admission/preservation/owned
settlement, feature restarts and distinct eligibility catalogs remain required, and
subset receipts never claim omitted/full proof. This prospective recipe does not
rewrite stronger saved full/native/private/integration obligations or alter recurring
CI. Inspect authoritative local captures directly; contact sheets are optional aids,
not a second required retained corpus. Archive duplication/classifier expansion/PNG
encoding remain separate work, not cleanup authority.

Routine native/ordinary smoke defaults to [finite authored synthetic inputs](smoke-inputs.md), independent of personal data and repeated per-ticket consent; exact current standing/one-off authority is optional for private input. Quick/nightly's minimal recipe and costs stay unchanged. Routine native smoke is [programmatic-first](dev-bridge.md), using `smoke:ordinary` for actual unmodified outside-checkout ordinary-bundle parallel/save/restart and wide/narrow geometry-preserving redacted Trainer/Sync/Profile capture; `smoke:native` retains debug populated-copy navigation/Profile/save/restart/parallel subtree capture. `smoke:release` positively audits supported ordinary admission/control and excludes legacy debug/probe admission, then runs separately labeled launch-only release-mode denial. Debug/probe observations do not replace required ordinary outside-checkout production launch or relevant real integration smoke. Ordinary isolated success is not default singleton/settings/auth or real-service certification. Inspect actual images and record the appropriate debug-subtree or ordinary-redacted-geometry limits. Safe task-needed bridge/runner expansion is expected within the authorized task: follow the [before-use contract, regression and evidence recipe](smoke/protocol.md#task-needed-bridge-and-runner-extensions) rather than treating missing commands/inputs as a permanent ban or automatic new-ticket/operator stop. Existing refusals remain until safely extended; real safety/ownership/credential gates and ordinary-artifact evidence still bind. Native dialogs/trusted input remain explicitly arranged manual fallback only. The recurring nightly enrolls only the minimal synthetic quick scenario described above, not the full private populated-copy/release suite; `npm test` includes only cheap Python gate/runner/audit unit tests in addition to Vitest.

Both Knip modes model individual non-test tool entries: package/workflow commands,
assembler-bundled `scripts/desktop/runtime.ts`, native OAuth's `chatgpt-oauth.mjs`,
Python-invoked seed/recipe scripts, local setup HTML's `src-tauri/ui/setup.js`, shared
natively admitted `src-tauri/debug/smoke.js` (never installed by default), debug-only
Settings and history-setup bootstraps, and ESLint's custom rule entries. Debug
bootstraps stay outside ordinary production UI resources. Closed debug `smoke:settings` covers keyless nonactivating Connect/Back/cancel/Save/restart and inspected sanitized Garmin key-control subtrees, with Garmin-key changes, adoption, picker and Finish refused. It does not certify ordinary artifacts, first-run or a real key; see [debug Settings scope](smoke/settings.md#closed-keyless-native-settings-smoke). Shared settings validation/catalog is reached from these entries; Actual native smoke must include blank Create/Finish/same-session ready/relaunch, populated Use-existing, exclusive collision/sidecar/lease rejection and committed-state retry/cancel, advanced settings, metadata-only private-file save/reload, explicit legacy adoption/denial/re-entry and preserved originals, saved direct launch and ordinary catalog/shared-key live acknowledgment plus separate restart-only pending state, as well as saved/not-applied and unknown recovery. The packaged assembler probes the in-memory initializer without a filesystem target; native tests exercise real bundled fresh publication and readonly compatibility, not ordinary-artifact wizard certification. A real Garmin key belongs to the operator in the private local UI; name unavailable real-key evidence and never equate the authored fixture with key validity. Generated `src-tauri/{target,gen,resources}` and `dist` are build output only; no source files are exempted from lint/ownership/Knip.

Presentation-only Markdown-table changes can use `npm run smoke:tables -- --scratch
<canonical-private-task-scratch> --bundle <same-source-ordinary-app>` instead of
personal populated inputs. It uses the existing synthetic seed, actual ordinary
native artifact and isolated online-copy/identity/shutdown owners. See the finite
[table scenario](smoke/features.md#finite-synthetic-markdown-table-scenario) for strict
canonical-content masks, twelve wide/narrow/scroll-edge captures, before-use
contracts and explicit integration/input-fidelity limits. Default recurring CI and
quick/ordinary scenarios are unchanged.

### ChatGPT subscription proof boundaries

`tests/chatgpt-{oauth,transport,composition,settings}.test.*` cover authored OAuth/JWKS/callbacks, private-browser launch arguments, actual compatible HTTP/SSE for all generation purposes, API-key-free production coaching/tool/history/complete-memory/title plus maintenance/rebuild/import/Densify, terminal failures, native-refusal currentness and UI intent. Native `chatgpt` tests cover protected restart/identity, rotating refresh, transient/terminal disposition, queued/late cancellation, file/parent replacement and authenticated broker denials. These are not real-account certificates. Returning-client regressions assert the outgoing issued-client/host intent before callback, not merely local row counts. Pending-registration tests distinguish durable known-client retry from unknown-remote-effect refusal across restart; explicit new workspaces are never merged by subject/email. Debug/release-probe credential owners refuse real access; routine tests never borrow ordinary-app credentials.

After the before-use marker/DOM/Python/native checks, use `smoke:settings -- --scratch <canonical-root> --input-file <authored-selection> --chatgpt-presentation` for fixed fictional account/model controls, saved-versus-new switch intent and Back, and nine inspected native wide/narrow presentation images without credentials or a broker. Keep full ordinary two-instance regression plus affected eligibility/chat/summary proof for shared lifetime changes. Real browser authorization/renewal and finite subscription inference require separately explicit operator account/usage/data/window authority; record exact unavailable proof instead of treating a mock/native image as real integration. See [connection contract](chatgpt.md).

## Official Personal API reader (dormant)

The official reader is exercised only by tests until the product cutover, so the ordinary desktop smoke below still verifies the unchanged MCP path. Its own evidence is authored and synthetic: `tests/official-{client,fit,coverage,reader,mixed-provenance}.test.ts` cover transport, ZIP/FIT admission, zones and coverage policy; `tests/official-composed-sync.test.ts` runs the official reader through the real import application into a real SQLite file against an in-memory Personal API (`tests/official-api-fixture.ts`), covering range request counts, legacy transition, replay, cancellation and non-null preservation. FIT inputs are built by `tests/official-fit-fixture.ts`; no recorded or personal file is used. These tests do not call Garmin, use a key, or certify real-account, other-device, rate-limit or terms behaviour. Native proof of the official path belongs to the cutover.

## Generated Next.js declarations

`next-env.d.ts` and `.next/` are framework-owned, ignored local output. Do not
commit or hand-edit them: development and production use different generated
route imports. TypeScript still includes the Next.js ambient/image declarations
and both development and production route types through `tsconfig.json`.

On a fresh checkout, run `npm ci` then `npm run typecheck` or `npm run validate`;
no prior development server or build is needed. Type checking runs `next typegen`
before `tsc --noEmit` and stops if generation fails. Production builds and native resource assembly also regenerate declarations.
No browser development server is supported; generated output should not require
restoring tracked files or produce Git changes.

## Task process guardrails

Before handoff, tasks that make local SQLite data stale or incomplete must complete the needed same-task migration/backfill/back-sync/re-sync work against the intended DB target, or record an explicit blocker. Tasks that create smoke/test/mock app data must clean up those task-created artifacts after evidence capture, or record a deferral with provenance and approval/stop-condition rationale. See [developer-process.md](developer-process.md) for the concise planning and evidence contract.

Live smoke with local secrets:

1. Launch the actual Tauri app on disposable populated DB/config copies and verify the trainer loads chat/Profile without `/api/dev-login`, Google OAuth, cookies, or an email allowlist.
2. Confirm LAN/public exposure remains unsupported and `npm run doctor` flags non-loopback URLs.
3. Follow [Garmin connection](garmin-auth.md): create a Personal API key, enter it in native Settings, Save and explicitly quit/reopen; no live account switch. Old unofficial-connector selections show **Reconnect needed** and their token files stay untouched. **Sync → Verify connection** is the only explicit key check; doctor never reads the key. Do not print the key, bearer tokens or raw API errors. For task smoke use a disposable populated SQLite copy and bounded sync, not a primary-data backfill.
4. Run one explicit Sync without a history date under a separately authorized finite live-test envelope (the product's 30-minute maximum is not test authority). Verify recent-first work once, multiple automatic internal batches within one claim, 480 cumulative HTTP requests/30 minutes overall, independent 96 requests/180 seconds per batch, 30 seconds per request and serial one-second historical dispatch pacing (explicit latest has no artificial spacing). Verify separately durable family cursors, positive-only daily-summary hints, checked-versus-imported health and unknown remote lower bound. Cancel, settle, restart and explicitly Resume; passive launch/navigation/summary must not replay POST and old source-empty dates must not be repeatedly hydrated. `smoke:history --synthetic-sync` provides finite evidence through the product's official reader against an authored loopback Personal API, without private inputs; it cannot certify Garmin. The historical copied-token runner refuses its obsolete route; real-key evidence needs an independently authorized finite envelope. A saved advanced `GARMIN_HISTORY_START_DATE` remains an optional exploration limit, never earliest-remote proof. Test the explicit Automatic/Use exploration limit choice, required valid dates only in Limited mode, disabling/expanding the limit, and preserve older normalized/weight-history rows; do not reset checkpoints or run an exhaustive real backfill to obtain evidence.
5. Enter one imported Garmin activity ID in Activity detail and run Backfill detail. Confirm the status reports normalized record/lap counts or an explicit unsupported/failed reason; redacted API/detail payloads may be retained only in the local SQLite raw-payload table, and no raw FIT files should be created by the app (files are decoded in memory).
6. Use Show detail coverage to verify per-activity fields such as streams, GPS, elevation, HR, grade, power, recovery, record count, and lap count.
7. Interrupt a sync, resume it, and run again to verify idempotency.
8. Chat with the configured provider using imported facts. For local Ollama chat, set `AI_PROVIDER=ollama` and `OLLAMA_MODEL=qwen3.5:4b` with a loopback `/v1` base URL. Ask for a specific activity comparison, count, trend, ranking, or projection and verify the planner uses schema inspection when needed, guarded `runReadOnlySql`, and `runMathAnalysis` for consequential custom calculation over the same-turn SQL handle. Confirm the answer discloses selected criteria/formula and limitations without a hidden fixed rubric, model-only Garmin arithmetic, raw tool output, or unsupported data claims.
9. Restart the app and verify conversation/profile/detail coverage persistence.
10. Edit profile memory and verify later responses reflect the correction.
11. Clear chat/profile, clear semantic memory, then disconnect/delete Garmin data and verify activity detail and `garmin_raw_payload` tables are also removed and the state is reconnectable.

Trainer chat orchestration checks:

- Focused suites should cover the typed tool registry, planner-selected chat actions, two-step fresh-call orchestration, fail-closed invalid tool selections, and no-replay behavior. Use deterministic/provider-mocked tests for these paths when live provider credentials are unavailable.
- Live provider smoke, when credentials are configured, should include one no-tool coaching request, one Garmin-backed SQL/math coaching request, one single-tool status/reference request where useful, and one missing-evidence case. Record only tool names/statuses, bounded timings, criteria/limitation disclosure, and redacted evidence.

Privacy checks:

- Garmin reads are read-only HTTPS requests to the fixed official Personal API origin over a closed endpoint set; no redirects, alternate endpoints or connector processes.
- Raw API JSON/decoded detail payloads may be retained only as redacted local SQLite records for generated analysis; they are not logged or written as app-owned FIT/files, and obvious credential/token/auth/cookie/secret fields are redacted before storage/exposure.
- LLM tools return bounded local SQLite summaries/slices, guarded SQL results, or same-turn bounded math evidence and include privacy notes; they do not expose credentials, token paths, raw FIT bytes, full raw payload dumps, filesystem/network/process/environment access, or unrestricted history.
- Semantic memory is retrieved only after completed persisted turns, remains inspectable/editable/deletable/clearable/disableable, and deleted/disabled/expired records are inactive.
- Local production smoke uses the actual unsigned ARM64 `.app` outside checkout; native development uses `npm run desktop:dev` with rebuilt production resources, not HMR. Follow [explicit non-serving setup](../README.md#installation) for dependencies/status/approved backed-up DB preparation, then `desktop:build`. Probe APIs only through the native-owned ephemeral listener, never another browser launcher. Preserve primary state and unrelated services; no release/deploy is implied.
