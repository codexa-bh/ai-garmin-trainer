# Additional Garmin evidence and explicit history backfill

Owns official-Sync extra fields, coverage, UI/trainer projections and maintenance. Schema 30 adds individual snow splits to schema 29 groups; older builds refuse and startup never migrates. Views read stored data, never import.

## Field and coverage contract

- **Sleep:** `daily_sleep_detail` / `daily_sleep_score_component` by Garmin date. GMT epoch ms/source-local clock/own offset, never host timezone. overall/deep/light/rem scores 0–100; duration/stress/awake-count/restlessness have qualifiers/ranges only, no invented score. Feedback is enum codes, free text dropped.
- **HRV:** `daily_hrv_detail`, weekly average/best 5-minute night/baseline bounds in ms. Nightly/status remains `daily_health`; no app threshold.
- **VO2:** `vo2_max_reading` by date/branch generic|cycling|rowing, rounded/precise ml/kg/min and supplied sport. Sparse, never daily/forward-filled.
- **Battery:** `daily_body_battery` min/max/charged/drained/latest/source end-of-day (latest differs); `body_battery_event` signed impact keyed type+GMT start+duration. Link activity only when source names it, not time proximity. `activity_extra_metrics.body_battery_delta` is signed delta, not level. Range data, no wake/sleep reads.
- **Stress:** `daily_stress` durations seconds converted from ms. Fractions 0–1 only if consistent with durations, else null; activity/uncategorized is not high stress.
- **Lap HR:** `activity_lap_hr_zone_time` by activity/lap/bucket, joining FIT lap's own message_index. Bucket 0 below zone 1,1–5 zones,6+ above, with that file's boundaries/method/max/rest HR. Missing/duplicate references make unavailable. Never add lap and session totals.
- **Dynamics:** activity list cadence steps/min and stride cm; FIT cadence **cycles/min** with fraction/total cycles. FIT oscillation/step length convert mm; other sensor metrics exist only when recorded. Preserve list/FIT distinction.
- **Snow totals:** `activity_split_summary`, five types SKI_RUN_SPLIT/SKI_LIFT_SPLIT/ASCENT_SPLIT/DESCENT_SPLIT/TRANSITION; counts/duration/distance/best split are aggregate **totals**, not individual runs.
- **Snow individuals:** `activity_snow_split`, FIT 312 run/lift, stable key; UTC measured start/end, elapsed/timer/moving seconds, distance/ascent/descent/elevation metres, average/max/signed vertical m/s. Null remains missing, zero/negative elevation valid. GPS only for explicit bounded route questions. Provenance `garmin_official_fit`.

### Coverage and refresh

`garmin_data_coverage(group,subject_type,subject_id,status,reason)` distinguishes populated, source-empty, unavailable and failed. **No row means not imported/backfilled—unknown, not zero.** Original groups retain populated on later unsuccessful reads; independent snow_run_lift_splits reports latest attempt even with preserved children. Read rows and coverage together.

Sync reuses 31-day health ranges plus one VO2 range/block, existing activity pages and single FIT decode. Scalars coalesce; sleep components merge independently; event/summary sets replace only if source list returned; lap refresh replaces zones with laps.

Individual splits require one FIT session and unique valid indexes 0–4095, key `index:N` independent of file order. Display by start/index, retain source_order. Missing/duplicate index, unknown type, multisession/reversed interval or >2000 messages makes entire set unavailable, never partial/truncated authority. Complete nonempty refresh reconciles keys/merges surviving null metrics; empty/unavailable/failed preserves prior rows. Decode failure is failed, not no-file. Split import is independent of stored laps: count/order/time proximity grants **no lap link or allocation of lap/session HR**. Aggregate sets separately before joins; never add individual/summary totals or count lift ascent as athlete effort. Recipe freshness includes split facts/latest coverage; Garmin deletion removes these groups.

## Default trainer evidence

Recovery preview uses ten newest existing `daily_health` dates only: sleep score/qualifier, weekly HRV/balanced bounds (not nightly), charged/drained points (not levels/delta), high_seconds/60 rounded to one decimal (not activity/uncategorized). Independent group coverage, no extra-only dates/carry-forward/child multiplicity. Legacy values remain without extra coverage; populated null is missing. Enum codes≤64 ASCII, no free text.

