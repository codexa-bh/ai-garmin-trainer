# AI Garmin Connect Trainer

Local-only, single-user private trainer MVP for importing Garmin Connect history and chatting with a grounded non-medical fitness coach.

## Quick start

1. Install Node 22+ and Python tooling capable of running `uvx`.
2. Copy `.env.example` to `.env.local` and fill in local secrets. Do not commit `.env.local`, SQLite files, backups, or Garmin token directories.
3. Create a Google OAuth web client with callback `http://localhost:3000/api/auth/callback/google` and add the operator email to `ALLOWED_GOOGLE_EMAILS`.
4. Run `npm run doctor` and fix any failed preflight checks. Doctor reports environment/config/database/provider/Garmin auth-state presence without printing secret values, token contents, prompts, precise GPS streams, or raw connector payloads.
5. Authenticate Garmin out of band with the pinned connector: `garmin-mcp-auth` (or the equivalent command provided by `Taxuspt/garmin_mcp` at commit `2974244bfda1595b00836b3f942f579ec2d6f7d6`). The app never asks for the Garmin password. Current connector auth writes OAuth state to its default `~/.garminconnect/garmin_tokens.json`; the app verifies that file exists without reading token contents.
6. Run `npm install`, `npm run db:migrate`, `npm run build`, then `npm run start:local` for the production-style loopback runtime. Use `npm run dev` only for maintainer development.

## Validation

Run `npm run validate` for formatting, linting, type checking, tests, and production build. Additional source-beta evidence commands are `npm run doctor -- --json`, `npm run eval:reliability`, and `npm run deps:evidence -- --output <path>`.

## Safety and privacy

- This is not medical software. It gives fitness coaching only and never diagnosis or treatment guidance.
- Garmin access is local-only through stdio to a pinned unofficial connector; HTTP transport and connector write operations are not used.
- The trainer sees only app-normalized summaries selected for the current conversation, never Garmin credentials or raw connector payloads.
- Profile, recent transcript, Garmin facts, and confirmed learned memories are separate concepts. Learned memories are inactive until confirmation; temporary constraints expire or require reconfirmation before use.
- Clear chat/profile/learned memory independently from Garmin data, or disconnect Garmin and delete normalized Garmin records/checkpoints for a clean reconnectable state. See `docs/source-beta-readiness.md` for backup, restore, export, reset, uninstall, dependency-evidence, and support artifact boundaries.
