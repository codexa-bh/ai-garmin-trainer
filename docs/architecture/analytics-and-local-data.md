# Architecture: guarded analytics and local data

Part of [architecture](../architecture.md). [Extra data](../garmin-extra-data.md) owns field meanings; this page owns capability and persistence boundaries.

## Guarded analytical policy and SQLite execution

`ai/sql-analysis.ts` lazily composes `describeGarminDatabase` and `runReadOnlySql`. Inner `analytics/{contracts,schema,policy,application}` owns descriptors, admission, coercion, safe corrections/redaction and bounded results. Math/evidence/handles use neutral types, never SQLite handles.

Admit before opening: one bounded SELECT/WITH, with no writes, PRAGMAs, comments, stacked statements, disallowed tables, credentials/raw FIT/unrestricted streams or process/network/filesystem capabilities. Inspection uses fixed-table statistics, not caller metadata SQL; only successful results register same-turn handles.

`sqlite-execution.ts` uses the existing app DB and a readonly/fileMustExist connection with 750ms busy timeout and `query_only`; its elapsed check is **not hard preemption**. `recipe-execution.ts` separately supplies hard-bounded child execution for [weekly measurements](../weekly-kpis.md#refresh-and-execution). Weekly application owns verification/coalescing/conditional publication; Sync invokes it through composition.

### Bounded math

`math-analysis.ts` operates on supplied same-turn rows for generic scoring, normalization, ordering, grouping and summaries, never coaching rubrics or external capabilities. [Guardrails](../project-guardrails.md#architecture-boundaries) checks pure helper closures; opaque packages/loaders are not exceptions.

Syntax/column and row/byte/output bounds apply. Eligible mismatches return at most 16 ASCII names of 48 bytes, without values/sensitive identifiers. Formula/grouping hints use input fields; ordering uses transformed output fields. Rejection publishes no handle. Corrections require fresh budgeted planning with stale batch tails discarded; repeated unchanged failure without progress yields an honest limitation.

### Calculated activity-grade evidence

`analytics/calculated-grade.ts` derives altitude/distance change, not measured instantaneous slope or coaching technicality. Its SQL relation `activity_calculated_grade(activity_id)` requires explicit IDs, caps 100000 samples and 32 invocations/query, and uses a separate lazy readonly snapshot whose lifetime follows the main connection. Hidden `garmin_id` supports arguments/WHERE/constrained joins, including safe numeric literals; unconstrained reads return bounded corrections. Inspection's zero static rows is registration metadata, not availability.

Timestamp-based sections target 180 seconds and require 60 seconds, three complete samples and 10m net distance. Time strictly increases with gaps ≤30s; distance is nonnegative/nondecreasing. Invalid/over-limit/no-stream inputs remain null/status/unavailable, never zero. Shared endpoints are not unique-stream coverage; stored elapsed alone proves no timing. Source grade, import/dashboard formulas and storage stay unchanged; descriptors provide executable examples.

## Local-data application and adapters

`local-data/application` supplies synchronous reads/scoped deletion; composition lazily binds SQLite for routes/chat/Garmin/tools. Repositories retain filtering, ordering/caps, aggregation, decoding and transactions; no unbounded replacement of SQL filters or generic container. HTTP owns wire/date/label/error behavior and lap-speed fallback. Health retains newest-first 366 days; status keeps count fallback/read order. [Trainer evidence](../garmin-extra-data.md#default-trainer-evidence) owns recovery-preview fields/units/coverage. Reference matching preserves all-summary selection, exact name/date/ID rules, order and ambiguity before caps.

Pure policies own nullish merging, clock freshness, Garmin/stream timing, paging/coverage and interpretation. `split-heart-rate` shares derived time-weighted run/lift HR and zones within stored windows; it is neither persisted nor lap-linked.

`db/local-data-lifecycle` owns atomic bulk deletion, with counts read after commit:

- Chat/Profile clears messages, conversations and Profile, preserving semantic memory.
- Garmin clears raw archive/additional evidence/coverage, then its existing table list in order. It does not additionally clear `activity_hr_zone_time`, `activity_detail_attempt`, memory, plans, app metadata, auth or files. These are compatibility exclusions, not cleanup opportunities.

Later failure rolls back all statements; no retry or widened count transaction. [Persistence](server-and-persistence.md#persistence-owners) separately owns single-conversation deletion.

Verification: SQL application/execution/dependency/compatibility, math/tools, calculated-grade and local-data suites. Real SQLite tests cover readonly settings, deletion order/exclusions and late rollback; erased dependency types remain checked.