Known-ID dashboard adds battery/dynamics/lap zones/all five snow total types with source units/boundaries intact. Coverage/measurement limits precede optional detail: supplementary≤20 laps×8 buckets with exact counts/omissions; optional overview laps/terrain≤20, source cap 100 means unknown full lap total. Finite evidence remains complete on native/legacy carriers without raising generic limits (selected recovery tested<8000 characters, supplementary JSON<90000). Numerical default exposes no raw FIT/GPS/paths/charts/streams/fetch/UI selection; explicit images are separate.

Preview is discovery, not full history/current verification. Event-relative questions need tools; all-day totals do not prove pre-start state. Missing coverage differs from empty/unavailable/failed/zero; reads never migrate/backfill.

### Derived split heart rate

Derive on read from stored HR samples **inside the split's measured start/end**, never persist/backfill or infer end from timer/elapsed. Endpoints need valid explicit-zone ISO. Explicit-zone samples keep their instant. Zone-less YYYY-MM-DD HH:mm:ss (or T,1–3 fractional digits) is UTC only if the activity's **first stored sample before filtering** exactly matches valid raw started_at epoch-ms. Anchor may lack HR/be outside split; never choose later/other activity anchor or infer timezone/tolerance/correction. Any rejected sample time makes activity split HR unavailable, not bridged.

Each sample supports its half-open next-sample span clipped to end; no outside-window carry or shared-boundary double count. Only positive spans≤30s count; longer spans contribute nothing. Missing/zero/out-of-range HR is unsupported, not zero. Need multiple measured samples and **≥80% unrounded window support**; exactly 80% qualifies despite gaps. Avg HR is duration-weighted over supported seconds; zones sum to that support, not full window. Never fill leading/middle/trailing gaps or filter stationary/paused data by speed/timer.

Zone bounds come only from trusted file session (`garmin_official_fit`/estimate) or independently complete lap-file zones 1–5. MCP/list sessions cannot veto lap-file bounds. Require positive strictly ascending integers and agreement across all eligible known bounds, including incomplete laps/beyond UI cap; never combine partial laps. Incomplete trusted session remains unavailable, not absent. Missing/conflicting limits can leave Avg HR valid; no current athlete fallback or allocation of stored zone durations. Floors inclusive, below-zone 1 bucket first; reading lap limits creates no split association.

UI shows runs; trainer `snowEvidence.splitHeartRate` includes runs/lifts≤20 each with source/returned/omitted counts. Do not add derived and Garmin totals or extrapolate omitted rows. Closed reason precedence: invalid window, unproven timezone, invalid/absent time, no stored/window samples, no usable HR, too few samples, insufficient support. Exact support/window seconds and nullable >30s contiguous-gap warning disclose duration coverage. Unknown clocks/windows/minimum samples leave warning unknown; unavailable support is null. Time/HR failure also invalidates zones; limits-only failure does not hide valid Avg HR. No raw timestamps/parse errors/sample diagnostics in transport.

## Visibility in Health and Activity

All views read stored normalized rows. Gap labels distinguish Not reported by Garmin (populated null), Garmin returned none, Source unavailable, Read failed, Not imported (unknown). Do not show free-text reasons; neutralize unknown enum labels.

### Health Daily

Use existing newest 366-day payload and selected seven dates:

- HRV nightly value, weekly average and same-date balanced band remain distinct; band needs ordered endpoints, never carry-forward.
- Sleep qualifier beside score; component disclosure, no numbers for qualifier-only fields.
- Stress minutes: stack only with all rest/low/medium/high values; activity/uncategorized separately.
- Battery charged/drained points, not latest/end-of-day levels; zero distinct from missing.
- VO2 per-branch dated points only, no lines/averages/fill. Empty window proves nothing elsewhere.

### Activity list and summary

Only resort_skiing/resort_snowboarding list distance uses stored SKI_RUN_SPLIT total, excluding lifts; missing/negative/nonfinite is dash, zero valid. No individual-row sum/coverage dependency. Duration/other sports/detail session distance unchanged.

Summary shows signed battery delta, list cadence steps/min/stride cm separately from fractional FIT cycles/min/step metres; stored list maximum cadence is not shown. Lap zones align by stored lap number, with bar/exact times/file provenance; missing stays blank and recorded all-zero says so. Never add session/lap totals.

### Snow totals and individual runs

Show snow only for normalized closed ski/snowboard sports and actual stored parts, not name/relevance/coverage alone. Compact **Garmin totals** shows Runs/Lifts count/duration/distance, e.g. `Runs 12 · 1h 0m · 31 km | Lifts 11 · 50m · 8.4 km`; omit absent part/separator, dash missing fields, retain zero. It is not sum of shown runs. Other aggregate types/best split remain trainer-only; individual lifts are not UI rows. No empty snow heading/panel.

