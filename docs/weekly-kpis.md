# Structured weekly KPIs

Trainer chat manages weekly commitments, not a separate goals catalog/editor. Weekly documents explain intent; structured sets/assessments own saved values. Narrative bytes/revisions remain sources; General Plan editing is separate.

## Identity and saved meaning

The first planned set is immutable original, including plans saved before the week. Adaptations get new IDs. Assessments bind exact set/item/track references, never implicit latest or narrative `review.planRevision`. Chat may give a legacy plan an explicitly **review-defined, provisional** interpretation, never a fabricated agreed original. Historical commitment editing is disallowed; assessment corrections replace only that set's assessment revision. Retained versions survive, but report/review/achievement use the latest committed target set: correcting an older assessment cannot replace its score. Optional `set.planRevision` records narrative provenance; review-defined eligibility must match the latest narrative revision, not inferred time/prose.

Items have stable concept IDs and 1–3 named numeric/qualifying tracks. Each scored numeric track has `availablePoints`; its actual has `awardedPoints` (null means unknown). There is no shared point pool in new writes, item-level allocation/award or scored qualifying track. Target and allocation are independently optional; monitoring/context has no invented zero allocation. Points are not identity: concept/key must retain kind/unit/meaning; changed semantics need a new identity, while labels/targets can change. Unknown is not zero.

Evidence origin/references/cutoff are saved facts, not fresh Garmin verification. Qualification/limitations/explanations are optional except when uncertainty, substitution/partial credit or genuine extra-credit relevance needs explanation. Ordinary targets/points need no duplicate prose. Optional scoring preserves non-obvious agreement (for example reduced points for a substituted session); code never interprets that prose. Legacy definition/selection/evidenceRequired/provenance/overall-explanation bytes remain stored/readable but are absent from new model schemas.

The trainer retains the 100-point full-achievement convention, explained partial/bonus credit (including above100), latest-plan denominators, unmet sport-specific commitments and provisional assumptions. `latestPlanWeek` context and `getKpiProgress.latestPlan` expose names/concepts/keys/meanings for reuse. Similar labels never merge different selection/qualification/unit semantics. Code validates structure/references/finite values and executes only agreed numeric `pointsRule`; it never selects activities, eligibility, weights, targets or bonuses.

## Reads, writes and limits

- `getWeeklyPlan` returns narrative plus KPIs. Ordinary `getWeeklyKpis` questions use only `weekStart`, returning canonical original/latest/review-defined sets with assessments, stored measured actuals and derived points. Deliberate historical access adds an exact retained `setId` for that week; literal latest/original are not aliases.
- An unavailable exact ID stays `rejected` / `kpi_set_unavailable`. Its `result={requestedSetId,canonical}` separately supplies the requested week's bounded canonical read immediately, without another model-selected discovery call. It never fulfills the missing version or searches another week. Both native tool results and legacy evidence carry the full labelled recovery object. One fresh planner pass can answer from it or use its actual complete objects; dependent batch tails are discarded and repeat failure stops.
- A rejection or discovery header alone grants no mutation authority. Only complete independent canonical objects shown in a prior pass enter the normal week/identity/revision/calendar/turn checks. `complete=false` retains narrower IDs, not editable previews. Read recovery never executes recipes, refreshes measurements or saves anything.
- Empty weeks mean no saved KPIs, not zero achievement. Missing exact versions remain unavailable even if canonical targets exist; invalid weeks and uncertain persistence are distinct failures, not missing data or safety violations. Ordinary answers use actual saved values/gaps without asking the operator to manage internal IDs.
- Writes require one complete relevant prior-pass read, unchanged overall KPI revision, matching civil week/calendar and current-turn ownership. A narrow read includes its full set/assessment. Presentation narrows incomplete envelopes to the latest eligible set; refresh never pins an obsolete selection.
- `saveWeeklyKpis` changes one week. `saveWeeklyDocuments.kpiChanges` atomically commits related narrative/KPI/assessment changes for at most two distinct weeks. `setId=new` binds only that operation's new commitment. No provider/semantic extraction awaits inside SQLite transactions.
- Focused and combined weekly mutations share one attempt per turn, including failure/uncertainty. General Plan has its own attempt/outcome. Reconcile uncertainty, never replay. JSON/NDJSON success metadata refreshes weekly/Progress views.
- Limits: 12 items/set, 3 tracks/item, 24,000 serialized characters/set or assessment, 128 immutable sets/week; read evidence 60,000 characters. A selected single object omits archive metadata to remain complete. Assessment correction retains set identity with a new assessment revision. `getKpiProgress` allows 12 civil weeks; oversized evidence requests narrowing and grants no write authority.

