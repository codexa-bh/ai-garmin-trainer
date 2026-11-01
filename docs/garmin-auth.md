# Garmin connection and private authentication

## Desktop: Connect Garmin

Open **Settings** from the native app menu → **Connect Garmin**, or **Reconnect Garmin** for an existing selection. First run offers **Continue without Garmin**; existing installations can connect later. Configured-provider chat and saved/offline history remain available without Garmin, while fresh Garmin data and coaching grounded in it require a working connection. No automatic login, startup probe or sync runs.

Compatible saved connections remain selected exactly where they are, without finding, importing, moving or replacing token files. **Configured — not verified** reports saved configuration only, never current authentication or expiry. Desktop never imports env files, discovers alternate stores or uses its old pointer. Invalid saved configuration is preserved for recovery, not blank-install authority.

For new sign-in, enter email/password and one supported MFA code privately in trusted native Settings, never trainer chat, screenshots or issues. Only this local document has the narrow auth privilege: trainer/model/HTTP/debug smoke do not. The first-party locked `garminconnect==0.3.2` adapter receives transient credentials over private native pipes, never argv/env/files/logs. Native owns one UUID-bound session, a 180-second absolute deadline and Cancel. Managed runtimes minimize copies but cannot promise perfect zeroization.

The app chooses fresh private storage under platform app-data, outside source/bundle; there are no manual token folder controls. Pinned no-follow parent traversal validates ownership, private permissions and identity; insecure existing objects are refused, not chmodded. Fresh UUID destinations remain absent until independent token-login/profile-presence verification and exclusive atomic publication. Parent/staging substitutions, aliases, hardlinked token files, collisions and late-result/cancel races refuse without overwriting originals. Compatible `garmin_tokens.json` and `garmin_tokens.base64` remain `0600` in `0700` directories. This is **plaintext, not encryption**: same-user/privileged processes and backups can read it.

**Connected — verified during this sign-in** proves only that authentication worked then, not lifetime or future availability. Choose **Use this verified connection** to select the matching session's published result in draft. Then first-run Review/Finish, or ordinary Save and explicit quit/reopen. Pending activation is distinct from the running connection. Reconnect never switches a running backend/import or deletes/rotates the old store. Independently published tokens survive later settings failure/cancellation; reconcile their native session result before another attempt. Closing/cancelling settings discards unsaved selection, not published tokens.

Rejected credentials/MFA, unsupported/repeated challenges, tooling unavailable, network/service failure, rate limits, timeout and protocol/publication refusal have separate sanitized states. Network/tooling/rate-limit failures do not establish expiry or make login a remedy. No automatic retry, second MFA submission, region/CAPTCHA bypass or official OAuth claim. Sync recovery points back to native Settings, never terminal auth or manual token manipulation. Metadata-only Verify connector remains explicitly metadata-only. See [native lifecycle and recovery](desktop.md) and [unofficial connector risk](garmin-risk.md).

## Maintenance-only token configuration

The retained non-serving CLIs are separate from desktop onboarding and never read private native Settings or legacy Keychain. Their deliberately authored ignored `.env.local` or process environment uses **only `GARMIN_MCP_TOKEN_DIR`**, a literal directory path, never token contents. Missing/blank configuration disables Garmin without searching home/default stores, unrelated files, inherited `GARMINTOKENS` or base64 stores. No credential fallback exists.

Relative maintenance paths resolve against the process working directory; run commands from the explicitly selected checkout. Paths with spaces work. Shell expansion (`~`, `$HOME`), URLs and control characters are rejected. Use a durable absolute location, never the only credentials in a disposable worktree. Native desktop paths remain canonical absolute paths.

### Existing credentials first

1. Resolve only a known configured store; never scan home/Downloads, choose by modification time or infer expiry from absence. Preserve originals.
2. Verify a private copy through a bounded noninteractive token-only authenticated read using the pinned dependency. Copies protect originals from library refresh. No email/password variables, interactive auth probe, raw errors or account payload logs. Distinguish rejection, local configuration, rate limits, network/service and inconclusive results.
3. Any deliberately selected copy must be exclusive/no-overwrite. Stop for uncertain account/provenance, conflicting candidates or overwrite. Preserve originals for rollback, not runtime fallbacks.
4. Keep directories `0700` and files `0600`; verify ignore coverage before any secret placement under a repo. Ignoring is not privacy protection. Do not share env values or token paths/contents.
5. `npm run doctor -- --json` checks readable/nonempty regular-file metadata only, not validity/lifetime/expiry. Aliases, wrong types, missing/empty files and access failures refuse. `defaultTokenFilePresent` is always false; no default is inspected.
6. Separate bounded live connector read/sync evidence uses disposable populated SQLite and token copies; no schema/backfill/checkpoint reset is required merely for configuration repair.

### Private-terminal authentication, only when needed

Advanced maintenance only: run `npm run garmin:auth` yourself in a private interactive terminal from an explicitly configured checkout. It loads local env using the existing Next convention and runs pinned `garmin-mcp-auth` with reviewed `mcp==1.28.1`. It refuses unattended invocation, path/force/verify overrides and existing credential overwrite; UI never scrapes it. Preserve originals before any separately authorized replacement; never delete the only usable credentials or run bare upstream auth as an alternate desktop setup route.

The selected maintenance directory must be private/unaliased. New directories use `0700` and private umask; expected output is `garmin_tokens.json`, with derived `garmin_tokens.base64` alongside, not a second input. App/MCP/FIT launchers map the resolved setting to upstream variables, strip inherited Garmin email/password/file/provider credentials and force stdio. Standalone Python helpers require that absolute app setting and never search elsewhere. Never share auth output, passwords/MFA/tokens/account details or token paths in chat, logs, screenshots, PRs or support artifacts. Broad upstream auth/expiry wording is not evidence of lifetime.
