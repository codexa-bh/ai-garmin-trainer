import { lstatSync } from "node:fs";
import { configuredSecret, getOptionalEnv } from "../../src/lib/env";
import { isCanonicalLocalPath } from "../../src/lib/db/local-path";
import fields from "../../src-tauri/ui/settings-fields.json";
import { validateChatgptDescriptor } from "../../src/lib/ai/chatgpt-connection";
import {
  legacyChatCatalog,
  containsControlCharacters,
  validateChatCatalog,
} from "../../src/lib/model-settings/catalog";

export const SECRET_SLOTS = [
  "OPENAI_API_KEY",
  "DEEPSEEK_API_KEY",
  "OPENROUTER_API_KEY",
] as const;

/** Closed failure metadata only; never forward exception text, paths or values. */
export function desktopValidationFailureCode(error: unknown): string {
  const code =
    error && typeof error === "object" && "code" in error
      ? error.code
      : undefined;
  if (
    typeof code === "string" &&
    [
      "SQLITE_BUSY",
      "SQLITE_LOCKED",
      "SQLITE_CANTOPEN",
      "SQLITE_CORRUPT",
      "SQLITE_NOTADB",
      "SQLITE_READONLY",
      "SQLITE_ERROR",
      "SQLITE_IOERR",
      "MODULE_NOT_FOUND",
      "ERR_DLOPEN_FAILED",
    ].includes(code)
  )
    return code;
  const known: Record<string, string> = {
    "Select a canonical absolute local path, without aliases or expansion.":
      "canonical-path",
    "Select an existing regular database, not an empty file or alias.":
      "database-file",
    "Database schema is not supported. Back up and explicitly upgrade a disposable copy using the source tools first.":
      "database-schema",
    "Database integrity check failed.": "database-integrity",
    "Database compatibility structure is incomplete; repair a backed-up copy before adoption.":
      "database-compatibility",
    "Database conversation control is inconsistent; preserve data and use compatible recovery.":
      "database-control",
  };
  return error instanceof Error && Object.hasOwn(known, error.message)
    ? known[error.message]!
    : "unavailable";
}

function literalPath(value: string): string {
  if (
    value !== value.trim() ||
    /[~$%]/.test(value) ||
    [...value].some((character) => character.charCodeAt(0) < 32) ||
    !isCanonicalLocalPath(value)
  )
    throw new Error(
      "Select a canonical absolute local path, without aliases or expansion.",
    );
  // Windows owner/DACL privacy is not visible to Node; the native settings owner
  // enforces it (private_fs) before any save or activation on every platform.
  if (!lstatSync(value).isFile())
    throw new Error("Selected path has the wrong type.");
  return value;
}

function endpoint(value: string, local: boolean): void {
  const url = new URL(value);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (local && !["127.0.0.1", "localhost"].includes(url.hostname))
  )
    throw new Error(
      "Use an HTTP endpoint without credentials, query or fragment; Ollama must be loopback.",
    );
}

// This is the only desktop editable-field inventory. Application defaults and
// enums still come from getOptionalEnv; the native host invokes this before any
// Keychain mutation. Runtime repeats validation before constructing resources.
export function validateSettings(
  input: unknown,
  database: "existing" | "new" = "existing",
): Record<string, string> {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("Invalid settings.");
  const values = input as Record<string, unknown>;
  if (
    Object.keys(values).some(
      (key) => !fields.some((field) => field.key === key),
    )
  )
    throw new Error("Unknown setting.");
  for (const value of Object.values(values))
    if (
      typeof value !== "string" ||
      Buffer.byteLength(value, "utf8") > 2048 ||
      containsControlCharacters(value)
    )
      throw new Error("Invalid setting value.");
  const strings = values as Record<string, string>;
  const env = getOptionalEnv(strings);
  if (!strings.DATABASE_PATH) throw new Error("Select an existing database.");
  // Native validates and exclusively publishes the fresh destination. This mode
  // validates configuration only, never opens or creates a selected database.
  if (database === "existing") literalPath(strings.DATABASE_PATH);
  const date = new Date(`${strings.GARMIN_HISTORY_START_DATE}T00:00:00Z`);
  if (
    strings.GARMIN_HISTORY_START_DATE &&
    (!Number.isFinite(date.getTime()) ||
      date.toISOString().slice(0, 10) !== strings.GARMIN_HISTORY_START_DATE ||
      date > new Date())
  )
    throw new Error(
      "History date must be a calendar date no later than today.",
    );
  if (
    strings.MEMORY_ENABLED &&
    !["true", "false"].includes(strings.MEMORY_ENABLED)
  )
    throw new Error("Invalid memory switch.");
  for (const [key, min, max] of [
    ["MEMORY_EMBEDDING_DIMS", 8, 65536],
    ["MEMORY_TIMEOUT_MS", 1, 300000],
    ["MEMORY_EXTRACTION_TIMEOUT_MS", 1, 300000],
  ] as const) {
    const value = env[key];
    if (!/^\d+$/.test(value) || Number(value) < min || Number(value) > max)
      throw new Error("Invalid memory dimension or timeout.");
  }
  endpoint(env.OLLAMA_BASE_URL, true);
  if (env.MEMORY_EMBEDDING_BASE_URL)
    endpoint(
      env.MEMORY_EMBEDDING_BASE_URL,
      env.MEMORY_EMBEDDING_PROVIDER === "ollama",
    );
  for (const field of fields) {
    const value = strings[field.key];
    if (field.key.endsWith("_MODEL") && value !== undefined && !value.trim())
      throw new Error("Model cannot be blank.");
  }
  const result: Record<string, string> = {};
  for (const field of fields) {
    const value =
      strings[field.key] ||
      (env as Record<string, string | undefined>)[field.key];
    if (value !== undefined) result[field.key] = value;
  }
  return result;
}

