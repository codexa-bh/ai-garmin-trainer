# Architecture

## Boundaries

- `src/lib/auth`: Better Auth configuration, allowlisted Google identity checks, protected server helpers.
- `src/lib/db`: Drizzle schema and SQLite migration bootstrap.
- `src/lib/garmin`: pinned stdio-only Garmin MCP boundary, normalization, checkpoints, and sync orchestration.
- `src/lib/ai`: provider registry, grounded context selection, non-medical prompts, streaming chat, and profile extraction.
- `src/app`: authenticated UI, sync controls, chat, profile, and deletion routes.

The app stores normalized Garmin facts only. Raw connector payloads are transformed in memory and discarded after upsert.
