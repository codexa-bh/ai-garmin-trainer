import { tool } from "ai";
import { z } from "zod";
import {
  activityDetailCoverage,
  dataCounts,
  getActivityByGarminId,
  getActivityDetailForAnalytics,
  getGarminAthleteBaseline,
  listActivityDetailAvailability,
  verifyActivityReference,
  type ActivityReferenceInput,
  type ActivityVerificationEvidence,
} from "@/lib/db/repository";
import { backfillActivityDetail, runGarminSync } from "@/lib/garmin/importer";
import {
  runGeneratedGarminAnalysis,
  type GeneratedAnalysisEvidence,
} from "@/lib/ai/generated-analysis";
import {
  describeGarminDatabase,
  runReadOnlySql,
  type AnalysisResult,
  type AnalysisRow,
  type GarminDatabaseDescription,
} from "@/lib/ai/sql-analysis";
import {
  runMathAnalysis,
  type MathAnalysisResult,
} from "@/lib/ai/math-analysis";

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

export type TrainerToolName =
  | "runGarminSync"
  | "getSyncStatus"
  | "verifyActivityReference"
  | "forceRefreshActivityDetail"
  | "getActivityDetailAvailability"
  | "getActivityDetailSlice"
  | "describeGarminDatabase"
  | "runReadOnlySql"
  | "runMathAnalysis"
  | "runGeneratedGarminAnalysis";

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

const generatedAnalysisSelectionTermSchema = z
  .string()
  .trim()
  .min(2)
  .max(40)
  .regex(/^[\p{L}\p{N}][\p{L}\p{N}\s_-]*$/u);

const generatedAnalysisActivitySelectionSchema = z
  .object({
    includeText: z
      .array(generatedAnalysisSelectionTermSchema)
      .min(1)
      .max(8)
      .optional(),
    excludeText: z
      .array(generatedAnalysisSelectionTermSchema)
      .min(1)
      .max(8)
      .optional(),
  })
  .strict()
  .refine(
    (value) => Boolean(value.includeText?.length || value.excludeText?.length),
    { message: "At least one include or exclude selection term is required." },
  );

const generatedAnalysisDatasetSchema = z.enum([
  "activities",
  "dailyHealth",
  "activityDetails",
  "rawPayloads",
]);

const sqlResultNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .regex(/^[A-Za-z][A-Za-z0-9_-]*$/)
  .optional();

const mathFieldSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[A-Za-z_][A-Za-z0-9_]*$/);

const mathOperationSchema = z.enum([
  "score",
  "normalize",
  "sportNormalizedDemand",
  "aggregate",
  "correlate",
  "summarize",
  "customFormula",
]);

