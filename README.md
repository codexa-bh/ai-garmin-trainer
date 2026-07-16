# AI Garmin Connect Trainer

Local-only, single-user private trainer MVP for importing Garmin Connect history and chatting with a grounded non-medical fitness coach.

## Quick start

1. Install Node 22+ and Python tooling capable of running `uvx`.
2. Copy `.env.example` to `.env.local` and fill in local secrets. Do not commit `.env.local`, SQLite files, or Garmin token directories.
3. Create a Google OAuth web client with callback `http://localhost:3000/api/auth/callback/google` and add the operator email to `ALLOWED_GOOGLE_EMAILS`.
4. Authenticate Garmin out of band with the pinned connector: `garmin-mcp-auth` (or the equivalent command provided by `Taxuspt/garmin_mcp` at commit `2974244bfda1595b00836b3f942f579ec2d6f7d6`). The app never asks for the Garmin password.
5. Run `npm install`, `npm run db:migrate`, then `npm run dev`.

## Validation

Run `npm run validate` for formatting, linting, type checking, tests, and production build.

## Safety and privacy

- This is not medical software. It gives fitness coaching only and never diagnosis or treatment guidance.
- Garmin access is local-only through stdio to a pinned unofficial connector; HTTP transport and connector write operations are not used.
- The trainer sees only app-normalized summaries selected for the current conversation, never Garmin credentials or raw connector payloads.
- Clear chat/profile memory independently from Garmin data, or disconnect Garmin and delete normalized Garmin records/checkpoints for a clean reconnectable state.
