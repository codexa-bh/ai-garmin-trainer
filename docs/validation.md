# Local validation and smoke checklist

Blocking local/private-CI gate: `npm ci && npm run validate`. See
[project guardrails](project-guardrails.md) for selected lint/SonarJS rules,
architecture boundaries, Knip coverage and false-positive handling.

Automated validation:

```bash
npm run doctor -- --json
npm run db:status -- --json
npm run bootstrap:local -- --prepare-only
npm run format
npm run lint
npm run knip
npm run typecheck
npm run test
npm run eval:reliability
npm run deps:evidence -- --output ./tmp/dependency-evidence.json
npm run build
```

`npm run doctor`, `npm run db:status -- --json`, bootstrap stage output, and dependency evidence output are allowlisted support artifacts. They report versions, schema readiness, current/migration decisions, selected chat provider readiness including loopback Ollama chat when configured, loopback readiness, and whether Garmin MCP args explicitly include the reviewed exact `mcp==1.28.1` compatibility requirement or whether runtime had to inject it for a stale local override. Review before sharing; they must not contain credentials, token contents, provider keys, provider base URLs, prompts, precise GPS streams, raw connector payloads, vectors, or `.env.local` values.

## Generated Next.js declarations

`next-env.d.ts` and `.next/` are framework-owned, ignored local output. Do not
commit or hand-edit them: development and production use different generated
route imports. TypeScript still includes the Next.js ambient/image declarations
and both development and production route types through `tsconfig.json`.

On a fresh checkout, run `npm ci` then `npm run typecheck` or `npm run validate`;
no prior development server or build is needed. Type checking runs `next typegen`
before `tsc --noEmit` and stops if generation fails. Development startup and
production builds also regenerate declarations automatically. Switching modes
should not require restoring generated files or produce Git changes.

## Task process guardrails

Before handoff, tasks that make local SQLite data stale or incomplete must complete the needed same-task migration/backfill/back-sync/re-sync work against the intended DB target, or record an explicit blocker. Tasks that create smoke/test/mock app data must clean up those task-created artifacts after evidence capture, or record a deferral with provenance and approval/stop-condition rationale. See [developer-process.md](developer-process.md) for the concise planning and evidence contract.

Live smoke with local secrets:

1. Start the app on loopback and verify the trainer loads chat/Profile without `/api/dev-login`, Google OAuth, cookies, or an email allowlist.
2. Confirm LAN/public exposure remains unsupported and `npm run doctor` flags non-loopback URLs.
3. Follow [Garmin authentication setup and recovery](garmin-auth.md): explicitly set `GARMIN_MCP_TOKEN_DIR`, reuse verified existing credentials, and run `npm run garmin:auth` out of band only if needed. Doctor verifies readable/nonempty expected-file metadata only; a separate bounded authenticated read establishes current usability, not expiry. Do not print credentials or raw connector errors. For task smoke use a disposable populated SQLite copy and bounded sync, not a primary-data backfill.
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
- Local production smoke uses `npm run bootstrap:local` for the first/repeat path. Manual fallback remains `npm ci`, `npm run db:status -- --json`, `npm run db:migrate` only when needed, `npm run build`, and `npm run start:local`; loopback access is supported, LAN/public exposure is not.
