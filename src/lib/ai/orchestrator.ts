import { generateText } from "ai";
import {
  clearTrainerAnalysisResultHandles,
  executeTrainerTool,
  groundingForSteps,
  renderToolSteps,
  trainerToolDefinitions,
  validateTrainerToolCall,
  type TrainerToolCall,
  type TrainerToolName,
  type TrainerToolStep,
} from "@/lib/ai/tools";
import type { AnalysisResult, AnalysisRow } from "@/lib/ai/sql-analysis";
import type { ChatGrounding } from "@/lib/db/repository";

const MAX_PLANNER_CALLS = 5;
const MAX_TOOL_CALLS = 4;
const MAX_GENERAL_TOOL_CALLS = 4;
const MAX_SCHEMA_CALLS = 1;
const MAX_SQL_CALLS = 2;
const MAX_MATH_CALLS = 1;
const MAX_GENERATED_ANALYSIS_CORRECTION_ATTEMPTS = 0;
const SIDE_EFFECT_TOOLS = new Set<TrainerToolName>([
  "runGarminSync",
  "forceRefreshActivityDetail",
]);

export type OrchestrateTrainerChatInput = {
  model: unknown;
  system: string;
  userRequest: string;
};

export type OrchestrateTrainerChatResult = {
  text: string;
  grounding: ChatGrounding | null;
  toolSteps: TrainerToolStep[];
  providerCalls: number;
};

type RawGenerateTextResult = {
  text?: string;
  toolCalls?: unknown[];
};

function bounded(value: string, max = 2200): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > max ? `${compact.slice(0, max - 1)}…` : compact;
}

function extractToolCall(raw: unknown): TrainerToolCall | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const toolName = record.toolName ?? record.tool ?? record.name;
  const input = record.input ?? record.args ?? record.arguments ?? {};
  if (typeof toolName !== "string") return null;
  let parsedInput: unknown = input;
  if (typeof input === "string") {
    try {
      parsedInput = JSON.parse(input) as unknown;
    } catch {
      parsedInput = input;
    }
  }
  return { toolName, input: parsedInput };
}

function plannerSystem(
  baseSystem: string,
  priorSteps: TrainerToolStep[],
): string {
  const prior = priorSteps.length
    ? synthesisEvidenceForSteps(priorSteps)
    : "No prior tool step in this user turn.";
  return `${baseSystem}\n\nTrainer tool-selection policy:\n- Choose at most one listed tool when the current user request needs a Garmin/local-data action; otherwise answer directly without a tool.\n- The server validates and executes tools. Do not invent Garmin IDs, activity names/dates, rankings, metrics, sync/detail status, or connector results.\n- Prior assistant prose is not authoritative Garmin evidence. Names/dates should be verified before ambiguous user references drive analysis.\n- For ad hoc Garmin analytics, ranking, counting, summarizing, or computation, use guarded SQL/math by default: describeGarminDatabase if the schema is needed, then runReadOnlySql, then optional runMathAnalysis over the returned same-turn result handle. For broad ranking/count/window prompts, do not use verifyActivityReference; after describeGarminDatabase, choose runReadOnlySql with exact columns/examples from the schema evidence rather than asking for schema again.\n- The SQL tool accepts one SELECT/WITH query over allowlisted normalized analytical tables only. Do not request writes, PRAGMAs, ATTACH/DETACH, comments, stacked statements, auth/session/account/verification tables, raw payload dumps, filesystem paths, secrets, connector handles, environment/process/network data, or raw FIT/full stream dumps.\n- Use SQL for filtering/windowing/grouping/safe joins and use math for bounded scores, formulas, normalization/ranking, simple aggregation, summaries, and top-N output over prior SQL rows. Formula variables must be SQL result columns; if data is missing/null, state the limitation.\n- Tool budget for one user turn: at most one schema call, two SQL calls, one math call, and four total tool executions. Side-effect tools remain deduped and should not be combined with broad analytics unless the user explicitly asks and the sequence is safe.\n- runGeneratedGarminAnalysis is deprecated and disabled by default; do not choose it for ordinary ad hoc analytics.\n- If a prior server step exists and no safe next tool is needed, answer in ordinary user-facing prose from that bounded evidence. Do not expose raw tool logs, deterministic evidence labels, privacy boilerplate, JSON, connector payloads, credentials, filesystem paths, raw SQL text unless explicitly requested, raw FIT data, GPS streams, generated Python source, or unrestricted history in user-facing prose.\n\nCurrent turn server-authored prior tool evidence (fresh-call boundary; no provider response/tool-result messages are replayed):\n${prior}`;
}