One weekly readonly projection selects `latestPlanSetId` and its exact assessment for report/achievement. Without automatic fallback it preserves the saved finite total over positive summed scored allocations, even when total differs from item sum. With fallback it sums exact reviewed track awards, automatic candidates and reviewed extras once. Every scored contribution must be available; monitoring adds nothing, missing contributions never shrink denominator. Missing/incomplete totals are gaps; zero stays zero and explained above100 is uncapped. Reads never assess/save.

Progress includes each week's latest eligible set. A separate persistence query discovers the latest established plan independently of range/assessment time. Empty future slots do not replace it; KPI-free plans do not resurrect historical choices. Secondary measurements join exact concept/key/kind/unit/meaning through each week's latest set, preserving target/actual/cutoff. Label/target amounts may vary; incompatible observations stay unavailable, with no fuzzy renderer match or global baseline.

### Report and Progress presentation

Each numeric measurement gets its own target/actual/`awarded / available` row. Scored tracks (including zero allocations) and extras precede monitoring rows, preserving order within groups. Compound labels disambiguate measurements; no shared/row-spanning point cell exists. Qualifying tracks are conditions, not Yes/No metric rows. Condition-only legacy points remain a concise annotation beside the grid and in the saved total. No redundant Scoring and evidence section appears.

**Period** applies immediately: Last 1, 2 (default), 3, 6 or 12 months, with no date form/Load. Inclusive Monday weeks subtract calendar months from current device-calendar Monday, clamp month-end, then use that date's Monday. Charts reload together, ignoring superseded responses; selection lasts only while mounted. App/API permits 54 weeks; trainer tool remains 12. Range never changes latest-plan membership.

Individual Progress opens by default with every latest-plan numeric track and distinct labels/units, including same-unit compound measurements. There is no selection step, Week details or Saved measurement values panel. Focusable chart-local figures expose exact nonvisual values/status/cutoff/necessary qualification without visible replacement tables. Conditions remain assessment evidence, not chart series. Charts compare lower/equal target to actual from zero; upper range bounds remain in report/text, not plotted/tooltips.

Current/Next notes open at full grid width; History puts Review before Plan, both closed, including narrative-only records. Scoped titles and viewport-bounded flex layout account for wrapped tabs without clipped/shrinking content. Routine Reload is absent after weekly/General Plan success; navigation/save reads, drafts and failure Retry retain ownership. Calendar/report routing is unchanged.

## Measured actuals

Measurement is not assessment. A recipe is verified readonly SQL for one concept: one row, one column per listed numeric track key, null for no qualifying value, optional `missing_source>0` for incomplete eligible data. Related tracks share selection (for example long-outing Time/ascent, with others excluding that outing). Exact kind/unit/meaning signatures bind recipes, not targets/points. Changed SQL or track list creates an immutable version; measurements name it, older versions remain.

`saveKpiRecipes` needs the current/upcoming week's complete prior-pass read and current turn, sharing the weekly save attempt. Each changed recipe must run successfully on that week and the preceding week before atomic acceptance; failure preserves prior recipe/value. Verification publishes the target week.

### Refresh and execution

Completed Garmin Sync, Progress **Refresh** and default `refreshKpiMeasurements` refresh current and immediately previous weeks through one entry point regardless of displayed period. Outcomes are independent; one failure never blocks the other or changes Sync success. An explicit trainer Monday refreshes only that week within the 12-week window. Verified recipe changes publish their target week. A successful current-week commitment save triggers one best-effort postcommit refresh of that week; failure does not change save outcome. Upcoming/assessment-only saves do not refresh. Reads/GET/navigation/range/rollover never execute recipes or write measurements; no scheduler/history fan-out exists.

