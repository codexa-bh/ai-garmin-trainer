# Architecture: guarded analytics and local data

Part of the [architecture overview](../architecture.md).

## Guarded analytical policy and SQLite execution

`ai/sql-analysis.ts` is the lazy production composition/compatibility facade;
only `describeGarminDatabase` and `runReadOnlySql` are exposed to analytical tools.
`ai/analytics/contracts.ts` owns plain row/result/schema/input shapes and the
consumer-owned execution capabilities. Math, tool evidence and the turn-owned
handle map use these neutral types, never concrete SQLite types.

`analytics/schema.ts` owns the exact allowlisted descriptors, examples, limits
and privacy description, composing the additional Garmin evidence relations from
`analytics/extra-schema.ts` (units, meanings and coverage semantics in
[Garmin extra data](../garmin-extra-data.md)); `policy.ts` owns admission precedence, CTE/table checks,
name/limit coercion, correction hints/error redaction and bounded normalization.
`application.ts` receives explicit execution and clock capabilities. It admits
before opening a session, runs one synchronous query and interprets its result.
The session exposes rows, empty-result column names and close, not a Database or
Statement. Inspection is a separate fixed-table statistics operation with no
caller-provided metadata SQL. There is no container or ambient dependency setter.

`analytics/sqlite-execution.ts` alone initializes the existing app DB, resolves
the path, opens readonly/fileMustExist with a 750ms busy timeout and enables
query_only. It keeps prepare → safeIntegers(false) → all, fixed inspection SQL,
and concrete close mechanics. The application retains open and initial clock
outside its try, elapsed checking immediately after all (before empty columns),
normalization inside catch/finally and unhandled close failures. Inspection
closes on success/failure. The existing timeout is **not** hard query preemption;
no parser fixes, extra queries, access expansion or lifecycle corrections are
hidden in this structural change. Only successful results register same-turn
handles in `tool-analytics.ts`; rejected/failed queries cannot replace them.

Saved weekly measurement recipes use a separate outer adapter,
`analytics/recipe-execution.ts`. It re-admits every recipe (`validateRecipeSql`) and runs
the batch in one short-lived child process (empty env, heap caps,
readonly/query_only, allowlisted temp column views, bounded iteration/output).
It holds a hard per-recipe SIGKILL deadline and a parent-death watchdog, so this
path, unlike the interactive tool, has real preemption. The weekly application
(`weekly/measurements.ts`) owns recipe verification, the coalescing queue and
conditional publication against the plan/recipe/imported-data basis. Weekly
composition binds it; Garmin composition calls it after a completed sync.

`tests/sql-compatibility.test.ts` freezes pre-extraction provider schema and
admission/error snapshots. `sql-application.test.ts` directly supplies ports and
a clock to cover rejection-before-I/O, ordering, limits, normalization and errors.
`sql-execution.test.ts` covers actual readonly/query_only settings, closed handles,
inspection and production tool wiring. `sql-dependencies.test.ts` checks the
transitive type-inclusive inner closure, with negative infrastructure/composition
fixtures; the runtime graph and existing SQL/math/tool/orchestrator suites remain
required. SQL/schema/back-sync is a no-op; source revert is sufficient rollback.

### Calculated activity-grade evidence

`analytics/calculated-grade.ts` owns pure mechanical signed altitude-change /
cumulative-distance-change estimates, not coaching classifications or dashboard
readouts. `sqlite-execution.ts` registers connection-local
`activity_calculated_grade(activity_id)` for guarded SQL: explicit activity IDs
select at most 100,000 normalized samples via the existing primary key, with at
most 32 function invocations per query. A lazy separate readonly/query-only
snapshot supplies samples because SQLite callbacks cannot re-enter the executing
connection; the query session closes both handles on success/failure. Unbound
schema inspection reports zero static rows as registration metadata, never as
activity availability, and never computes windows. The hidden `garmin_id`
parameter supports function arguments, WHERE constraints and constrained joins;
safe numeric ID literals are accepted. Unconstrained access fails with a bounded
correction message rather than silently reporting missing data.