// Version4 wraps two independently bounded private documents plus its descriptor.
// Preserve the old single-document bound for every other private command/frame.
export const PRIVATE_FRAME_LIMIT = 260 * 1024;
export function decodePrivateFrame(bytes: Uint8Array): unknown {
  if (bytes.length >= PRIVATE_FRAME_LIMIT)
    throw new Error("Activation too large.");
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(bytes).toString("utf8"));
  } catch {
    throw new Error("Invalid activation.");
  }
  if (
    bytes.length >= 128 * 1024 &&
    !(
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      "version" in value &&
      value.version === 4
    )
  )
    throw new Error("Activation too large.");
  return value; // Closed per-operation validators still own the complete schema.
}
/** Opaque printable key, mirrored from the native owner; never logged. */
export function garminActivationKey(input: unknown): string | undefined {
  const frame =
    input &&
    typeof input === "object" &&
    "version" in input &&
    input.version === 4
      ? (input as { activation?: unknown }).activation
      : input;
  if (!frame || typeof frame !== "object" || !("garminKey" in frame))
    return undefined;
  const key = frame.garminKey;
  if (
    typeof key !== "string" ||
    key.length < 8 ||
    key.length > 4096 ||
    !/^[\x21-\x7e]+$/.test(key) ||
    !configuredSecret(key)
  )
    throw new Error("Invalid Garmin key.");
  return key;
}
export function activationEnvironment(
  input: unknown,
  database: "existing" | "new" = "existing",
): Record<string, string> {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("Invalid activation.");
  if ("version" in input && input.version === 4) {
    if (
      Object.keys(input).sort().join() !== "activation,chatgpt,version" ||
      !("activation" in input) ||
      !("chatgpt" in input) ||
      !input.activation ||
      typeof input.activation !== "object" ||
      !("version" in input.activation) ||
      ![1, 2, 3].includes(input.activation.version as number)
    )
      throw new Error("Unsupported ChatGPT activation.");
    return {
      ...activationEnvironment(input.activation, database),
      CHATGPT_CONNECTIONS: JSON.stringify(
        validateChatgptDescriptor(input.chatgpt).connections,
      ),
    };
  }
  const frame = input as {
    version?: unknown;
    fields?: unknown;
    secrets?: unknown;
    chatCatalog?: unknown;
    selectionCompatibility?: unknown;
    garminKey?: unknown;
    garminFixture?: unknown;
  };
  if (
    ![1, 2, 3].includes(frame.version as number) ||
    Object.keys(frame).some(
      (key) =>
        !(
          frame.version === 3
            ? [
                "version",
                "fields",
                "secrets",
                "chatCatalog",
                "selectionCompatibility",
                "garminKey",
                // Isolated synthetic runs only; parsed and bounded by config.ts.
                "garminFixture",
              ]
            : frame.version === 2
              ? ["version", "fields", "secrets", "chatCatalog"]
              : ["version", "fields", "secrets"]
        ).includes(key),
    )
  )
    throw new Error("Unsupported activation.");
  garminActivationKey(frame);
  const result = validateSettings(frame.fields, database);
  if (
    !frame.secrets ||
    typeof frame.secrets !== "object" ||
    Array.isArray(frame.secrets)
  )
    throw new Error("Invalid secret slots.");
  for (const [key, value] of Object.entries(frame.secrets)) {
    if (
      !SECRET_SLOTS.some((slot) => slot === key) ||
      typeof value !== "string" ||
      Buffer.byteLength(value, "utf8") > 16384 ||
      containsControlCharacters(value) ||
      !configuredSecret(value)
    )
      throw new Error("Invalid provider secret.");
    result[key] = value;
  }
  const env = getOptionalEnv(result);
  const selected = env.AI_PROVIDER;
  if (
    frame.version === 1 &&
    ((selected === "openai" && !result.OPENAI_API_KEY) ||
      (selected === "deepseek" && !result.DEEPSEEK_API_KEY) ||
      (selected === "openrouter" && !result.OPENROUTER_API_KEY) ||
      (selected === "auto" &&
        !result.OPENAI_API_KEY &&
        !result.DEEPSEEK_API_KEY))
  )
    throw new Error(
      "Required provider key unavailable. Update private settings; no provider fallback.",
    );
  const catalog =
    frame.version !== 1
      ? validateChatCatalog(frame.chatCatalog)
      : legacyChatCatalog(result, {
          openai: Boolean(result.OPENAI_API_KEY),
          deepseek: Boolean(result.DEEPSEEK_API_KEY),
        });
  result.CHAT_MODEL_CATALOG = JSON.stringify(catalog);
  if (frame.version === 3) {
    const prior = frame.selectionCompatibility;
    if (
      !prior ||
      typeof prior !== "object" ||
      Array.isArray(prior) ||
      Object.keys(prior).length !== 2 ||
      !("database" in prior) ||
      !("catalog" in prior) ||
      !(
        prior.database === null ||
        (typeof prior.database === "string" &&
          prior.database.length <= 2048 &&
          !containsControlCharacters(prior.database))
      )
    )
      throw new Error("Unsupported selection compatibility.");
    const original = validateChatCatalog(prior.catalog);
    result.CHAT_SELECTION_COMPATIBILITY = JSON.stringify(
      prior.database === result.DATABASE_PATH ? original : null,
    );
  }
  return result;
}
