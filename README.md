# AI Garmin Connect Trainer

Local-only, single-user private trainer MVP for importing Garmin Connect history and chatting with a grounded non-medical fitness coach.

## Quick start

1. Install Node 22+ and Python tooling capable of running `uvx`.
2. Copy `.env.example` to `.env.local` and fill in local secrets/provider keys. No local app sign-in, Google OAuth client, or allowlist is required for normal loopback use. Do not commit `.env.local`, SQLite files, backups, or Garmin token directories.
3. Run `npm run doctor` and fix any failed preflight checks. Doctor reports environment/config/database/provider/Garmin auth-state presence without printing secret values, token contents, prompts, precise GPS streams, or raw connector payloads.
4. Authenticate Garmin out of band with the pinned connector: `garmin-mcp-auth` (or the equivalent command provided by `Taxuspt/garmin_mcp` at commit `2974244bfda1595b00836b3f942f579ec2d6f7d6`). The app never asks for the Garmin password. Current connector auth writes OAuth state to its default `~/.garminconnect/garmin_tokens.json`; the app verifies that file exists without reading token contents.
5. Optional semantic memory: configure embedded SQLite semantic memory using `docs/memory.md`; leave `MEMORY_ENABLED=false` to run without semantic memory.
6. Run `npm install`, `npm run db:migrate`, `npm run build`, then `npm run start:local` for the production-style loopback runtime. Use `npm run dev` only for maintainer development.

## Design reference

See `docs/design-choices-and-boundaries.md` for the main design choices, app component responsibilities, and separation of concerns between AI reasoning, guarded SQL, bounded math, local storage, Garmin import, and UI/API routes.

## Validation

Run `npm run validate` for formatting, linting, type checking, tests, and production build. Additional source-beta evidence commands are `npm run doctor -- --json`, `npm run eval:reliability`, and `npm run deps:evidence -- --output <path>`.

## Safety and privacy

- This is not medical software. It gives fitness coaching only and never diagnosis or treatment guidance.
- Local app access has no sign-in gate and is supported only on private loopback/localhost; do not expose it on LAN, public hosts, tunnels, or deployments.
- Garmin access is local-only through stdio to a pinned unofficial connector; HTTP transport and connector write operations are not used.
- The trainer sees app-normalized summaries and, for generated analysis, bounded redacted local raw-payload snippets selected for the current request; it never sees Garmin credentials, token/auth/cookie fields, connector config, environment values, filesystem paths, or unrestricted raw dumps.
- Profile, recent transcript, Garmin facts, and embedded semantic memory are separate concepts. Memory is extracted only after completed persisted turns, can be inspected/edited/deleted/cleared/disabled, and is lower authority than Profile and Garmin/tool evidence.
- Clear chat/profile, clear semantic memory, and Garmin deletion are separate controls; disconnect Garmin and delete normalized Garmin records/checkpoints only for a clean reconnectable Garmin state. See `docs/source-beta-readiness.md` and `docs/memory.md` for backup, restore, export, reset, uninstall, dependency-evidence, and support artifact boundaries.
