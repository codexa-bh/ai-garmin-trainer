import { createHash } from "node:crypto";

export type GarminRawSubjectType =
  "activity_page" | "daily_health" | "activity_detail" | "athlete_baseline";

export type GarminRawContentType = "json" | "text";

export type RedactedGarminRawPayload = {
  payload: unknown;
  contentType: GarminRawContentType;
  sha256: string;
  redactedFieldCount: number;
  redactionVersion: 1;
};

const SECRET_KEY_PATTERN =
  /(password|token|secret|cookie|authorization|credential|access[_-]?token|refresh[_-]?token|id[_-]?token|session|auth|environment|env|command|args?|path)/i;
const SECRET_VALUE_PATTERN =
  /(?:bearer\s+[a-z0-9._~+/-]+=*|garmin[_-]?(?:token|password|cookie)|access[_-]?token|refresh[_-]?token|authorization)/i;
const REDACTED = "[REDACTED]";

function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, item) => {
    if (item && typeof item === "object" && !Array.isArray(item)) {
      return Object.fromEntries(
        Object.entries(item as Record<string, unknown>).sort(([a], [b]) =>
          a.localeCompare(b),
        ),
      );
    }
    return item;
  });
}

function redactValue(value: unknown): { value: unknown; count: number } {
  if (Array.isArray(value)) {
    let count = 0;
    const items = value.map((item) => {
      const redacted = redactValue(item);
      count += redacted.count;
      return redacted.value;
    });
    return { value: items, count };
  }
  if (value && typeof value === "object") {
    let count = 0;
    const output: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(
      value as Record<string, unknown>,
    )) {
      if (SECRET_KEY_PATTERN.test(key)) {
        output[key] = REDACTED;
        count += 1;
        continue;
      }
      const redacted = redactValue(child);
      output[key] = redacted.value;
      count += redacted.count;
    }
    return { value: output, count };
  }
  if (typeof value === "string" && SECRET_VALUE_PATTERN.test(value)) {
    return { value: REDACTED, count: 1 };
  }
  return { value, count: 0 };
}

export function redactGarminRawPayload(
  input: unknown,
): RedactedGarminRawPayload {
  const parsed = typeof input === "string" ? tryParseJson(input) : input;
  const contentType: GarminRawContentType =
    typeof parsed === "string" ? "text" : "json";
  const redacted = redactValue(parsed);
  const serialized =
    contentType === "text"
      ? String(redacted.value)
      : (stableStringify(redacted.value) ?? "null");
  return {
    payload: redacted.value,
    contentType,
    sha256: createHash("sha256").update(serialized).digest("hex"),
    redactedFieldCount: redacted.count,
    redactionVersion: 1,
  };
}

export function payloadHasSecretLikeText(value: unknown): boolean {
  return SECRET_VALUE_PATTERN.test(
    typeof value === "string" ? value : (JSON.stringify(value) ?? ""),
  );
}

function tryParseJson(value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return value;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return value;
  }
}
