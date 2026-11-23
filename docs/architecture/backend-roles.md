# Architecture: backend roles and composition

Part of [architecture](../architecture.md).

## Enforced backend roles and composition inventory

[`scripts/backend-roles.mjs`](../../scripts/backend-roles.mjs) is the per-file feature/layer inventory; do not maintain a parallel file list here. [Guardrails](../project-guardrails.md#featurelayer-ownership-runtime-and-erased-contracts) owns allowed edges, erased contracts and checker limitations. Folder names confer no exemption.

Feature applications consume plain contracts/ports; adapters supply capabilities; composition binds them; HTTP invokes composition, not concrete infrastructure. Follow the relevant [area guide](../architecture.md#area-guides) for Chat/AI, Garmin, analytics/local-data, personalization and plans. Operational auth/migration/status/doctor scripts are outer entrypoints, not domain services.

Composition binds functions **without opening resources at import time**. Lifetimes:

- One lazy SQLite connection; synchronous feature transactions.
- One reader per Garmin import, closed by that invocation. Explicit Sync cancellation/disconnect stops admission/owned reader work, not committed normalized data.
- One readonly session per guarded SQL call, closed by that call.
- One disposable tool context per AI turn and timeout per provider call. Chat disconnect is not provider cancellation.
- Captured memory/provider configuration per admitted work item. Shared-key changes rotate the lazy current store without changing in-flight snapshots; subscription invalidation follows registration epochs.

There is no DI container, ambient setter or eager initialization. `backend-composition.test.mjs` checks all route families with DB/env/provider/connector probes; construction must not access them. Feature application, wiring and adapter tests cover actual use.

## Model configuration

`model-settings` owns strict versioned catalog/preferences and supplied-port application policy; [local runtime](../local-runtime.md) owns exact choice compatibility and [desktop](../desktop.md) owns activation/live apply. Chat captures one selection/config snapshot before context awaits. Shared launcher/Next state is a narrowly named validated catalog/key cell, not a mutable whole-config env overlay. Live POST/GET checks boot/generation/revision; native lock order is service-before-settings with nonblocking startup acquisition and bounded transport. No provider probing or DB migration is implicit.

[ChatGPT](../chatgpt.md) owns native registration/token/broker access and epoch invalidation. Pure public metadata enters model selection; credentials/capabilities never enter renderer, argv or inherited connector environment. API-key adapters and inactive legacy stores remain separate.

## Conversation titles and selection

First-prompt titles use chat ports and `chat/title-adapter` with the independent summary/title selector. A synchronous transaction reserves the first eligible message; one conditional claim admits generation via Next `after()` in both HTTP modes. Apply only to that surviving message's unchanged automatic excerpt, never a manual title or recency. Clear/delete retain admission tombstones. `titlePending`/`x-chat-title-pending` permits at most four list refetches; settlement/navigation/unmount stop them. [Memory](../memory.md#first-prompt-chat-titles) owns visible behavior and migration.

Selection uses `app_metadata` key `chat.active_conversation.v1`; empty string means resolved-empty. GET validates saved existence beyond sidebar paging and repairs stale selection by `updated_at DESC, id DESC`. PUT accepts only an existing valid ID, never creates/retimestamps it. Delete repairs only a selection still naming that row. The UI serializes mutations and rejects superseded reads/delete responses. Failure offers explicit retry, not browser/default rescue; no schema migration/browser import or preference change is implied.
