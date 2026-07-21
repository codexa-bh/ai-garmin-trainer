import { tool } from "ai";
import { z } from "zod";
import {
  analyzeStoredActivity,
  rankActivities,
  type ActivityRankingEvidence,
} from "@/lib/analytics/activity";
import {
  activityDetailCoverage,
  dataCounts,
  getActivityByGarminId,
  getActivityDetailForAnalytics,
  getGarminAthleteBaseline,
  listActivityDetailAvailability,
  listRecentActivities,
  verifyActivityReference,
  type ActivityReferenceInput,
  type ActivityVerificationEvidence,
} from "@/lib/db/repository";
import { backfillActivityDetail, runGarminSync } from "@/lib/garmin/importer";

const garminIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/)
  .describe("Garmin activity ID already imported into the local SQLite store.");

const boundedNameSchema = z
  .string()
  .trim()
  .min(2)
  .max(100)
  .describe(
    "User-supplied activity name to verify against local imported history.",
  );

const isoDateSchema = z
  .string()
  .trim()
  .regex(/^20\d{2}-\d{2}-\d{2}$/)
  .describe("ISO calendar date YYYY-MM-DD from the user request.");

export const rankingMetricSchema = z.enum([
  "elevationGainMeters",
  "distanceMeters",
  "durationSec",
  "avgHeartRate",
]);

export type TrainerToolName =
  | "runGarminSync"
  | "getSyncStatus"
  | "rankActivities"
  | "verifyActivityReference"
  | "analyzeActivity"
  | "forceRefreshActivityDetail"
  | "getActivityDetailAvailability"
  | "getActivityDetailSlice";

const emptyInputSchema = z.object({}).strict();

const verifyActivityReferenceSchema = z
  .object({
    garminId: garminIdSchema.optional(),
    suppliedName: boundedNameSchema.optional(),
    date: isoDateSchema.optional(),
  })
  .strict()
  .refine(
    (value) => Boolean(value.garminId || value.suppliedName || value.date),
    {
      message: "At least one activity reference field is required.",
    },
  );

const latestSelectorSchema = z
  .object({
    latest: z.literal(true),
    sport: z.string().trim().min(2).max(40).optional(),
  })
  .strict();

const idSelectorSchema = z.object({ garminId: garminIdSchema }).strict();

export const trainerToolInputSchemas = {
  runGarminSync: emptyInputSchema,
  getSyncStatus: z
    .object({ availabilityLimit: z.number().int().min(1).max(25).optional() })
    .strict(),
  rankActivities: z
    .object({
      metrics: z.array(rankingMetricSchema).min(1).max(4),
      windowDays: z.number().int().min(1).max(3650).optional(),
      limit: z.number().int().min(1).max(5).optional(),
    })
    .strict(),
  verifyActivityReference: verifyActivityReferenceSchema,
  analyzeActivity: z
    .object({
      selectors: z
        .array(z.union([idSelectorSchema, latestSelectorSchema]))
        .min(1)
        .max(4),
    })
    .strict(),
  forceRefreshActivityDetail: z.object({ garminId: garminIdSchema }).strict(),
  getActivityDetailAvailability: z
    .object({ limit: z.number().int().min(1).max(25).default(10) })
    .strict(),
  getActivityDetailSlice: z
    .object({
      garminId: garminIdSchema,
      pointOffset: z.number().int().min(0).default(0),
      pointLimit: z.number().int().min(1).max(120).default(60),
    })
    .strict(),
} satisfies Record<TrainerToolName, z.ZodTypeAny>;

