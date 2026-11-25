# Architecture: dashboard, charts and terrain

Part of [architecture](../architecture.md). Product field meanings belong to [Garmin visibility](../garmin-extra-data.md#visibility-in-health-and-activity); plan/history behavior belongs to [Training Plan](../training-plan.md) and [weekly KPIs](../weekly-kpis.md).

## Dashboard ownership and lifetime

`trainer-dashboard.tsx` owns navigation, visibility, focus/scroll restoration, startup and cross-feature refresh. Feature hooks run unconditionally in the persistent shell; hiding views does not reset request/state ownership or repeat startup fetches. Conditional views own presentation lifetime, including Health mode/charts. No shared dashboard store, sibling-hook imports or client provider/storage access.

Hooks own request generations, loading/errors and mutations; views render. Superseded reads cannot replace newer intent or dirty drafts; Cancel restores saved state and saves invalidate older reads. Shared transport/contracts/formatting/Markdown own decoding/defaults/labels/safe links, not server capabilities.

Native mobile dialog owns modality/focus trap/dismissal/breakpoint cleanup; shell owns destination focus. Conversation selection remains panel-local, collapsed initially, beside the transcript or above at ≤960px. Shell retains only expansion, closes menus on toggle and preserves arrow focus; no main navigation/drawer/backdrop.

### Refresh and navigation

Startup schedules conversation/memory/Profile/plan/summary reads. History waits for resolved selection; bootstrap/create/delete/select mutations serialize and stale list/history/page responses are rejected. Durable identity belongs to [backend selection](backend-roles.md#conversation-titles-and-selection), not browser storage.

Navigation triggers search/plan reload, never saves or remounts owners. Reopening plans selects the current weekly plan. In-view refresh preserves historical selection or reloads through the oldest loaded week with new cursors/deduplication; General Plan refresh preserves drafts. Successful Sync awaits summary, then refreshes loaded/open Health without losing Daily range. Streamed chat completion refreshes memory/conversations and conditionally plans; JSON fallback keeps its distinct conditions. Keyboard effects use current handlers without render-identity restarts. Model settings refresh on chat visibility with explicit retry/save feedback; native Settings owns credentials/configuration.

### Health and Activity

The persistent Health hook owns civil range-end date. Tabs/away-back preserve it; refresh retains overlapping eligible dates. Only initial load, Latest or a lost window reanchors. Display seven ascending calendar dates—not newest rows—with missing fields/dates, outside-loaded history and today's UTC in-progress data distinct. No interpolation/date compression. Exact-value keyboard/pointer controls and roving tabs preserve accessibility without a wide table.

Shared rollups exclude separate Calories and REM/Deep/Light stacks with independently recorded sleep duration. Additional evidence uses bounded real-key supplements in existing payloads, not per-row detail or automatic Sync. Resort skiing/snowboarding card distance alone uses stored `SKI_RUN_SPLIT`; missing/invalid is a dash, while duration/other sports stay session-based.

Garmin-backed views use one plain, secondary-text source label at the heading, not per row or metric. Activity list/detail, Health modes, Sync coverage and imported Profile facts label only displayed data; manual Profile fields and KPI targets do not. KPI labels name measured actuals, not reviewed/user-reported values. Chat uses the same label before answers under the existing persisted visible-grounding condition, including reloaded history; it does not infer provenance from prose.

Memory presents state/coverage, not semantic search or new eligibility/privacy policy. Passive reads preserve mounted content; privacy mutations revoke it. Sync state/log disclosure persists across navigation; imported facts stay in Profile & data.

## Selected-activity chart and route calculations

Pure `analytics/activity-dashboard-calculations.ts` builds charts/routes over ordered normalized rows. Repository owns query/order/laps; local-data owns read models/HR zones; HTTP owns serialization/labels. No sorting/mutation or measured-speed/GPS/summary fallback. Chart points remain unsampled; route sampling preserves endpoints and derives bounds from all accepted points, beyond the 400-point cap.

Stored `sourceElapsedSec` stays distinct from timestamp-derived display time. ActivityView owns payload-scoped pointer/keyboard selection/clearing; RouteMap finds nearest retained GPS key (earlier ties, stable duplicates) and draws a non-intercepting dot without moving the viewport. Missing metadata/GPS hides only the dot. No interpolation, fetch, persistence or terrain linkage.

## Shared activity terrain-section evidence

`analytics/terrain-sections.ts` owns pure elevation-profile analysis and its tuning constants; it is not a coaching score. `createTerrainAnalysis` shares one capped normalized read between dashboard/tool, detects the 100000-point limit and recomputes imported changes without cache/raw/connector/schema dependencies.

The algorithm rejects spikes/gaps, smooths elevation, requires sustained grade/vertical support and refines boundaries without joining disconnected runs or imposing periodic lengths. Ascent/descent integrate filtered edges once; grade is net filtered elevation over recorded distance. Steep support is sustained distance, not instantaneous maxima. Distance/time coverage have separate denominators; unsupported gaps are not silently complete. Timestamp consistency can establish relative time; elapsed keys alone cannot. Missing duration, stationary/moving time, pace or supported time-weighted HR stays null. Exact thresholds/window arithmetic are implementation-owned, with frozen-input tests rather than a second prose algorithm.

`analyzeActivityTerrain` takes one ID and 1–20 rows, omits samples/GPS/paths and keeps whole-analysis totals/coverage before truncation. Only success registers same-turn math rows. Partial/truncated results remain useful with disclosed limits.

UI shows Avg HR, h/m/s duration (zero is 0s), elapsed pace/km and method/quality support. Data notes explains incomplete rows/global gaps. Selection highlights elevation independently of hover and resets on activity change; incompatible timestamp origins/counts disclose unavailable alignment. No map highlight, and old missing payloads remain tolerated.

Verification: dashboard hydration/features, Health/Activity/model-settings/memory UI, chart/route-position and terrain suites; real SQLite/API/tool equality, privacy/isolation and interactions complement pure calculations. Public examples stay synthetic; real smoke stays private/local.