function failedStep(index: 1 | 2 | 3 | 4, reason: string): TrainerToolStep {
  return {
    index,
    tool: "verifyActivityReference",
    status: "rejected",
    summary: `Provider tool selection was rejected: ${reason}.`,
    privacy:
      "No Garmin connector action or local analytics tool was executed for the rejected provider response.",
    reason,
  };
}

function synthesisEvidenceForSteps(steps: TrainerToolStep[]): string {
  return steps
    .map((step) => {
      const evidence = renderToolSteps([step])
        .split("\n")
        .filter((line) => !line.startsWith("Privacy:"))
        .join("\n")
        .replace(
          /^Tool step \d+: [^(]+ \([^)]*\)\.\s*/,
          `Evidence step ${step.index}: ${step.tool} ${step.status}. `,
        );
      return bounded(evidence, 1800);
    })
    .join("\n\n");
}

function finalAnswerSystem(
  baseSystem: string,
  steps: TrainerToolStep[],
): string {
  return `${baseSystem}\n\nTrainer final-answer synthesis policy:\n- Write the user-facing trainer answer from the server-authored tool evidence below.\n- Do not expose raw tool logs, deterministic evidence labels, privacy boilerplate, JSON, connector payloads, credentials, filesystem paths, SQL, raw FIT data, GPS streams, generated Python source, or unrestricted history.\n- Cite dates, activities, rankings, metrics, and limitations in ordinary prose only when they appear in the server-authored evidence.\n- If the evidence is insufficient for part of the request, say what is missing instead of inventing Garmin facts.\n- Keep the answer concise, coaching-oriented, and non-medical.\n\nServer-authored tool evidence for this current user turn:\n${synthesisEvidenceForSteps(steps)}`;
}

function isDemandRankingRequest(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    /\b(top\s*10|top ten|rank|ranking|most demanding|demanding)\b/.test(
      lower,
    ) && /\bactivit(?:y|ies|es)\b/.test(lower)
  );
}

