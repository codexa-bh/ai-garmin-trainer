# Architecture

## Boundaries

- `src/lib/db`: Drizzle schema, explicit SQLite schema versioning, migration integrity checks, profile, confirmed-memory, chat, Garmin data, and deletion repositories.
- `src/lib/diagnostics`: allowlisted source-beta doctor/preflight reporting and redaction canaries.
- `src/lib/garmin`: pinned stdio-only Garmin MCP boundary, normalization, checkpoints, and sync orchestration.
- `src/lib/ai`: provider registry, grounded context selection, non-medical prompts, Profile/recent-chat/Garmin/confirmed-memory separation, deterministic reliability fixtures, streaming chat, and profile extraction.
- `src/app`: local no-auth loopback UI, sync controls, chat, profile, and deletion routes.

The app stores normalized Garmin facts only. Raw connector payloads are transformed in memory and discarded after upsert. Source-beta startup uses `npm run start:local`, which binds the production Next.js server to loopback by default; LAN/public exposure is unsupported.