export const trainerToolDefinitions = {
  runGarminSync: tool({
    description:
      "Run a bounded local Garmin import/sync when the current user explicitly asks to sync/import/refresh Garmin data. Use at most once per turn. It writes only app-owned normalized SQLite rows and never writes back to Garmin.",
    inputSchema: trainerToolInputSchemas.runGarminSync,
  }),
  getSyncStatus: tool({
    description:
      "Report local import/sync/detail coverage and athlete-baseline availability. Use for status, what is synced/imported, and detail coverage questions.",
    inputSchema: trainerToolInputSchemas.getSyncStatus,
  }),
  rankActivities: tool({
    description:
      "Rank imported activities by explicit typed metrics. Use for top/most/highest/longest/hardest/demanding/ranking/comparison requests. Choose metrics from elevationGainMeters, distanceMeters, durationSec, avgHeartRate; use windowDays for phrases like last 365 days.",
    inputSchema: trainerToolInputSchemas.rankActivities,
  }),
  verifyActivityReference: tool({
    description:
      "Verify a current user-supplied Garmin ID, name, or date against the complete local imported history. Use for corrections, named lookups, disputed/fabricated activities, ambiguous references, and before analysis when only a name/date is supplied. Prior assistant prose is not evidence.",
    inputSchema: trainerToolInputSchemas.verifyActivityReference,
  }),
  analyzeActivity: tool({
    description:
      "Compute deterministic local analytics for one to four known imported activities. Use explicit garminId selectors, or latest:true only when the user clearly asks for latest/most recent activity. Names/dates must be verified first.",
    inputSchema: trainerToolInputSchemas.analyzeActivity,
  }),
  forceRefreshActivityDetail: tool({
    description:
      "Force one bounded local detail backfill for a known imported Garmin ID when the user explicitly requests refresh/backfill/fetch detail for that ID. Use at most once per turn.",
    inputSchema: trainerToolInputSchemas.forceRefreshActivityDetail,
  }),
  getActivityDetailAvailability: tool({
    description:
      "Return bounded local activity detail availability metadata. Use before claiming stream/FIT availability or when asked what detailed data exists.",
    inputSchema: trainerToolInputSchemas.getActivityDetailAvailability,
  }),
  getActivityDetailSlice: tool({
    description:
      "Return a bounded normalized local detail slice for a known imported Garmin ID. Never request raw FIT, full streams, credentials, URLs, paths, or connector methods.",
    inputSchema: trainerToolInputSchemas.getActivityDetailSlice,
  }),
} satisfies Record<TrainerToolName, unknown>;

export const trainerTools = trainerToolDefinitions;

export type TrainerToolStep = {
  index: 1 | 2;
  tool: TrainerToolName;
  status: "succeeded" | "rejected" | "failed";
  summary: string;
  activityIds?: string[];
  privacy: string;
  reason?: string;
  result?: unknown;
};

export type TrainerToolCall = {
  toolName: string;
  input: unknown;
};

function boundedText(value: string, max = 500): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > max ? `${compact.slice(0, max - 1)}…` : compact;
}

function summarizeSyncStatus(limit = 10) {
  const counts = dataCounts();
  const coverage = activityDetailCoverage();
  const athlete = getGarminAthleteBaseline();
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
  return { counts, coverage, athlete, availability };
}

function latestActivityId(sport?: string): string | null {
  const activities = listRecentActivities(25);
  const match = sport
    ? activities.find(
        (activity) => activity.sport.toLowerCase() === sport.toLowerCase(),
      )
    : activities[0];
  return match?.garminId ?? null;
}

export function validateTrainerToolCall(
  call: TrainerToolCall,
):
  | { ok: true; toolName: TrainerToolName; input: unknown }
  | { ok: false; reason: string } {
  if (
    !Object.prototype.hasOwnProperty.call(
      trainerToolInputSchemas,
      call.toolName,
    )
  ) {
    return { ok: false, reason: "unknown_tool" };
  }
  const toolName = call.toolName as TrainerToolName;
  const parsed = trainerToolInputSchemas[toolName].safeParse(call.input ?? {});
  if (!parsed.success) return { ok: false, reason: "malformed_input" };
  return { ok: true, toolName, input: parsed.data };
}

