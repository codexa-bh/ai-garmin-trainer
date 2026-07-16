# Local validation and smoke checklist

Automated validation:

```bash
npm run format
npm run lint
npm run typecheck
npm run test
npm run build
```

Live smoke with local secrets:

1. Sign in with an email in `ALLOWED_GOOGLE_EMAILS`.
2. Confirm an unallowlisted Google account fails closed where practical.
3. Run out-of-band `garmin-mcp-auth` and verify connector status in the app. The current connector auth stores OAuth state at `~/.garminconnect/garmin_tokens.json`; verify only file existence, never contents.
4. Sync activities to exhaustion and daily health from `GARMIN_HISTORY_START_DATE` through today.
5. Interrupt a sync, resume it, and run again to verify idempotency.
6. Chat with OpenAI using imported facts, restart the app, and verify conversation/profile persistence.
7. Edit profile memory and verify later responses reflect the correction.
8. Clear chat/profile, then disconnect/delete Garmin data and verify a reconnectable empty state.

```

```
