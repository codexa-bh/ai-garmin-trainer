# Local validation and smoke checklist

Comprehensive local gate: `npm ci && CI=true npm run validate`. Routine Ubuntu
PR/main CI uses `npm run validate:ci`: formatting, lint, architecture, Knip,
fresh `next typegen && tsc --noEmit`, all Vitest tests and cheap Python contracts.
It deliberately does **not** compile a production backend or native host. The
existing full `validate` still adds the production Next build. See
[project guardrails](project-guardrails.md) for blocking lint/graph/Knip ownership;
none of those gates or deterministic tests is removed by the fast profile.

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
one production Next build/resource assembly, locked Cargo check/tests and one real
native synthetic Profile Goals save/restart. No optimized desktop packaging, full
parallel/navigation/capture/release suite, provider/Garmin/Keychain calls or native
dialog certification. Summary status/source/platform are observations, not promises
that stages after a failed step ran. Hosted allocation/cron/skip results must be
observed separately from fixture/local tests.

Reproduce on macOS ARM64 in a dedicated worktree with unchanged inputs between steps:

```bash
npm ci
CI=true npm run validate
npm run eval:reliability
npm run desktop:assemble
cargo check --locked --manifest-path src-tauri/Cargo.toml
npm run desktop:test:native
npm run smoke:quick -- --scratch '/absolute/canonical/private-task-scratch' --resources-ready
```

`desktop:assemble` is assembler-only: call it immediately after the same-input
successful Next build, never against stale `.next` output. `--resources-ready`
verifies the assembled source fingerprint and every inventoried resource hash
before building the debug native host; mismatch fails, with no rebuild fallback.
Without that flag `smoke:quick` builds resources itself. Existing `desktop:resources`,
`desktop:build`, `smoke:native` and `smoke:release` retain their full meanings.

Routine superseded PR/ref runs cancel; nightly runs serialize without cancelling
an allocated native attempt. Actions are SHA-pinned, installs locked, and the only
shared cache is npm download tarballs keyed by lockfile. No node_modules/build/app
state cache or binary/SQLite/image uploads. Fresh synthetic state is job-private,
retained only until runner expiry (local reproduction: task-scratch expiry).
Failures retain bounded receipt/source/owned shutdown facts; never dump private
config, DOM or database contents. Pivan registers PR/main CI asynchronously;
no polling loop or skipped/pending-as-green claim. Ordinary checked merge/protection
and explicit task gates remain independent.

Automated validation:

```bash
npm run doctor -- --json
npm run db:status -- --json
npm run format
npm run lint
npm run architecture
npm run knip
npm run typecheck
npm run test
npm run eval:reliability
npm run deps:evidence -- --output ./tmp/dependency-evidence.json
npm run build
```

`npm run doctor`, `npm run db:status -- --json`, and dependency evidence output are allowlisted support artifacts. They report versions, schema readiness, current/migration decisions, selected chat provider readiness including loopback Ollama chat when configured, loopback readiness, and whether Garmin MCP args explicitly include the reviewed exact `mcp==1.28.1` compatibility requirement or whether runtime had to inject it for a stale local override. Review before sharing; they must not contain credentials, token contents, provider keys, provider base URLs, prompts, precise GPS streams, raw connector payloads, vectors, or `.env.local` values.

## macOS desktop validation

On macOS ARM64, run `npm run desktop:build` then `npm run desktop:test:native` (unsigned app only; no signing/notarization/installer publication). On fresh worktrees the native build/test build-script requires assembled `src-tauri/resources`; build first, or use `desktop:resources` before native tests. The production app must launch outside the source checkout with bundled Node/SQLite and explicit disposable populated state, not just a browser/development server. Exercise native lifecycle, configuration/ownership/resource failures, repeated launch, persisted feature parity and inspected sanitized local screenshots; disclose unavailable real integrations. See [desktop build and recovery](desktop.md) and the epic live-smoke runbook.

Routine native/ordinary smoke defaults to [finite authored synthetic inputs](smoke-inputs.md), independent of personal data and repeated per-ticket consent; exact current standing/one-off authority is optional for private input. Quick/nightly's minimal recipe and costs stay unchanged. Routine native smoke is [programmatic-first](dev-bridge.md), using `smoke:ordinary` for actual unmodified outside-checkout ordinary-bundle parallel/save/restart and wide/narrow geometry-preserving redacted Trainer/Sync/Profile capture; `smoke:native` retains debug populated-copy navigation/Profile/save/restart/parallel subtree capture. `smoke:release` positively audits supported ordinary admission/control and excludes legacy debug/probe admission, then runs separately labeled launch-only release-mode denial. Debug/probe observations do not replace required ordinary outside-checkout production launch or relevant real integration smoke. Ordinary isolated success is not default singleton/settings/auth or real-service certification. Inspect actual images and record the appropriate debug-subtree or ordinary-redacted-geometry limits. Safe task-needed bridge/runner expansion is expected within the authorized task: follow the [before-use contract, regression and evidence recipe](dev-bridge.md#task-needed-bridge-and-runner-extensions) rather than treating missing commands/inputs as a permanent ban or automatic new-ticket/operator stop. Existing refusals remain until safely extended; real safety/ownership/credential gates and ordinary-artifact evidence still bind. Native dialogs/trusted input remain explicitly arranged manual fallback only. The recurring nightly enrolls only the minimal synthetic quick scenario described above, not the full private populated-copy/release suite; `npm test` includes only cheap Python gate/runner/audit unit tests in addition to Vitest.

