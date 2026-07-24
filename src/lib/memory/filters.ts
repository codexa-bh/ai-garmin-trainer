import type {
  CompletedTurn,
  MemoryCandidate,
  MemoryKind,
  RetrievedMemory,
} from "./types";

const SECRET_PATTERN =
  /\b(password|passcode|api\s*key|secret|token|credential|refresh[_ -]?token|authorization)\b/i;
const RAW_GARMIN_PATTERN =
  /\b(raw\s*fit|fit\s*bytes|connector\s*payload|garmin\s*password|\.fit\b|gps\s*stream|lat(?:itude)?\s*[:=]|lon(?:gitude)?\s*[:=])\b/i;
const MEDICAL_PATTERN =
  /\b(diagnos(?:e|is|ed)|prescription|medication\s+dosage|blood\s+pressure|symptom|injury\s+diagnosis|treat(?:ment)?)\b/i;
const POLICY_PATTERN =
  /\b(system prompt|developer message|ignore previous|bypass policy|reveal all messages|tool diagnostics?)\b/i;
const ASSISTANT_OR_TOOL_PATTERN =
  /\b(assistant\s*:|tool evidence|tool output|sql rows|formula says|ranking result)\b/i;

const MEMORY_TEXT_MAX_LENGTH = 260;
const TEMPORARY_MEMORY_DAYS = 14;

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
  if (ASSISTANT_OR_TOOL_PATTERN.test(value)) return "assistant_or_tool_prose";
  return null;
}

export function safeCompletedTurnText(input: CompletedTurn): string | null {
  const userText = compactText(input.userText, MEMORY_TEXT_MAX_LENGTH);
  if (!userText) return null;
  if (unsafeMemoryReason(userText)) return null;
  return userText;
}

function stripTrailingPunctuation(value: string): string {
  return value.replace(/[.!?]+$/, "").trim();
}

function candidateText(value: string): string | null {
  const text = compactText(
    stripTrailingPunctuation(value),
    MEMORY_TEXT_MAX_LENGTH,
  );
  if (!text || unsafeMemoryReason(text)) return null;
  return text;
}

function temporaryExpiry(input: CompletedTurn): Date {
  return new Date(
    input.completedAt.getTime() + TEMPORARY_MEMORY_DAYS * 24 * 60 * 60 * 1000,
  );
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

export function extractMemoryCandidates(
  input: CompletedTurn,
): MemoryCandidate[] {
  const userText = safeCompletedTurnText(input);
  if (!userText) return [];

  const candidates: MemoryCandidate[] = [];
  const add = (candidate: Omit<MemoryCandidate, "source">) => {
    const text = candidateText(candidate.text);
    if (!text) return;
    candidates.push({ ...candidate, text, source: "completed-turn-user-fact" });
  };

  const explicitCorrection =
    /\b(?:actually|correction|to\s+correct\s+that|that's\s+not\s+true|that\s+is\s+not\s+true)\b[:,]?\s*(.+)$/i.exec(
      userText,
    );

  const remember = /(?:^|\b)remember\s+that\s+(.+)$/i.exec(userText);
  if (remember?.[1]) {
    add({ kind: "saved_preference", text: remember[1] });
  }

  const preference = /\bI\s+(prefer|like|dislike|hate)\s+(.+)$/i.exec(userText);
  if (!explicitCorrection && preference?.[1] && preference[2]) {
    add({
      kind: "saved_preference",
      text: `I ${preference[1].toLowerCase()} ${preference[2]}`,
    });
  }

  const goal = /\bmy\s+goal\s+is\s+(.+)$/i.exec(userText);
  if (goal?.[1]) {
    add({ kind: "saved_preference", text: `My goal is ${goal[1]}` });
  }

  const recurring =
    /\b(I\s+(?:usually|tend\s+to|can\s+only|cannot|can't|have\s+only|need)\b.+)$/i.exec(
      userText,
    );
  if (recurring?.[1]) {
    add({ kind: "saved_preference", text: recurring[1] });
  }

  if (explicitCorrection?.[1]) {
    add({ kind: "correction", text: `Correction: ${explicitCorrection[1]}` });
  }

  const temporaryIntent =
    /\b(?:I\s+will|I'll|I\s+plan\s+to|I\s+am\s+going\s+to|I'm\s+going\s+to|I\s+intend\s+to|I\s+might|I\s+should|try\s+today|trying\s+today)\b/i.test(
      userText,
    ) &&
    /\b(today|tomorrow|this\s+week|this\s+weekend|tonight|next\s+week|soon)\b/i.test(
      userText,
    );
  if (temporaryIntent) {
    add({
      kind: "temporary",
      text: userText,
      expiresAt: temporaryExpiry(input),
    });
  }

  return uniqueCandidates(candidates);
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
  if (/\b(correction|instead|not true|actually)\b/.test(text))
    return "correction";
  if (/\b(today|tomorrow|this week|this weekend|tonight|soon)\b/.test(text))
    return "temporary";
  if (
    /\b(prefer|likes?|usually|default|goal|constraint|need|cannot|can't)\b/.test(
      text,
    )
  )
    return "saved_preference";
  return "conversation";
}

export function memorySafeToRender(item: RetrievedMemory): boolean {
  return Boolean(item.text.trim()) && !unsafeMemoryReason(item.text);
}