export const trainerToolInputSchemas = {
  runGarminSync: emptyInputSchema,
  getSyncStatus: z
    .object({ availabilityLimit: z.number().int().min(1).max(25).optional() })
    .strict(),
  verifyActivityReference: verifyActivityReferenceSchema,
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
  describeGarminDatabase: emptyInputSchema,
  runReadOnlySql: z
    .object({
      sql: z.string().trim().min(8).max(6000),
      purpose: z.string().trim().min(2).max(300).optional(),
      maxRows: z.number().int().min(1).max(200).default(50),
      resultName: sqlResultNameSchema,
    })
    .strict(),
  runMathAnalysis: z
    .object({
      inputResult: z.string().trim().min(1).max(40),
      operation: mathOperationSchema,
      formula: z
        .string()
        .trim()
        .min(1)
        .max(800)
        .regex(/^[A-Za-z0-9_\s+\-*/()]+$/)
        .optional(),
      groupBy: z.array(mathFieldSchema).min(1).max(4).optional(),
      orderBy: z
        .array(
          z
            .object({
              field: mathFieldSchema,
              direction: z.enum(["asc", "desc"]),
            })
            .strict(),
        )
        .min(1)
        .max(4)
        .optional(),
      limit: z.number().int().min(1).max(100).default(10),
      outputName: sqlResultNameSchema,
    })
    .strict(),
  runGeneratedGarminAnalysis: z
    .object({
      request: z.string().trim().min(5).max(500),
      datasets: z
        .array(generatedAnalysisDatasetSchema)
        .min(1)
        .max(4)
        .optional(),
      requestedCount: z.number().int().min(1).max(25).default(10),
      activitySelection: generatedAnalysisActivitySelectionSchema.optional(),
      script: z.string().trim().min(20).max(12000),
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
  verifyActivityReference: tool({
    description:
      "Verify a current user-supplied Garmin ID, name, or date against the complete local imported history. Use for corrections, named lookups, disputed/fabricated activities, ambiguous references, and before analysis when only a name/date is supplied. Prior assistant prose is not evidence.",
    inputSchema: trainerToolInputSchemas.verifyActivityReference,
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
  describeGarminDatabase: tool({
    description:
      "Describe the compact analytical SQLite schema available for local Garmin analysis: allowed normalized tables/views, columns, units, date coverage, safe joins, examples, and forbidden private/secret/auth/path surfaces. Does not dump private rows.",
    inputSchema: trainerToolInputSchemas.describeGarminDatabase,
  }),
  runReadOnlySql: tool({
    description:
      "Run one bounded read-only SELECT/WITH SQLite query over allowlisted normalized Garmin analytical tables. Use for ad hoc rankings, counts, summaries, windows, safe joins, and exploratory local trainer analytics after schema inspection. Writes, PRAGMAs, comments, multi-statements, disallowed tables, raw payloads, auth/session/account data, paths, and secrets are rejected. Returns capped rows plus a same-turn result handle for math.",
    inputSchema: trainerToolInputSchemas.runReadOnlySql,
  }),
  runMathAnalysis: tool({
    description:
      "Run bounded TypeScript math over a prior same-turn runReadOnlySql result handle. Supports scoring/custom formulas over numeric columns, sportNormalizedDemand for generic most-demanding activity rankings with within-sport percentiles and sparse-data limitations, normalization/ranking, simple aggregation/grouping, summaries, ordering, and top-N output. No scripts, DB/filesystem/network/process/environment/connector access.",
    inputSchema: trainerToolInputSchemas.runMathAnalysis,
  }),
  runGeneratedGarminAnalysis: tool({
    description:
      "Deprecated internal fallback only: server-sandboxed Python over bounded Garmin datasets. Do not choose for ordinary ad hoc analytics; use describeGarminDatabase, runReadOnlySql, and runMathAnalysis instead. This tool is disabled unless ENABLE_GENERATED_GARMIN_ANALYSIS=true.",
    inputSchema: trainerToolInputSchemas.runGeneratedGarminAnalysis,
  }),
} satisfies Record<TrainerToolName, unknown>;

export const trainerTools = trainerToolDefinitions;

export type TrainerToolStep = {
  index: 1 | 2 | 3 | 4;
  tool: TrainerToolName;
  status: "succeeded" | "rejected" | "failed";
  summary: string;
  activityIds?: string[];
  privacy: string;
  reason?: string;
  correctionAllowed?: boolean;
  failureMessage?: string;
  correctionHint?: string;
  result?: unknown;
};

export type TrainerToolCall = {
  toolName: string;
  input: unknown;
};

const sameTurnSqlResults = new Map<string, AnalysisRow[]>();

export function clearTrainerAnalysisResultHandles(): void {
  sameTurnSqlResults.clear();
}

function boundedText(value: string, max = 500): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > max ? `${compact.slice(0, max - 1)}…` : compact;
}

const GENERATED_ACTIVITY_FIELDS = [
  "garminId",
  "label",
  "sport",
  "date",
  "startedAt",
  "durationSec",
  "distanceMeters",
  "calories",
  "avgHeartRate",
  "maxHeartRate",
  "steps",
  "elevationGainMeters",
  "elevationLossMeters",
  "trainingEffect",
];

function generatedAnalysisCorrectionContext(
  evidence: GeneratedAnalysisEvidence,
): string {
  const datasets = evidence.manifest.datasets
    .map((dataset) => `${dataset.name}:${dataset.rowCount}`)
    .join(", ");
  const allowedImports =
    evidence.manifest.scriptContract.allowedImports.join(", ");
  return `Correction context: selected datasets ${datasets || "none"}; allowed imports ${allowedImports}; common activities fields ${GENERATED_ACTIVITY_FIELDS.join(", ")}; RESULT must be JSON with nonempty kind, optional title/summary/metrics, optional rows no larger than requestedCount ${evidence.requestedCount}, and limitations; max output bytes ${evidence.manifest.limits.maxOutputBytes}.`;
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
  index: 1 | 2 | 3 | 4;
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
            "Server-side bounded action used a read-only Garmin connector call and retained only redacted local connector payloads for generated analysis.",
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
      case "describeGarminDatabase": {
        const result = describeGarminDatabase();
        return {
          index: input.index,
          tool: input.toolName,
          status: "succeeded",
          summary: `Described ${result.tables.length} allowlisted analytical tables; forbidden auth/session/account/verification/secrets/path surfaces excluded.`,
          privacy: result.privacy,
          result,
        };
      }
      case "runReadOnlySql": {
        const result = runReadOnlySql(
          input.args as Parameters<typeof runReadOnlySql>[0],
        );
        if (result.status === "succeeded")
          sameTurnSqlResults.set(result.resultName, result.rows);
        return {
          index: input.index,
          tool: input.toolName,
          status: result.status,
          summary:
            result.status === "succeeded"
              ? `Read-only SQL ${result.resultName}; returned ${result.returnedRows}/${result.rowCount} rows${result.truncated ? "; truncated" : ""}.`
              : `Read-only SQL rejected: ${result.reason ?? result.status}.`,
          privacy: result.privacy,
          reason: result.status === "succeeded" ? undefined : result.reason,
          correctionAllowed:
            result.status === "succeeded"
              ? undefined
              : result.correctionAllowed,
          correctionHint:
            result.status === "succeeded" ? undefined : result.correctionHint,
          failureMessage:
            result.status === "succeeded" ? undefined : result.message,
          result,
        };
      }
      case "runMathAnalysis": {
        const args = input.args as Omit<
          Parameters<typeof runMathAnalysis>[0],
          "rowsByResult"
        >;
        const result = runMathAnalysis({
          ...args,
          rowsByResult: sameTurnSqlResults,
        });
        if (result.status === "succeeded")
          sameTurnSqlResults.set(result.resultName, result.rows);
        return {
          index: input.index,
          tool: input.toolName,
          status: result.status,
          summary:
            result.status === "succeeded"
              ? `Math ${result.operation} ${result.resultName}; returned ${result.returnedRows}/${result.rowCount} rows${result.truncated ? "; truncated" : ""}.`
              : `Math analysis rejected: ${result.reason ?? result.status}.`,
          privacy: result.privacy,
          reason: result.status === "succeeded" ? undefined : result.reason,
          failureMessage:
            result.status === "succeeded" ? undefined : result.message,
          result,
        };
      }
      case "runGeneratedGarminAnalysis": {
        if (process.env.ENABLE_GENERATED_GARMIN_ANALYSIS !== "true") {
          return {
            index: input.index,
            tool: input.toolName,
            status: "rejected",
            summary:
              "Generated Garmin Python analysis is disabled by default; use read-only SQL and bounded math tools.",
            privacy:
              "No generated Python ran; local analytics should use guarded SQL/math over normalized SQLite data.",
            reason: "generated_analysis_disabled",
          };
        }
        const result = await runGeneratedGarminAnalysis(
          input.args as Parameters<typeof runGeneratedGarminAnalysis>[0],
        );
        return {
          index: input.index,
          tool: input.toolName,
          status: result.status,
          summary:
            result.status === "succeeded"
              ? `Generated Garmin dataset script ${result.result?.kind ?? "result"}; ${result.result?.returnedCount ?? 0}/${result.requestedCount} rows; script ${result.scriptHash.slice(0, 12)}; datasets ${result.manifest.datasets.map((dataset) => `${dataset.name}:${dataset.rowCount}`).join(", ")}${result.manifest.activitySelection ? "; activity selection applied" : ""}.`
              : `Generated Garmin analysis blocked: ${result.reason ?? result.status}; script ${result.scriptHash.slice(0, 12)}; ${result.correctionAllowed ? "correction feedback may be offered" : "correction feedback is not offered"}.`,
          activityIds: result.result?.rows
            ?.map((row) => row.garminId)
            .filter((id): id is string => typeof id === "string")
            .slice(0, 10),
          privacy: result.privacy,
          reason: result.status === "succeeded" ? undefined : result.reason,
          correctionAllowed:
            result.status === "succeeded"
              ? undefined
              : result.correctionAllowed,
          failureMessage:
            result.status === "succeeded" ? undefined : result.message,
          correctionHint:
            result.status === "succeeded" ? undefined : result.correctionHint,
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
    if (step.tool === "describeGarminDatabase" && step.result) {
      const evidence = step.result as GarminDatabaseDescription;
      lines.push(
        `Analytical tables: ${evidence.tables.map((table) => `${table.name} (${table.rowCount})`).join(", ")}.`,
      );
      for (const table of evidence.tables) {
        const columns = table.columns
          .map((column) =>
            column.unit ? `${column.name} (${column.unit})` : column.name,
          )
          .join(", ");
        const dateRange = table.dateRange
          ? ` Date range ${table.dateRange.min ?? "n/a"} to ${table.dateRange.max ?? "n/a"}.`
          : "";
        lines.push(`${table.name} columns: ${columns}.${dateRange}`);
      }
      if (evidence.examples.length)
        lines.push(`Safe SQL examples: ${evidence.examples.join(" | ")}`);
      lines.push(
        `Forbidden data classes: ${evidence.forbiddenDataClasses.join("; ")}.`,
      );
    }
    if (step.tool === "runReadOnlySql" && step.result) {
      const evidence = step.result as AnalysisResult;
      if (evidence.status === "succeeded") {
        lines.push(
          `SQL result handle ${evidence.resultName}: returned ${evidence.returnedRows}/${evidence.rowCount} rows${evidence.truncated ? " with truncation" : ""}.`,
        );
        for (const [index, row] of evidence.rows.slice(0, 20).entries())
          lines.push(`${index + 1}. ${JSON.stringify(row).slice(0, 500)}`);
      } else if (evidence.message) {
        lines.push(`Bounded SQL detail: ${evidence.message}`);
        if (evidence.correctionHint)
          lines.push(`Correction guidance: ${evidence.correctionHint}`);
      }
    }
    if (step.tool === "runMathAnalysis" && step.result) {
      const evidence = step.result as MathAnalysisResult;
      if (evidence.status === "succeeded") {
        lines.push(
          `Math result handle ${evidence.resultName}: ${evidence.operation} over ${evidence.inputResult}, returned ${evidence.returnedRows}/${evidence.rowCount} rows${evidence.truncated ? " with truncation" : ""}.`,
        );
        for (const [index, row] of evidence.rows.slice(0, 20).entries())
          lines.push(`${index + 1}. ${JSON.stringify(row).slice(0, 500)}`);
      } else if (evidence.message)
        lines.push(`Bounded math detail: ${evidence.message}`);
    }
    if (step.tool === "runGeneratedGarminAnalysis" && step.result) {
      const evidence = step.result as GeneratedAnalysisEvidence;
      if (evidence.status === "succeeded" && evidence.result) {
        lines.push(
          `Generated dataset script result: ${evidence.result.title ?? evidence.result.kind}; returned ${evidence.result.returnedCount ?? evidence.result.rows?.length ?? 0}/${evidence.result.requestedCount}; script hash ${evidence.scriptHash.slice(0, 12)}.`,
        );
        if (typeof evidence.result.summary === "string")
          lines.push(evidence.result.summary);
        for (const row of evidence.result.rows ?? []) {
          const label = String(
            row.label ?? row.garminId ?? `row ${row.rank ?? ""}`,
          ).trim();
          const value =
            row.value ?? row.count ?? row.score ?? row.metric ?? "computed";
          lines.push(
            `${row.rank ?? "-"}. ${label} — ${String(value).slice(0, 120)}${row.units ? ` ${String(row.units).slice(0, 40)}` : ""}${row.date ? ` (${String(row.date).slice(0, 40)}` : ""}${row.sport ? `, ${String(row.sport).slice(0, 40)}` : ""}${row.date ? ")" : ""}${row.garminId ? `; Garmin ID ${String(row.garminId).slice(0, 80)}` : ""}${row.notes ? `; ${String(row.notes).slice(0, 160)}` : ""}.`,
          );
        }
        if (evidence.result.limitations.length)
          lines.push(...evidence.result.limitations);
        lines.push(
          `Data bundle: ${evidence.manifest.datasets.map((dataset) => `${dataset.name} ${dataset.rowCount}`).join(", ")}; raw payload metadata rows ${evidence.manifest.rawPayloads.length}; local-only execution.`,
        );
      } else {
        lines.push(
          `Generated analysis did not run to completion: ${evidence.reason ?? evidence.status}.`,
        );
        if (evidence.message)
          lines.push(`Bounded failure detail: ${evidence.message}.`);
        if (evidence.correctionHint)
          lines.push(`Correction guidance: ${evidence.correctionHint}`);
        lines.push(generatedAnalysisCorrectionContext(evidence));
        lines.push(
          `Correction feedback: ${evidence.correctionAllowed ? "the model may choose a corrected generated-analysis call" : "correction feedback is not offered for this failure"}.`,
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
      correctionAllowed: step.correctionAllowed,
    })),
  };
}
