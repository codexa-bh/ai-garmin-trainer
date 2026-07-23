import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { z } from "zod";
import { GARMIN_MCP_COMMIT } from "../garmin/client";
import {
  currentSchemaVersion,
  LATEST_SCHEMA_VERSION,
  runIntegrityCheck,
} from "../db/migrations";
import { getOptionalEnv } from "../env";
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

function tokenState(env: { GARMIN_MCP_TOKEN_DIR?: string }): {
  configuredTokenDirPresent: boolean;
  defaultTokenFilePresent: boolean;
} {
  const configuredTokenDirPresent = Boolean(
    env.GARMIN_MCP_TOKEN_DIR &&
    existsSync(env.GARMIN_MCP_TOKEN_DIR) &&
    readdirSync(env.GARMIN_MCP_TOKEN_DIR).length > 0,
  );
  const defaultTokenFilePresent = existsSync(
    join(process.env.HOME ?? "", ".garminconnect", "garmin_tokens.json"),
  );
  return { configuredTokenDirPresent, defaultTokenFilePresent };
}

function loopbackHost(rawUrl: string): boolean {
  try {
    const host = new URL(rawUrl).hostname;
    return ["localhost", "127.0.0.1", "::1"].includes(host);
  } catch {
    return false;
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

  const providerKeyPresent =
    env.AI_PROVIDER === "deepseek"
      ? Boolean(env.DEEPSEEK_API_KEY)
      : Boolean(env.OPENAI_API_KEY);
  check(
    checks,
    providerKeyPresent ? "pass" : "fail",
    "provider.key",
    providerKeyPresent ? "provider.configured" : "provider.missing_key",
    `${env.AI_PROVIDER} provider key ${providerKeyPresent ? "is configured" : "is missing"}; key value is not printed.`,
    providerKeyPresent
      ? undefined
      : `Set the BYO ${env.AI_PROVIDER} provider key in .env.local.`,
  );

  const memoryEnabled = ["1", "true", "yes", "on"].includes(
    env.MEMORY_ENABLED.toLowerCase(),
  );
  const memoryEmbeddingKeyPresent = Boolean(
    env.MEMORY_EMBEDDING_PROVIDER === "deterministic" ||
    env.MEMORY_EMBEDDING_API_KEY ||
    env.OPENAI_API_KEY,
  );
  check(
    checks,
    !memoryEnabled || memoryEmbeddingKeyPresent ? "pass" : "fail",
    "memory.embedding",
    !memoryEnabled || memoryEmbeddingKeyPresent
      ? "memory.embedding_configured_or_disabled"
      : "memory.embedding_missing_key",
    memoryEnabled
      ? `Embedded SQLite memory embedding provider ${env.MEMORY_EMBEDDING_PROVIDER}/${env.MEMORY_EMBEDDING_MODEL} ${memoryEmbeddingKeyPresent ? "is configured" : "is missing a key"}; key value is not printed.`
      : "Embedded SQLite memory is disabled; embedding key is not required.",
    !memoryEnabled || memoryEmbeddingKeyPresent
      ? undefined
      : "Set MEMORY_EMBEDDING_API_KEY or OPENAI_API_KEY before enabling memory; DeepSeek chat does not imply embeddings.",
  );
  check(
    checks,
    "pass",
    "memory.vector",
    "memory.sqlite_embedded",
    memoryEnabled
      ? "Semantic memory vectors persist in the app-owned SQLite database; no hosted/vector sidecar service is configured."
      : "Semantic memory is disabled; embedded SQLite vector storage will be used when enabled.",
  );

  const token = tokenState(env);
  check(
    checks,
    token.configuredTokenDirPresent || token.defaultTokenFilePresent
      ? "pass"
      : "fail",
    "garmin.auth_state",
    token.configuredTokenDirPresent || token.defaultTokenFilePresent
      ? "garmin.auth_state_present"
      : "garmin.auth_state_missing",
    token.configuredTokenDirPresent || token.defaultTokenFilePresent
      ? "Garmin auth state file presence was detected without reading token contents."
      : "No Garmin auth-state file presence detected; no token contents were read.",
    token.configuredTokenDirPresent || token.defaultTokenFilePresent
      ? undefined
      : "Run garmin-mcp-auth out of band and never paste Garmin credentials or token contents into the app.",
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
      configuredTokenDirPresent: token.configuredTokenDirPresent,
      defaultTokenFilePresent: token.defaultTokenFilePresent,
      stdioOnly: true,
      httpTransportSupported: false,
    },
    provider: {
      selected: env.AI_PROVIDER,
      keyPresent: providerKeyPresent,
    },
    memory: {
      enabled: memoryEnabled,
      provider: "app-sqlite-vector",
      vectorProvider: "sqlite",
      embeddingProvider: env.MEMORY_EMBEDDING_PROVIDER,
      embeddingKeyPresent: memoryEmbeddingKeyPresent,
      embeddingModel: env.MEMORY_EMBEDDING_MODEL,
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
