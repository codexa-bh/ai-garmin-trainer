# ChatGPT subscription access

ChatGPT subscription and **OpenAI API key** are separate optional providers. The local, public-source desktop app uses OpenAI's documented [Sign in with ChatGPT flow](https://developers.openai.com/siwc/token-sharing-open-source). It does not borrow Codex credentials, require a partner key, add an app-access login or automatically switch to paid API billing. Eligibility, supported models and plan/credit restrictions are determined by OpenAI; remotely hosted/commercial use has separate requirements.

## Connect and choose explicitly

1. Open native **Settings → ChatGPT subscription → Continue with ChatGPT**. Complete authorization privately in your system browser. Never paste passwords, tokens, callback URLs or authorization URLs into chat, logs or issues.
2. A signed-in identity is not necessarily plan-use permission. If Settings reports identity-only access, use **Enable plan permission** deliberately. Declining/cancelling preserves prior saved connections.
3. Select the saved registration, then **Refresh models**. Only that registration's visible model catalog is offered. Account changes clear the previous model choice; nothing chooses the first account/model automatically. Separate registrations remain separate even when their email labels match.
4. Select an account model and **Add model**, then **Save settings**. Connection credentials are saved independently of catalog drafts. Cancelling a catalog edit does not roll back an already committed connection.
5. Choose the exact **ChatGPT plan · account / model** entry in Trainer. The shared **Memory and automatic chat-title model** is a separate explicit choice in Settings; connecting a subscription never retargets an existing API-key choice.

The first successful plan-enabled connection displays the plan/credit disclosure once. Trainer identifies the subscription billing route and offers **Manage usage**, which opens the fixed official ChatGPT usage destination. Requests can consume plan usage or credits: this is not a free/unlimited allowance, API token-price invoice or remaining-quota estimate.

Catalog/key Save uses the existing live acknowledgment. A successful connection also updates the owned backend's secret-free availability metadata. Saved/not-applied or unknown results do not mean rollback or permission to retry blindly: reload to inspect saved state, and explicitly quit/reopen when activation cannot be confirmed. Ordinary Save never restarts the backend. Other startup-only settings remain restart-only.

## Recovery and lifetime

| State                                              | Deliberate next action                                                                                                                                                                   |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Signed in, plan permission required                | Enable plan permission; do not assume identity access authorizes inference.                                                                                                              |
| No account model selected / stale or removed model | Refresh the selected registration's catalog and choose a supported entry explicitly. Old preferences remain visible/unavailable, never substituted.                                      |
| Reconnect required / terminal refresh rejection    | Continue with the selected saved registration; its issued client and verified identity must still match.                                                                                 |
| Transient network/service failure                  | Retain the connection and inspect/retry deliberately. There is no sign-in loop or automatic inference replay.                                                                            |
| Usage limit                                        | Manage usage. The failure does not establish whole-plan exhaustion or a reset time. API-key routing requires a separate manual selection.                                                |
| Ineligible account, region, route or capability    | Check current OpenAI eligibility/model support. Repeated sign-in or a paid fallback is not an automatic remedy.                                                                          |
| Private connection state unavailable / unsupported | Preserve originals and use a compatible build or reconcile private storage. Do not delete/chmod/adopt files to bypass refusal. Other configured API-key/local routes remain independent. |
| Saved/live activation unknown                      | Inspect saved state and explicitly reopen if necessary; do not treat a timeout as rollback or a confirmed live update.                                                                   |

Authorization is bounded to three minutes. Cancel/Settings-close/quit invalidate the captured native attempt, including queued or late results. A stale Cancel cannot cancel a newer attempt. Token rotation is serialized and atomically saved by native ownership; transient failures do not erase credentials. Changed plan permission or model entitlements invalidate the affected account's older admissions; unchanged discovery and token-only rotation preserve them.

**Disconnect** invalidates local access and clears local tokens before attempting renewable-session revocation. The issued-client/account mapping and host identity remain for deliberate reauthorization. A remote revocation failure is reported separately; manage access in ChatGPT if confirmation is unavailable. Already committed local tool writes remain committed, and interrupted/unknown effects are not silently replayed. Unrelated providers retain their captured settings.

## Private boundary and compatibility

Native code owns an original-preserving versioned companion record beside private Settings, with owner-private directories/files, pinned no-follow reads, cross-process exclusion and atomic publication. Storage is **plaintext, not encryption**: same-user/privileged processes and backups can read it. No secure-erasure guarantee is made. Unsupported/unsafe records refuse without downgrade or overwrite.

Only trusted native Settings can authorize or administer a connection. Renderer/model/tool/SQLite history/job/support data receive no tokens, raw claims, issued client IDs or credential paths. The owned backend receives a private startup capability, not a renderer credential. OAuth/network helper input/output use private pipes; ID-token hints do not enter process argv. Connector/FIT children receive neither provider secrets nor subscription account metadata.

Existing settings/catalog entries and API-key summary encodings remain compatible. Subscription entries additionally bind an opaque local registration; shared summary/title selection uses a closed version-2 identity. Older readers refuse the new provider instead of downgrading it. Startup activation wraps the prior frame in version4; credential records are version1. There is no SQLite schema migration, Garmin backfill, historical accounting rewrite, private-file import or primary cutover for this provider addition.

## Inference behavior

Every applicable subscription purpose uses selected-account OAuth at the documented public streaming Responses endpoint: coaching/planner/synthesis, namespaced local tools, linked history, supported local compaction, independent summaries/maintenance/rebuild/import/Densify and automatic titles (including Summary Off). Full required history and saved memory remain client-supplied. Ordinary coaching does not restart retired vector extraction/embeddings or require API keys/a separate token-count endpoint.

The adapter omits unsupported direct-API presets and stored-conversation continuation. Success requires a completed terminal stream, not HTTP200, a text delta or EOF. Malformed/partial/incomplete/failed/quota/interrupted output stays failed; local effects and missing usage counters remain truthful. No automatic paid fallback or generation repair/replay is added. Subscription tokens are observed when returned, never multiplied by API prices or labelled $0. Selected activity-image analysis remains unavailable until that route/model capability is verified.

## Verification boundary

Deterministic tests exercise the production composition and actual serialized HTTP/SSE with authored credentials; native tests cover protected storage/refresh/cancellation and admission. The finite keyless [Settings presentation scenario](dev-bridge.md#finite-chatgpt-settings-presentation) verifies native layout and actual form controls using fictional secret-free metadata, without a credential owner or provider request. None of those certifies an eligible real account, browser authorization, real token renewal or billed inference.

Actual integration requires an explicitly arranged private operator sign-in, eligible account, bounded subscription-usage permission, authored app data and a noninterfering native window. The operator enters credentials privately. Record that exact service proof—or its unavailable boundary—separately from synthetic/native presentation. Source delivery does not install, restart the normal app, release or authorize primary-data use.