Run table sorts measured start (missing last), index/key and shows timer seconds/tenths, km, descent m, measured average/max km/h, derived Avg HR and HR-zone Times disclosure. No ascent/Max HR/inferred timer-speed/GPS/lap association. Support note remains visible even when zone bounds unavailable, reports partial duration and long-gap warning; labels say supported HR time, not full run or recorded lap time. Missing derivation is dash/closed reason, distinct from all-zero buckets. One run is visible; defensive 2000-row bound discloses omitted counts, not lap cap. Narrow keyboard-reachable scroller preserves decimals/zero.

Preserved rows stay visible with latest-coverage warning; unknown/empty/unavailable/failed/populated-no-runs differ in disclosure. Hide Lap details **only** for normalized snow with individual runs actually displayed, including preserved rows. Other sports/stray rows/snow without runs/strength/fewer-than-two-lap rules retain prior behavior.

## Explicit history backfill

Old archives lack these fields; history needs **fresh official reads**. `backfill:garmin-extra` is explicit maintenance, not startup/Sync/Settings work. Default writes extra relations/coverage/own checkpoint only, not existing core activity/health/laps, normal checkpoints or other domains. It creates no dates/activities. Lap evidence requires stored/file count/number/start within 2s, otherwise unavailable. Snow-only is a separate phase/authority below.

### Preconditions (every invocation needs current authority)

1. Approve exact target; stop all writers and acquire shared lease without killing/deleting to force access.
2. Verify a pre-write WAL-consistent recovery backup, integrity/FKs/schema.
3. Explicitly migrate approved target to schema 30; backfill rejects other schemas.
4. Rehearse same operation on disposable copy. Snow history requires **full stored selection/range**, not sampling. Present backup/rehearsal/preservation/coverage/request bounds and obtain fresh primary migration/backfill approval. Start/source merge/earlier general-backfill consent is insufficient. Key/service access and stop/build/activation/reopen retain separate exact authority.

### Run

```bash
# Key only on stdin; never argv/env/logs/chat.
DATABASE_PATH='/exact/approved.sqlite' npm run -s backfill:garmin-extra -- \
  --from 2024-07-01 --to 2026-11-19 [--max-requests 150] [--max-seconds 600] < private-key-input
```

Serial requests≥1s apart; defaults 150/600s, maxima 1000/3600s. Phases:31-day health blocks,90-day activity windows padded one day, then one FIT/activity. Settled nonfailed coverage skips reads; failed remains retryable under fresh authority. Data/checkpoint commit atomically; crash replays batch. Bind contract/schema/canonical-target hash/date bounds; corrupt/mismatch refuses unchanged. SIGINT/SIGTERM/budget/auth/429 stop with durable progress; isolated service/protocol failure marks batch failed, three consecutive failures stop.

No stable account ID exists: before each batch, stored activities must recognizably reappear and overlapping daily steps match. Otherwise account-or-target-mismatch writes nothing. One JSON result contains closed status/reason, phase/counts/endpoint totals/coverage/integrity/FKs, never key/IDs/measurements/payloads/paths.

### Snow-only individual history

Add `--snow-only --from <full-history-start> --to <full-history-end>`. Write only individual splits/latest split coverage/garmin_snow_split_backfill; no laps/streams/zones/core/general-extra/normal checkpoints. Select exact stored closed snow sports in deterministic full-range order, never invent candidates.

Binding includes contract/schema/path+device/inode/full candidate identity-order/range; changed/corrupt/foreign refuses even after completion. Each pending subject must reappear in fresh padded local-date pages≤20/day before one FIT read; listing is admission, not persisted list evidence. Settled nonfailed **new** coverage skips without requests regardless of old lap coverage. Data/coverage/checkpoint atomic. Cancellation/budget/auth/429 stops; read/store/invalid-original failures stop visibly without automatic retry. Missing original is unavailable; successful no messages is empty. Resume needs reconciled effects/fresh scoped authority.

### Recovery

Stopped/refused target remains consistent. Inspect result/coverage; continue same bounds only under current authority, never edit/reset checkpoints. Preserve genuine recovery backups (not expiring rehearsal scratch), originals and newer writes. Use compatible forward fix or separately reconciled restore, never automatic rollback/copy-back. Reopen compatible app only with authority. Primary completion requires full-selection coverage, no failed/pending subjects, integrity/FKs and unchanged unrelated/checkpoint facts.
