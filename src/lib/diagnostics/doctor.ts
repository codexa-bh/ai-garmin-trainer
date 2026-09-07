import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { inspectTokenLocation } from "../garmin/token-location";
import Database from "better-sqlite3";
import { z } from "zod";
import {
  GARMIN_MCP_COMMIT,
  GARMIN_MCP_SDK_REQUIREMENT,
  garminMcpArgs,
  garminMcpSdkConstraintStatus,
} from "../garmin/client";
import {
  currentSchemaVersion,
  LATEST_SCHEMA_VERSION,
  runIntegrityCheck,
} from "../db/migrations";
import { aiProviderStatus, isLoopbackAiBaseUrl } from "../ai/providers";
import { getOptionalEnv, hasConfiguredSecret } from "../env";
import {
  isLoopbackUrl,
  OLLAMA_DEFAULT_BASE_URL,
  OLLAMA_DEFAULT_EMBEDDING_MODEL,
} from "../memory/config";
import { redactDiagnosticValue } from "./redaction";

export type DoctorStatus = "pass" | "warn" | "fail";
export type DoctorCheck = {
  id: string;
  status: DoctorStatus;
  className: string;
  message: string;
  remediation?: string;
};
export type DoctorReport = {
  ok: boolean;
  generatedAt: string;
  contractVersion: 1;
  supportedBoundary: string;
  facts: Record<string, unknown>;
  checks: DoctorCheck[];
};

function check(
  checks: DoctorCheck[],
  status: DoctorStatus,
  id: string,
  className: string,
  message: string,
  remediation?: string,
): void {
  checks.push({ id, status, className, message, remediation });
}

function parseMajor(version: string): number {
  return Number(version.replace(/^v/, "").split(".")[0] ?? 0);
}

