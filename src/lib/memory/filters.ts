import type { CompletedTurn, MemoryKind, RetrievedMemory } from "./types";

const SECRET_PATTERN =
  /\b(password|passcode|api\s*key|secret|token|credential|refresh[_ -]?token|authorization)\b/i;
const RAW_GARMIN_PATTERN =
  /\b(raw\s*fit|fit\s*bytes|connector\s*payload|garmin\s*password|\.fit\b|gps\s*stream|lat(?:itude)?\s*[:=]|lon(?:gitude)?\s*[:=])\b/i;
const MEDICAL_PATTERN =
  /\b(diagnos(?:e|is|ed)|prescription|medication\s+dosage|blood\s+pressure|symptom|injury\s+diagnosis|treat(?:ment)?)\b/i;
const POLICY_PATTERN =
  /\b(system prompt|developer message|ignore previous|bypass policy|reveal all messages|tool diagnostics?)\b/i;

export function compactText(value: string, maxLength: number): string {
  const compacted = value.replace(/\s+/g, " ").trim();
  return compacted.length > maxLength
    ? `${compacted.slice(0, maxLength - 1)}…`
    : compacted;
}

export function unsafeMemoryReason(value: string): string | null {
  if (SECRET_PATTERN.test(value)) return "credential_or_secret";
  if (RAW_GARMIN_PATTERN.test(value)) return "raw_garmin_or_location_payload";
  if (MEDICAL_PATTERN.test(value)) return "medical_or_sensitive_inference";
  if (POLICY_PATTERN.test(value)) return "policy_or_prompt_injection";
  return null;
}

export function safeCompletedTurnText(input: CompletedTurn): string | null {
  const userText = compactText(input.userText, 900);
  const assistantText = compactText(input.assistantText, 900);
  const combined = `User: ${userText}\nAssistant: ${assistantText}`;
  if (!userText || !assistantText) return null;
  if (unsafeMemoryReason(combined)) return null;
  return combined;
}

export function classifyMemory(item: {
  metadata?: Record<string, unknown>;
  memory?: string;
}): MemoryKind {
  const kind = item.metadata?.kind;
  if (
    kind === "conversation" ||
    kind === "saved_preference" ||
    kind === "correction" ||
    kind === "temporary"
  ) {
    return kind;
  }
  const text = (item.memory ?? "").toLowerCase();
  if (/\b(prefer|likes?|usually|default|goal|constraint)\b/.test(text))
    return "saved_preference";
  if (/\b(correction|instead|not true|actually)\b/.test(text))
    return "correction";
  return "conversation";
}

export function memorySafeToRender(item: RetrievedMemory): boolean {
  return Boolean(item.text.trim()) && !unsafeMemoryReason(item.text);
}