Knip's additional entrypoints are assembler-bundled `scripts/desktop/runtime.ts`, local setup HTML's `src-tauri/ui/setup.js`, shared natively admitted `src-tauri/debug/smoke.js` (never installed by default), debug-only `src-tauri/debug/setup-smoke.js`, and the Python-invoked `scripts/desktop/smoke_recipe.ts`; both bootstraps stay outside production UI resources. Closed debug `smoke:settings` covers keyless nonactivating Connect/later/cancel/Save/restart and inspected sanitized Garmin subtrees, with native auth/MFA/adoption/picker/Finish refusal. It does not certify ordinary artifacts, first-run or live login; see [debug Settings scope](dev-bridge.md#closed-keyless-native-settings-smoke). Shared settings validation/catalog is reached from these entries; the packaged Python auth worker/uv lock is tested through the focused desktop suite. Actual native smoke must include blank Create/Finish/same-session ready/relaunch, populated Use-existing, exclusive collision/sidecar/lease rejection and committed-state retry/cancel, advanced settings, metadata-only private-file save/reload, explicit legacy adoption/denial/re-entry and preserved originals, saved direct launch and ordinary next-launch-only saves. The packaged assembler probes the in-memory initializer without a filesystem target; native tests exercise real bundled fresh publication and readonly compatibility, not ordinary-artifact wizard certification. Real fresh password/MFA entry belongs to the operator in the private local UI; name unavailable live challenge evidence and never equate deterministic simulation with live MFA. Generated `src-tauri/{target,gen,resources}` and `dist` are build output only; no source files are exempted from lint/ownership/Knip.

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

1. Launch the actual Tauri app on disposable populated DB/config/token copies and verify the trainer loads chat/Profile without `/api/dev-login`, Google OAuth, cookies, or an email allowlist.
2. Confirm LAN/public exposure remains unsupported and `npm run doctor` flags non-loopback URLs.
3. Follow [Garmin authentication setup and recovery](garmin-auth.md): preserve compatible saved connections internally; use native Connect/Reconnect only when needed. Native chooses fresh private storage. Select the matching verified connection in draft, then Save and explicitly quit/reopen; no live account switch. The retained TTY-only maintenance CLI is separate and never scraped by UI. Doctor verifies readable/nonempty expected-file metadata only; a separate bounded authenticated read establishes current usability, not expiry. Do not print credentials or raw connector errors. For task smoke use a disposable populated SQLite copy and bounded sync, not a primary-data backfill.
4. Sync activities to exhaustion and daily health from `GARMIN_HISTORY_START_DATE` through today.
5. Enter one imported Garmin activity ID in Activity detail and run Backfill detail. Confirm the status reports normalized record/lap counts or an explicit unsupported/failed reason; redacted connector/detail payloads may be retained only in the local SQLite raw-payload table, and no raw FIT files should be created by the app.
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

- Connector runs over stdio with a narrow `GARMIN_ENABLED_TOOLS` allowlist.
- Raw connector JSON/detail payloads may be retained only as redacted local SQLite records for generated analysis; they are not logged or written as app-owned FIT/files, and obvious credential/token/auth/cookie/secret fields are redacted before storage/exposure.
- LLM tools return bounded local SQLite summaries/slices, guarded SQL results, or same-turn bounded math evidence and include privacy notes; they do not expose credentials, token paths, raw FIT bytes, full raw payload dumps, filesystem/network/process/environment access, or unrestricted history.
- Semantic memory is retrieved only after completed persisted turns, remains inspectable/editable/deletable/clearable/disableable, and deleted/disabled/expired records are inactive.
- Local production smoke uses the actual unsigned ARM64 `.app` outside checkout; native development uses `npm run desktop:dev` with rebuilt production resources, not HMR. Follow [explicit non-serving setup](../README.md#installation) for dependencies/status/approved backed-up DB preparation, then `desktop:build`. Probe APIs only through the native-owned ephemeral listener, never another browser launcher. Preserve primary state and unrelated services; no release/deploy is implied.
