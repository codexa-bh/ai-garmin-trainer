# Sync, history import and Health views

[Garmin connection](garmin-auth.md) owns keys; [additional Garmin data](garmin-extra-data.md) owns extra fields and their separate backfill. This guide owns manual/hourly Sync, historical exploration, health finality and Health views.

## Sync latest and historical import

**Sync latest** refreshes recent health/activity/body facts and baseline/details without changing historical exploration. **Import older data** explores the automatic or selected scope; **Continue historical import** appears only for verified executable saved work. A history record or unknown remote boundary alone is not backlog. Completed ranges stay completed on refresh. Upsert counts are processed/refreshed records, not proven new records; stored totals are separate.

One Sync drains all eligible known activity details, including activities admitted later in history import, with no count quota/selection ceiling. Available, partial and unsupported details are terminal. Failures stop rather than loop; attempted/completed/remaining counts differ. Phase, incomplete reason and next action stay visible outside collapsed **Technical details**. `garmin_sync_v1` retains operation truth across latest/history/reload; legacy absence means unknown. Cancellation/safety stops remain incomplete in `sync_run`. Internal pre-dispatch batches continue within the same claim without resetting timeouts/cumulative limits.

### Hourly auto-sync

Native **Auto-sync** defaults On, including settings saved before this field existed; explicit Off is retained. Save takes effect after quit/reopen. While the app runs, the backend refreshes **latest only** every 60 elapsed minutes after validated successful completion of the current history scope, with no executable family/repair/detail backlog. A missing, incomplete, failed, interrupted, corrupt or differently scoped history checkpoint never unlocks it. A selected limit and automatic discovery keep their existing completion semantics; no new inception probe is required.

Successful manual or automatic Sync postpones the next refresh. Reopen/wake admits at most one overdue latest operation, not one per missed hour. No work runs while the app is closed or asleep. Native readiness, active setting and local key configuration precede admission; there is no startup Verify probe. View visibility does not own scheduling. Passive summary observation shows current work/results across navigation, offers Cancel for backend work and refreshes loaded Health after settlement without success toasts or focus changes.

Automatic work shares the importer, claim, budgets, KPI measurement and recovery rules. Cancellation, failure or interruption blocks later automatic work until explicit successful recovery, never immediate retry or historical resume. Additive `garmin_auto_sync_v1` records scope, successful cadence basis and attempted admission before reader construction, preventing uncertain attempts from replaying after reopen. Existing valid settled history/operation timestamps initialize cadence without migration; unknown checkpoint bytes remain untouched.

### Bounds and discovery

History refreshes recent facts once, then advances fair health/activity/body/repair batches in one foreground operation:

- Operation: 30 minutes / 480 cumulative HTTP requests; serial dispatches at least one second apart.
- Internal batch: 96 requests / 180 seconds; each request: 30 seconds.
- Daily ranges: 31 days for sleep/Body Battery, up to a year for summaries/HRV. Counts measure actual HTTP requests, not a promised service allowance. Startup, nested reads and pacing share the operation clock.

Trainer/bodyless legacy HTTP callers retain their bounds but refuse mismatched saved scope; dashboard sends explicit latest/history/discover intent. **Syncing…** and a decorative spinner indicate local or confirmed server activity, not stale metadata/interruption; reduced motion uses a static cue. Technical details contains sanitized run logs/cursors/counts, not standing policy. Older-history attention remains visible after latest succeeds.

Discovery probes daily summaries in year-long ranges of at most 364 days, never below a selected limit, prioritizing dates with wellness data. Selected limits still read empty dates. Automatic discovery probes the next older year before each historical batch; a full empty year stops at the oldest data date (`noDataBefore`) and displays **Older history complete — No Garmin data found before <date>**, without Continue. This is a practical summary-data stop, not certified account inception: data before a wholly empty year is not automatically explored. Family cursors remain independent.

### Cancellation, checkpoints and scope

