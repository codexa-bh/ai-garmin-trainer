import type { GarminReader, DetailStore } from "./import-ports";
import type {
  ActivityEffortBackfillResult,
  DetailedBackfillResult,
  DetailRefreshOptions,
} from "./import-contracts";
import { normalizeUnsupportedActivityDetail } from "./detail-normalize";
import { classifyDetailError } from "./import-policy";

export function createDetailImports(
  store: DetailStore,
  createReader: () => GarminReader,
) {
  const {
    upsertActivities,
    listActivityIdsNeedingEffortBackfill,
    upsertActivityHrZoneTime,
    getDetailAvailability,
    recordActivityDetailAttempt,
    upsertActivityDetail,
  } = store;
  async function fetchAndStoreActivityEffort(
    client: GarminReader,
    garminId: string,
  ): Promise<boolean> {
    try {
      const activity = await client.activityEffort(garminId);
      if (!activity) return false;
      upsertActivities([activity]);
      return true;
    } catch {
      return false;
    }
  }

  async function backfillActivityEffortFields(
    options: { limit?: number } = {},
  ): Promise<ActivityEffortBackfillResult> {
    const ids = listActivityIdsNeedingEffortBackfill(options.limit ?? 100);
    const client = createReader();
    let updated = 0;
    try {
      await client.start();
      for (const garminId of ids) {
        if (await fetchAndStoreActivityEffort(client, garminId)) updated += 1;
      }
      const remaining = listActivityIdsNeedingEffortBackfill(1).length;
      return {
        status: "completed",
        attempted: ids.length,
        updated,
        remaining,
        detail:
          remaining === 0
            ? `Activity effort back-sync completed for ${updated}/${ids.length} attempted activities; no activities remain without any normalized effort fields.`
            : `Activity effort back-sync completed for ${updated}/${ids.length} attempted activities; at least one activity still has no normalized effort fields.`,
      };
    } catch (error) {
      const remaining = listActivityIdsNeedingEffortBackfill(1).length;
      return {
        status: "failed",
        attempted: ids.length,
        updated,
        remaining,
        detail: (error instanceof Error
          ? error.message
          : "activity effort back-sync failed"
        ).slice(0, 500),
      };
    } finally {
      client.close();
    }
  }

  async function fetchAndStoreActivityHrZoneTime(
    client: GarminReader,
    garminId: string,
  ): Promise<boolean> {
    try {
      const normalized = await client.activityHrZoneTime(garminId);
      if (!normalized) return false;
      upsertActivityHrZoneTime(normalized);
      return true;
    } catch {
      // Garmin activity HR-zone totals are an additive dashboard source. Preserve
      // existing FIT detail behavior and any previous usable HR-zone rows when the
      // connector endpoint is unavailable or returns an unrecognized shape.
      return false;
    }
  }

  async function fetchAndStoreActivityDetail(
    client: GarminReader,
    garminId: string,
    options: DetailRefreshOptions = {},
  ): Promise<DetailedBackfillResult> {
    const previous = getDetailAvailability(garminId);
    recordActivityDetailAttempt({
      garminId,
      force: options.force,
      status: "running",
      retryable: false,
    });
    try {
      const fetched = await client.activityDetail(garminId);
      if (fetched.recognized) {
        const detail = fetched.detail;
        upsertActivityDetail(detail);
        const storedHrZoneTime = await fetchAndStoreActivityHrZoneTime(
          client,
          garminId,
        );
        const detailStatus =
          detail.status === "not_requested" ? "unsupported" : detail.status;
        recordActivityDetailAttempt({
          garminId,
          force: options.force,
          status: detailStatus === "unsupported" ? "unsupported" : "succeeded",
          detailStatus,
          retryable: false,
          preservedPrevious: false,
        });
        return {
          status: "completed",
          garminId,
          detailStatus,
          recordCount: detail.recordCount,
          lapCount: detail.lapCount,
          preservedPrevious: false,
          retryable: false,
          detail: `Detailed Garmin activity ${garminId} normalized locally from FIT parser. Records: ${detail.recordCount}; laps: ${detail.lapCount}; Garmin activity HR-zone totals ${storedHrZoneTime ? "stored" : "unavailable or preserved"}. Redacted raw connector payload was retained locally for generated analysis.`,
        };
      }
      const unsupported = fetched.detail;
      upsertActivityDetail(unsupported);
      recordActivityDetailAttempt({
        garminId,
        force: options.force,
        status: "unsupported",
        detailStatus: "unsupported",
        retryable: false,
        preservedPrevious: false,
      });
      return {
        status: "completed",
        garminId,
        detailStatus: "unsupported",
        recordCount: 0,
        lapCount: 0,
        preservedPrevious: false,
        retryable: false,
        detail: unsupported.unavailableReason ?? "Activity detail unsupported.",
      };
    } catch (error) {
      const classified = classifyDetailError(error);
      const preservedPrevious = Boolean(
        previous && ["available", "partial"].includes(previous.status),
      );
      if (!classified.retryable && !preservedPrevious) {
        upsertActivityDetail(
          normalizeUnsupportedActivityDetail(garminId, classified.message),
        );
      }
      recordActivityDetailAttempt({
        garminId,
        force: options.force,
        status: "failed",
        detailStatus: "failed",
        retryable: classified.retryable,
        errorClass: classified.errorClass,
        errorMessage: classified.message,
        preservedPrevious,
      });
      return {
        status: "failed",
        garminId,
        detailStatus: "failed",
        recordCount: previous?.recordCount ?? 0,
        lapCount: previous?.lapCount ?? 0,
        preservedPrevious,
        retryable: classified.retryable,
        detail: preservedPrevious
          ? `${classified.message}. Previous usable normalized detail was preserved.`
          : classified.message,
      };
    }
  }

  async function backfillActivityDetail(
    garminId: string,
    options: DetailRefreshOptions = {},
  ): Promise<DetailedBackfillResult> {
    const client = createReader();
    try {
      await client.start();
      return await fetchAndStoreActivityDetail(client, garminId, options);
    } finally {
      client.close();
    }
  }
  return {
    fetchAndStoreActivityEffort,
    fetchAndStoreActivityDetail,
    backfillActivityEffortFields,
    backfillActivityDetail,
  };
}
