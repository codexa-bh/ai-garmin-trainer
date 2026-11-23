# Architecture: dashboard, charts and terrain

Part of [architecture](../architecture.md).

## Dashboard ownership and lifetime

`trainer-dashboard.tsx` owns navigation, section visibility, focus/scroll restoration, startup and cross-feature refresh callbacks. Feature hooks in `src/app/dashboard` are called unconditionally in that persistent shell; hiding a view does not unmount its state/request owner or repeat startup fetches. Views mount conditionally; Health mode/chart presentation follows view lifetime. No dashboard-wide store, sibling-hook import or provider/storage access belongs in client features.

The mobile native dialog owns modality/focus trapping/dismissal/breakpoint cleanup; shell owns destination focus. Chat conversation selection is panel-local: an arrow-only toggle, identity rail/band and hidden body beside the transcript (above at ≤960px). Shell keeps only expansion state, initially collapsed, closes menus on toggle and preserves arrow focus; no main navigation entry/drawer/backdrop.

Feature hooks own request generations, loading/errors and mutation lifecycles; views own rendering. Superseded responses cannot overwrite newer intent or dirty editor drafts. Cancel restores the current saved snapshot; saves invalidate older reads. Shared contracts/transport/formatting/Markdown modules own wire defaults, response decoding, labels and safe links, not server capabilities.

### Refresh and navigation

Startup schedules conversation/memory/Profile/plan/summary reads. History waits for resolved conversation selection; selection/bootstrap/create/delete mutations serialize and stale history/page/list responses are rejected. [Backend selection](backend-roles.md#conversation-titles-and-selection) owns durable identity; no browser storage.

Navigation triggers Activity search and plan reload, never saves/remounts feature owners. Reopening plans selects the current weekly plan. In-view weekly refresh retains historical week selection or refreshes pages through the oldest loaded week with new cursors/deduplication; General Plan entry refreshes its saved snapshot while preserving drafts. [Training Plan](../training-plan.md) and [weekly KPIs](../weekly-kpis.md) own displayed targets and history.

Successful Sync awaits summary, then refreshes loaded/open Health preserving Daily range. Streamed chat completion refreshes memory/conversations and conditionally plans; JSON fallback retains its distinct refresh conditions. Keyboard effects read current handlers without render-identity restart. Model settings refresh on chat visibility and offer explicit retry/save feedback; native Settings owns keys/configuration. Profile & data composes Profile/imported facts/debug/deletion, not new credential or mutation authority.

### Health and Activity

Daily range-end civil date lives in the persistent Health hook. Tabs/away-back retain it; refresh keeps a range overlapping eligible loaded dates. Only first load, Latest or lost-window reanchoring chooses latest. Display seven ascending calendar dates, not seven newest rows. Missing dates/fields, outside-loaded history and today's UTC in-progress values remain distinct. Roving tabs and exact-value keyboard/pointer controls preserve accessibility without a wide table; source/HRV context is secondary. No interpolation, aggregation or date compression.

Health charts share rollup rendering except Calories and REM/Deep/Light stacks with independently recorded sleep duration. Additional evidence arrives in existing Health/Activity payloads via bounded real-key supplement reads, not per-row list detail or automatic Sync. [Garmin visibility](../garmin-extra-data.md#visibility-in-health-and-activity) owns those fields. Only resort skiing/snowboarding list cards use stored `SKI_RUN_SPLIT` distance; missing/invalid distance is a dash, duration/other sports remain session-based.

Memory view translates summary state/coverage without changing eligibility, engine or privacy policy; it is not semantic search. Passive reads retain mounted content; privacy mutations revoke it. Sync state persists across navigation and keeps bounded log/operation disclosure; imported facts belong in Profile & data.

## Selected-activity chart and route calculations

`analytics/activity-dashboard-calculations.ts` exposes pure `buildActivityDashboardCharts` and `buildActivityDashboardRoute` over selected ordered normalized rows. Repository owns queries/order/laps; local-data owns read models/HR zones; HTTP owns serialization/labels. Preserve timing, 60-second distance speed, 180-second grade, route filtering/bounds and endpoint-preserving sampling. Chart points are not downsampled; route bounds use all accepted points even beyond the 400-point cap. No sorting/mutation or measured-speed/GPS/summary fallback.

Chart `sourceElapsedSec` retains the stored row key independently of displayed timestamp-derived seconds. ActivityView owns payload-scoped pointer/keyboard selection and owner-aware clearing. RouteMap finds nearest supported retained GPS key (earlier ties, stable duplicates) and draws a non-intercepting dot in the current offline/external projection without moving the viewport. Missing metadata/GPS hides only the dot. No interpolation, fetch, persistence or terrain-map linkage.

## Shared activity terrain-section evidence

`analytics/terrain-sections.ts` is pure elevation-profile analysis, not a coaching score. `createTerrainAnalysis` receives one capped normalized read; repository selects 100001 rows to detect the 100000-point limit. Dashboard and tool share the same result; no raw archive, connector, cache or schema dependency. Reimported inputs recompute on read.

Terrain-v2 uses 25m distance anchors, rejects isolated >10m spikes whose neighbors agree within 2m, and smooths with triangular [1,2,1]/4 weights. Continuously sliding 100m signed-grade and 300m relief windows use ±3% enter/±2% stay evidence. Trend changes must persist ≥300m; climbs/descents need ≥6m vertical support. Refine to an extremum/plateau edge within 100m and require ≥300m on both sides; absorb short edge/transient features. Disconnected runs below 300m are rejected, not joined. Final rolling classification requires sustained rolling plus ≥10m ascent, descent and range and |net|/gross<0.6. Equal adjacent kinds merge only inside a continuous run; windows do not impose periodic section lengths.

Invalid ranges, >30s time gaps or >100m distance gaps split runs. Ascent/descent integrate filtered edges once; grade is net filtered elevation/recorded route distance. Steep support counts ≥10% anchor-edge distance, not instantaneous maxima. Distance coverage includes all valid positive changes, even unsupported gaps; time coverage uses distance-split adjacent-edge counts. Consistent timezone-less timestamps support relative time; stored elapsed alone does not. Valid original edges supply elapsed, estimated stationary (≤0.3m/s for ≥30s), moving, elapsed pace and pairwise time-weighted HR with support; missing values are null.

`analyzeActivityTerrain` accepts one ID and 1–20 rows, omits samples/GPS/paths and retains whole-analysis totals/coverage before truncation. Success registers rows for same-turn math; unavailable results do not. Partial/truncated results require disclosed limitations, not suppression of useful facts.

UI labels time-weighted mean **Avg HR**, uses h/m/s durations (omit zero units, zero stays 0s) and elapsed pace per kilometre. Method/quality carries detailed support; Data notes appears for incomplete/unavailable rows with readable global gaps. Keyboard/pointer selection highlights an elevation interval independently of hover and resets on activity change. Timestamp-derived charts require matching source origins/counts; otherwise disclose unavailable alignment. No map highlight; route sampling/coordinates are independent. Old missing payloads remain tolerated.

Verification entry points: dashboard-feature/hydration, Health/Activity, model-settings/memory UI, chart/route-position and `terrain-*` suites. Pure calculation tests use frozen inputs; wiring tests cover SQLite/API, tool equality, privacy/isolation and interaction. Public examples are synthetic; real smoke remains private/local.
