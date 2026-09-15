#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import {
  BootstrapError,
  configuredMemory,
  databaseStatus,
  ensureOllama,
  loadLocalEnv,
} from "./bootstrap-local.mjs";

export async function prepareRestart({
  cwd = process.cwd(),
  env = process.env,
  signal,
} = {}) {
  const localEnv = loadLocalEnv(cwd, env);
  let memory = configuredMemory(localEnv);
  if (memory.effectiveEnabled && memory.embeddingProvider === "ollama") {
    // Read-only status: no dependency install, DB creation or migration here.
    let status;
    try {
      status = databaseStatus({ cwd, env: localEnv });
    } catch {
      throw new BootstrapError(
        "Cannot read effective memory settings from SQLite.",
        {
          remediation:
            "Review npm run db:status -- --json locally; verify DATABASE_PATH and run bootstrap:local if setup is incomplete. Database details are not printed here.",
        },
      );
    }
    if (
      !status.ok ||
      status.needsMigration ||
      typeof status.memoryUserDisabled !== "boolean"
    ) {
      throw new BootstrapError(
        "SQLite is not ready for reading effective memory settings.",
        {
          remediation:
            "Review npm run db:status -- --json locally and complete bootstrap:local before repeat restart.",
        },
      );
    }
    memory = configuredMemory(localEnv, {
      memoryUserDisabled: status.memoryUserDisabled,
    });
  }
  const result = await ensureOllama({
    cwd,
    env: localEnv,
    memory,
    lifetime: "persistent",
    signal,
  });
  console.log(
    `Ollama: ${result.action}${result.model ? ` model=${result.model} pull=${result.pull}; embedding probe passed` : ` (${result.reason})`}.`,
  );
  return result;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.once("SIGINT", cancel);
  process.once("SIGTERM", cancel);
  try {
    await prepareRestart({ signal: controller.signal });
  } catch (error) {
    console.error(
      `Restart readiness failed: ${error instanceof BootstrapError ? error.message : "Unable to prepare local memory embeddings."}`,
    );
    console.error(
      `Remediation: ${error instanceof BootstrapError && error.remediation ? error.remediation : "Check local configuration and retry restart:local."}`,
    );
    process.exitCode = 1;
  } finally {
    process.removeListener("SIGINT", cancel);
    process.removeListener("SIGTERM", cancel);
  }
}
