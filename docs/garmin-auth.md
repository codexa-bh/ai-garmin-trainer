# Garmin authentication: one local location

Set **only `GARMIN_MCP_TOKEN_DIR`** in ignored `.env.local`. This is a literal directory path, never token contents. Missing or blank settings disable Garmin operations with actionable diagnostics; other app features and offline doctor remain available. No home store, unrelated file, inherited `GARMINTOKENS`, or base64 store is an alternate source.

Relative settings resolve against the app process working directory: run npm commands from the selected checkout. Paths with spaces work. Shell expansion (`~`, `$HOME`), URLs, and control characters are rejected. Use an absolute durable primary-repository path when copying local env into disposable worktrees. Do not strand the only usable credentials in a removable worktree.

## Existing credentials first

1. Resolve only your known old configured store and intended durable store; do not scan home/Downloads. Preserve originals. Never choose by modification time or infer expiry from a missing file.
2. Prefer a working existing durable store. Before moving anything, verify a private copy using a bounded, noninteractive token-only authenticated read through the pinned dependency. A copy protects originals from library refresh. Do not provide email/password variables or invoke ordinary interactive auth as a probe. Distinguish local config/file errors, credential rejection, rate limits/network/service failures, and inconclusive results. Never log raw library errors or account payloads.
3. If copying a proven working set, use exclusive no-overwrite copying into the selected directory. Stop for conflicting candidates, uncertain account/provenance, or any required overwrite. Leave originals inactive for rollback, not runtime fallbacks.
4. Set the explicit absolute setting in local env. Keep `.env.local` and credential files owner-private (`0600`), directories `0700`, and verify `git check-ignore` before placing secrets under a repository. `.env.local` and `.garmin-token/` are already ignored; ignore coverage alone is not privacy protection.
5. Run `npm run doctor -- --json`. A passing auth-state check means only that `garmin_tokens.json` is a readable, nonempty regular file. It never opens credential contents or proves validity, lifetime, or expiry. Directory/file symlinks, wrong types, empty/missing files and access failures fail safely. The retained `defaultTokenFilePresent` diagnostic fact is always false: no default is inspected.
6. Verify current authentication separately with a bounded live connector read and app sync on a disposable populated SQLite copy. Preserve the primary DB. There is no schema/backfill/checkpoint reset required solely for this configuration repair.

## New authentication, only when needed

Run `npm run garmin:auth` yourself in a private interactive terminal from the app checkout. The entry point loads local env with the same Next.js convention as doctor and runs the pinned `garmin-mcp-auth` executable with the reviewed `mcp==1.28.1` SDK constraint. It accepts no path/force/verify overrides and refuses unattended invocation or existing credential overwrite. If replacement is genuinely required, preserve existing artifacts out of the selected directory yourself before retrying; do not delete your only usable credentials.

The auth directory must be owner-private and contain no symlinks. New directories use `0700`; a private umask protects generated files. The expected credential file is `garmin_tokens.json`; the upstream base64 companion is internally derived as `garmin_tokens.base64` inside that same directory. It is an output artifact, not a second configurable input. Both remain private/ignored. Never run bare upstream auth as an alternate app setup route.

The app maps its resolved setting to upstream `GARMINTOKENS` and `GARMINTOKENS_BASE64`, replacing inherited alternates. It removes inherited Garmin email/password values and file references and forces stdio. All four FIT launchers receive the same resolved environment; standalone Python helpers require that absolute app setting and never search elsewhere. Interactive upstream output is for the operator's private terminal only: do not copy it, passwords, MFA codes, tokens, account details or token paths into chat, screenshots, app diagnostics, PRs or support artifacts. Upstream broad auth/expiry wording is not evidence of token lifetime.