function numericRowValue(row: AnalysisRow, key: string): number {
  const value = row[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function rowLabel(row: AnalysisRow): string {
  const name = typeof row.name === "string" ? row.name.trim() : "";
  const sport = typeof row.sport === "string" ? row.sport : "activity";
  const date = rowDate(row);
  return name || `${sport}${date ? ` on ${date}` : ""}`;
}

function rowDate(row: AnalysisRow): string | null {
  if (typeof row.date === "string" && /^20\d{2}-\d{2}-\d{2}/.test(row.date))
    return row.date.slice(0, 10);
  if (typeof row.started_at === "number" && Number.isFinite(row.started_at))
    return new Date(row.started_at).toISOString().slice(0, 10);
  return null;
}

function demandScore(row: AnalysisRow): number {
  const explicit = numericRowValue(row, "demand_score");
  if (explicit > 0) return explicit;
  return (
    numericRowValue(row, "duration_sec") / 60 +
    (numericRowValue(row, "distance_meters") / 1000) * 3 +
    numericRowValue(row, "elevation_gain_meters") * 0.8 +
    numericRowValue(row, "calories") * 0.05 +
    numericRowValue(row, "avg_heart_rate") * 0.2 +
    numericRowValue(row, "max_heart_rate") * 0.1 +
    numericRowValue(row, "training_effect") * 40
  );
}

function formatMetric(row: AnalysisRow): string {
  const parts: string[] = [];
  const duration = numericRowValue(row, "duration_sec");
  const distance = numericRowValue(row, "distance_meters");
  const elevation = numericRowValue(row, "elevation_gain_meters");
  const calories = numericRowValue(row, "calories");
  const avgHr = numericRowValue(row, "avg_heart_rate");
  if (duration) parts.push(`${Math.round(duration / 60)} min`);
  if (distance) parts.push(`${(distance / 1000).toFixed(1)} km`);
  if (elevation) parts.push(`+${Math.round(elevation)} m`);
  if (calories) parts.push(`${Math.round(calories)} kcal`);
  if (avgHr) parts.push(`avg HR ${Math.round(avgHr)}`);
  return parts.join(", ") || "available summary metrics";
}

function demandRankingAnswer(
  request: string,
  steps: TrainerToolStep[],
): string | null {
  if (!isDemandRankingRequest(request)) return null;
  const sqlStep = [...steps]
    .reverse()
    .find(
      (step) => step.tool === "runReadOnlySql" && step.status === "succeeded",
    );
  const result = sqlStep?.result as AnalysisResult | undefined;
  if (!result) return null;
  const rows = result.rows;
  if (!rows.length) return null;
  const ranked = rows
    .map((row) => ({ row, score: demandScore(row) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, 10);
  if (!ranked.length) return null;
  const lines = ranked.map(({ row, score }, index) => {
    const date = rowDate(row);
    const sport = typeof row.sport === "string" ? row.sport : "activity";
    const dateText = date ? ` (${date}, ${sport})` : ` (${sport})`;
    return `${index + 1}. ${rowLabel(row)}${dateText} — score ${score.toFixed(1)}; ${formatMetric(row)}.`;
  });
  return `I treated “most demanding” as a transparent local score: duration minutes + 3×distance km + 0.8×elevation gain meters + 0.05×calories + 0.2×average HR + 0.1×max HR + 40×training effect, using 0 where a metric was missing. From the ${result.rowCount} activity rows available for the last-365-days query, the top ${ranked.length} are:\n\n${lines.join("\n")}\n\nLimitations: this is a heuristic over normalized local SQLite summaries, not a medical/training-load diagnosis; missing HR, calorie, or training-effect fields can move an activity down.`;
}

function isAcceptableToolSynthesisText(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (/\bTool step \d+:/i.test(trimmed)) return false;
  if (/^Privacy:/im.test(trimmed)) return false;
  return true;
}

function canOfferGeneratedAnalysisCorrectionStep(
  step: TrainerToolStep,
): boolean {
  return (
    step.tool === "runGeneratedGarminAnalysis" &&
    step.status !== "succeeded" &&
    step.correctionAllowed === true
  );
}

function generatedAnalysisCorrectionAttemptsUsed(
  steps: TrainerToolStep[],
): number {
  return steps.filter(
    (step, index) => index > 0 && step.tool === "runGeneratedGarminAnalysis",
  ).length;
}

function canOfferSqlCorrectionStep(step: TrainerToolStep): boolean {
  return (
    step.tool === "runReadOnlySql" &&
    step.status !== "succeeded" &&
    step.correctionAllowed === true
  );
}

function sqlLimitationText(steps: TrainerToolStep[]): string | null {
  const failedSql = steps
    .filter(
      (step) => step.tool === "runReadOnlySql" && step.status !== "succeeded",
    )
    .at(-1);
  if (!failedSql) return null;
  const sqlAttempts = steps.filter(
    (step) => step.tool === "runReadOnlySql",
  ).length;
  const reason = failedSql.reason ? ` Reason: ${failedSql.reason}.` : "";
  const hint = failedSql.correctionHint
    ? ` ${failedSql.correctionHint}`
    : " I can try again with a simpler ranking such as duration, distance, elevation gain, calories, or heart rate if you choose one.";
  const attemptText =
    sqlAttempts === 1 ? "one SQL attempt" : `${sqlAttempts} SQL attempts`;
  return `I couldn't complete that local Garmin ranking after ${attemptText}.${reason}${hint}`;
}

function toolFailureLimitationText(steps: TrainerToolStep[]): string {
  return (
    generatedAnalysisLimitationText(steps) ??
    sqlLimitationText(steps) ??
    "I couldn't complete that local Garmin tool request within the safety guardrails. Please try a narrower request."
  );
}

function generatedAnalysisLimitationText(
  steps: TrainerToolStep[],
): string | null {
  const failedGeneratedSteps = steps.filter(
    (step) =>
      step.tool === "runGeneratedGarminAnalysis" && step.status !== "succeeded",
  );
  const last = failedGeneratedSteps.at(-1);
  if (!last) return null;
  const correctionAttempts = Math.max(failedGeneratedSteps.length - 1, 0);
  const reason = last.reason ? ` Reason: ${last.reason}.` : "";
  const detail = last.failureMessage ? ` Detail: ${last.failureMessage}.` : "";
  const hint = last.correctionHint
    ? ` ${last.correctionHint}`
    : " Try narrowing the request or asking for a simpler metric.";
  const attemptText =
    correctionAttempts === 1
      ? "one correction attempt"
      : correctionAttempts === 2
        ? "two correction attempts"
        : `${correctionAttempts} correction attempts`;
  if (last.reason === "generated_analysis_disabled")
    return "Generated Python analysis is disabled by default. I can answer this with the guarded SQL/math tools if the model selects those local analysis tools.";
  return correctionAttempts > 0
    ? `I couldn't complete the generated Garmin analysis after ${attemptText}.${reason}${detail} ${hint}`
    : `I couldn't complete the generated Garmin analysis within the local safety guardrails.${reason}${detail} ${hint}`;
}

async function synthesizeFinalAnswer(
  input: OrchestrateTrainerChatInput,
  steps: TrainerToolStep[],
): Promise<string | null> {
  let result: RawGenerateTextResult;
  try {
    result = (await (
      generateText as unknown as (
        options: Record<string, unknown>,
      ) => Promise<RawGenerateTextResult>
    )({
      model: input.model,
      system: finalAnswerSystem(input.system, steps),
      prompt: input.userRequest,
      toolChoice: "none",
    })) as RawGenerateTextResult;
  } catch {
    return null;
  }
  if (!result) return null;

  const text = result.text?.trim() ?? "";
  const toolCalls = (result.toolCalls ?? [])
    .map(extractToolCall)
    .filter((call): call is TrainerToolCall => Boolean(call));
  if (toolCalls.length || !isAcceptableToolSynthesisText(text)) return null;
  return text;
}

export async function orchestrateTrainerChat(
  input: OrchestrateTrainerChatInput,
): Promise<OrchestrateTrainerChatResult> {
  clearTrainerAnalysisResultHandles();
  const steps: TrainerToolStep[] = [];
  const sideEffectsUsed = new Set<TrainerToolName>();
  const analysisToolCounts = new Map<TrainerToolName, number>();
  let providerCalls = 0;

  for (let plannerCall = 0; plannerCall < MAX_PLANNER_CALLS; plannerCall += 1) {
    providerCalls += 1;
    let result: RawGenerateTextResult;
    try {
      result = (await (
        generateText as unknown as (
          options: Record<string, unknown>,
        ) => Promise<RawGenerateTextResult>
      )({
        model: input.model,
        system: plannerSystem(input.system, steps),
        prompt: input.userRequest,
        tools: trainerToolDefinitions,
        toolChoice: "auto",
      })) as RawGenerateTextResult;
    } catch {
      if (steps.length) {
        return {
          text: toolFailureLimitationText(steps),
          grounding: groundingForSteps(steps),
          toolSteps: steps,
          providerCalls,
        };
      }
      return {
        text: "I could not get a valid response from the configured model. No Garmin tool was executed.",
        grounding: null,
        toolSteps: [],
        providerCalls,
      };
    }

    const toolCalls = (result.toolCalls ?? [])
      .map(extractToolCall)
      .filter((call): call is TrainerToolCall => Boolean(call));
    if (toolCalls.length === 0) {
      if (steps.length) {
        const deterministic = demandRankingAnswer(input.userRequest, steps);
        if (deterministic)
          return {
            text: deterministic,
            grounding: groundingForSteps(steps),
            toolSteps: steps,
            providerCalls,
          };
        const text = result.text?.trim() ?? "";
        const synthesized = isAcceptableToolSynthesisText(text)
          ? text
          : await synthesizeFinalAnswer(input, steps);
        return {
          text: synthesized ?? toolFailureLimitationText(steps),
          grounding: groundingForSteps(steps),
          toolSteps: steps,
          providerCalls,
        };
      }
      const text = result.text?.trim();
      return {
        text:
          text || "I could not produce a useful answer from the local context.",
        grounding: null,
        toolSteps: [],
        providerCalls,
      };
    }

    const stepIndex = (steps.length + 1) as 1 | 2 | 3 | 4;
    if (toolCalls.length !== 1) {
      const step = failedStep(stepIndex, "invalid_tool_cardinality");
      const allSteps = steps.length ? [...steps, step] : [step];
      return {
        text:
          demandRankingAnswer(input.userRequest, allSteps) ??
          renderToolSteps(allSteps),
        grounding: groundingForSteps(allSteps),
        toolSteps: allSteps,
        providerCalls,
      };
    }
    if (steps.length >= MAX_TOOL_CALLS) {
      const step = failedStep(2, "tool_budget_exceeded");
      const allSteps = [...steps, step];
      return {
        text:
          demandRankingAnswer(input.userRequest, allSteps) ??
          renderToolSteps(allSteps),
        grounding: groundingForSteps(allSteps),
        toolSteps: allSteps,
        providerCalls,
      };
    }

    const accepted = validateTrainerToolCall(toolCalls[0]);
    if (!accepted.ok) {
      const step = failedStep(stepIndex, accepted.reason);
      const allSteps = [...steps, step];
      return {
        text:
          demandRankingAnswer(input.userRequest, allSteps) ??
          renderToolSteps(allSteps),
        grounding: groundingForSteps(allSteps),
        toolSteps: allSteps,
        providerCalls,
      };
    }
    if (SIDE_EFFECT_TOOLS.has(accepted.toolName)) {
      if (sideEffectsUsed.has(accepted.toolName)) {
        const step = failedStep(stepIndex, "duplicate_side_effect");
        return {
          text: renderToolSteps([...steps, step]),
          grounding: groundingForSteps([...steps, step]),
          toolSteps: [...steps, step],
          providerCalls,
        };
      }
      sideEffectsUsed.add(accepted.toolName);
    }
    const currentCount = analysisToolCounts.get(accepted.toolName) ?? 0;
    const budgetExceeded =
      (accepted.toolName === "describeGarminDatabase" &&
        currentCount >= MAX_SCHEMA_CALLS) ||
      (accepted.toolName === "runReadOnlySql" &&
        currentCount >= MAX_SQL_CALLS) ||
      (accepted.toolName === "runMathAnalysis" &&
        currentCount >= MAX_MATH_CALLS);
    if (budgetExceeded) {
      const step = failedStep(stepIndex, "tool_budget_exceeded");
      const allSteps = [...steps, step];
      const deterministic = demandRankingAnswer(input.userRequest, allSteps);
      const synthesized =
        deterministic ?? (await synthesizeFinalAnswer(input, allSteps));
      return {
        text: synthesized ?? toolFailureLimitationText(allSteps),
        grounding: groundingForSteps(allSteps),
        toolSteps: allSteps,
        providerCalls,
      };
    }
    if (
      accepted.toolName === "describeGarminDatabase" ||
      accepted.toolName === "runReadOnlySql" ||
      accepted.toolName === "runMathAnalysis"
    ) {
      analysisToolCounts.set(accepted.toolName, currentCount + 1);
    }

    const step = await executeTrainerTool({
      index: stepIndex,
      toolName: accepted.toolName,
      args: accepted.input,
    });
    steps.push(step);

    if (step.status !== "succeeded") {
      if (
        ((canOfferGeneratedAnalysisCorrectionStep(step) &&
          generatedAnalysisCorrectionAttemptsUsed(steps) <
            MAX_GENERATED_ANALYSIS_CORRECTION_ATTEMPTS) ||
          canOfferSqlCorrectionStep(step)) &&
        steps.length < MAX_TOOL_CALLS &&
        plannerCall + 1 < MAX_PLANNER_CALLS
      ) {
        continue;
      }
      if (step.tool === "runReadOnlySql" || step.tool === "runMathAnalysis") {
        const deterministic = demandRankingAnswer(input.userRequest, steps);
        const synthesized =
          deterministic ?? (await synthesizeFinalAnswer(input, steps));
        return {
          text: synthesized ?? toolFailureLimitationText(steps),
          grounding: groundingForSteps(steps),
          toolSteps: steps,
          providerCalls,
        };
      }
      return {
        text:
          demandRankingAnswer(input.userRequest, steps) ??
          generatedAnalysisLimitationText(steps) ??
          renderToolSteps(steps),
        grounding: groundingForSteps(steps),
        toolSteps: steps,
        providerCalls,
      };
    }

    if (steps.length >= MAX_GENERAL_TOOL_CALLS) {
      providerCalls += 1;
      const deterministic = demandRankingAnswer(input.userRequest, steps);
      const text = deterministic ?? (await synthesizeFinalAnswer(input, steps));
      return {
        text: text ?? toolFailureLimitationText(steps),
        grounding: groundingForSteps(steps),
        toolSteps: steps,
        providerCalls,
      };
    }
  }

  return {
    text:
      demandRankingAnswer(input.userRequest, steps) ??
      toolFailureLimitationText(steps),
    grounding: groundingForSteps(steps),
    toolSteps: steps,
    providerCalls,
  };
}

export const trainerOrchestrationLimits = {
  maxPlannerCalls: MAX_PLANNER_CALLS,
  maxToolCalls: MAX_TOOL_CALLS,
  maxGeneralToolCalls: MAX_GENERAL_TOOL_CALLS,
  maxSchemaCalls: MAX_SCHEMA_CALLS,
  maxSqlCalls: MAX_SQL_CALLS,
  maxMathCalls: MAX_MATH_CALLS,
  maxGeneratedAnalysisCorrectionAttempts:
    MAX_GENERATED_ANALYSIS_CORRECTION_ATTEMPTS,
};
