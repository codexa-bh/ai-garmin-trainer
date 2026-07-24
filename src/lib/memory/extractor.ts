import { generateText } from "ai";
import { selectedModel } from "../ai/providers";
import { getOptionalEnv } from "../env";
import { compactText, unsafeMemoryReason } from "./filters";
import type { CompletedTurn, MemoryCandidate, MemoryKind } from "./types";

const MEMORY_EXTRACTION_INPUT_MAX_LENGTH = 1200;
const MEMORY_EXTRACTION_OUTPUT_MAX_LENGTH = 4000;
const MEMORY_EXTRACTION_MAX_CANDIDATES = 3;
const MEMORY_TEXT_MAX_LENGTH = 260;
const TEMPORARY_MEMORY_DAYS = 14;
const MIN_DERIVED_TOKEN_OVERLAP = 2;

const ALLOWED_KINDS = new Set<MemoryKind>([
  "conversation",
  "saved_preference",
  "correction",
  "temporary",
]);
const ALLOWED_CONFIDENCE = new Set(["high", "medium"]);
const RESULT_KEYS = new Set(["memories", "noMemory"]);
const CANDIDATE_KEYS = new Set(["kind", "text", "confidence", "expiresInDays"]);
const STOP_TOKENS = new Set([
  "about",
  "after",
  "before",
  "better",
  "from",
  "that",
  "than",
  "their",
  "them",
  "they",
  "this",
  "user",
  "usually",
  "with",
]);
const SUMMARY_BRIDGE_TOKENS = new Set([
  "constraint",
  "constraints",
  "disruptive",
  "feels",
  "finds",
  "goal",
  "goals",
  "prefers",
  "preference",
  "preferences",
  "recurring",
]);
const GARMIN_FACT_PATTERN =
  /\b(?:garmin\s+id|activity\s+id|distance|elevation|pace|calories|heart\s*rate|hrv|vo2|max\s+hr|avg\s+hr|training\s+effect|last\s+(?:hike|run|ride|activity|workout)\s+(?:was|is|started|covered|had)|latest\s+(?:hike|run|ride|activity|workout)\s+(?:was|is|started|covered|had))\b/i;
const EXPLICIT_MEMORY_INTENT_PATTERN =
  /\b(?:remember(?:\s+that)?|keep\s+this\s+in\s+mind|keep\s+that\s+in\s+mind|for\s+future\s+coaching)\b/i;

export type MemoryExtractionMode = "llm" | "deterministic" | "off";

type RawGenerateTextResult = { text?: string; toolCalls?: unknown[] };

type ParsedExtractorResult = {
  memories: MemoryCandidate[];
};

export function memoryExtractionMode(): MemoryExtractionMode {
  const raw = process.env.MEMORY_EXTRACTION_MODE?.trim().toLowerCase();
  return raw === "deterministic" || raw === "off" ? raw : "llm";
}

export function memoryExtractionTimeoutMs(): number {
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

function strictObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  allowed: Set<string>,
): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}

function tokenize(value: string): Set<string> {
  const tokens = value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .match(/[a-z0-9]+/g);
  return new Set(
    (tokens ?? []).filter(
      (token) =>
        token.length >= 4 &&
        !STOP_TOKENS.has(token) &&
        !SUMMARY_BRIDGE_TOKENS.has(token),
    ),
  );
}

function derivedFromUserText(candidateText: string, userText: string): boolean {
  const candidateTokens = tokenize(candidateText);
  if (candidateTokens.size === 0) return false;
  const userTokens = tokenize(userText);
  let overlap = 0;
  for (const token of candidateTokens) {
    if (userTokens.has(token)) overlap += 1;
  }
  return (
    overlap >= MIN_DERIVED_TOKEN_OVERLAP ||
    overlap / candidateTokens.size >= 0.5
  );
}

function explicitTemporaryExpiry(
  value: unknown,
  completedAt: Date,
): Date | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const days = Math.trunc(value);
  if (days < 1 || days > 60) return null;
  return new Date(completedAt.getTime() + days * 24 * 60 * 60 * 1000);
}

function defaultTemporaryExpiry(completedAt: Date): Date {
  return new Date(
    completedAt.getTime() + TEMPORARY_MEMORY_DAYS * 24 * 60 * 60 * 1000,
  );
}