Cancel, disconnect or app exit stops dispatch/owned work but retains commits. Restart/safety pauses require explicit Continue when saved work is actionable; Finish, startup, navigation and summary reads never discover history. Auth/rate/protocol/storage failures and no safe progress stop automatic admission without retries. After cancellation/lost response, refresh summary before another action; stale/failed summary blocks replay. Live claims refuse overlap; persisted running without a live claim means interrupted, not a permanent lock.

Summary separates checked older dates, dates with metrics, oldest imported date and unresolved work. Empty dates/activity exhaustion never prove earliest remote health. Saved dates are optional limits, not coverage proof; clearing requires explicit relaunch. Old forward checkpoints are preserved, never treated as reverse cursors. Additive records own separate facts:

- `garmin_history_v1`: family progress.
- `garmin_discovery_v1`: minimized hint provenance, queued dates and operation phase/attempts/batches/stop reason.
- `garmin_latest_v1`: latest settlement/counters.

Summary reads never write them. Switching a saved limit to automatic discovery offers **Discover older history** only for valid settled/paused limited progress. Under the Sync claim it atomically changes history/discovery scope, retains cursors/counts/unresolved work/imported data and continues below the old limit. A frozen activity window finishes its original lower bound; a steps hint already past the limit is reread once just below it. Startup, summary and Sync latest never transition scope. Other limit changes, disagreeing/one-sided checkpoints and failed/no-progress history explain why no recovery action is executable. Corrupt/unsupported checkpoints refuse reset. Normalized rows and date-keyed weight history remain preserved. Older source may ignore new checkpoints but is not a bounded-sync substitute; rollback must preserve DB/backups.

### Latest health finality and freshness

An ended desktop-local day becomes operationally final only after successful normalized download and Garmin summary coverage from local midnight to next midnight with consistent GMT offsets, including 23/25-hour DST days. Partial/malformed/missing coverage and today stay mutable. Finality is independent of metric completeness: complete, partial and recognized source-empty final days skip across restarts, with missing fields still missing. Coverage proves neither a watch upload nor that Garmin will never revise old cloud records.

Non-final dates and the complete forward tail remain eligible without a 14-day cutoff, within floor/budgets. The first official-reader run over retired-connector data rechecks the most recent 14 local dates and all non-final ones; older upload-based finals remain legacy-final. Refresh preserves prior non-null values and valid zero/downward corrections.

Latest has no artificial pacing; serial cancellation/budgets/fatal auth-rate handling still apply. Its one recent-activity request covers about 14 UTC dates and required details drain. Original-file FIT supplies detail/HR zones, with list-bucket fallback or a labelled estimate when file boundaries permit. Profile/zone attempts occur at most once per local day across restart, including failures/body-profile access. FIT baseline runs only if the newest known activity differs from the last successful applicable FIT activity; no activity skips it. Failed/skipped sources preserve useful baseline facts. `garmin_latest_freshness_v1` adds no schema/history/discovery write. A settled same-day repeat normally uses about nine requests (key exchange, daily sources, activity list, weight/body history), with no file downloads.

## Health views

**Daily** compares seven consecutive calendar dates, not an aggregate. Previous/Next moves seven dates including gaps; Latest selects the newest imported date at/before today. The range survives tabs, navigation and overlapping post-sync refreshes. Missing fields/records and outside-loaded history are explicit; today is in progress on the UTC sync calendar. Charts keep all seven slots, with exact values on pointer/focus/tap date buttons.

- Calories stacks resting below active, with shared exact breakdown and independent recorded total. Incomplete components omit the stack but retain known values; differing sums stay explicit.
- Sleep stacks REM, Deep, Light bottom-to-top in Daily/Weekly/Monthly. Order is presentation, not quality. Shared readout keeps independent recorded sleep duration; period stages average over their own available days. Incomplete stacks are omitted without hiding known values or reconciling sums. Awake, Nap and score remain separate.
- Collapsed per-date details preserve coverage and categorical HRV. No interpolation/zero-fill. Weekly/monthly calculations and bounded imported inputs are unchanged. [Extra-data visibility](garmin-extra-data.md#visibility-in-health-and-activity) owns additional metrics.
