# Architecture: guarded analytics and local data

Part of [architecture](../architecture.md).

## Guarded analytical policy and SQLite execution

`ai/sql-analysis.ts` lazily composes the only tool-facing operations, `describeGarminDatabase` and `runReadOnlySql`. Inner `analytics/{contracts,schema,policy,application}` owns plain capabilities, allowlisted descriptors/examples, admission, coercion, correction/redaction and bounded result interpretation. [Extra data](../garmin-extra-data.md) owns field meanings. Math/evidence/handles use neutral types, never SQLite handles.

Admission precedes opening. Execute one bounded SELECT/WITH; reject writes, PRAGMAs, comments, stacked statements, disallowed tables, auth/session/account data, raw payloads/FIT, unrestricted streams, secrets/paths/connector handles and environment/process/network access. Inspection uses fixed-table statistics, not caller metadata SQL. Successful results alone register same-turn handles.

`sqlite-execution.ts` initializes the existing app DB, resolves its path and opens readonly/fileMustExist with 750ms busy timeout and `query_only`. Preserve prepare → safeIntegers(false) → all. Application open/initial clock stay outside try; elapsed checking follows `all` before empty-column lookup; normalization is inside catch/finally, and close errors propagate. This elapsed timeout is **not hard preemption**.

Saved recipes use a separate `recipe-execution.ts` child process: re-admitted SQL, empty environment, heap caps, readonly/query_only, allowlisted temp views, bounded iteration/output, hard per-recipe SIGKILL and parent-death watchdog. Weekly application owns verification, coalescing and basis-conditional publication; completed Sync invokes it through composition. [Measured actuals](../weekly-kpis.md#measured-actuals) owns the product contract.

### Bounded math

`math-analysis.ts` computes generic formula scoring, normalization, ordering, grouping and summaries over supplied same-turn rows. It owns no coaching rubric or external capabilities. [Guardrails](../project-guardrails.md#architecture-boundaries) verifies pure local helper closures; opaque packages/loaders are not exceptions.

Syntax/column checks and row/byte/output limits apply. Eligible mismatches return at most 16 ASCII column names of at most 48 bytes, omitting values/sensitive identifiers. Formula/grouping hints use input fields; ordering hints use transformed output fields. Rejection publishes no handle. Correction returns to fresh budgeted planning, discarding stale batch tails; repeated unchanged failure without progress yields an honest limitation.

### Calculated activity-grade evidence

`analytics/calculated-grade.ts` derives signed altitude/distance change, not measured instantaneous slope or coaching terrain/technicality. Guarded SQL exposes connection-local `activity_calculated_grade(activity_id)`: explicit IDs, at most 100000 normalized samples and 32 invocations/query. A separate lazy readonly snapshot supplies callbacks; both handles close together. Hidden `garmin_id` supports arguments, WHERE and constrained joins, including safe numeric literals. Unconstrained access fails with a bounded correction; schema inspection's zero static rows means registration metadata, not availability.

Timestamp-only consecutive sections target 180 seconds and require 60 seconds, three complete samples and 10m net distance. Times strictly increase with gaps ≤30s; distance is nonnegative/nondecreasing. Invalid/over-limit/no-stream inputs report null/status or unavailable sentinels, never zero. Shared endpoints mean section sample totals are not unique-stream coverage. Stored elapsed may be an index and never proves time alone. Source grade, import/dashboard formulas and storage stay unchanged; descriptors/examples specify executable usage.

## Local-data application and adapters

`local-data/application` exposes synchronous reads/scoped deletion through `LocalDataReads`/`LocalDataLifecycle`; composition lazily binds SQLite for routes, chat, Garmin and tools. Feature policies interpret selected values; repositories retain predicates, aggregation/order/caps, decoding and transactions. No unbounded replacement of SQL filters or generic container belongs here.

HTTP owns wire/date/label/error behavior and lap-speed display fallback. Health retains newest-first 366 days; status retains count fallback/read order. Chat separately reads a ten-day recovery preview with independent sleep/HRV/battery/stress coverage; high-stress seconds render as minutes, and nightly/weekly, totals/levels and pre-event/all-day meanings remain distinct. [Default trainer evidence](../garmin-extra-data.md#default-trainer-evidence) owns units/caps/backfill. Reference verification preserves all-summary selection, exact normalized-name/date/ID matching, order and ambiguity before match caps.

Pure policies own nullish health merging, supplied-clock freshness, Garmin versus stream HR timing, reference/paging/coverage and dashboard interpretation. `split-heart-rate` derives time-weighted run/lift HR and zone time within each stored split window, read through its repository; it is neither persisted nor linked to laps and is shared by UI/trainer.

`db/local-data-lifecycle` owns two atomic bulk transactions; application reads counts **after** commit:

- Chat/Profile clears messages, conversations and Profile, preserving semantic memory.
- Garmin clears raw archive, additional evidence/coverage, then its original table list in exact order. It does **not** additionally clear `activity_hr_zone_time`, `activity_detail_attempt`, memory stores, plans, app metadata, auth or external files. Those exclusions are compatibility, not cleanup opportunities.

A later failure rolls back every earlier statement; no retry or widened count transaction. Single-conversation deletion is separately [owned](server-and-persistence.md#persistence-owners).

Tests: `sql-{compatibility,application,execution,dependencies}`, math/tool suites, calculated-grade fixtures, `local-data-{application,wiring,dependencies}` and dashboard/import/chat integrations. Dependency tests include erased types; real SQLite tests cover readonly settings, exact deletion order/exclusions and late-failure rollback.
