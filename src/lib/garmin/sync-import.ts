import type { GarminImportPorts } from "./import-ports";
import type { GarminSyncResult, ProgressReporter } from "./import-contracts";
import { isoDate, dailyHealthImportPlan } from "./import-policy";
import { createBaselineImports } from "./baseline-import";
import { createDetailImports } from "./detail-import";

export function createGarminImports({
  store,
  createReader,
  historyStartDate,
  clock,
}: GarminImportPorts) {
  const {
    recordSyncRun,
    getGarminAthleteBaseline,
    getGarminBodyMetrics,
    getCheckpoint,
    upsertActivities,
    saveCheckpoint,
    listActivityIdsNeedingEffortBackfill,
    listRecentActivities,
    listDailyHealthMissingGapDates,
    listDailyHealthRepairCandidateDates,
    listDailyHealthIntensityRepairCandidateDates,
    listDailyHealthTrailingCandidateDates,
    upsertDailyHealth,
    listActivityIdsNeedingDetail,
    finishSyncRun,
    dataCounts,
  } = store;
  const { fetchAndStoreAthleteBaseline, fetchAndStoreBodyMetrics } =
    createBaselineImports(store, clock);
  const {
    fetchAndStoreActivityEffort,
    fetchAndStoreActivityDetail,
    backfillActivityDetail,
    backfillActivityEffortFields,
  } = createDetailImports(store, createReader);
  async function runGarminSync(
    onProgress: ProgressReporter = () => undefined,
  ): Promise<GarminSyncResult> {
    const startDate = historyStartDate();
    const endDate = isoDate(clock());
    const syncRunId = recordSyncRun("running", {
      coverageStart: startDate,
      coverageEnd: endDate,
    });
    const client = createReader();
    let activitiesImported = 0;
    let healthDaysImported = 0;
    let detailsProcessed = 0;
    let effortDetailsProcessed = 0;
    let athleteBaseline = getGarminAthleteBaseline();
    let bodyMetrics = getGarminBodyMetrics();

    try {
      onProgress({
        stage: "starting",
        message: "Starting pinned Garmin MCP stdio connector…",
        activitiesImported,
        healthDaysImported,
      });
      await client.start();
      onProgress({
        stage: "athlete",
        message:
          "Refreshing Garmin athlete baselines from approved read-only profile tools…",
        activitiesImported,
        healthDaysImported,
        athleteAvailability: athleteBaseline.availability,
      });
      athleteBaseline = await fetchAndStoreAthleteBaseline(client);
      onProgress({
        stage: "athlete",
        message: `Garmin athlete baseline refresh ${athleteBaseline.availability}; checking recent FIT zones target for configured max HR after activity import.`,
        activitiesImported,
        healthDaysImported,
        athleteAvailability: athleteBaseline.availability,
      });
      onProgress({
        stage: "body_metrics",
        message:
          "Refreshing Garmin body metrics from approved read-only profile/body-composition/weigh-in tools…",
        activitiesImported,
        healthDaysImported,
        bodyMetricsAvailability: bodyMetrics.availability,
      });
      bodyMetrics = await fetchAndStoreBodyMetrics(client, startDate, endDate);
      onProgress({
        stage: "body_metrics",
        message: `Garmin body metrics refresh ${bodyMetrics.availability}; current weight ${bodyMetrics.values.weightKg !== null ? `available (source ${bodyMetrics.currentWeightSource ?? "unknown"})` : "unavailable"}; height ${bodyMetrics.values.heightCm !== null ? "available" : "unavailable"}; weight history ${bodyMetrics.history.availability}${bodyMetrics.history.source ? ` (source ${bodyMetrics.history.source})` : ""}; weigh-ins ${bodyMetrics.weighInAvailability ?? "not attempted"}.`,
        activitiesImported,
        healthDaysImported,
        bodyMetricsAvailability: bodyMetrics.availability,
      });

      let page = Number(getCheckpoint("activity_page") ?? 0);
      while (true) {
        onProgress({
          stage: "activities",
          message: `Fetching Garmin activities page ${page}…`,
          activitiesImported,
          healthDaysImported,
          page,
        });
        const parsed = await client.activityPage(startDate, endDate, page);
        activitiesImported += upsertActivities(parsed.activities);
        saveCheckpoint("activity_page", String(page));
        onProgress({
          stage: "activities",
          message: `Imported ${activitiesImported} activities through page ${page}.`,
          activitiesImported,
          healthDaysImported,
          page,
        });
        if (!parsed.hasMore) break;
        page = parsed.nextPage ?? page + 1;
      }

      const effortBackfillIds = listActivityIdsNeedingEffortBackfill(50);
      for (const [index, garminId] of effortBackfillIds.entries()) {
        onProgress({
          stage: "activities",
          message: `Refreshing Garmin activity effort fields ${index + 1}/${effortBackfillIds.length} from read-only activity detail…`,
          activitiesImported,
          healthDaysImported,
          page,
        });
        if (await fetchAndStoreActivityEffort(client, garminId)) {
          effortDetailsProcessed += 1;
        }
      }

      const fitBaselinePayload = await client.fitBaseline(
        listRecentActivities(6).map((activity) => activity.garminId),
      );
      if (fitBaselinePayload) {
        athleteBaseline = await fetchAndStoreAthleteBaseline(
          client,
          fitBaselinePayload,
        );
        onProgress({
          stage: "athlete",
          message: `Garmin athlete baseline refresh ${athleteBaseline.availability}; configured max HR ${athleteBaseline.values.configuredMaxHeartRateBpm ? "recovered from FIT zones target" : "unavailable"}; HR zones ${athleteBaseline.values.heartRateZones.status}.`,
          activitiesImported,
          healthDaysImported,
          athleteAvailability: athleteBaseline.availability,
        });
      }

      const resumeDate = getCheckpoint("health_next_date") ?? startDate;
      const missingGapDates = listDailyHealthMissingGapDates({
        startDate,
        endDate,
      });
      const missingRepairDates = listDailyHealthRepairCandidateDates({
        startDate,
        endDate,
      });
      const intensityRepairDates = listDailyHealthIntensityRepairCandidateDates(
        {
          startDate,
          endDate,
        },
      );
      const trailingDates = listDailyHealthTrailingCandidateDates({
        startDate,
        endDate,
      });
      const repairDates = Array.from(
        new Set([
          ...missingGapDates,
          ...missingRepairDates,
          ...intensityRepairDates,
        ]),
      );
      const healthPlan = dailyHealthImportPlan({
        historyStartDate: startDate,
        resumeDate,
        endDate,
        repairDates,
        trailingDates,
      });
      const checkpointDates = new Set(healthPlan.checkpointDates);
      for (const [index, date] of healthPlan.dates.entries()) {
        onProgress({
          stage: "health",
          message: `Refreshing daily health ${index + 1}/${healthPlan.dates.length}: ${date}…`,
          activitiesImported,
          healthDaysImported,
          date,
          totalHealthDays: healthPlan.dates.length,
          completedHealthDays: index,
        });
        const health = await client.dailyHealth(date);
        healthDaysImported += upsertDailyHealth([health]);
        if (checkpointDates.has(date)) {
          const next = new Date(`${date}T00:00:00Z`);
          next.setUTCDate(next.getUTCDate() + 1);
          saveCheckpoint("health_next_date", isoDate(next));
        }
        onProgress({
          stage: "health",
          message: `Imported daily health ${index + 1}/${healthPlan.dates.length}: ${date}.`,
          activitiesImported,
          healthDaysImported,
          date,
          totalHealthDays: healthPlan.dates.length,
          completedHealthDays: index + 1,
        });
      }

      const detailIds = listActivityIdsNeedingDetail();
      for (const [index, garminId] of detailIds.entries()) {
        onProgress({
          stage: "detail",
          message: `Refreshing missing activity detail ${index + 1}/${detailIds.length}: ${garminId}…`,
          activitiesImported,
          healthDaysImported,
          detailsProcessed,
          detailTotal: detailIds.length,
        });
        await fetchAndStoreActivityDetail(client, garminId, { force: false });
        detailsProcessed += 1;
        saveCheckpoint("activity_detail_last_id", garminId);
      }

      saveCheckpoint("activity_page", "0");
      finishSyncRun(syncRunId, "completed");
      const totals = dataCounts();
      const result = {
        status: "completed" as const,
        activitiesImported,
        healthDaysImported,
        activitiesProcessed: activitiesImported,
        healthDaysRefreshed: healthDaysImported,
        detailsProcessed,
        effortDetailsProcessed,
        storedActivities: totals.activities,
        storedHealthRows: totals.healthCoverage.totalRows,
        coverageStart: startDate,
        coverageEnd: endDate,
        healthCoverage: totals.healthCoverage,
        detailCoverage: totals.detailCoverage,
        athleteBaseline,
        bodyMetrics,
        detail: `Sync complete via pinned read-only Garmin MCP stdio. Processed ${activitiesImported} activity records; refreshed ${healthDaysImported} health dates including ${missingGapDates.length} missing-date gaps, ${missingRepairDates.length} missing-row repair candidates, ${intensityRepairDates.length} daily intensity coverage repair candidates, and ${trailingDates.length} mutable trailing daily-health candidates; refreshed ${detailsProcessed} activity detail records. Stored totals: ${totals.activities} activities; health ${totals.healthCoverage.completeDays} complete, ${totals.healthCoverage.partialDays} partial, ${totals.healthCoverage.missingDays} missing of ${totals.healthCoverage.totalRows}; daily intensity coverage ${totals.healthCoverage.metrics.intensityDays}/${totals.healthCoverage.totalRows}; detail ${totals.detailCoverage.available} available, ${totals.detailCoverage.partial} partial, ${totals.detailCoverage.unsupported} unsupported, ${totals.detailCoverage.pending} pending. Athlete baseline ${athleteBaseline.availability}; body metrics ${bodyMetrics.availability}.`,
      };
      onProgress({
        stage: "completed",
        message: result.detail,
        activitiesImported,
        healthDaysImported,
        detailsProcessed,
        detailTotal: detailIds.length,
        athleteAvailability: athleteBaseline.availability,
        bodyMetricsAvailability: bodyMetrics.availability,
      });
      return result;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Garmin sync failed";
      finishSyncRun(syncRunId, "failed", message.slice(0, 1000));
      const totals = dataCounts();
      onProgress({
        stage: "failed",
        message: message.slice(0, 1000),
        activitiesImported,
        healthDaysImported,
      });
      return {
        status: "failed",
        activitiesImported,
        healthDaysImported,
        activitiesProcessed: activitiesImported,
        healthDaysRefreshed: healthDaysImported,
        detailsProcessed,
        effortDetailsProcessed,
        storedActivities: totals.activities,
        storedHealthRows: totals.healthCoverage.totalRows,
        coverageStart: startDate,
        coverageEnd: endDate,
        healthCoverage: totals.healthCoverage,
        detailCoverage: totals.detailCoverage,
        athleteBaseline,
        bodyMetrics,
        detail: message.slice(0, 1000),
      };
    } finally {
      client.close();
    }
  }

  return {
    runGarminSync,
    backfillActivityDetail,
    backfillActivityEffortFields,
  };
}
