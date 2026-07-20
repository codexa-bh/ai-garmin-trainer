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

1. Sign in with an email in `ALLOWED_GOOGLE_EMAILS`.
2. Confirm an unallowlisted Google account fails closed where practical.
3. Run out-of-band `garmin-mcp-auth` and verify connector status in the app. The current connector auth stores OAuth state at `~/.garminconnect/garmin_tokens.json`; verify only file existence, never contents.
4. Sync activities to exhaustion and daily health from `GARMIN_HISTORY_START_DATE` through today.
5. Enter one imported Garmin activity ID in Activity detail and run Backfill detail. Confirm the status reports normalized record/lap counts or an explicit unsupported/failed reason; no raw FIT files should be created by the app.
6. Use Show detail coverage to verify per-activity fields such as streams, GPS, elevation, HR, grade, power, recovery, record count, and lap count.
7. Interrupt a sync, resume it, and run again to verify idempotency.
8. Chat with OpenAI/DeepSeek using imported facts. Ask for a specific activity analysis and verify the response cites deterministic tool results rather than inventing calculations from summaries.
9. Restart the app and verify conversation/profile/detail coverage persistence.
10. Edit profile memory and verify later responses reflect the correction.
11. Clear chat/profile/learned memory, then disconnect/delete Garmin data and verify activity detail tables are also removed and the state is reconnectable.

Privacy checks:

- Connector runs over stdio with a narrow `GARMIN_ENABLED_TOOLS` allowlist.
- Raw connector JSON/FIT bytes are normalized in memory, not logged, and not retained as app-owned files.
- LLM tools return bounded local SQLite summaries/slices and include privacy notes; they do not expose credentials, token paths, raw FIT bytes, or unrestricted history.
- Learned memory is retrieved only after user confirmation; pending, deleted, rejected, superseded, expired, or reconfirmation-due records are inactive.
- Local production smoke uses `npm run build` plus `npm run start:local`; loopback access is supported, LAN/public exposure is not.