function commandVersion(command: string, args = ["--version"]): string | null {
  try {
    return execFileSync(command, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
      .trim()
      .slice(0, 80);
  } catch {
    return null;
  }
}

function loopbackHost(rawUrl: string): boolean {
  try {
    const host = new URL(rawUrl).hostname;
    return ["localhost", "127.0.0.1", "::1"].includes(host);
  } catch {
    return false;
  }
}

type OllamaProbe = {
  ok: boolean;
  className: string;
  message: string;
  remediation?: string;
};

function configuredOllamaModel(model: string): string {
  return model === "text-embedding-3-small"
    ? OLLAMA_DEFAULT_EMBEDDING_MODEL
    : model;
}

function ollamaEndpoint(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/api/embed`;
}

function ollamaChatEndpoint(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/chat/completions`;
}

function probeOllamaEmbedding(
  baseUrl: string,
  model: string,
  timeoutMs: string,
): OllamaProbe {
  if (!isLoopbackUrl(baseUrl))
    return {
      ok: false,
      className: "memory.ollama_non_loopback",
      message:
        "Ollama memory embeddings are configured with a non-loopback base URL; value content is not printed.",
      remediation:
        "Set MEMORY_EMBEDDING_BASE_URL=http://127.0.0.1:11434 or leave it unset for the local default.",
    };
  const timeoutSeconds = Math.max(
    1,
    Math.ceil(Number.parseInt(timeoutMs, 10) / 1000) || 8,
  ).toString();
  try {
    const output = execFileSync(
      "curl",
      [
        "-sS",
        "--max-time",
        timeoutSeconds,
        "-X",
        "POST",
        ollamaEndpoint(baseUrl),
        "-H",
        "content-type: application/json",
        "--data",
        JSON.stringify({ model, input: "memory readiness probe" }),
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
    const parsed = JSON.parse(output) as {
      embeddings?: unknown[];
      embedding?: unknown;
      error?: unknown;
    };
    const vector = parsed.embeddings?.[0] ?? parsed.embedding;
    if (
      Array.isArray(vector) &&
      vector.length > 0 &&
      vector.every(
        (value) => typeof value === "number" && Number.isFinite(value),
      )
    )
      return {
        ok: true,
        className: "memory.ollama_ready",
        message: `Ollama embedding model ${model} returned a valid local vector; vector content is not printed.`,
      };
    const error = typeof parsed.error === "string" ? parsed.error : "";
    if (error.toLowerCase().includes("not found"))
      return {
        ok: false,
        className: "memory.ollama_model_missing",
        message: `Ollama embedding model ${model} is not available locally.`,
        remediation: `Run ollama pull ${model}, then rerun npm run doctor.`,
      };
    return {
      ok: false,
      className: "memory.ollama_invalid_embedding",
      message: `Ollama embedding model ${model} did not return a valid embedding vector; vector content is not printed.`,
      remediation:
        "Confirm the configured model supports embeddings, or set MEMORY_EMBEDDING_MODEL=nomic-embed-text.",
    };
  } catch {
    return {
      ok: false,
      className: "memory.ollama_unavailable",
      message:
        "Ollama embedding probe could not reach the local daemon or timed out.",
      remediation:
        "Start Ollama on the local machine, verify http://127.0.0.1:11434 is reachable, and rerun npm run doctor.",
    };
  }
}

function probeOllamaChat(
  baseUrl: string,
  model: string,
  timeoutMs: string,
): OllamaProbe {
  if (!isLoopbackAiBaseUrl(baseUrl))
    return {
      ok: false,
      className: "provider.ollama_non_loopback",
      message:
        "Ollama chat is configured with a non-loopback base URL; value content is not printed.",
      remediation:
        "Set OLLAMA_BASE_URL=http://127.0.0.1:11434/v1 or leave it unset for the local default.",
    };
  const timeoutSeconds = Math.max(
    1,
    Math.ceil(Number.parseInt(timeoutMs, 10) / 1000) || 8,
  ).toString();
  try {
    const output = execFileSync(
      "curl",
      [
        "-sS",
        "--max-time",
        timeoutSeconds,
        "-X",
        "POST",
        ollamaChatEndpoint(baseUrl),
        "-H",
        "content-type: application/json",
        "--data",
        JSON.stringify({
          model,
          messages: [{ role: "user", content: "doctor readiness probe" }],
          max_tokens: 1,
          stream: false,
        }),
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
    const parsed = JSON.parse(output) as {
      choices?: Array<{ message?: { content?: unknown } }>;
      error?: unknown;
    };
    if (typeof parsed.choices?.[0]?.message?.content === "string")
      return {
        ok: true,
        className: "provider.ollama_chat_ready",
        message: `Ollama chat model ${model} answered a local readiness probe; response content is not printed.`,
      };
    const error = typeof parsed.error === "string" ? parsed.error : "";
    if (error.toLowerCase().includes("not found"))
      return {
        ok: false,
        className: "provider.ollama_model_missing",
        message: `Ollama chat model ${model} is not available locally.`,
        remediation: `Run ollama pull ${model}, then rerun npm run doctor.`,
      };
    return {
      ok: false,
      className: "provider.ollama_invalid_response",
      message:
        "Ollama chat readiness probe returned an invalid OpenAI-compatible response; response content is not printed.",
      remediation:
        "Confirm OLLAMA_BASE_URL points at the /v1 OpenAI-compatible endpoint and the configured model supports chat.",
    };
  } catch {
    return {
      ok: false,
      className: "provider.ollama_unavailable",
      message:
        "Ollama chat probe could not reach the local daemon or timed out.",
      remediation:
        "Start Ollama on the local machine, verify http://127.0.0.1:11434/v1 is reachable, and rerun npm run doctor.",
    };
  }
}

function databaseFacts(databasePath: string): Record<string, unknown> {
  if (!existsSync(databasePath)) return { configured: true, exists: false };
  try {
    const db = new Database(databasePath, {
      readonly: true,
      fileMustExist: true,
    });
    const facts = {
      configured: true,
      exists: true,
      schemaVersion: currentSchemaVersion(db),
      latestSchemaVersion: LATEST_SCHEMA_VERSION,
      integrity: runIntegrityCheck(db),
    };
    db.close();
    return facts;
  } catch (error) {
    return {
      configured: true,
      exists: true,
      errorClass: "database.unreadable",
      error: error instanceof Error ? error.message : "unreadable database",
    };
  }
}

export function runDoctor(
  input: Record<string, string | undefined> = process.env,
): DoctorReport {
  const checks: DoctorCheck[] = [];
  const nodeVersion = process.version;
  const npmVersion = commandVersion("npm");
  const pythonVersion = commandVersion("python3");
  const uvxVersion = commandVersion("uvx", ["--version"]);

  if (parseMajor(nodeVersion) >= 22) {
    check(
      checks,
      "pass",
      "runtime.node",
      "runtime.supported",
      `Node ${nodeVersion} is supported.`,
    );
  } else {
    check(
      checks,
      "fail",
      "runtime.node",
      "runtime.unsupported_node",
      `Node ${nodeVersion} is below the supported source-beta minimum of 22.x.`,
      "Install Node 22 or newer before running the app.",
    );
  }

  const platformSupported =
    process.platform === "darwin" || process.platform === "linux";
  check(
    checks,
    platformSupported ? "pass" : "warn",
    "runtime.platform",
    platformSupported
      ? "runtime.supported_platform"
      : "runtime.unsupported_platform",
    `${process.platform}/${process.arch} detected; macOS Apple Silicon is primary and Ubuntu x64 is secondary for source beta.`,
    platformSupported
      ? undefined
      : "Use macOS Apple Silicon or Ubuntu LTS for supported clean-machine validation.",
  );

  let env = getOptionalEnv(input);
  let envError: string | null = null;
  try {
    env = getOptionalEnv(input);
  } catch (error) {
    envError =
      error instanceof z.ZodError
        ? error.issues.map((i) => i.path.join(".")).join(", ")
        : String(error);
  }

  if (envError) {
    check(
      checks,
      "fail",
      "config.env_parse",
      "config.invalid_env",
      `Environment could not be parsed: ${envError}.`,
      "Copy .env.example to .env.local and correct URL/date/provider values.",
    );
  }

  const requiredPresence = [
    ["GARMIN_HISTORY_START_DATE", env.GARMIN_HISTORY_START_DATE],
  ] as const;
  for (const [name, value] of requiredPresence) {
    check(
      checks,
      value ? "pass" : "fail",
      `config.${name.toLowerCase()}`,
      value ? "config.present" : "config.missing_required",
      `${name} ${value ? "is present" : "is missing"}; value content is not printed.`,
      value ? undefined : `Set ${name} in .env.local before local startup.`,
    );
  }

  const provider = aiProviderStatus(env);
  const providerKeyPresent = Boolean(provider.selected);
  check(
    checks,
    providerKeyPresent ? "pass" : "fail",
    "provider.key",
    providerKeyPresent
      ? "provider.configured"
      : (provider.failureClass ?? "provider.missing_key"),
    providerKeyPresent
      ? `AI provider ${provider.selected}/${provider.modelName} is selected by ${provider.selectionMode} configuration; provider configuration values are not printed.`
      : `No usable AI provider configuration is available for ${provider.requested}; missing and placeholder key values are treated as absent.`,
    providerKeyPresent ? undefined : provider.remediation,
  );

  if (provider.selected === "ollama") {
    const probe = probeOllamaChat(
      env.OLLAMA_BASE_URL,
      env.OLLAMA_MODEL,
      env.MEMORY_TIMEOUT_MS,
    );
    check(
      checks,
      probe.ok ? "pass" : "fail",
      "provider.ollama_chat",
      probe.className,
      probe.message,
      probe.remediation,
    );
  }

  const memoryEnabled = ["1", "true", "yes", "on"].includes(
    env.MEMORY_ENABLED.toLowerCase(),
  );
  const memoryEmbeddingModel =
    env.MEMORY_EMBEDDING_PROVIDER === "ollama"
      ? configuredOllamaModel(env.MEMORY_EMBEDDING_MODEL)
      : env.MEMORY_EMBEDDING_MODEL;
  const memoryEmbeddingConfigured =
    env.MEMORY_EMBEDDING_PROVIDER === "deterministic" ||
    (env.MEMORY_EMBEDDING_PROVIDER === "openai" &&
      hasConfiguredSecret(env.OPENAI_API_KEY)) ||
    env.MEMORY_EMBEDDING_PROVIDER === "ollama";
  if (memoryEnabled && env.MEMORY_EMBEDDING_PROVIDER === "ollama") {
    const probe = probeOllamaEmbedding(
      env.MEMORY_EMBEDDING_BASE_URL?.trim() || OLLAMA_DEFAULT_BASE_URL,
      memoryEmbeddingModel,
      env.MEMORY_TIMEOUT_MS,
    );
    check(
      checks,
      probe.ok ? "pass" : "fail",
      "memory.embedding",
      probe.className,
      probe.message,
      probe.remediation,
    );
  } else {
    check(
      checks,
      !memoryEnabled || memoryEmbeddingConfigured ? "pass" : "fail",
      "memory.embedding",
      !memoryEnabled || memoryEmbeddingConfigured
        ? "memory.embedding_configured_or_disabled"
        : "memory.embedding_missing_openai_key",
      memoryEnabled
        ? `Embedded SQLite memory embedding provider ${env.MEMORY_EMBEDDING_PROVIDER}/${memoryEmbeddingModel} ${memoryEmbeddingConfigured ? "is configured" : "is missing a valid OpenAI key or deterministic mode"}; key value is not printed.`
        : "Embedded SQLite memory is disabled; embedding key is not required.",
      !memoryEnabled || memoryEmbeddingConfigured
        ? undefined
        : "Set a valid OPENAI_API_KEY, MEMORY_EMBEDDING_PROVIDER=ollama with a local embedding model, or MEMORY_EMBEDDING_PROVIDER=deterministic before enabling memory; DeepSeek chat does not imply embeddings.",
    );
  }
  check(
    checks,
    "pass",
    "memory.vector",
    "memory.sqlite_embedded",
    memoryEnabled
      ? "Semantic memory vectors persist in the app-owned SQLite database; no hosted/vector sidecar service is configured."
      : "Semantic memory is disabled; embedded SQLite vector storage will be used when enabled.",
  );

  const token = inspectTokenLocation(env.GARMIN_MCP_TOKEN_DIR);
  check(
    checks,
    token.ok ? "pass" : "fail",
    "garmin.auth_state",
    token.className,
    token.detail,
    token.ok
      ? undefined
      : "Repair GARMIN_MCP_TOKEN_DIR and verify existing credentials separately. Only if authentication is needed, use npm run garmin:auth in a private terminal; never paste credentials into the app.",
  );

  const argsPinned = env.GARMIN_MCP_ARGS.includes(GARMIN_MCP_COMMIT);
  check(
    checks,
    argsPinned ? "pass" : "fail",
    "garmin.pin",
    argsPinned ? "garmin.connector_pinned" : "garmin.connector_unpinned",
    `Garmin MCP connector pin ${argsPinned ? "matches" : "does not match"} reviewed commit ${GARMIN_MCP_COMMIT}.`,
    argsPinned
      ? undefined
      : "Use the pinned Taxuspt/garmin_mcp commit from .env.example.",
  );

  const rawSdkConstraint = garminMcpSdkConstraintStatus(env.GARMIN_MCP_ARGS);
  const effectiveMcpArgs = garminMcpArgs(env.GARMIN_MCP_ARGS);
  const effectiveSdkConstraint = garminMcpSdkConstraintStatus(effectiveMcpArgs);
  const sdkConstraintOk = effectiveSdkConstraint === "exact";
  check(
    checks,
    !sdkConstraintOk ? "fail" : rawSdkConstraint === "exact" ? "pass" : "warn",
    "garmin.mcp_sdk",
    sdkConstraintOk
      ? rawSdkConstraint === "exact"
        ? "garmin.mcp_sdk_pinned"
        : "garmin.mcp_sdk_injected"
      : "garmin.mcp_sdk_incompatible",
    sdkConstraintOk
      ? rawSdkConstraint === "exact"
        ? `Garmin MCP SDK requirement ${GARMIN_MCP_SDK_REQUIREMENT} is configured explicitly.`
        : `GARMIN_MCP_ARGS omits an explicit MCP SDK requirement; runtime will add ${GARMIN_MCP_SDK_REQUIREMENT} for the reviewed connector.`
      : `GARMIN_MCP_ARGS does not produce the required ${GARMIN_MCP_SDK_REQUIREMENT} constraint; value content is not printed.`,
    sdkConstraintOk
      ? rawSdkConstraint === "exact"
        ? undefined
        : `Update .env.local to match .env.example so the MCP SDK requirement is explicit: ${GARMIN_MCP_SDK_REQUIREMENT}.`
      : `Use the .env.example Garmin MCP args with ${GARMIN_MCP_SDK_REQUIREMENT}; MCP 2.x is incompatible with the pinned connector import path.`,
  );

  const loopback = loopbackHost(env.NEXT_PUBLIC_APP_URL);
  check(
    checks,
    loopback ? "pass" : "fail",
    "network.loopback",
    loopback ? "network.loopback_only" : "network.unsupported_exposure",
    `Configured app URL is ${loopback ? "loopback/local" : "not loopback"}; LAN/public exposure is unsupported.`,
    loopback
      ? undefined
      : "Set NEXT_PUBLIC_APP_URL to http://localhost:3000 and run npm run start:local.",
  );

  const dbFacts = databaseFacts(env.DATABASE_PATH);
  const dbIntegrity = dbFacts.integrity;
  check(
    checks,
    dbIntegrity === "ok" || dbFacts.exists === false ? "pass" : "fail",
    "database.integrity",
    dbIntegrity === "ok" || dbFacts.exists === false
      ? "database.ready_or_new"
      : "database.integrity_failed",
    dbFacts.exists === false
      ? "SQLite database does not exist yet; migration will create it."
      : `SQLite schema version ${dbFacts.schemaVersion ?? "unknown"}/${LATEST_SCHEMA_VERSION}; integrity ${dbIntegrity ?? "unknown"}.`,
    dbIntegrity === "ok" || dbFacts.exists === false
      ? undefined
      : "Stop the app, restore from a known-good backup, and rerun npm run db:migrate.",
  );

  const facts = redactDiagnosticValue({
    nodeVersion,
    npmVersion: npmVersion ?? "missing",
    pythonVersion: pythonVersion ?? "missing",
    uvxVersion: uvxVersion ?? "missing",
    platform: process.platform,
    arch: process.arch,
    appUrlLoopback: loopback,
    database: dbFacts,
    garmin: {
      connectorCommit: GARMIN_MCP_COMMIT,
      mcpSdkRequirement: GARMIN_MCP_SDK_REQUIREMENT,
      configuredMcpSdkConstraint: rawSdkConstraint,
      effectiveMcpSdkConstraint: effectiveSdkConstraint,
      effectiveMcpArgCount: effectiveMcpArgs.length,
      configuredTokenDirPresent: token.ok,
      defaultTokenFilePresent: false,
      stdioOnly: true,
      httpTransportSupported: false,
    },
    provider: {
      requested: provider.requested,
      selected: provider.selected ?? "none",
      selectionMode: provider.selectionMode ?? "none",
      model: provider.modelName ?? "none",
      keyPresent: providerKeyPresent,
      deepseekKeyPresent: provider.deepseekKeyConfigured,
      openaiKeyPresent: provider.openaiKeyConfigured,
      ollamaBaseUrlLoopback: provider.ollamaBaseUrlLoopback,
    },
    memory: {
      enabled: memoryEnabled,
      provider: "app-sqlite-vector",
      vectorProvider: "sqlite",
      embeddingProvider: env.MEMORY_EMBEDDING_PROVIDER,
      embeddingConfigured: memoryEmbeddingConfigured,
      embeddingModel: memoryEmbeddingModel,
      ollamaBaseUrlLoopback:
        env.MEMORY_EMBEDDING_PROVIDER === "ollama"
          ? isLoopbackUrl(
              env.MEMORY_EMBEDDING_BASE_URL?.trim() || OLLAMA_DEFAULT_BASE_URL,
            )
          : undefined,
    },
  }) as Record<string, unknown>;

  return {
    ok: checks.every((item) => item.status !== "fail"),
    generatedAt: new Date().toISOString(),
    contractVersion: 1,
    supportedBoundary:
      "local MCP-only source beta; macOS Apple Silicon primary, Ubuntu LTS secondary; LAN/public exposure unsupported",
    facts,
    checks,
  };
}

export function formatDoctorReport(report: DoctorReport): string {
  return [
    `Source-beta doctor: ${report.ok ? "PASS" : "FAIL"}`,
    `Boundary: ${report.supportedBoundary}`,
    ...report.checks.map(
      (item) =>
        `${item.status.toUpperCase()} ${item.id} [${item.className}]: ${item.message}${item.remediation ? ` Remediation: ${item.remediation}` : ""}`,
    ),
  ].join("\n");
}
