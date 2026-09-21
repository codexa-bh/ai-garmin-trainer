import { generateText } from "ai";
import { selectedMemoryExtractionModel } from "../ai/providers";
import { getOptionalEnv } from "../env";
import {
  createMemoryExtractor,
  type ExtractionResult,
} from "./extraction-policy";
type MemoryExtractionMode = "llm" | "deterministic" | "off";
export function memoryExtractionMode(): MemoryExtractionMode {
  const raw = process.env.MEMORY_EXTRACTION_MODE?.trim().toLowerCase();
  return raw === "deterministic" || raw === "off" ? raw : "llm";
}

function memoryExtractionTimeoutMs(): number {
  const env = getOptionalEnv();
  const raw = process.env.MEMORY_EXTRACTION_TIMEOUT_MS ?? env.MEMORY_TIMEOUT_MS;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 500 && parsed <= 15000
    ? parsed
    : 3000;
}

function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timer = new Promise<never>((_, reject) => {
    timeout = setTimeout(
      () => reject(new Error(`${label} timed out`)),
      timeoutMs,
    );
  });
  return Promise.race([operation, timer]).finally(() => {
    if (timeout) clearTimeout(timeout);
  });
}

export const extractMemoryCandidatesWithLlm = createMemoryExtractor({
  mode: memoryExtractionMode,
  async generate(input) {
    const selection = selectedMemoryExtractionModel();
    if (!selection) return null;
    return withTimeout(
      (
        generateText as unknown as (
          options: Record<string, unknown>,
        ) => Promise<ExtractionResult>
      )({
        model: selection.model,
        ...input,
        toolChoice: "none",
        temperature: 0,
        maxOutputTokens: 900,
      }),
      memoryExtractionTimeoutMs(),
      "memory extraction",
    );
  },
});
