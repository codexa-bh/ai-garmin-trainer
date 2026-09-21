import {
  activityDetailCoverage,
  dataCounts,
  getActivityByGarminId,
  getActivityDetailForAnalytics,
  getGarminAthleteBaseline,
  getGarminBodyMetrics,
  listActivityDetailAvailability,
  verifyActivityReference,
} from "@/lib/db/repository";
import {
  backfillActivityDetail,
  runGarminSync,
} from "@/lib/garmin/composition";
import { boundedText, sanitizedResultDetail } from "./tool-evidence";
import type { TrainerToolExecutionInput } from "./tool-execution-input";
import type { TrainerToolStep } from "./tool-types";

function summarizeSyncStatus(limit = 10) {
  const counts = dataCounts();
  const coverage = activityDetailCoverage();
  const healthCoverage = counts.healthCoverage ?? {
    totalRows: counts.healthDays,
    completeDays: 0,
    partialDays: 0,
    missingDays: 0,
    metrics: {
      sleepDays: 0,
      restingHeartRateDays: 0,
      hrvDays: 0,
      stressDays: 0,
      stepsDays: 0,
      calorieDays: 0,
      intensityDays: 0,
      bodyBatteryDays: 0,
    },
  };
  const athlete = getGarminAthleteBaseline();
  const bodyMetrics = getGarminBodyMetrics();
  const availability = listActivityDetailAvailability(limit).map((item) => ({
    garminId: item.garminId,
    status: item.status,
    recordCount: item.recordCount,
    lapCount: item.lapCount,
    hasStreams: item.hasStreams,
    hasGps: item.hasGps,
    hasHeartRate: item.hasHeartRate,
    hasElevation: item.hasElevation,
  }));
  return {
    counts: { ...counts, healthCoverage },
    coverage,
    athlete,
    bodyMetrics,
    availability,
  };
}

export async function executeLocalDataTool(
  input: Extract<
    TrainerToolExecutionInput,
    {
      toolName:
        | "runGarminSync"
        | "getSyncStatus"
        | "verifyActivityReference"
        | "forceRefreshActivityDetail"
        | "getActivityDetailAvailability"
        | "getActivityDetailSlice";
    }
  >,
): Promise<TrainerToolStep> {
  switch (input.toolName) {
    case "runGarminSync": {
      const result = sanitizedResultDetail(await runGarminSync());
      return {
        index: input.index,
        tool: input.toolName,
        status: result.status === "completed" ? "succeeded" : "failed",
        summary: boundedText(`${result.status}: ${result.detail}`),
        privacy:
          "Read-only Garmin MCP stdio connector and app-owned normalized SQLite writes only; no Garmin write-back.",
        reason: result.status === "completed" ? undefined : "sync_failed",
        result,
      };
    }
    case "getSyncStatus": {
      const args = input.input;
      const result = summarizeSyncStatus(args.availabilityLimit ?? 10);
      return {
        index: input.index,
        tool: input.toolName,
        status: "succeeded",
        summary: `Local Garmin status: ${result.counts.activities} stored activities, ${result.counts.healthCoverage.totalRows} health calendar rows (${result.counts.healthCoverage.completeDays} complete, ${result.counts.healthCoverage.partialDays} partial, ${result.counts.healthCoverage.missingDays} missing), detail coverage ${result.coverage.available} available, ${result.coverage.partial} partial, ${result.coverage.unsupported} unsupported, ${result.coverage.pending} pending, athlete baseline ${result.athlete.availability}.`,
        privacy: "Read from local normalized SQLite only.",
        result,
      };
    }
    case "verifyActivityReference": {
      const result = verifyActivityReference(input.input);
      return {
        index: input.index,
        tool: input.toolName,
        status: "succeeded",
        summary: `Outcome ${result.outcome}; checked ${result.importedCoverage.activityCount} imported activities.`,
        activityIds: result.matches.map((match) => match.garminId),
        privacy: result.privacy,
        result,
      };
    }
    case "forceRefreshActivityDetail": {
      const args = input.input;
      const activity = getActivityByGarminId(args.garminId);
      if (!activity) {
        return {
          index: input.index,
          tool: input.toolName,
          status: "rejected",
          summary: `No imported local activity with Garmin ID ${args.garminId}.`,
          activityIds: [args.garminId],
          privacy: "Unknown local IDs are rejected before connector access.",
          reason: "unknown_activity_id",
        };
      }
      const result = sanitizedResultDetail(
        await backfillActivityDetail(args.garminId, {
          force: true,
        }),
      );
      return {
        index: input.index,
        tool: input.toolName,
        status: result.status === "completed" ? "succeeded" : "failed",
        summary: `Forced local detail refresh for ${args.garminId}: ${result.status}, detail status ${result.detailStatus}, records ${result.recordCount}, laps ${result.lapCount}, retryable ${result.retryable ? "yes" : "no"}, preserved previous usable detail ${result.preservedPrevious ? "yes" : "no"}.`,
        activityIds: [args.garminId],
        privacy:
          "Server-side bounded action used a read-only Garmin connector call and retained only redacted local connector payloads for generated analysis.",
        reason:
          result.status === "completed" ? undefined : "detail_refresh_failed",
        result,
      };
    }
    case "getActivityDetailAvailability": {
      const args = input.input;
      const result = listActivityDetailAvailability(args.limit);
      return {
        index: input.index,
        tool: input.toolName,
        status: "succeeded",
        summary: `Returned ${result.length} bounded local detail availability rows.`,
        activityIds: result.map((row) => row.garminId),
        privacy:
          "Local SQLite availability metadata only; no Garmin credentials, raw FIT, or full stream data included.",
        result,
      };
    }
    case "getActivityDetailSlice": {
      const args = input.input;
      if (!getActivityByGarminId(args.garminId)) {
        return {
          index: input.index,
          tool: input.toolName,
          status: "rejected",
          summary: `No imported local activity with Garmin ID ${args.garminId}.`,
          activityIds: [args.garminId],
          privacy: "Unknown local IDs are rejected before detail access.",
          reason: "unknown_activity_id",
        };
      }
      const detail = getActivityDetailForAnalytics(args.garminId);
      const result = {
        tool: "getActivityDetailSlice",
        garminId: args.garminId,
        availability: detail.availability,
        laps: detail.laps.slice(0, 20),
        points: detail.stream.slice(
          args.pointOffset,
          args.pointOffset + args.pointLimit,
        ),
        totalPoints: detail.stream.length,
        nextPointOffset:
          args.pointOffset + args.pointLimit < detail.stream.length
            ? args.pointOffset + args.pointLimit
            : null,
      };
      return {
        index: input.index,
        tool: input.toolName,
        status: "succeeded",
        summary: `Returned ${result.points.length} normalized points and ${result.laps.length} bounded laps for ${args.garminId}.`,
        activityIds: [args.garminId],
        privacy:
          "Bounded normalized local stream slice; no credentials, raw FIT bytes, or unrestricted history included.",
        result,
      };
    }
  }
}
