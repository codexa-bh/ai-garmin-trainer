# Garmin connection and private key handling

Garmin data comes only from Garmin's official **Personal API** over HTTPS, read with your own **Personal API key**. The app does not sign in with your Garmin email/password, does not handle MFA and does not need Python, uv or uvx.

## Desktop: Connect Garmin

1. Create a key in Garmin Connect (**Settings → Personal API key**, `https://connect.garmin.com/app/settings/personalApiToken`). You sign in and create it in your own browser; the app never automates or observes that session. The Settings link opens that fixed page through the native host.
2. Open **Settings** from the native app menu → **Connect Garmin** (**Replace Garmin key** when one is saved) and paste the key into **Garmin Personal API key**.
3. **Save** (first run: **Finish**), then explicitly quit and reopen Trainer. A saved key is used only from the next launch; Save never switches the running connection or an active import.

The connection summary and the key control share one Garmin section; **Key and private storage details** stays collapsed until opened. First run keeps **Continue without Garmin**; ordinary Settings shows **Back — keep saved connection** while the key control is open. Back, Cancel and closing Settings discard a typed key draft without saving. Configured-provider chat and saved/offline history remain available without Garmin; fresh Garmin data and coaching grounded in it need a working key. No automatic login, startup probe or sync runs.

### Key presence and replacement

Settings shows presence only: **Key saved**, **Not connected** or **Reconnect needed**. A saved key is never shown again; the field shows a mask. Leaving the field untouched keeps the saved key, typing replaces it, and deleting the masked value clears it on Save. A blank field or the mask never becomes key data or a silent removal. Clearing a key stops future Garmin reads after reopen; it never deletes saved history.

**Key saved** reports configuration, not validity. Garmin decides how long a key stays valid and may revoke it; the app does not guess an expiry from the key. **Sync → Garmin maintenance → Verify connection** is the only explicit check: one key exchange plus a profile read, reported as accepted, rejected (mistyped, expired or revoked), rate-limited or network/service unavailable. Settings open, Save, startup and summary reads never call Garmin.

### Storage and privacy

The key is stored in the native owner-private settings file under platform app data (`settings-v3.json`, `0600` in a private directory, pinned no-follow reads, revision-checked atomic writes). This is **plaintext, not encryption**: same-user and privileged processes and backups can read it. At launch native passes it to the owned backend through the private startup frame, never argv, environment, files or logs; the backend keeps it in a process-owned capability that trainer chat, the model, SQL tools, HTTP responses, debug traces and raw archives cannot read. Live provider/catalog updates never carry it. Never paste the key into chat, screenshots, issues or support artifacts.

Recovery copy distinguishes a rejected key (create and save a new one), rate limiting and network/service failures (retry later; not a key problem) and local settings failures. No automatic retry. Sync recovery points to native Settings, never terminal commands or manual file edits. See [native lifecycle and recovery](desktop.md) and [Garmin access risk](garmin-risk.md).

## Existing installations from the unofficial connector

Earlier builds used an unofficial connector with saved token files. On upgrade, Settings shows **Reconnect needed**: create a Personal API key and save it. Saved history, provider settings and chat remain available offline in the meantime. The old token directory and its files are kept exactly as they were: they are not read, refreshed, converted, moved or deleted, and nothing falls back to them. Their old settings entries stay as inert compatibility metadata in the preserved settings file and are never forwarded to the backend. Delete old token files yourself only when you no longer need them for an older build.

## Maintenance CLIs

The non-serving source CLIs (`doctor`, `db:status`, `db:migrate`) never read native Settings, the Garmin key or token files and never contact Garmin. There is no terminal Garmin sign-in command.
