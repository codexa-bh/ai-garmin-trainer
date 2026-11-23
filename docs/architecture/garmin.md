# Architecture: Garmin application and adapters

Part of [architecture](../architecture.md). [Sync and health](../sync-and-health.md) owns operation/checkpoint behavior; [extra data](../garmin-extra-data.md) owns fields/coverage/backfill; [connection](../garmin-auth.md) owns native key handling.

## Garmin application and adapter boundary

HTTP Sync and targeted detail, CLI maintenance and local-data tools share `garmin/composition` and the same import applications. There is no alternate importer facade. `createGarminImports` receives named reader operations, synchronous storage, request-time config, clock and admission/wait capabilities. Pure modules own baseline/detail failure policy, date/error classification, history/scope/discovery/latest/coverage and explicit Sync intent; they import neither DB types nor transport. Composition binds capabilities lazily, never DB/env/clock/client work at import time.

Adapters raise fixed-vocabulary `failure.ts` subclasses; other errors become generic. Archive redaction/persistence precedes normalization and normalized writes. Malformed/unknown responses never become empty successful coverage; auth/rate-limit failures stop further reads. Raw archives are not application/HTTP data.

Sync records its run before constructing one reader per invocation. Initial DTO reads remain outside try/finally. Standalone effort converts startup errors to failed results; standalone detail propagates them. Close is synchronous and not swallowed. Normalized idempotent writes precede atomic checkpoint saves, so crashes replay rather than skip. Existing evidenced dates may skip remote refetch, but a local minimum proves no remote boundary. Failed dates stay unresolved; older body batches preserve current facts.

### Admission and settlement

Maintenance/tool calls retain 96 requests/180 seconds and 30 seconds per request. Explicit foreground Sync has a non-resetting 30-minute/480-request ceiling. History/discovery space serial dispatches by at least 1000ms; latest has no artificial spacing. Admission counts startup/nested requests/pacing. One claim spans all batches, writes/checkpoints/settlement and close. Common profile/FIT supplements run once and historical families rotate.

Safe pre-dispatch exhaustion may renew the batch under the same reader/claim/counters; in-flight timeout, connection/protocol/auth/rate/storage failure or no progress stops without retry. Reader failures swallowed by best-effort import policy still reach foreground admission. Pending detail drains terminal-removing selections without offsets/default ceiling, rechecks after history pages and at settlement, and stops on failure/no progress. Explicit maintenance selections keep their bounds.

Operation results and passive summary use the same typed policy/checkpoints, never text parsing or UI history heuristics; live summary additionally recomputes unique eligibility. Unknown/corrupt versions preserve bytes and refuse mutation. Latest preserves family/discovery bytes. Scope transitions, frozen history windows, coverage finality, empty-year discovery, lost-response reconciliation and explicit Resume are specified once in [Sync](../sync-and-health.md). No background scheduler or model-driven 30-minute continuation is introduced.

### Official Personal API reader

`official-reader.ts` is the sole product `GarminReader`. Native installs the key capability into `connection.ts` at startup; each operation gets its own reader/transport. Only admitted isolated synthetic smoke can select the owned loopback fixture. `GET /api/sync` is the explicit connection check: key exchange plus profile read, never startup/Settings/summary probing.

- `official-client.ts` owns HTTPS at fixed `https://personal.connectapi.garmin.com`, manual redirects, bounded raw-text token exchange and in-memory bearer renewal before the documented 24-hour lifetime. A rejected cached bearer permits one reacquisition; a rejected key is never retried. Every actual request/download asks admission. Closed errors contain no URL, headers, key/token or vendor body.
- `official-normalize.ts` maps nested daily summaries, ranges, grams, epoch milliseconds, sleep score and separate HRV into validating normalizers. The reader plans at most 31-date health blocks and retains only operation-local caches.
- `official-zip.ts` admits one original FIT under size/ratio/entry/name bounds; `official-fit.ts` decodes in-process with `fit-file-parser` for detail/baseline/HR zones. Session-referenced zone time is exact, activity-list buckets next; sampling with the file's own boundaries is labelled `garmin_official_estimate`; otherwise unavailable, never zero.
- New facts use `garmin_official`; old `garmin_mcp` provenance is preserved. `official_*` archive labels map to the existing repair-query logical kinds.

Verification: `garmin-application`, `garmin-dependencies`, `official-reader`, `official-composed-sync`, `garmin-production-wiring`, `garmin-history` and `garmin-product-exclusion` tests. Supplied ports, authored HTTP transport and real SQLite/wiring test different boundaries. Checkpoint/body-merge changes need populated-copy transition/re-sync proof, not a schema-no-op excuse. Compatible source rollback preserves records/backups and ignores supported additive keys; it does not certify the old policy as bounded Sync.
