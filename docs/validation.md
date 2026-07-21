# Local validation and smoke checklist

Automated validation:

```bash
npm run doctor -- --json
npm run format
npm run lint
npm run typecheck
npm run test
npm run eval:reliability
npm run deps:evidence -- --output ./tmp/dependency-evidence.json
npm run build
```

`npm run doctor` and dependency evidence output are allowlisted support artifacts. Review before sharing; they must not contain credentials, token contents, provider keys, prompts, precise GPS streams, or raw connector payloads.

Live smoke with local secrets:

1. Start the app on loopback and verify the trainer loads chat/Profile without `/api/dev-login`, Google OAuth, cookies, or an email allowlist.
2. Confirm LAN/public exposure remains unsupported and `npm run doctor` flags non-loopback URLs.
3. Run out-of-band `garmin-mcp-auth` and verify connector status in the app. The current connector auth stores OAuth state at `~/.garminconnect/garmin_tokens.json`; verify only file existence, never contents.
4. Sync activities to exhaustion and daily health from `GARMIN_HISTORY_START_DATE` through today.
5. Enter one imported Garmin activity ID in Activity detail and run Backfill detail. Confirm the status reports normalized record/lap counts or an explicit unsupported/failed reason; redacted connector/detail payloads may be retained only in the local SQLite raw-payload table, and no raw FIT files should be created by the app.
6. Use Show detail coverage to verify per-activity fields such as streams, GPS, elevation, HR, grade, power, recovery, record count, and lap count.
7. Interrupt a sync, resume it, and run again to verify idempotency.
8. Chat with OpenAI/DeepSeek using imported facts. Ask for a specific activity analysis and verify the response cites deterministic tool results rather than inventing calculations from summaries. Ask a clear ad hoc ranking such as top 10 demanding activities and verify generated analysis returns a disclosed criterion, bounded ten-row evidence when available, local-only execution wording, and no raw payload/secret dump; ask an ambiguous criterion and verify it asks a concrete clarification.
9. Restart the app and verify conversation/profile/detail coverage persistence.
10. Edit profile memory and verify later responses reflect the correction.
11. Clear chat/profile/learned memory, then disconnect/delete Garmin data and verify activity detail and `garmin_raw_payload` tables are also removed and the state is reconnectable.

Trainer chat orchestration checks:

- Focused suites should cover the typed tool registry, planner-selected chat actions, two-step fresh-call orchestration, fail-closed invalid tool selections, and no-replay behavior. Use deterministic/provider-mocked tests for these paths when live provider credentials are unavailable.
- Live provider smoke, when credentials are configured, should include one no-tool coaching request, one single-tool Garmin/status/ranking request, one two-step verification or sync follow-up, and one fail-closed invalid/unknown local-object case. Record only tool names/statuses, bounded timings, and redacted evidence.

Privacy checks:

- Connector runs over stdio with a narrow `GARMIN_ENABLED_TOOLS` allowlist.
- Raw connector JSON/detail payloads may be retained only as redacted local SQLite records for generated analysis; they are not logged or written as app-owned FIT/files, and obvious credential/token/auth/cookie/secret fields are redacted before storage/exposure.
- LLM tools return bounded local SQLite summaries/slices or generated-analysis manifests/results and include privacy notes; they do not expose credentials, token paths, raw FIT bytes, full raw payload dumps, generated filesystem/network/process access, or unrestricted history.
- Learned memory is retrieved only after user confirmation; pending, deleted, rejected, superseded, expired, or reconfirmation-due records are inactive.
- Local production smoke uses `npm run build` plus `npm run start:local`; loopback access is supported, LAN/public exposure is not.