function validateCandidate(
  raw: unknown,
  input: CompletedTurn,
): MemoryCandidate | null {
  if (!strictObject(raw) || !hasOnlyKeys(raw, CANDIDATE_KEYS)) return null;
  if (!ALLOWED_KINDS.has(raw.kind as MemoryKind)) return null;
  if (typeof raw.text !== "string") return null;
  if (
    raw.confidence !== undefined &&
    (!ALLOWED_CONFIDENCE.has(String(raw.confidence)) ||
      String(raw.confidence) === "low")
  )
    return null;

  const text = compactText(raw.text, MEMORY_TEXT_MAX_LENGTH);
  if (!text || unsafeMemoryReason(text) || GARMIN_FACT_PATTERN.test(text))
    return null;
  if (
    unsafeMemoryReason(input.userText) ||
    !derivedFromUserText(text, input.userText)
  )
    return null;

  const kind = raw.kind as MemoryKind;
  const explicitExpiry = explicitTemporaryExpiry(
    raw.expiresInDays,
    input.completedAt,
  );
  if (raw.expiresInDays !== undefined && !explicitExpiry) return null;
  return {
    kind,
    text,
    source: "llm-completed-turn-user-fact",
    expiresAt:
      kind === "temporary"
        ? (explicitExpiry ?? defaultTemporaryExpiry(input.completedAt))
        : null,
  };
}

function uniqueCandidates(candidates: MemoryCandidate[]): MemoryCandidate[] {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = `${candidate.kind}\0${candidate.text.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function parseMemoryExtractorOutput(
  output: string,
  input: CompletedTurn,
): ParsedExtractorResult | null {
  const trimmed = output.trim();
  if (
    !trimmed ||
    trimmed.length > MEMORY_EXTRACTION_OUTPUT_MAX_LENGTH ||
    !trimmed.startsWith("{") ||
    !trimmed.endsWith("}")
  )
    return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed) as unknown;
  } catch {
    return null;
  }
  if (!strictObject(parsed) || !hasOnlyKeys(parsed, RESULT_KEYS)) return null;
  const memories = parsed.memories;
  if (!Array.isArray(memories)) return null;
  if (memories.length > MEMORY_EXTRACTION_MAX_CANDIDATES) return null;
  if (parsed.noMemory === true && memories.length > 0) return null;
  if (
    parsed.noMemory === true &&
    EXPLICIT_MEMORY_INTENT_PATTERN.test(input.userText)
  )
    return null;

  const validMemories = uniqueCandidates(
    memories
      .map((candidate) => validateCandidate(candidate, input))
      .filter((candidate): candidate is MemoryCandidate => Boolean(candidate)),
  );
  if (
    validMemories.length === 0 &&
    EXPLICIT_MEMORY_INTENT_PATTERN.test(input.userText)
  )
    return null;

  return { memories: validMemories };
}

function extractionPrompt(input: CompletedTurn): string {
  const latestUserText = compactText(
    input.userText,
    MEMORY_EXTRACTION_INPUT_MAX_LENGTH,
  );
  return `Latest user message only:\n${latestUserText}`;
}

const EXTRACTION_SYSTEM = `You extract optional long-lived trainer personalization memory from a single latest user message. Return only strict JSON and no markdown or prose.

JSON schema:
{"memories":[{"kind":"saved_preference|correction|temporary|conversation","text":"concise user-stated memory","confidence":"high|medium","expiresInDays":14}],"noMemory":false}
For no useful memory return exactly {"memories":[],"noMemory":true}.

Rules:
- Store only facts, preferences, corrections, constraints, goals, recurring patterns, or short temporary plans that the user actually stated or clearly implied in the latest user message.
- Do not store assistant claims, coaching conclusions, Garmin measurements, activity IDs, raw tool/database facts, credentials, policy/prompt text, medical diagnosis/treatment, or raw transcript labels.
- Keep text concise, inspectable, and user-derived; do not include reasoning or explanations.
- Use temporary for near-term plans and include expiresInDays from 1 to 60.
- Return at most three memories.`;

export async function extractMemoryCandidatesWithLlm(
  input: CompletedTurn,
): Promise<MemoryCandidate[] | null> {
  if (memoryExtractionMode() !== "llm") return null;
  if (!compactText(input.userText, MEMORY_EXTRACTION_INPUT_MAX_LENGTH))
    return [];
  if (unsafeMemoryReason(input.userText)) return [];

  let result: RawGenerateTextResult;
  try {
    const { model } = selectedModel();
    result = await withTimeout(
      (
        generateText as unknown as (
          options: Record<string, unknown>,
        ) => Promise<RawGenerateTextResult>
      )({
        model,
        system: EXTRACTION_SYSTEM,
        prompt: extractionPrompt(input),
        toolChoice: "none",
        temperature: 0,
        maxOutputTokens: 900,
      }),
      memoryExtractionTimeoutMs(),
      "memory extraction",
    );
  } catch {
    return null;
  }

  const toolCalls = result.toolCalls ?? [];
  if (toolCalls.length > 0) return null;
  const parsed = parseMemoryExtractorOutput(result.text ?? "", input);
  return parsed?.memories ?? null;
}
