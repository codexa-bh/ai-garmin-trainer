# Architecture: dashboard, charts and terrain

Part of the [architecture overview](../architecture.md).

## Dashboard ownership and lifetime

[`trainer-dashboard.tsx`](../../src/app/trainer-dashboard.tsx) retains navigation,
section visibility, focus return, transcript scroll restoration, startup scheduling
and cross-feature refresh wiring. Mobile navigation composes
[`mobile-navigation-sheet.tsx`](../../src/app/mobile-navigation-sheet.tsx), whose
native dialog owns modality, focus trapping, dismissal and breakpoint cleanup
(`tests/mobile-navigation-sheet.test.tsx`). The shell retains destination focus
handoffs. Chat conversation selection is panel-local: `ChatView` renders an
Activities-style selector (arrow-only circular toggle, collapsed rail/band
identity label and a `hidden` body) beside or, at <=960px, above the transcript.
The shell owns only its transient expanded state (collapsed at startup), closes any
open row menu on toggle and keeps focus on the always-visible arrow; no main
navigation entry, drawer or backdrop exists.
Every feature hook is called unconditionally in
the persistent shell. Hiding a view does **not** unmount its state/request owner or
restart startup fetches. Views retain the prior conditional mounting and DOM/CSS
contract; Health mode/chart state still follows the Health view lifetime. Daily's
range-end civil date lives in the persistent Health hook: tabs and away/back do
not discard it. Refresh retains any range overlapping eligible loaded dates;
only initial load, explicit Latest, or lost-window reanchoring chooses latest.
The seven ascending calendar slots are not seven newest rows. Missing records,
fields, outside-loaded history and today's UTC in-progress values stay distinct;
no cross-day aggregation or additional read is introduced. Roving keyboard tabs
and responsive raw Daily chart cards with keyboard/pointer exact-value buttons
preserve access without a wide comparison table. Per-date source coverage and HRV
context live in a secondary disclosure; chart presentation projects finite values
or gaps without aggregation, interpolation or date compression. Additional Garmin
evidence (HRV baseline band, sleep qualifiers, stress breakdown, sparse VO2 points,
Body Battery charged/drained) arrives in the same `/api/health-dashboard` payload
from `db/supplement-repository.ts` (independent child reads on their real keys,
bounded to the daily window) through `local-data/supplement-policy.ts`, and follows
the selected seven dates; the Activity route adds one explicit `supplement`
projection per activity. The paged Activity list separately projects the stored
`SKI_RUN_SPLIT` distance for navigation without changing session distance or
loading detail per row. Only resort skiing and snowboarding cards use that value;
missing or invalid run distance is a dash, while duration and other sports retain
their session values. Presentation is `health-supplements.tsx` and
`activity-supplement.tsx` plus an optional band on the existing chart wrapper. The
trainer's `grounding-contracts.ts` reads are separate and unchanged. See
[Visibility in Health and Activity](../garmin-extra-data.md#visibility-in-health-and-activity).

Files below are in [`src/app/dashboard`](../../src/app/dashboard):

| Owner                                                                               | Responsibility and exclusions                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Verification entry points                                                                                                                         |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `use-chat.tsx`, `chat-view.tsx`, `chat-presentation.tsx`                            | Conversation CRUD/rename, history generations, streaming, cancellation/retry, composer and transcript rendering. Reuses `../use-active-conversation.ts` for transient unresolved/empty/selected React state; serializes DB selection/bootstrap/create/delete and rejects superseded history/page/list responses. No browser storage or provider access. Shell supplies focus/scroll integration and refresh callbacks.                                                                                                                                                             | `tests/profile-dashboard.test.tsx`, `tests/conversation-hydration.test.tsx`                                                                       |
| `use-health.tsx`, `health-view.tsx`, `health-metrics.tsx`, `health-daily-range.tsx` | Fetch generations/status and persistent Daily range; strict civil-date slots and raw Daily charts with exact-value/source-context readouts. Daily and weekly/monthly presentation reuse `../health-rollup-chart.tsx`, except Calories (`../daily-calories-chart.tsx`) and the REM/Deep/Light sleep-stage stack with independent recorded duration (`../sleep-stages-chart.tsx`, all three modes); opening Health never initiates sync.                                                                                                                                             | `tests/health-dashboard.test.tsx`, `tests/health-rollup-chart.test.tsx`, `tests/sleep-stages-chart.test.tsx`, `tests/dashboard-features.test.tsx` |
| `use-activity.tsx`, `activity-view.tsx`, `activity-charts.tsx`                      | Search generations, paging/dedup guards, selection, charts/map and metric presentation. No importer or analytics policy; nullable/finite metric semantics are preserved.                                                                                                                                                                                                                                                                                                                                                                                                           | `tests/profile-dashboard.test.tsx`, `tests/activity-dashboard.test.ts`                                                                            |
| `use-training-plan.tsx`, `training-plan-view.tsx`                                   | Singleton snapshot, stale metadata, draft/edit/cancel/save lifecycle and Markdown view. No chat write authorization or schema ownership.                                                                                                                                                                                                                                                                                                                                                                                                                                           | `tests/profile-dashboard.test.tsx`, `tests/dashboard-features.test.tsx`, `tests/training-plan-route.test.ts`                                      |
| `use-profile.tsx`, `profile-card.tsx`, `profile-fields.tsx`                         | Profile request generations, dirty-edit protection, retained preferences, form/save feedback. Does not own imported athlete/body metrics.                                                                                                                                                                                                                                                                                                                                                                                                                                          | `tests/profile-dashboard.test.tsx`, `tests/dashboard-features.test.tsx`, `tests/profile-route.test.ts`                                            |
| `use-memory.tsx`, `memory-content.tsx`, `memory-presentation.tsx`                   | Persistent generation-safe inspection/mutation owner; one complete generated summary and separate preference editors, exact-inspection confirmations and focused history/management views without archive, selective-import, technical or per-chat snapshot dashboards. Passive observations preserve mounted content; privacy mutations still revoke it. Contextual cancellation reconciles older imports without replay. Presentation translates state/coverage without changing source eligibility, engine policy, API or native Settings. No semantic search/vector retrieval. | `tests/summary-memory-ui.test.tsx`, `tests/profile-dashboard.test.tsx`, `tests/native-memory-smoke.test.ts`                                       |
| `use-sync.tsx`, `sync-view.tsx`, `sync-presentation.tsx`                            | Sync duplicate-start ref, NDJSON progress and bounded log, summary normalization, athlete/body summaries and detail refresh. Sync renders maintenance actions and current-operation feedback; Profile & data displays imported facts. Receives explicit Health-refresh callback; cannot import sibling state.                                                                                                                                                                                                                                                                      | `tests/profile-dashboard.test.tsx`, `tests/health-dashboard.test.tsx`, `tests/dashboard-features.test.tsx`                                        |
| `use-model-settings.tsx`, `model-settings-card.tsx`                                 | Persistent shell-owned request state, refresh-on-chat-visibility and direct retry, authoritative explicit-choice save feedback and accessible dynamic activated-catalog control. No keys, SDKs, environment or storage access.                                                                                                                                                                                                                                                                                                                                                     | `tests/model-settings-ui.test.tsx`                                                                                                                |
| `use-data-controls.tsx`, `settings-view.tsx`                                        | Request status/error adapter and diagnostics visibility; composes Profile & data: Profile, imported facts, debug traces and existing deletion scopes; native Settings owns configuration. No new confirmation, mutation or credential authority.                                                                                                                                                                                                                                                                                                                                   | `tests/profile-dashboard.test.tsx`                                                                                                                |
| `contracts.tsx`, `transport.tsx`, `formatting.tsx`, `markdown.tsx`                  | Client wire shapes/defaults, existing response decoding/error behavior, shared labels and safe Markdown links/tables. No server capabilities or dashboard-wide mutable state.                                                                                                                                                                                                                                                                                                                                                                                                      | `tests/profile-dashboard.test.tsx`, `tests/dashboard-features.test.tsx`                                                                           |

Integration stays explicit: startup schedules conversation/memory/Profile/plan/summary
loads; history waits for resolved conversation selection via Effect Events; navigation
triggers Activity search and plan reload. The existing closed-to-open plan effect
revalidates persistent owners and explicitly selects the current weekly plan.
In-view weekly refresh retains the selected historical civil week or rereads list
pages through the oldest loaded week with fresh cursors and deduplication. General Plan tab entry explicitly refreshes its saved snapshot.
Read generations reject superseded completions; active editor drafts survive
hidden views and refreshed snapshots. Cancel restores the current saved snapshot;
explicit save invalidates older reads. Navigation does not write or remount owners.
Weekly presentation shows latest committed targets only, with a compact table and
preserved narrative disclosures; older documents remain stored, not competing
review baselines. Incomplete KPI envelopes narrow automatically to the latest
eligible set, and refresh cannot pin an obsolete selected set.
Successful sync awaits summary refresh,
then refreshes already-loaded/open Health while preserving its Daily date range. Streamed chat
completion refreshes memories/conversations and conditionally the plan. JSON fallback
retains its different refresh conditions. These are compatibility contracts, not
opportunities to normalize behavior during extraction. Keyboard effects read current
close handlers without depending on render-local identities.

## Selected-activity chart and route calculations

`src/lib/analytics/activity-dashboard-calculations.ts` owns two synchronous pure
facades over already selected, ordered normalized rows: `buildActivityDashboardCharts`
and `buildActivityDashboardRoute`. It has no imports or storage, environment,
filesystem, provider or connector capability. Its plain chart/route contracts are
composed into the repository's existing `ActivityDashboardDetail` response.

`getActivityDashboardDetail` retains SQLite queries, row selection/order, detail
availability and laps; local-data policies own selected-row and HR-zone composition,
alongside chart timing,
60-second distance-based speed, 180-second grade readouts and route filtering,
bounds and endpoint-preserving sampling. Chart points are not downsampled. Route
bounds use every accepted point, including points omitted by the 400-point cap.
There is no sorting, input mutation, new fallback, formula or schema change.
The existing repository window-constant exports remain compatible.

Chart points additionally retain `sourceElapsedSec`, the original stored row key,
independent of displayed timestamp-derived seconds. Metric-filtered chart samples
report transient pointer/keyboard selection to `ActivityView`, which owns
payload-scoped selection and owner-aware clearing. `RouteMap` chooses the nearest
supported retained GPS key (earlier ties, stable duplicates) and draws a distinct
non-intercepting dot using the active external/offline projection, without moving
the viewport. Missing metadata or GPS support hides only this dot; no interpolation,
fetching, persistence, backfill or terrain-section map linkage is introduced.
`tests/activity-route-position.test.tsx` and dashboard interaction coverage verify
alignment, clearing, sparse/capped GPS and preservation of map controls.

`tests/activity-dashboard-calculations.test.ts` exercises the pure facades without
SQLite or environment setup, including original window-boundary/duplicate behavior
and frozen inputs. `tests/activity-dashboard.test.ts` retains repository/API wiring,
privacy, lap and HR-zone integration coverage. Source revert is sufficient rollback;
no stored-data backfill or migration is needed.

## Shared activity terrain-section evidence

`analytics/terrain-sections.ts` is neutral pure elevation-profile analysis, not a coaching score. `local-data/application.ts#createTerrainAnalysis` consumes a single capped normalized selected-read capability; composition binds `repository.ts#getActivityTerrainInput` (100,001 rows detects the 100,000-point limit) and adds the same canonical result to the dashboard DTO. There is no raw archive, connector, persistence/cache or migration dependency. Reimported normalized inputs recompute on the next read; back-sync is a no-op and rollback is a source revert.

Terrain-v2 uses 25m distance anchors, isolated >10m spike rejection when adjacent neighbors agree within 2m and triangular [1,2,1]/4 smoothing. It detects sustained trend changes, not fixed tiles: a continuously sliding 100m signed-grade window and 300m rolling-relief window supply ±3% enter / ±2% stay evidence. A changed trend must persist >=300m; climb/descent changes also need >=6m vertical support. Refine the boundary to a nearby profile extremum/plateau edge within100m. Require >=300m on both sides before committing a boundary, absorb short initial/transient/final features, and reject disconnected runs below300m rather than join gaps. Final rolling labels require a sustained detected rolling trend plus >=10m each ascent/descent and range, with |net|/gross<0.6; small flat noise or one absorbed short hill cannot turn a long flat approach into rolling terrain. Merge equal adjacent final kinds only inside a continuous run. Windows and 25m resolution do not impose output section lengths or periodic cuts. Invalid ranges, >30s time gaps and >100m distance gaps split runs. Ascent/descent integrate filtered edges once; signed grade uses net filtered elevation / recorded along-route distance. Steep up/down support counts >=10% filtered anchor-edge distance, not instantaneous maxima. Distance coverage uses all valid positive recorded changes, including unsupported gaps; timestamp coverage uses distance-split adjacent-edge counts. Consistent timezone-less Garmin timestamps establish a relative clock; stored elapsed alone never establishes seconds. Original valid adjacent time edges supply elapsed/estimated stationary (<=0.3m/s for >=30s)/moving, elapsed pace and pairwise time-weighted HR with explicit support. Missing metrics remain null.

`analyzeActivityTerrain` admits one ID and 1–20 result rows, omits raw samples/GPS/paths and preserves whole-analysis coverage/totals before row caps. Successful rows register in the existing turn-owned handle map for bounded math and useful evidence-backed prose. Unavailable results register nothing; partial/truncated analysis requires explicit limitations with useful supported partial facts. Existing SQL/math semantics, budgets, source grade, hover formulas and laps remain unchanged.

The additive Terrain sections grid labels the section's time-weighted mean as **Avg HR**, formats durations as h/m/s with zero units omitted (zero stays0s), and shows elapsed pace as a human duration per kilometre. Detailed timing/HR support lives in **Method and quality**; a main-grid **Data notes** column appears only for incomplete/unavailable row support, with readable global gap/partial/truncation messages. Raw API/tool values and analytical weighting remain unchanged. The grid has keyboard/pointer buttons and an elevation interval overlay independent of hover. Activity changes reset selection. Raw chart timelines use stored coordinates; timestamp-derived charts highlight only with matching source-row origins/counts, otherwise explicitly report unavailable alignment. No map highlight: route points are independently sampled and retain stored elapsed coordinates. Missing old payloads are tolerated. Numerical, API/tool equality, privacy/grounding/isolation and no-GPS UI tests live in `terrain-*` and the existing dashboard suites. Public examples are synthetic; real smoke remains private/local.