Every execution re-admits SQL through `validateSql`, allowing exactly `:week_start_ms`/`:week_end_ms`, no quoted identifiers, schema qualifiers, SQLite internals or parameterized grade table. One short-lived child uses empty environment, V8/SQLite heap limits, readonly + `query_only`, temporary views of allowlisted columns, at most two iterated rows and finite numbers only. Per-recipe SIGKILL deadline is 2s, total 8s; an in-child watchdog exits on parent loss. Hung/oversized recipe fails alone; remaining recipes rerun in a fresh child to share one snapshot. Runs serialize and repeated triggers coalesce. This bounds resources; it is not a general sandbox.

Conditional publication refuses changed latest set, recipe versions or imported-data basis, with one bounded retry. Basis hashes window activity/daily-health rows and latest completed Sync from the same snapshot. Latest success (values/version/signatures/measuredAt/asOf/basis) and failure are separate: failures neither zero nor advance values. Freshness concerns imported data, not live Garmin.

`kpiActual` feeds grid/charts/tools. A compatible stored measurement wins; otherwise reviewed actual retains provenance. Exact-set reviewed awards, including zero, remain authoritative per track; declared rules fill only unreviewed tracks. UI has Refresh, Incomplete/Stale and separate “Actuals measured”/“Points as of”. Refresh's accessible name is “Refresh this and last week”. With no current plan and no previous refresh, “No plan for this week” appears unless failure takes priority. No SQL/audit/explanation panel is shown.

The approved hiking recipe is not app policy: `hiking`/`walking`, Time = `activity.duration_sec` (Garmin timer Time excluding pauses, connector `duration`, not moving/elapsed). Long outing is longest Time ≥7200s, ties earliest start then ID; others exclude that exact outing. Missing timer makes selection incomplete.

## Declared automatic points

Numeric `pointsRule` is a closed union:

- `{kind:"proportional"}`: allocation × min(actual/target,1), positive at-least target.
- `{kind:"threshold"}`: allocation when declared at-least/at-most/equal/inclusive-range is met.
- `{kind:"perUnit",points,cap}`: min(actual × points,cap), without flooring fractions.

Values/parameters are finite/nonnegative; per-unit cap cannot exceed allocation. Monitoring, qualifying tracks and legacy pools never gain inferred rules. There are no formula strings or stored automatic scores.

Optional `requiresCondition` names a qualifying key in the same item/exact set. Reviewed false yields zero, true permits calculation, missing/null/unavailable leaves a computable candidate Pending. Measurement/qualification cutoffs remain independent. Complete measured-null can mean zero positive volume, not a reward-bearing at-most/equal-zero success. Incomplete inputs may yield provisional candidates; missing/incompatible/stale/failed inputs cannot fill contributions. All totals containing automatic values remain Provisional. Canonical week/progress `points` uses the same bounded pure projection with track source/status/reason/cutoff, never SQL or assessment writes on read.

Reused identities carry latest agreed `pointsRule`/`requiresCondition` unless the user agrees a change. Omitting metadata visibly saves no rule; the server never silently copies agreement. Reviewed awards freeze only their tracks. No-rule/wholly reviewed totals retain meaning. History uses its own saved rules/targets/measurements, never retrospective fan-out.

## Storage, migration and recovery

A legacy item-level pool with exactly one numeric track belongs to that track. Multi-numeric/condition-only pools remain one unmapped denominator unit and a separate `<KPI> · combined points` row, never split/duplicated/relabelled per measurement. Only reviewed per-record mapping replaces them; code never chooses weights.

Schema26 adds `weekly_kpi` week JSON and unique concept/track signatures in `weekly_kpi_track`; schema28 adds immutable `weekly_kpi_recipe` and week-bound `weekly_kpi_measurement`. Existing rows remain unchanged. Older native versions refuse newer schemas; explicit `db:migrate` is required for existing-data admission. Fresh initialization includes these tables. The weekly application validates internal references, SQLite commits atomically through the shared lazy connection. No eager resource, startup semantic extraction, extra SQL access or deletion authority is added. KPI-only data counts for user-data/backup detection and survives chat/Profile/Garmin deletion.

