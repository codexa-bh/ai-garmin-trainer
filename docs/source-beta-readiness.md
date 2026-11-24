# Source-beta readiness foundation

The supported product is the advanced-user local **macOS ARM64 Tauri app**, from source or [published binaries](https://github.com/codexa-bh/ai-garmin-trainer/releases). [Windows x64 alpha](windows.md) is experimental/unsupported. Availability is not clean-machine certification, a beta invitation or commercial multi-user support.

## Supported boundary

[Desktop](desktop.md) owns launch/private state; [Garmin connection](garmin-auth.md) owns official fixed-origin Personal API/native key handling. No browser/LAN/hosted product, alternate Garmin connector/endpoint, manual FIT fallback, telemetry or Garmin write-back. Local no-auth is not hosted security. The app needs no Python/uv/uvx; Ollama stays operator-managed.

Source merge grants no install/restart/migration/signing/release/deployment. Separately scoped operations follow [release](release.md) and [redistribution](redistribution.md).

## Setup flow for clean-machine validation

Follow the [README source build](../README.md#build-from-source) and [native adoption](desktop.md#explicit-private-state-adoption); this route is not a completed certification. Run `npm ci` before dependency-backed tools. Desktop never imports env/old pointers; preserve originals and use supported private adoption/re-entry. Never enter credentials in chat/issues/diagnostics.

Maintenance CLIs are non-serving, use explicit checkout/process configuration rather than native Settings/Keychain, and give process env precedence. Relative CLI paths use cwd; prefer approved absolute paths. Existing-data preparation needs the [stopped-target upgrade procedure](release.md#existing-database-upgrades-and-recovery), not primary mutation to test source delivery.

Fresh Create and Finish, commit-aware retry, live catalog/key application versus restart-only settings and startup refusal follow [Settings](settings.md)/desktop. Native owns an ephemeral backend, not port 3000 or unrelated listeners. Doctor reports readiness, not real integration.

## Local data lifecycle

[Desktop recovery](desktop.md#validation-and-recovery) owns writers/leases and compatible activation; [release recovery](release.md#existing-database-upgrades-and-recovery) owns verified WAL-consistent backups, stopped-target migration and preservation of newer work. [Rehearsal placement](smoke-inputs.md#task-owned-rehearsal-restore-and-run-backup-placement) never makes genuine/borrowed backups disposable.

No one-click export exists. Manual stopped-app SQLite copies may contain private/redacted raw records; exclude credentials, prompts, GPS and diagnostics from support artifacts. [Bulk deletion](architecture/analytics-and-local-data.md#local-data-application-and-adapters) owns exact chat/Profile/Garmin exclusions; [memory](memory.md) owns separate memory controls. Clear/replace Garmin keys in Settings, never scan old token stores. App removal preserves DBs/backups/versioned settings/Keychain/tools; no automatic state/worktree cleanup.

## Memory and coaching reliability

[Memory](memory.md), [summary](cross-chat-summary.md) and [history](conversation-history.md) own current privacy/source precedence. Ordinary chat uses sealed memory/replay, not legacy vector retrieval/post-answer extraction. Profile is user data, Garmin is measured evidence, transcript/compact prose is untrusted continuity. `npm run eval:reliability` tests deterministic safety/evidence boundaries, not live coaching quality.

## Diagnostics and support artifact rules

Use `npm run doctor` or `npm run doctor -- --json`; review even redacted output. Never publish private env/settings/credentials, raw API/SQLite/SQL/math evidence, unreviewed payloads, GPS, prompts/chat logs, shell history or secret-bearing images. Keep path-bearing maintenance output private.

## Dependency evidence

`npm run deps:evidence -- --output <path>` records bounded Node counts/lock hash and Garmin/FIT/no-external-tools facts; `--audit` adds npm findings. It is not a Node/Rust/vendor security or legal conclusion. Retain findings, distinguish development-only/shipped exposure and apply [release review](release.md#release-cut-runbook). Evidence grants no beta or redistribution authority.
