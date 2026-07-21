# Source-beta readiness foundation

This repository is ready only for the next controlled clean-machine validation milestone. It is not a public release, desktop package, beta invitation, provider application, deployment, or commercial implementation.

## Supported boundary

- Primary path: local MCP-only advanced-user source beta.
- Platforms prepared here: macOS Apple Silicon first; Ubuntu LTS after reproducibility evidence.
- Unsupported: LAN/public exposure, hosted use, desktop packaging, manual FIT/import fallback, alternate Garmin connectors, public distribution, deployment, release, telemetry, commercial multi-user operation, and treating local no-auth as a hosted safety boundary.
- Garmin connector: `Taxuspt/garmin_mcp` pinned to `2974244bfda1595b00836b3f942f579ec2d6f7d6`, launched over local stdio only, with app-side read-operation allowlisting. Garmin auth remains out of band through `garmin-mcp-auth`; the app checks auth-state file presence only and never reads token contents.

## Setup flow for clean-machine validation

1. Install Node 22+, npm, Python 3, and `uvx`.
2. Copy `.env.example` to `.env.local`; fill `DATABASE_PATH`, pinned Garmin MCP settings, and one BYO model provider key. No Google OAuth, app sign-in secret, or email allowlist is required for private loopback use.
3. Run `npm run doctor -- --json` and fix any `fail` checks. Doctor output is allowlisted: versions, config presence booleans, schema/integrity state, connector pin/auth-state presence, provider key presence, and loopback posture. It does not print credentials, token contents, provider keys, prompts, precise GPS streams, or raw connector payloads.
4. Run `npm install`.
5. Run `npm run db:migrate`. Existing SQLite files are copied to `data/backups/trainer-schema-backup-*.sqlite` before upgrade/user-data validation; migration verifies `pragma integrity_check` after applying the versioned schema.
6. Run `npm run build` and `npm run start:local`. The supported production-local command binds Next.js to `127.0.0.1:3000` by default. LAN/public host binding is unsupported and flagged by doctor.
7. Authenticate Garmin out of band with `garmin-mcp-auth`. Never paste Garmin password, MFA code, tokens, cookies, or token file contents into the app, chat, diagnostics, or support issues.

## Local data lifecycle

| Operation               | Source-beta behavior                                                                                                                                                                                                                                                            |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Schema upgrade          | `npm run db:migrate` records explicit schema version in `app_metadata`, creates/updates tables, backs up existing user-data databases before upgrade, and verifies integrity.                                                                                                   |
| Restore                 | Stop the app, replace `DATABASE_PATH` with a backup SQLite file, run `npm run db:migrate`, and run `npm run doctor -- --json`. Automatic downgrade is not supported; pre-upgrade backups are the rollback boundary.                                                             |
| Export                  | No one-click product export exists yet. For clean-machine validation, export is a manual SQLite copy after stopping the app. Exports must exclude `.env.local`, provider keys, Garmin token files, shell history, and diagnostics unless explicitly reviewed.                   |
| Clear chat/profile      | Deletes conversations, messages, explicit profile, and confirmed/pending learned-memory rows. It preserves normalized Garmin data.                                                                                                                                              |
| Delete Garmin data      | Deletes app-managed normalized Garmin rows, detail tables, sync runs, and checkpoints. It does not delete external Garmin token files.                                                                                                                                          |
| Garmin disconnect/reset | Stop the app, optionally delete app-managed normalized Garmin data, then manually remove the app-owned `GARMIN_MCP_TOKEN_DIR` or upstream `~/.garminconnect/garmin_tokens.json` if the user chooses to reset Garmin auth.                                                       |
| Backup                  | Copy SQLite only after stopping the app. Do not bundle model-provider keys, Garmin token contents, prompts, raw connector payloads, or precise GPS streams into support artifacts.                                                                                              |
| Uninstall               | Stop `npm run start:local`, remove the source/worktree directory, optionally remove SQLite data/backups, optionally remove app-owned Garmin token directory, and remove `.env.local`/provider keys. No background service or launch item is installed by this source-beta path. |

## Memory and coaching reliability

The product treats source categories separately:

- Explicit Profile: user-authored goals, sports, preferences, and constraints.
- Confirmed learned memories: low-risk preferences/corrections that affect future answers only after user confirmation.
- Temporary constraints/commitments: active only until `expires_at` or `reconfirm_after`.
- Garmin facts: normalized source data and deterministic analytics, not generic memory.
- Recent transcript: bounded context only, untrusted for policy/tool/deletion decisions.

Pending, rejected, superseded, deleted, expired, or reconfirmation-due learned memories are not retrieved into model context. The deterministic `npm run eval:reliability` gate covers critical deletion, diagnostic redaction, prompt-injection, non-medical safety, missing/detail evidence, and expired-memory cases without snapshotting provider prose.

## Diagnostics and support artifact rules

- Run `npm run doctor` or `npm run doctor -- --json` for support triage.
- Review output before sharing even though it is redacted by default.
- Never share `.env.local`, model-provider keys, Garmin token files, token contents, raw connector payloads, precise GPS streams, full prompts/chat logs, shell history, screenshots containing secrets, or raw SQLite files in public or broad support channels.

## Dependency evidence

Run `npm run deps:evidence -- --output <path>` to generate a bounded local evidence JSON containing Node dependency counts, lockfile hash, Garmin MCP pin/transport/auth boundary, Python/uvx dependency boundary, and optional npm audit output when `--audit` is supplied. This evidence surfaces blockers; it is not a legal/security/license conclusion and does not authorize external beta invitations or redistribution.