Historical backfill is finite **reviewed mapping**, not Markdown parsing or an LLM job. With separately approved exact source-read/copy authority, privately inventory original/latest/review bytes, review every mapping, rehearse a WAL-consistent disposable copy and verify integrity/FKs/references/coverage plus unchanged source/unrelated rows. KPI-free/unassessed/ambiguous history stays absent or unresolved; never invent targets/agreement/scores. Preserve review-only/retained versions, compound/exclusion/condition semantics; preserving versions does not require obsolete comparisons in UI.

For an approved stopped target, genuine recoverable pre-upgrade backup and compatible activation plan:

1. Explicit process-env `DATABASE_PATH` with `npm run db:migrate` performs writer admission and schema DDL. It requires canonical target/parent, refuses fresh sidecar collisions and preserves explicit fresh creation. Populated/upgrade backups are exclusive siblings in canonical owner-private `backups`; SQLite online backup includes WAL, becomes standalone DELETE-journal and passes integrity/FK/version checks before DDL. Partial output remains; no automatic restore/downgrade/lease theft.
2. `npm run backfill:weekly-kpis -- /absolute/private/reviewed-manifest.json`, same explicit target/owner/current schema, verifies exact source identity/byte hashes and applies/reconciles atomically. Manifest v1: `{version:1,mappings:[{sourceSha256,source,state}]}`, exact WeeklyRecord and reviewed WeeklyKpis with durable IDs. Keep ≤4MiB, private, outside public assets. Matching existing state reconciles; changed source/conflicting state refuses without partial writes.
3. Reverify target, then separately approved compatible activation/reopen. New writes favor forward fix; restoring backups needs reconciliation and separate authority. Source merge/rehearsal/Done never grants installation, stop/reopen or primary mutation.

### Existing-state source binding (no schema upgrade)

For reviewed relationships missing explicit metadata, `npm run reconcile:weekly-kpi-sources -- /absolute/private/manifest.json` uses process-env `DATABASE_PATH` on an approved stopped target/copy. Manifest v1 mappings `{sourceSha256, source, expected, newRevision, planRevisions}` bind exact narrative/structured state, fixed conflict revision and reviewed set-ID → narrative-revision links. Planned binds original; adapted/review-defined binds latest. Only `planRevision` metadata/conflict revision changes: never identities, signatures, labels, values, targets, scores or narrative. Identical rerun reconciles; newer/mismatched state or incompatible bindings refuses atomically. Backfill still has no overwrite flag.

### Per-measurement point mapping

`npm run map:weekly-kpi-points -- /absolute/private/manifest.json` applies operator-approved per-record mappings to an approved stopped target/copy with explicit process-env `DATABASE_PATH`. Manifest v1: `{sourceSha256, stateSha256, source, expected, replacement:{record, state}, newRevision}`. Hashes bind current narrative/structured bytes; replacement state has reviewed track allocations/awards and any reviewed total; replacement record only reviewed prose edits. Identities/signatures/bindings, document titles/revisions/timestamps and unlisted weeks stay unchanged; state and any changed record take `newRevision`. Superseded bytes are not additional versions: the genuine pre-change app+DB backup is recovery evidence. Identical rerun reconciles; changed/newer data refuses atomically. Weights are never chosen by code.

Rehearse preservation, idempotence, changed-source refusal and recovery on a WAL-consistent copy first. Identity reconciliation may be a verified no-op; similar labels never merge restricted-window/selected-outing/qualification semantics. No classifier/alias platform, DDL, startup repair or historical rescoring is added; metadata is additive within schema26. Primary application/activation/recovery require separate authority.

Tests `weekly-kpi-achievement`, `weekly-kpi-progress-ui`, `weekly-kpis`, `weekly-kpi-tools`, `weekly-kpi-ui`, `weekly-kpi-backfill` and adjacent weekly/calendar/plan/chat/persistence cover SQLite/orchestration/UI/backup seams. [Native KPI scenarios](smoke/features.md#finite-authored-weekly-kpis) use authored replies, not real-provider reasoning or primary-migration proof.
