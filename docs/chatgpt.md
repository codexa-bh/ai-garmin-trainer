# ChatGPT subscription access

Optional ChatGPT subscription is separate from OpenAI API keys/billing. This local public-source app uses documented [Sign in with ChatGPT](https://developers.openai.com/siwc/token-sharing-open-source), not borrowed Codex credentials, partner keys or app login. OpenAI determines eligibility/models/plan credits; hosted/commercial use has separate requirements. No automatic paid-API fallback.

## Connect and choose explicitly

1. Native Settings → ChatGPT subscription → Continue with ChatGPT for initial connection. One active connection is reused. Switch account chooses a **retained** registration and Continue with selection authorizes its issued client; Back/cancel/failure preserves active connection. New account/workspace intentionally creates a registration, never reconnects/looks up a saved identity. Ambiguous legacy records require explicit Connection to keep; do not pick first or match email labels. Never share browser/callback URLs/passwords/tokens.
2. Identity-only sign-in is not plan permission. Deliberately Enable plan permission; declining preserves saved state.
3. Refresh models for the selected registration. No auto-selection. Switching makes old catalog/Trainer/summary identities unavailable, never retargets them. Returning auth chooses saved client/host **before** browser and verifies original identity/client. Distinct issued clients may represent different workspaces for the same subject/email; no silent merge/delete/revoke.
4. Check Models to add, Add selected, then Save settings. Picker counts only new selections; existing pairs are hidden and exhausted picker disappears. Whole batch must fit 32-entry limit or nothing adds. Catalog rows include drafts; Cancel restores saved rows but cannot undo independently committed credentials.
5. Select exact ChatGPT plan/model in Trainer. Shared summary/title model is separate explicit Settings choice; connecting does not replace an API-key choice.

First plan-enabled connection discloses usage once; Trainer labels route and opens only fixed official Manage usage destination. Calls may consume plan/credits, not free/unlimited access, API-priced invoices or remaining-quota estimates. Catalog/key Save uses [live acknowledgment](desktop.md#save-and-live-activation); connection also updates secret-free availability. Unknown/saved-not-applied means inspect saved state/reopen explicitly, not rollback or blind retry.

### Bounded failure diagnostics

Failures expose closed categories/stages/timing/validated HTTP status and validated request ID, never raw bodies/errors/causes/prompts/tokens/account labels/paths. Missing/invalid/overlong metadata is omitted whole, not truncated or invented; old failures are not reconstructed. Stages distinguish upstream request/read, stream validation/SDK decode, native credential/poll/final-current, admission/abort or unknown generation. They show where observed, not proven cause/reconnect advice. Final native-current failure rejects completed output.

Incomplete decoding may record an absent/present terminal receipt comparison: text match/empty/prefix/different; call match/mismatch, counts and changed dimensions count/order/id/name/arguments. Comparison stays in memory; diagnostics contain no text/arguments/IDs/hashes. Text delta/end without matching start is fixed sdk_text_lifecycle_failed, not dynamic item-ID error. Bounded dropped-event counts describe actual locked-SDK fallback outcomes, not approximate schema checks; drops alone do not reject exact output.

Response-created correlation is separate from x-request-id: only `resp_` plus 32 lowercase hex digits is accepted; conflicts/other formats omitted. This conservative observed subset is not authentication or universal ID promise. [Memory failure details](memory.md#paused-summary-recovery) can show the same current projection, collapsed. Full debug traces independently contain private context and are **not shareable support bundles**. Inspect rather than reconnect/replay blindly.

## Recovery and lifetime

- Identity-only: explicitly enable plan permission.
- Missing/stale model: refresh selected registration and choose exact supported entry, never substitute.
- Reconnect/terminal refresh rejection: authorize retained issued client with verified identity.
- Interrupted new registration, known client: deliberate retry reuses retained client/host across restart, never code replay.
- Unknown remote registration effect: preserve state and reconcile intended connected app with operator before any new registration; never delete private files to retry.
- Transient failure: retain connection, inspect/retry deliberately, no sign-in/inference replay loop.
- Usage limit: Manage usage; failure proves neither entire plan exhaustion nor reset time. API route needs separate manual selection.
- Ineligible region/account/route: check current provider support; repeated sign-in/paid fallback is not a remedy.
- Unsafe/unsupported storage: preserve originals/use compatible build; no chmod/adopt/delete bypass. Other providers stay independent.
- Unknown live activation: reload/reopen explicitly; timeout is not rollback/live success.

OAuth lasts≤3min. Cancel/close/quit invalidate only captured attempt, including queued/late results; stale Cancel cannot cancel newer work. Identity validation requires signature/trusted issuer+key/nonce/expiry/account/client checks. Audience may be issued-client string or single-element array; explicit authorized-party must match, multiple audiences require matching party. Failure preserves prior connection and reports only rejected-check category/build version. Browser Return acknowledgment means callback received, not validated/committed.

Discovery failure is separate from sign-in: network/rate/size/unsupported/duplicate categories preserve connection/catalog, not “no models.” Catalog read≤2MiB/256 records; credential/discovery reads retain 128KiB bounds; only validated visible IDs/names project. Inspect before retry, not repeated disconnect/sign-in.

Native serializes/atomically saves rotation; transient failure does not erase credentials. Token-only rotation/unchanged discovery preserves admissions; changed permission/entitlement invalidates affected old admissions. Disconnect first invalidates local access/clears tokens, then attempts renewable-session revocation, preserving issued-client/account/host mapping for reauthorization. Report unconfirmed remote revocation separately. Local committed tool writes remain; unknown effects are never replayed.

## Keep one intended connected app

Reconnect the intended **retained** entry, never New. Operator privately checks provider connected-app list before/after reconnect and ordinary reopen; count must not grow. Identify entries using actual provider details, not names/order/usage/local ordinals. If indistinguishable, defer cleanup.

Operator alone removes identified obsolete entries where supported; allowance-off is not deletion. Revoking retained entry interrupts access. App never merges/deletes remote entries. Verify one intended entry remains and retained reconnect adds none; deferred cleanup is not completed outcome. Never send IDs/labels/URLs/credentials to an assistant.

## Private boundary and compatibility

Native companion storage is owner-private plaintext with pinned no-follow reads, cross-process exclusion and atomic publication—not encryption/secure erasure. Same-user/privileged processes/backups can read it. Newest-file presence is authoritative even unsafe/unsupported; preserve and refuse rather than downgrade/overwrite.

Before first registration, durably write pendingAuthorization with null client to fence unknown remote effects. Retain issued client on known helper result/failure; deliberate retry reuses it. Success atomically clears marker with credential commit. Unknown outcome refuses new registration; older deny-unknown readers may refuse pending documents. Never delete/downgrade/copy credentials around the fence.

Current `chatgpt-v1/records/credentials-v2.json` holds active and≤16 retained recovery registrations. V1 sole entry resolves readonly; multiple need explicit choice. First native write exclusively publishes v2, preserving v1 bytes. Archived entries cannot acquire credentials/discover/service admissions; switches fence epochs. Capacity refuses instead of deleting. No SQLite migration/backfill/history rewrite/private import/cutover is implied.

Only trusted native Settings administers connections. Renderer/model/tools/DB/jobs/support get no tokens/claims/client IDs/paths. Backend receives private startup broker capability, not renderer credential; helper I/O uses pipes, no ID-token argv. Connector/FIT children get neither secrets nor account metadata. Subscription catalog identity binds registration; summary/title uses closed v2 identity; activation wraps prior frame in v4. API-key routes remain compatible, old readers refuse unsupported provider.

Broker uses fixed loopback Node HTTP, not Fetch with browser headers; native browser-header denial stays. Bind exact operation/capability/epoch, bounded response/deadline/cancel, no redirect/cache. Currentness may retry **one pre-response wire failure within original 5s**, still requiring authoritative confirmation. Never replay credential acquisition/native refusal/malformed response/inference/tools.

## Inference behavior

All selected purposes use documented public streaming Responses with OAuth: chat/planner/synthesis/tools/history/local compaction/summary/import/rebuild/Densify/titles, including Summary Off titles. Full history/memory stays client-supplied; no retired vector pipeline/API-key/count endpoint.

Omit unsupported API presets/stored-conversation continuation; require SSE/no fetch cache. Success requires completed terminal stream, exact locked-SDK text/tool receipt and current account—not HTTP 200/delta/MIME/EOF. Validate namespace/tools/status/arguments. Optional function-call item ID is translated to its own call_id for SDK reference only; provider call identity/name/arguments remain exact. Missing/empty terminal output uses completed output items in output_index order; duplicate/out-of-range refuses. Independent delta-versus-completed receipt comparison remains; disagreeing nonempty terminal output fails.

Absent Content-Type still needs bounded valid SSE/completion/namespace/currentness; explicit non-SSE/JSON/stream-looking prefixes do not pass. Partial/malformed/failed/quota/interrupted stays failed with truthful effects/unknown usage. Diagnostics add no call/reconnect/repair/fallback. Tokens are observed, not API-priced or labelled $0. Activity images stay unavailable until this route/model is qualified.

## Verification boundary

Authored credentials/HTTP/SSE/SDK and native storage/broker/rotation/cancel tests prove mechanics, not eligible real account/browser auth/billing. Debug/release-probe cannot open real credential owner/host namespace/discover/authorize/revoke; ordinary smoke stays isolated keyless. [Fictional Settings scenario](smoke/settings.md#finite-chatgpt-settings-presentation) proves only form/layout/retained-new intent/Back.

Actual integration needs eligible saved connection or explicitly arranged private operator sign-in, bounded usage/data authority and noninterfering window. Operator enters credentials privately. Record service proof or unavailable boundary separately. Source delivery grants no install/normal restart/release/primary-data use.
