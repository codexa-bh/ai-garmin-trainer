# Local validation and smoke checklist

After [tool setup](#local-tool-setup), comprehensive validation is `npm ci && CI=true npm run validate`. Routine Ubuntu PR/main `validate:ci` runs cheap checks first: Prettier, rustfmt, Ruff format/lint, production Vulture, ESLint, architecture, both Knip modes, fresh `next typegen && tsc --noEmit`, Vitest and Python contracts. It builds no production backend/native host; full `validate` adds Next production build. Required hosted checks must succeed on the exact PR head before checked merge; pending/skipped/neutral is not success. [Project guardrails](project-guardrails.md) owns dynamic-entry/dead-code rules; test-only use is not a production consumer.

## Local tool setup

Use Node 22.23.4, Python 3.12, Rust 1.98.0 and pinned Ruff/Vulture. Put Python tooling outside the checkout (Pivan task disposable scratch), not in app/fixture state. Activate before npm so `python3` resolves its modules:

```bash
python3.12 -m venv '/absolute/outside-checkout/python-quality'
. '/absolute/outside-checkout/python-quality/bin/activate'
python3 -m pip install --disable-pip-version-check --no-cache-dir --only-binary=:all: --no-deps -r scripts/python-quality-requirements.txt
rustup toolchain install 1.98.0 --profile minimal --component rustfmt --component clippy
export RUSTUP_TOOLCHAIN=1.98.0
export PATH="$(dirname "$(rustup which cargo --toolchain 1.98.0)"):$PATH"
```

Checks never install/rewrite; missing tools fail. Ruff is 0.17.5, Vulture 2.16. Keep exact Cargo/rustc (not unrelated Homebrew tools) and environment unchanged through validation/build/smoke. Python selects Git-tracked files: format/lint includes tests; Vulture excludes `tests/` and `*_test.py` from usage/definitions, confidence60, with narrow reasoned protocol/public-entry modelling rather than name-based reachability. No Python/plain JS/MJS type-check claim is made. Hosted Clippy is post-merge macOS-only; Windows-only Rust is formatted, not linted.

## Windows x64 job

[Windows](windows.md#on-demand-execution) owns manual `workflow_dispatch`, immutable selected SHA, Server2025 runner, exact tools/build/tests and installed scenario. PRs/pushes never allocate this non-required job. [Scenario publication](windows.md#installed-app-scenario-and-narrow-evidence-exception) permits only six inspected synthetic masked PNGs plus sanitized manifest for three days. Default-off [release export](windows.md#explicit-exact-candidate-release-export) is separate authority.

Windows x64 remains alpha/unsupported. Server proof does not qualify Windows11/ARM, trusted input/menu/focus/full chrome, ordinary onboarding or real integrations; same-version replacement does not qualify older/dev upgrades or Windows source-CLI DB migration. [Release qualification](release.md#dual-platform-candidate-and-publication-procedure) owns candidate acceptance.

## Change-gated native nightly

`Nightly macOS` runs at **02:17 UTC** daily or manually on main. A Linux metadata gate precedes macOS allocation. First/changed exact main SHA runs; unchanged SHA skips after an allocated attempt (even failure/cancel/timeout) or carried successful unchanged decision. Cancellation before allocation is not an attempt. Skips save cost, not certify repair/green; manual dispatch cannot force unchanged retry. Inspect/repair failure before a new revision.

History limits are 20 runs and 20 jobs/run, 10-second/1-MiB API bounds and exact job identities. Missing/malformed/denied history fails before macOS. Only gate has Actions-read; all jobs Contents-read. Gate emits comparison SHA, native checkout verifies it against HEAD, so moving main cannot change revision.

The `macos-15` ARM64 runner (catalog plus actual Darwin/arm64 checks), Node22.23.4/Rust1.98.0 runs full validation, reliability, one Next build/resource assembly, locked all-target warnings-denied Clippy, native tests and one synthetic native Goals save/restart. It does not run optimized packaging, full navigation/parallel/capture/release, services/Keychain or dialog qualification. Stage observations do not imply later steps ran; observe hosted allocation/cron/skips separately from local tests.

Reproduce on dedicated macOS ARM64 worktree after setup, without changing inputs:

```bash
npm ci
CI=true npm run validate
npm run eval:reliability
npm run desktop:assemble
npm run lint:rust
rustup run 1.98.0 npm run desktop:test:native
rustup run 1.98.0 npm run smoke:quick -- --scratch '/absolute/canonical/private-task-scratch' --resources-ready
```

Assembler-only `desktop:assemble` must immediately follow the same-input successful Next build. `--resources-ready` checks source fingerprint/all resource hashes and refuses mismatch without rebuild fallback; without it quick builds resources. Other build/smoke commands keep their full meanings.

Superseded PR/ref runs cancel; nightly serializes without cancelling allocated native work. Actions are SHA-pinned and installs locked. Only nightly/Windows npm download-tarball caches keyed by lockfile exist; push Validate has no cache. Never cache node_modules/app/build state or upload binary/SQLite. macOS images stay local; Windows has only its linked exception. Job-private synthetic state follows [verified invocation disposal](smoke/ownership.md#preparation-reuse-and-owned-disposal) after settlement/evidence; diagnostics expire with runner/task scratch. Retain bounded receipt/source/shutdown facts, not private config/DOM/DB dumps. Pivan registers PR/main CI asynchronously; skips/pending never mean green or merge authority.

### Deterministic checks and diagnostics

Rendered navigation, mode-persistence and privacy scenarios remain independent real-component/bridge tests under default per-test deadlines. Separate CLI refusal tests each run the real CLI; splitting cumulative startup/render work never justifies longer timeouts, dropped assertions or mocked boundaries. For load-sensitive failures, run affected file then full Vitest under normal concurrency. SQLite preservation uses `Buffer.equals` for exact bytes; online-backup/migration assertions remain.

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

Doctor, DB status and dependency evidence are allowlisted support artifacts after review. They report version/schema/current-migration/provider/loopback configuration and native official-Garmin ownership, never remote readiness. Doctor reads no Garmin key and calls no Garmin service. Exclude credentials/tokens/provider URLs/prompts/GPS/raw payloads/vectors/env values from shared evidence.

## Individual snow split validation

```bash
npx vitest run tests/snow-splits.test.ts tests/snow-split-storage.test.ts tests/snow-backfill.test.ts tests/official-extra-sync.test.ts tests/garmin-extra-backfill-cli.test.ts
```

These cover authored FIT (including native Sync fixture), single-decode persistence, populated schema29 upgrade, stable/reordered identity/refusals, preservation/coverage, full authored history and independent resume/repeat/target/writer admission.

`split-heart-rate` and `stored-split-heart-rate` cover exact/near80% unrounded support despite long gaps; no held first30s; leading/middle/trailing/null-chain warnings; supported-only weighting/zones; stationary run/lift isolation/clipping; calendar/clock and exact activity-local legacy UTC proof through the millisecond writer; FIT alignment; MCP-excluding lap-only bounds, incomplete/conflicting bounds beyond UI caps; readonly preservation, reasons/privacy and trainer caps. `activity-supplement` covers run table/totals/lap visibility. Adjacent SQL, KPI recipe, local-data wiring and trainer instructions cover guarded evidence/freshness.

Run current full ordinary plus [Snow runs](smoke/features.md#finite-authored-snow-runs), synthetic Sync and `smoke:chat --extra-data`. Snow `--compact-captures` selects HR/coverage/warning/Times/narrow-right images before generation, retaining full two-instance assertions; record omitted image proof. These prove authored wiring, not service/model semantics. Primary history requires the separate [backup/full-range rehearsal/explicit-go contract](garmin-extra-data.md#explicit-history-backfill).

## macOS desktop validation

[Desktop](desktop.md#validation-and-recovery) owns full commands and required actual-artifact setup/lifecycle/state scenarios. Build with `npm run desktop:build` before `npm run desktop:test:native`; fresh native tests need assembled resources (`desktop:resources` is the alternative). Use an unsigned ARM64 bundle outside checkout on disposable populated state, not browser/dev-server success. Inspect sanitized native images and disclose unavailable real integrations.

For DMG tooling, [release foundation](release.md) requires cheap packaging/metadata/remote-mock tests, ordinary build, mounted final-payload verification and full ordinary `--release-record` smoke. Keep original producer stamp/lock and final transport identity at every boot; debug/probe never substitutes. Foundation grants no real tag/draft/upload/publication/install. `release:check` and `release_test.py` remain deterministic coverage.

[Ownership](smoke/ownership.md) is the single owner of:

- [Build identity/current-driver reuse](smoke/ownership.md#ordinary-build-identity-and-current-driver-reuse), including whole-source versus build/context identity, complete inventory and fail-closed freshness. Cheap mutation/concurrency tests are not actual-artifact smoke.
- [Risk-selected coverage](smoke/ownership.md#risk-selected-ordinary-feature-smoke): default full two-instance; reviewed local features may narrow, shared/native/controller/config/DB/process/identity/mask or uncertain impact requires full plus affected features. Stronger saved obligations remain.
- [Resources/disposal](smoke/ownership.md#preparation-reuse-and-owned-disposal), observer/preservation/settlement and [evidence limits](smoke/ownership.md#evidence-and-recovery).

The [catalog](smoke-commands.md) supplies commands/prerequisites/effects; [scenario references](dev-bridge.md#detailed-reference) own exact assertions/captures. Ordinary, debug, release-denial probe, fixed presentation, actual lifecycle, trusted input and real service are distinct proof. Routine synthetic input needs no personal consent; optional private input needs current exact authority. `smoke:test` contains cheap Python contracts, not full private/release execution. Quick/nightly remains minimal. Missing task-needed capability follows the [before-use extension recipe](smoke/protocol.md#task-needed-bridge-and-runner-extensions), never a bypass or automatic extra ticket. Native dialogs/trusted input need an arranged manual window.

Both Knip modes model actual command/workflow, runtime/OAuth, Python-invoked seed/recipe, setup HTML, admitted smoke bootstrap and ESLint-rule entries. Debug Settings/history bootstraps remain outside ordinary UI resources; shared validation is reachable through real entries. Generated `src-tauri/{target,gen,resources}` and `dist` are output, not source exemptions. Packaged initializer probes are target-free; native fresh-publication/readonly tests are not ordinary wizard certification. Operator-only real Garmin key entry remains separate from authored keyless evidence.

Presentation-only Markdown-table app changes may use `npm run smoke:tables -- --scratch <canonical-private-task-scratch> --bundle <same-source-ordinary-app>` under the [table scenario](smoke/features.md#finite-synthetic-markdown-table-scenario): synthetic existing seed, ordinary artifact, exact masks, twelve wide/narrow/scroll-edge captures and stated integration/input limits. This changes no recurring CI/default workload.

### ChatGPT subscription proof boundaries

`tests/chatgpt-{oauth,transport,composition,settings}.test.*` cover authored OAuth/JWKS/callbacks/browser args, compatible HTTP/SSE across purposes, API-key-free chat/tools/history/memory/titles/maintenance, failures, currentness and UI intent. Native tests cover storage/restart/identity/rotation, transient/terminal outcomes, queued/late cancellation, replaced file/parent and broker denials. Returning-client tests inspect outgoing issued-client/host before callback, not row counts. Pending tests distinguish known-client retry from unknown-remote refusal across restart; new workspaces never merge by subject/email. Debug/release-probe owners refuse real credentials; routine tests never borrow ordinary state.

After marker/DOM/Python/native checks, `smoke:settings -- --scratch <canonical-root> --input-file <authored-selection> --chatgpt-presentation` proves fictional controls, saved/new intent and Back in nine inspected images, not OAuth or billed inference. Shared lifetime changes need full ordinary plus affected eligibility/chat/summary proof. Real authorization/renewal/inference needs separately explicit account/usage/data/window authority. [ChatGPT](chatgpt.md) owns service contract and unavailable-proof reporting.

<a id="official-personal-api-reader-dormant"></a>

## Official Personal API reader

The official reader is the product path. `tests/official-{client,fit,coverage,reader,mixed-provenance}.test.ts` cover transport, ZIP/FIT, zones and coverage. `official-composed-sync` runs the real import application/SQLite against in-memory `official-api-fixture`, covering ranges, legacy transition, replay/cancel and non-null preservation. `official-fit-fixture` authors bytes, never personal recordings. [Synthetic Sync](synthetic-sync-smoke.md) exercises the native official path; neither proves account/device/rate-limit/terms behavior or uses a real key.

## Generated Next.js declarations

`next-env.d.ts` and `.next/` are ignored framework output: never commit/hand-edit them. TypeScript includes ambient/image and dev/production routes through tsconfig. Fresh checkout needs only `npm ci` then `typecheck`/`validate`; `next typegen` precedes tsc and failure stops it. Builds/assembly also regenerate. No browser server or restoring tracked declarations is required.

## Task process guardrails

[Developer process](developer-process.md) owns same-task reconciliation/no-op/blocker and evidence-first task-created cleanup/deferral. The following live checks require separately authorized secrets/services and disposable populated state, not primary backfill authority:

1. Actual Tauri chat/Profile loads without dev-login/Google OAuth/cookies/email allowlist; doctor flags non-loopback exposure.
2. Follow [Garmin key setup](garmin-auth.md), Save/reopen and explicit Verify. Never expose keys/tokens/raw errors; old connector files remain untouched.
3. Run explicit no-date Sync under finite approved live-test bounds, not merely the product maximum. Verify [operation/discovery/finality rules](sync-and-health.md), cancel/settle/restart/explicit Continue, passive no-replay, scope changes and preserved older/weight rows. Do not reset checkpoints or run exhaustive backfill for proof. [Synthetic Sync](smoke/sync.md#current-finite-synthetic-sync-scenario) is separate; copied-token routes refuse.
4. Backfill one imported activity's detail; inspect normalized record/lap status or supported failure. Check streams/GPS/elevation/HR/grade/power/recovery/count coverage. Payload archive stays redacted local SQLite; FIT is decoded in memory, not written as files. Interrupt/resume/repeat to verify idempotence.
5. Chat with configured provider on imported facts. Optional Ollama uses model `qwen3.5:4b` and loopback `/v1` (`AI_PROVIDER`/`OLLAMA_MODEL` are internal/maintenance identifiers, not desktop env onboarding). Include no-tool coaching, Garmin SQL/math, useful status/reference and missing-evidence cases. Verify schema discovery as needed, same-turn SQL handles/math, criteria/limitations and no fixed hidden rubric/model-only arithmetic. Record only tool statuses, bounded timing and redacted evidence.
6. Restart and verify conversation/Profile/detail persistence; edit Profile and verify correction. Separately exercise chat/Profile, memory Clear and Garmin deletion on disposable state, including raw-payload/detail removal and reconnectability, under their distinct [deletion scopes](source-beta-readiness.md#local-data-lifecycle).

Deterministic tool-registry/planner/two-step/invalid-selection/no-replay tests remain available without live credentials, not equivalent service proof. [Garmin risk](garmin-risk.md), [memory privacy](cross-chat-summary.md#stable-pin-inspection-controls-and-privacy) and [desktop lifecycle](desktop.md) own readonly fixed-origin access, bounded model evidence, actual-artifact/ephemeral-listener use and primary/unrelated-process preservation. Ordinary memory uses completed-source summaries, not retired semantic-vector retrieval. No release/deploy follows validation.
