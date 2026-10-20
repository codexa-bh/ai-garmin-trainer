import type { ActivityVerificationEvidence } from "@/lib/local-data/contracts";
import type {
  AnalysisResult,
  GarminDatabaseDescription,
} from "./analytics/contracts";
import type { MathAnalysisResult } from "./math-analysis";
import type { TrainerToolStep } from "./tool-types";

function redactSensitiveText(value: string): string {
  return value
    .replace(/(token data from directory\s+)['"][^'"]+['"]/gi, "$1[redacted]")
    .replace(/(tokens will be saved to:\s*)[^\r\n]+/gi, "$1[redacted]")
    .replace(/\/Users\/[^\s'"`]+/g, "[redacted-path]")
    .replace(/\b[A-Z0-9._%+-]+_API_KEY=\S+/gi, "[redacted-api-key]")
    .replace(/\b(refresh|access)_token\s*[=:]\s*\S+/gi, "$1_token=[redacted]");
}

export function boundedText(value: string, max = 500): string {
  const compact = redactSensitiveText(value).replace(/\s+/g, " ").trim();
  return compact.length > max ? `${compact.slice(0, max - 1)}…` : compact;
}

export function sanitizedResultDetail<T extends { detail?: unknown }>(
  result: T,
): T {
  if (typeof result.detail !== "string") return result;
  return { ...result, detail: boundedText(result.detail, 1200) };
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
        // This relation has no static rows; its binding/quality contract must reach
        // the model, not just the raw schema response. Zero is not availability.
        if (table.name === "activity_calculated_grade")
          lines.push(
            `Parameterized grade relation: ${boundedText(table.description, 1800)}`,
          );
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
        const calculatedFields =
          evidence.operation === "normalize"
            ? ["normalizedScore"]
            : evidence.operation === "aggregate"
              ? ["rowCount", "numericColumns"]
              : evidence.operation === "score" ||
                  evidence.operation === "customFormula"
                ? ["score"]
                : [];
        for (const [index, row] of evidence.rows.slice(0, 20).entries()) {
          // Preserve row indexes and exact cells, but do not let a long input
          // label hide the calculated value behind the existing evidence cap.
          const calculated = Object.fromEntries(
            calculatedFields.map((field) => [field, row[field]]),
          );
          lines.push(
            `${index + 1}. ${JSON.stringify({ ...calculated, ...row }).slice(0, 500)}`,
          );
        }
      } else if (evidence.message) {
        lines.push(`Bounded math detail: ${evidence.message}`);
        if (evidence.correctionHint)
          lines.push(`Correction guidance: ${evidence.correctionHint}`);
      }
    }
    lines.push(`Privacy: ${step.privacy}`);
  }
  return lines.join("\n");
}

export function groundingForSteps(steps: TrainerToolStep[]) {
  const finalStep =
    [...steps]
      .reverse()
      .find(
        (step) =>
          step.status === "succeeded" && step.tool !== "providerToolSelection",
      ) ?? steps.at(-1);
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
      selection: step.selection,
    })),
  };
}