export async function executeTrainerTool(input: {
  index: 1 | 2;
  toolName: TrainerToolName;
  args: unknown;
}): Promise<TrainerToolStep> {
  try {
    switch (input.toolName) {
      case "runGarminSync": {
        const result = await runGarminSync();
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
        const args = input.args as { availabilityLimit?: number };
        const result = summarizeSyncStatus(args.availabilityLimit ?? 10);
        return {
          index: input.index,
          tool: input.toolName,
          status: "succeeded",
          summary: `Local Garmin status: ${result.counts.activities} activities, ${result.counts.healthDays} health days, detail coverage ${result.coverage.terminal}/${result.coverage.total} terminal, athlete baseline ${result.athlete.availability}.`,
          privacy: "Read from local normalized SQLite only.",
          result,
        };
      }
      case "rankActivities": {
        const args = input.args as Parameters<typeof rankActivities>[0];
        const result = rankActivities(args);
        return {
          index: input.index,
          tool: input.toolName,
          status: "succeeded",
          summary: `Deterministic ranking metrics: ${result.metrics.join(", ")}; ${Object.values(result.rankings).reduce((count, rows) => count + rows.length, 0)} rows${result.window ? `; window ${result.window.label}` : ""}.`,
          activityIds: Object.values(result.rankings)
            .flat()
            .map((row) => row.garminId)
            .slice(0, 10),
          privacy: result.privacy,
          result,
        };
      }
      case "verifyActivityReference": {
        const result = verifyActivityReference(
          input.args as ActivityReferenceInput,
        );
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
      case "analyzeActivity": {
        const args = input.args as {
          selectors: Array<{
            garminId?: string;
            latest?: true;
            sport?: string;
          }>;
        };
        const ids: string[] = [];
        for (const selector of args.selectors) {
          const garminId =
            selector.garminId ?? latestActivityId(selector.sport);
          if (!garminId) {
            return {
              index: input.index,
              tool: input.toolName,
              status: "rejected",
              summary:
                "No imported local activity matched the requested selector.",
              privacy: "No provider-selected fallback activity was used.",
              reason: "activity_not_found",
            };
          }
          if (!getActivityByGarminId(garminId)) {
            return {
              index: input.index,
              tool: input.toolName,
              status: "rejected",
              summary: `No imported local activity with Garmin ID ${garminId}.`,
              activityIds: [garminId],
              privacy: "Unknown local IDs are rejected before analytics.",
              reason: "unknown_activity_id",
            };
          }
          ids.push(garminId);
        }
        const analyses = [...new Set(ids)]
          .slice(0, 4)
          .map((id) => analyzeStoredActivity(id));
        return {
          index: input.index,
          tool: input.toolName,
          status: "succeeded",
          summary: analyses
            .map(
              (analysis) =>
                `${analysis.activity?.garminId ?? "unknown"}: detail ${analysis.availability?.status ?? "not_requested"}, records ${analysis.streamSummary.records}`,
            )
            .join("; "),
          activityIds: analyses
            .map((analysis) => analysis.activity?.garminId)
            .filter((id): id is string => Boolean(id)),
          privacy:
            analyses[0]?.privacy ??
            "Computed from local normalized SQLite only.",
          result: analyses,
        };
      }
      case "forceRefreshActivityDetail": {
        const args = input.args as { garminId: string };
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
        const result = await backfillActivityDetail(args.garminId, {
          force: true,
        });
        return {
          index: input.index,
          tool: input.toolName,
          status: result.status === "completed" ? "succeeded" : "failed",
          summary: `Forced local detail refresh for ${args.garminId}: ${result.status}, detail status ${result.detailStatus}, records ${result.recordCount}, laps ${result.lapCount}, retryable ${result.retryable ? "yes" : "no"}, preserved previous usable detail ${result.preservedPrevious ? "yes" : "no"}.`,
          activityIds: [args.garminId],
          privacy:
            "Server-side bounded action used a read-only Garmin connector call and discarded raw connector payloads.",
          reason:
            result.status === "completed" ? undefined : "detail_refresh_failed",
          result,
        };
      }
      case "getActivityDetailAvailability": {
        const args = input.args as { limit: number };
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
        const args = input.args as {
          garminId: string;
          pointOffset: number;
          pointLimit: number;
        };
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
  } catch {
    return {
      index: input.index,
      tool: input.toolName,
      status: "failed",
      summary: `${input.toolName} failed before returning bounded evidence.`,
      privacy:
        "No raw provider, connector, credential, or stream details are exposed in this failure.",
      reason: "tool_exception",
    };
  }
}

export function renderToolSteps(steps: TrainerToolStep[]): string {
  if (!steps.length)
    return "I could not execute a trusted Garmin tool for that request.";
  const lines: string[] = [];
  for (const step of steps) {
    lines.push(
      `Tool step ${step.index}: ${step.tool} (${step.status}). ${step.summary}`,
    );
    if (step.status !== "succeeded" && step.reason)
      lines.push(`Reason: ${step.reason}.`);
    if (step.tool === "rankActivities" && step.result) {
      const evidence = step.result as ActivityRankingEvidence;
      if (evidence.window) {
        lines.push(
          `Window: ${evidence.window.label}; included activities started on or after ${evidence.window.startedAfter.slice(0, 10)}.`,
        );
      }
      for (const metric of evidence.metrics) {
        const rows = evidence.rankings[metric];
        if (!rows.length) continue;
        lines.push(
          `${metric}: ${rows.map((row, index) => `${index + 1}. ${row.label} (${row.date}, Garmin ID ${row.garminId}, ${row.value}${row.unit}, ${row.labelSource} label)`).join("; ")}`,
        );
      }
      if (evidence.limitations.length) lines.push(...evidence.limitations);
    }
    if (step.tool === "verifyActivityReference" && step.result) {
      const evidence = step.result as ActivityVerificationEvidence;
      lines.push(
        `Imported coverage checked: ${evidence.importedCoverage.activityCount} activities from ${evidence.importedCoverage.earliestDate ?? "n/a"} through ${evidence.importedCoverage.latestDate ?? "n/a"}.`,
      );
      if (evidence.outcome === "not_found") {
        lines.push(
          "No matching normalized local activity was found in the complete imported corpus. That means it is not present in local imported data; it is not a claim about Garmin outside this app.",
        );
      } else if (evidence.outcome === "ambiguous") {
        lines.push(
          `The reference is ambiguous in local imported data: ${evidence.matches.map((match) => `${match.date} ${match.label} (Garmin ID ${match.garminId})`).join("; ")}`,
        );
      } else {
        const match = evidence.matches[0];
        lines.push(
          `Found one local match: ${match.date} ${match.label} (Garmin ID ${match.garminId}, ${match.labelSource} label; sport ${match.sport}, distance ${match.distanceMeters ?? "n/a"} m, duration ${match.durationSec ?? "n/a"} s, elevation gain ${match.elevationGainMeters ?? "n/a"} m, avg HR ${match.avgHeartRate ?? "n/a"} bpm).`,
        );
      }
    }
    if (step.tool === "analyzeActivity" && Array.isArray(step.result)) {
      for (const analysis of step.result as ReturnType<
        typeof analyzeStoredActivity
      >[]) {
        const activity = analysis.activity;
        lines.push(
          activity
            ? `Activity: ${activity.name} on ${activity.date}, Garmin ID ${activity.garminId}, ${activity.distanceKm ?? "n/a"} km in ${activity.durationMin ?? "n/a"} min, avg HR ${activity.avgHeartRate ?? "n/a"} bpm; detail ${analysis.availability?.status ?? "not_requested"}, ${analysis.streamSummary.records} normalized records.`
            : "I could not find that imported activity in local SQLite.",
        );
      }
    }
    lines.push(`Privacy: ${step.privacy}`);
  }
  return lines.join("\n");
}

export function groundingForSteps(steps: TrainerToolStep[]) {
  const finalStep =
    [...steps].reverse().find((step) => step.status === "succeeded") ??
    steps.at(-1);
  if (!finalStep) return null;
  return {
    tool: finalStep.tool,
    activityId: finalStep.activityIds?.[0],
    privacy: finalStep.privacy,
    summary: finalStep.summary.slice(0, 500),
    toolSteps: steps.map((step) => ({
      index: step.index,
      tool: step.tool,
      status: step.status,
      summary: step.summary.slice(0, 500),
      activityIds: step.activityIds?.slice(0, 10),
      privacy: step.privacy,
      reason: step.reason,
    })),
  };
}
