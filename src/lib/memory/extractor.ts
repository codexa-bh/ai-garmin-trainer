import { generateText } from "ai";
import { selectedMemoryExtractionModel } from "../ai/providers";
import { getOptionalEnv } from "../env";
import { compactText, unsafeMemoryReason } from "./filters";
import type { CompletedTurn, MemoryCandidate, MemoryKind } from "./types";

const MEMORY_EXTRACTION_INPUT_MAX_LENGTH = 1200;
const MEMORY_EXTRACTION_ASSISTANT_CONTEXT_MAX_LENGTH = 500;
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
const ASSISTANT_CONTEXT_AUTHORIZATION_PATTERN =
  /\b(?:remember\s+(?:that|this)|use\s+(?:that|this|the\s+(?:first|second|third)\s+option)\s+(?:going\s+forward|as\s+(?:my|the)\s+default|for\s+future\s+coaching)|make\s+(?:that|this|the\s+(?:first|second|third)\s+option)\s+(?:my|the)\s+default|(?:first|second|third)\s+option\s+(?:going\s+forward|as\s+(?:my|the)\s+default)|actually[^.?!]{0,80}\b(?:first|second|third)\s+option\b|going\s+forward|my\s+default)\b/i;
const ASSISTANT_PROSE_PATTERN =
  /\b(?:assistant|trainer|model)\s+(?:said|says|recommended|suggested|told|thinks|concluded|noted|claimed)\b|\b(?:latest\s+user\s+message|assistant\s+response|assistant\s+excerpt)\b/i;

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

function derivedFromText(candidateText: string, sourceText: string): boolean {
  const candidateTokens = tokenize(candidateText);
  if (candidateTokens.size === 0) return false;
  const sourceTokens = tokenize(sourceText);
  let overlap = 0;
  for (const token of candidateTokens) {
    if (sourceTokens.has(token)) overlap += 1;
  }
  return (
    overlap >= MIN_DERIVED_TOKEN_OVERLAP ||
    overlap / candidateTokens.size >= 0.5
  );
}

function derivedFromUserText(candidateText: string, userText: string): boolean {
  return derivedFromText(candidateText, userText);
}

function assistantContextText(input: CompletedTurn): string {
  const assistantText = compactText(
    input.assistantText,
    MEMORY_EXTRACTION_ASSISTANT_CONTEXT_MAX_LENGTH,
  );
  if (!assistantText) return "";
  if (
    unsafeMemoryReason(assistantText) ||
    GARMIN_FACT_PATTERN.test(assistantText)
  )
    return "";
  return assistantText;
}

function hasExplicitMemoryIntent(userText: string): boolean {
  return (
    EXPLICIT_MEMORY_INTENT_PATTERN.test(userText) ||
    ASSISTANT_CONTEXT_AUTHORIZATION_PATTERN.test(userText)
  );
}

function derivedFromAuthorizedAssistantContext(
  candidateText: string,
  input: CompletedTurn,
): boolean {
  if (!hasExplicitMemoryIntent(input.userText)) return false;
  const assistantText = assistantContextText(input);
  if (!assistantText) return false;
  return derivedFromText(candidateText, `${input.userText}\n${assistantText}`);
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
  if (
    !text ||
    unsafeMemoryReason(text) ||
    GARMIN_FACT_PATTERN.test(text) ||
    ASSISTANT_PROSE_PATTERN.test(text)
  )
    return null;
  if (unsafeMemoryReason(input.userText)) return null;
  if (
    !derivedFromUserText(text, input.userText) &&
    !derivedFromAuthorizedAssistantContext(text, input)
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
  if (parsed.noMemory === true && hasExplicitMemoryIntent(input.userText))
    return null;

  const validMemories = uniqueCandidates(
    memories
      .map((candidate) => validateCandidate(candidate, input))
      .filter((candidate): candidate is MemoryCandidate => Boolean(candidate)),
  );
  if (validMemories.length === 0 && hasExplicitMemoryIntent(input.userText))
    return null;

  return { memories: validMemories };
}

function extractionPrompt(input: CompletedTurn): string {
  const latestUserText = compactText(
    input.userText,
    MEMORY_EXTRACTION_INPUT_MAX_LENGTH,
  );
  const assistantText = assistantContextText(input);
  const assistantSection = assistantText
    ? assistantText
    : "(omitted: empty or unsafe for extraction context)";
  return `Latest user message (primary, user-authoritative):\n${latestUserText}\n\nImmediately previous assistant response excerpt (lower-authority context only; use only to resolve explicit user confirmation, correction, or selection intent; never store assistant prose or Garmin/tool facts):\n${assistantSection}`;
}

const EXTRACTION_SYSTEM = `You extract optional long-lived trainer personalization memory from the latest user message, with the immediately previous assistant response only as bounded lower-authority context when provided. Return only strict JSON and no markdown or prose.

JSON schema:
{"memories":[{"kind":"saved_preference|correction|temporary|conversation","text":"concise user-stated memory","confidence":"high|medium","expiresInDays":14}],"noMemory":false}
For no useful memory return exactly {"memories":[],"noMemory":true}.

Rules:
- Store only facts, preferences, corrections, constraints, goals, recurring patterns, or short temporary plans that the user actually stated or clearly implied in the latest user message.
- Use assistant context only when the latest user message explicitly authorizes, confirms, corrects, or selects that context (for example, remember that, use the second option going forward, or make that my default).
- Do not store bare acknowledgements, assistant claims, coaching conclusions, Garmin measurements, activity IDs, raw tool/database facts, credentials, policy/prompt text, medical diagnosis/treatment, or raw transcript labels.
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
    const selection = selectedMemoryExtractionModel();
    if (!selection) return null;
    result = await withTimeout(
      (
        generateText as unknown as (
          options: Record<string, unknown>,
        ) => Promise<RawGenerateTextResult>
      )({
        model: selection.model,
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