Timestamp-only consecutive sections target 180 seconds, share boundary endpoints,
and require at least 60 seconds, 3 complete samples and 10 meters net distance.
Adjacent times strictly increase with gaps <=30 seconds; cumulative distance is
nonnegative/nondecreasing. Invalid sections return null and quality status, not
zero. Method, actual support and valid/total **section** coverage accompany grades;
shared endpoints mean summed sample counts are not unique-stream coverage.
No-stream/over-limit inputs return unavailable sentinels. Stored elapsed can be
an unmarked sample index and never establishes timing by itself. The descriptor
and executable single/multi-activity examples own the exact analytical contract.

Source `grade_pct`, source `has_grade`, imports and dashboard calculations remain
unchanged. No DB objects, migration, re-import or backfill: existing stored
prerequisites are derived at read time; source revert is sufficient rollback.
Pure edge fixtures, guarded relation/claim tests, readonly resource lifetime and
existing dashboard/privacy suites cover this addition. Grade remains an estimate,
not measured instantaneous slope, terrain or technicality.

## Local-data application and adapters

`local-data/application.ts` exposes synchronous read use cases and scoped deletion
through consumer-owned `LocalDataReads` / `LocalDataLifecycle` capabilities.
`composition.ts` binds the existing SQLite adapter lazily: Activity, Health,
summary and delete HTTP routes, chat context, Garmin read composition and local
data tools use these applications. Transport retains DTO/date serialization,
labels, lap-speed display fallbacks, parsing and error/status behavior. Health
retains its newest-first 366-day window; status retains its count fallback and
read order. Chat uses a separate ten-day `listTrainerRecoveryPreview` capability: only selected legacy dates receive one-to-one daily sleep score/qualifier, weekly HRV/baseline, battery charged/drained and high-stress duration plus independent group coverage. General Health reads are unchanged. The AI formatter converts high-stress seconds to minutes and keeps nightly/weekly, totals/levels and pre-event/all-day meanings distinct. The [extra-data contract](../garmin-extra-data.md#default-trainer-evidence) owns units, caps and missing/backfill semantics. Reference verification preserves its existing all-summary selection,
exact normalized-name/date/ID matching, order and ambiguity before match caps.

`contracts.ts` owns read models independently of SQLite. Existing plain Garmin
contracts (including stage-2 `HealthCoverage`) remain authoritative, not copied.
`health-policy.ts` owns nullish merging and clock-supplied trailing/refresh
criteria; `heart-rate-policy.ts` owns Garmin-total versus local-stream timing;
`split-heart-rate.ts` is the one pure read-time derivation of a run's/lift's
duration-weighted Avg HR and zone time from stored samples in its own window
(read through `db/split-heart-rate-repository.ts`, never persisted, never linked
to laps) for both the Activity run table and trainer evidence;
`activity-policy.ts`, `coverage-policy.ts` and `dashboard-policy.ts` own reference,
paging and selected-row interpretation. The repository keeps proven SQL predicates, aggregate queries,
selection/order/caps, JSON/date/boolean row decoding and import transactions.
Pure functions receive selected values; no unbounded replacement of SQL filters,
new framework/container, ambient setter or inward compatibility-barrel import.

`db/local-data-lifecycle.ts` owns the two complete atomic bulk transactions. The
application selects one scope, then reads counts after its commit. Chat/Profile
clears messages, conversations and Profile only. Garmin clearing deletes the raw
archive, then the schema-29 Garmin evidence relations and their coverage (see
[Garmin extra data](../garmin-extra-data.md)), then the original list in its exact
order with its labels; in particular it does **not** newly delete
`activity_hr_zone_time`, `activity_detail_attempt`, either memory store, the plan,
app metadata, auth rows or external files. These historical exclusions are
compatibility, not cleanup opportunities. A later statement failure rolls back
all earlier statements; no catch/retry or expanded transaction includes counts.

`tests/local-data-application.test.ts` covers supplied ports and frozen pure inputs;
`local-data-wiring.test.ts` covers actual HTTP/tool/composition/SQLite, every bulk
table and exclusion, exact statement order, late-failure and missing-table rollback.
`local-data-dependencies.test.ts` follows type-inclusive pure/application closures
and rejects outer capabilities; existing dashboard, daily-health, summary, import,
chat and tool suites retain integration coverage. No schema, metric, data shape or
import behavior changes: migration/back-sync is a no-op, source revert is rollback.
