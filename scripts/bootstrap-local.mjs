#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  statSync,
} from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);
const DEFAULT_OLLAMA_URL = "http://127.0.0.1:11434";
const DEFAULT_OLLAMA_MODEL = "nomic-embed-text";
const DEFAULT_APP_URL = "http://127.0.0.1:3000";

export class BootstrapError extends Error {
  constructor(message, { remediation, code = 1 } = {}) {
    super(message);
    this.name = "BootstrapError";
    this.remediation = remediation;
    this.code = code;
  }
}

export function parseDotEnv(text) {
  const values = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const equals = line.indexOf("=");
    if (equals <= 0) continue;
    const key = line.slice(0, equals).trim();
    let value = line.slice(equals + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

export function loadLocalEnv(cwd, baseEnv = process.env) {
  const fileEnv = existsSync(join(cwd, ".env.local"))
    ? parseDotEnv(readFileSync(join(cwd, ".env.local"), "utf8"))
    : {};
  return { ...fileEnv, ...baseEnv };
}

export function isTruthy(value) {
  return TRUE_VALUES.has(
    String(value ?? "")
      .trim()
      .toLowerCase(),
  );
}

export function isLoopbackUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    return (
      ["http:", "https:"].includes(parsed.protocol) &&
      ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)
    );
  } catch {
    return false;
  }
}

export function configuredMemory(env, { memoryUserDisabled = false } = {}) {
  const configuredEnabled = isTruthy(env.MEMORY_ENABLED ?? "false");
  const embeddingProvider = env.MEMORY_EMBEDDING_PROVIDER ?? "openai";
  const defaultModel =
    embeddingProvider === "ollama"
      ? DEFAULT_OLLAMA_MODEL
      : "text-embedding-3-small";
  const rawModel = env.MEMORY_EMBEDDING_MODEL ?? defaultModel;
  const embeddingModel =
    embeddingProvider === "ollama" && rawModel === "text-embedding-3-small"
      ? DEFAULT_OLLAMA_MODEL
      : rawModel;
  return {
    configuredEnabled,
    userDisabled: memoryUserDisabled,
    effectiveEnabled: configuredEnabled && !memoryUserDisabled,
    embeddingProvider,
    embeddingModel,
    embeddingBaseUrl:
      embeddingProvider === "ollama"
        ? env.MEMORY_EMBEDDING_BASE_URL || DEFAULT_OLLAMA_URL
        : env.MEMORY_EMBEDDING_BASE_URL,
    timeoutMs: positiveInteger(env.MEMORY_TIMEOUT_MS, 8000),
  };
}

export function normalizeOllamaName(name) {
  return name.includes(":") ? name : `${name}:latest`;
}

export function modelInstalled(model, installedNames) {
  const normalized = normalizeOllamaName(model);
  return installedNames.some(
    (name) =>
      name === model ||
      name === normalized ||
      normalizeOllamaName(name) === normalized,
  );
}

export function dependencyPreparationDecision({
  nodeModulesPresent,
  nodeModulesMtimeMs,
  lockfileMtimeMs,
  packageMtimeMs,
}) {
  if (!nodeModulesPresent) return "install";
  return nodeModulesMtimeMs < Math.max(lockfileMtimeMs, packageMtimeMs)
    ? "install"
    : "skip";
}

export function databaseMigrationDecision(status) {
  if (!status.ok) return "fail";
  return status.needsMigration ? "migrate" : "skip";
}

export function ollamaReadinessPlan({
  memory,
  daemonReady,
  cliAvailable,
  installedModels,
}) {
  if (!memory.effectiveEnabled)
    return { action: "skip", reason: "memory disabled" };
  if (memory.embeddingProvider !== "ollama")
    return { action: "skip", reason: "non-Ollama memory provider" };
  if (!isLoopbackUrl(memory.embeddingBaseUrl))
    return { action: "fail", reason: "non-loopback Ollama URL" };
  if (!daemonReady && !cliAvailable)
    return { action: "fail", reason: "missing Ollama CLI" };
  const pull = !modelInstalled(memory.embeddingModel, installedModels);
  if (pull && !cliAvailable)
    return { action: "fail", reason: "missing Ollama CLI for model pull" };
  return {
    action: daemonReady ? "reuse" : "start",
    model: memory.embeddingModel,
    pull,
  };
}

export function appListenerDecision({ appReady: ready, portFree }) {
  if (ready) return "reuse";
  return portFree ? "start" : "fail-conflict";
}

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function stage(name, message) {
  console.log(`\n==> ${name}: ${message}`);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env,
    encoding: "utf8",
    stdio: options.stdio ?? ["ignore", "pipe", "pipe"],
  });
  if (result.error) {
    throw new BootstrapError(
      `${command} ${args.join(" ")} failed to start: ${result.error.message}`,
    );
  }
  if (result.status !== 0) {
    const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`
      .split(/\r?\n/)
      .filter(Boolean)
      .slice(-20)
      .join("\n");
    throw new BootstrapError(
      `${command} ${args.join(" ")} exited ${result.status}.${output ? `\n${output}` : ""}`,
    );
  }
  return result.stdout ?? "";
}

function commandExists(command) {
  const result = spawnSync(command, ["--version"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    timeout: 5000,
  });
  return !result.error && result.status === 0;
}

function nodeMajor() {
  return Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10);
}

export function prerequisites({ cwd = process.cwd(), env = process.env } = {}) {
  if (nodeMajor() < 22) {
    throw new BootstrapError(
      `Node ${process.version} is below the supported 22.x minimum.`,
      {
        remediation:
          "Install Node 22 or newer, then rerun npm run bootstrap:local.",
      },
    );
  }
  if (!commandExists("npm")) {
    throw new BootstrapError("npm is required but was not found.", {
      remediation:
        "Install Node 22 with npm; this command will not install system software.",
    });
  }
  if (!["darwin", "linux"].includes(process.platform)) {
    throw new BootstrapError(
      `${process.platform}/${process.arch} is outside the supported local source-beta platform boundary.`,
      {
        remediation:
          "Use macOS Apple Silicon or Ubuntu LTS for this local bootstrap path.",
      },
    );
  }
  if (!existsSync(join(cwd, "package-lock.json"))) {
    throw new BootstrapError(
      "package-lock.json is required for reproducible local dependency preparation.",
    );
  }
  const appUrl = env.NEXT_PUBLIC_APP_URL || DEFAULT_APP_URL;
  if (!isLoopbackUrl(appUrl)) {
    throw new BootstrapError(
      "NEXT_PUBLIC_APP_URL must be loopback/local; value content is not printed.",
      {
        remediation:
          "Set NEXT_PUBLIC_APP_URL=http://localhost:3000 or http://127.0.0.1:3000.",
      },
    );
  }
}

export function ensureDependencies({
  cwd = process.cwd(),
  env = process.env,
} = {}) {
  const nodeModules = join(cwd, "node_modules");
  const lockfile = join(cwd, "package-lock.json");
  const packageJson = join(cwd, "package.json");
  const decision = dependencyPreparationDecision({
    nodeModulesPresent: existsSync(nodeModules),
    nodeModulesMtimeMs: existsSync(nodeModules)
      ? statSync(nodeModules).mtimeMs
      : 0,
    lockfileMtimeMs: statSync(lockfile).mtimeMs,
    packageMtimeMs: statSync(packageJson).mtimeMs,
  });
  if (decision === "skip") return "current";
  run("npm", ["ci"], { cwd, env, stdio: "inherit" });
  return "installed";
}

export function readJsonCommand(command, args, options = {}) {
  const output = run(command, args, options);
  return JSON.parse(output);
}

export function databaseStatus({
  cwd = process.cwd(),
  env = process.env,
} = {}) {
  return readJsonCommand(
    "npm",
    ["--silent", "run", "db:status", "--", "--json"],
    {
      cwd,
      env,
    },
  );
}

export function ensureDatabase({
  cwd = process.cwd(),
  env = process.env,
} = {}) {
  const status = databaseStatus({ cwd, env });
  const decision = databaseMigrationDecision(status);
  if (decision === "fail") {
    throw new BootstrapError(
      "SQLite database status check failed before migration.",
      {
        remediation:
          "Review npm run db:status -- --json locally; do not share paths or data unless reviewed.",
      },
    );
  }
  if (decision === "skip") return status;
  run("npm", ["run", "db:migrate"], { cwd, env, stdio: "inherit" });
  return databaseStatus({ cwd, env });
}

async function fetchJson(
  url,
  { timeoutMs = 3000, method = "GET", body, signal } = {},
) {
  const requestSignal = AbortSignal.timeout(timeoutMs);
  const response = await fetch(url, {
    method,
    body,
    headers: body ? { "content-type": "application/json" } : undefined,
    redirect: "error",
    signal: signal ? AbortSignal.any([signal, requestSignal]) : requestSignal,
  });
  const text = await response.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  return { ok: response.ok, status: response.status, text, json: parsed };
}

function trimUrl(url) {
  return url.replace(/\/+$/, "");
}

export async function ollamaApiModels(baseUrl, timeoutMs = 3000, signal) {
  try {
    const response = await fetchJson(`${trimUrl(baseUrl)}/api/tags`, {
      timeoutMs,
      signal,
    });
    if (!response.ok || !Array.isArray(response.json?.models)) return null;
    return response.json.models
      .map((model) => model?.name ?? model?.model)
      .filter((name) => typeof name === "string" && name.length > 0);
  } catch {
    return null;
  }
}

export async function ollamaApiReady(baseUrl, timeoutMs = 3000, signal) {
  return (await ollamaApiModels(baseUrl, timeoutMs, signal)) !== null;
}

async function waitFor(check, { timeoutMs, intervalMs = 500, signal }) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    signal?.throwIfAborted();
    if (await check()) return true;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return false;
}

function startOwnedProcess(command, args, { cwd, env, name }) {
  const child = spawn(command, args, {
    cwd,
    env,
    stdio: ["ignore", "ignore", "pipe"],
  });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    const lines = String(chunk).split(/\r?\n/).filter(Boolean).slice(-3);
    for (const line of lines) console.error(`[${name}] ${line.slice(0, 220)}`);
  });
  return child;
}

export function installedOllamaModels() {
  const output = run("ollama", ["list"]);
  return output
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.trim().split(/\s+/)[0])
    .filter(Boolean);
}

export async function proveEmbedding(baseUrl, model, timeoutMs, signal) {
  const response = await fetchJson(`${trimUrl(baseUrl)}/api/embed`, {
    timeoutMs,
    signal,
    method: "POST",
    body: JSON.stringify({ model, input: "memory readiness probe" }),
  });
  const vector = response.json?.embeddings?.[0] ?? response.json?.embedding;
  if (
    response.ok &&
    !response.json?.error &&
    Array.isArray(vector) &&
    vector.length > 0 &&
    vector.every((value) => typeof value === "number" && Number.isFinite(value))
  ) {
    return;
  }
  throw new BootstrapError(
    `Ollama embedding probe failed (HTTP ${response.status}; expected a nonempty finite numeric vector).`,
    {
      remediation:
        "Confirm MEMORY_EMBEDDING_MODEL is an embedding model and retry bootstrap:local or restart:local.",
    },
  );
}

// API and CLI must prepare exactly the same loopback endpoint. Inherited
// OLLAMA_HOST is deliberately replaced, never used to expose a LAN listener.
export function ollamaCommandEnv(env, baseUrl) {
  const url = new URL(baseUrl);
  if (
    !isLoopbackUrl(baseUrl) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new BootstrapError(
      "Ollama requires a plain loopback origin (no credentials, path, query or fragment).",
      {
        remediation:
          "Set MEMORY_EMBEDDING_BASE_URL=http://127.0.0.1:11434 or leave it unset.",
      },
    );
  }
  return { ...env, OLLAMA_HOST: url.origin };
}

function startPersistentOllama({ cwd, env }) {
  mkdirSync(join(cwd, "logs"), { recursive: true });
  const log = openSync(join(cwd, "logs", "ollama.log"), "a", 0o600);
  try {
    const child = spawn("ollama", ["serve"], {
      cwd,
      env,
      detached: true,
      stdio: ["ignore", log, log],
    });
    child.unref();
    return child;
  } finally {
    closeSync(log);
  }
}

async function pullOllamaModel(model, { cwd, env, signal }) {
  signal?.throwIfAborted();
  await new Promise((resolve, reject) => {
    // Visible CLI progress, bounded at 15 minutes; never shell-interpolate models.
    const child = spawn("ollama", ["pull", model], {
      cwd,
      env,
      stdio: "inherit",
      signal,
      timeout: 15 * 60 * 1000,
      killSignal: "SIGKILL",
    });
    child.once("error", () =>
      reject(
        new BootstrapError(
          "Ollama model pull could not start or was cancelled.",
        ),
      ),
    );
    child.once("exit", (code) =>
      code === 0
        ? resolve()
        : reject(
            new BootstrapError("Ollama model pull failed or timed out.", {
              remediation:
                "Check local network/disk and retry the configured model pull; no app was launched.",
            }),
          ),
    );
  });
}

export async function ensureOllama({
  cwd = process.cwd(),
  env = process.env,
  memory,
  owned = {},
  lifetime = "session",
  signal,
}) {
  if (!memory.effectiveEnabled)
    return { action: "skip", reason: "memory disabled" };
  if (memory.embeddingProvider !== "ollama")
    return { action: "skip", reason: "non-Ollama memory provider" };
  if (!isLoopbackUrl(memory.embeddingBaseUrl)) {
    throw new BootstrapError(
      "Ollama memory embeddings require a loopback base URL; value content is not printed.",
      {
        remediation:
          "Set MEMORY_EMBEDDING_BASE_URL=http://127.0.0.1:11434 or leave it unset.",
      },
    );
  }

  if (!["session", "persistent"].includes(lifetime)) {
    throw new BootstrapError("Unsupported Ollama process lifetime.");
  }
  const commandEnv = ollamaCommandEnv(env, memory.embeddingBaseUrl);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/.test(memory.embeddingModel)) {
    throw new BootstrapError("Invalid configured Ollama model name.", {
      remediation:
        "Set MEMORY_EMBEDDING_MODEL to an Ollama embedding model name.",
    });
  }
  signal?.throwIfAborted();
  let child;
  let started = false;
  const daemonReady = await ollamaApiReady(
    memory.embeddingBaseUrl,
    Math.min(memory.timeoutMs, 3000),
    signal,
  );
  const cliAvailable = commandExists("ollama");
  const preliminaryPlan = ollamaReadinessPlan({
    memory,
    daemonReady,
    cliAvailable,
    installedModels: [memory.embeddingModel],
  });
  if (preliminaryPlan.action === "fail") {
    throw new BootstrapError(
      preliminaryPlan.reason === "missing Ollama CLI"
        ? "Ollama CLI is required because the configured local daemon is not reachable."
        : "Ollama memory embeddings require a loopback base URL; value content is not printed.",
      {
        remediation:
          preliminaryPlan.reason === "missing Ollama CLI"
            ? "Install Ollama manually, then retry bootstrap:local or restart:local. This command will not install system software."
            : "Set MEMORY_EMBEDDING_BASE_URL=http://127.0.0.1:11434 or leave it unset.",
      },
    );
  }
  try {
    signal?.throwIfAborted();
    // A concurrent restart may have won while the CLI check was running.
    if (
      !daemonReady &&
      !(await ollamaApiReady(memory.embeddingBaseUrl, 1000, signal))
    ) {
      if (new URL(memory.embeddingBaseUrl).protocol !== "http:") {
        throw new BootstrapError(
          "Cannot start an HTTPS Ollama daemon automatically.",
          {
            remediation:
              "Start the configured TLS endpoint manually or use a loopback HTTP origin.",
          },
        );
      }
      console.log(
        lifetime === "persistent"
          ? "Starting persistent local Ollama daemon (logs/ollama.log); retained after successful preparation."
          : "Starting local Ollama daemon for this bootstrap session.",
      );
      child =
        lifetime === "persistent"
          ? startPersistentOllama({ cwd, env: commandEnv })
          : startOwnedProcess("ollama", ["serve"], {
              cwd,
              env: commandEnv,
              name: "ollama",
            });
      owned.ollama = child;
      let spawnFailed = false;
      child.once("error", () => {
        spawnFailed = true;
      });
      started = true;
      const ready = await waitFor(
        async () => {
          // Check the endpoint first: never kill a winner launched elsewhere.
          if (await ollamaApiReady(memory.embeddingBaseUrl, 1000, signal))
            return true;
          if (spawnFailed || child.exitCode !== null) {
            throw new BootstrapError("Ollama daemon failed to start.", {
              remediation:
                "Check the installed CLI, configured endpoint and local daemon log, then retry.",
            });
          }
          return false;
        },
        { timeoutMs: Math.max(memory.timeoutMs, 15000), signal },
      );
      if (!ready)
        throw new BootstrapError(
          "Ollama daemon did not become ready before the readiness deadline.",
          {
            remediation:
              "Check the configured loopback endpoint and local daemon log; start ollama serve manually if necessary.",
          },
        );
    }

    const models = await ollamaApiModels(
      memory.embeddingBaseUrl,
      Math.min(memory.timeoutMs, 3000),
      signal,
    );
    if (models === null)
      throw new BootstrapError(
        "Ollama model listing became unavailable; retry after checking the local daemon.",
      );
    const finalPlan = ollamaReadinessPlan({
      memory,
      daemonReady: true,
      cliAvailable,
      installedModels: models,
    });
    if (finalPlan.action === "fail") {
      throw new BootstrapError(
        "Ollama CLI is required to pull the configured missing model.",
        {
          remediation:
            "Install Ollama manually or pull the configured model with an available local Ollama CLI.",
        },
      );
    }
    const pull = finalPlan.pull;
    if (pull) {
      console.log(
        `Pulling configured Ollama embedding model ${memory.embeddingModel}; this may use the network and Ollama's normal progress output.`,
      );
      await pullOllamaModel(memory.embeddingModel, {
        cwd,
        env: commandEnv,
        signal,
      });
    }
    await proveEmbedding(
      memory.embeddingBaseUrl,
      memory.embeddingModel,
      memory.timeoutMs,
      signal,
    );
    signal?.throwIfAborted();
    // Transfer ownership only after a real embedding succeeds. Failed/cancelled
    // preparation stops only our child; later app build/start failures retain it.
    if (lifetime === "persistent" && child) delete owned.ollama;
    return {
      action: started ? "start" : "reuse",
      model: memory.embeddingModel,
      pull,
    };
  } catch (error) {
    if (child && child.exitCode === null && !child.killed)
      child.kill("SIGTERM");
    if (owned.ollama === child) delete owned.ollama;
    if (error instanceof BootstrapError) throw error;
    throw new BootstrapError("Ollama readiness failed or was cancelled.", {
      remediation:
        "Check the configured loopback daemon/model and MEMORY_TIMEOUT_MS, then retry.",
    });
  }
}

function parsePort(url) {
  try {
    return Number(
      new URL(url).port || (new URL(url).protocol === "https:" ? 443 : 80),
    );
  } catch {
    return 3000;
  }
}

async function canBind(host, port) {
  return await new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => server.close(() => resolve(true)));
    server.listen(port, host);
  });
}

async function appReady(appUrl, timeoutMs = 3000) {
  try {
    const response = await fetchJson(appUrl, { timeoutMs });
    return Boolean(response.ok && response.text.includes("Garmin AI Trainer"));
  } catch {
    return false;
  }
}

export async function ensureApp({
  cwd = process.cwd(),
  env = process.env,
  owned,
}) {
  const appUrl = env.NEXT_PUBLIC_APP_URL || DEFAULT_APP_URL;
  const ready = await appReady(appUrl, 2000);
  const port = parsePort(appUrl);
  const portFree = ready ? false : await canBind("127.0.0.1", port);
  const decision = appListenerDecision({ appReady: ready, portFree });
  if (decision === "reuse") return { action: "reuse", url: appUrl };
  if (decision === "fail-conflict") {
    throw new BootstrapError(
      `Port ${port} is already in use by an unverified listener.`,
      {
        remediation:
          "Stop the conflicting process or verify it is the trainer before rerunning; the bootstrap will not kill unrelated processes.",
      },
    );
  }
  owned.app = spawn("npm", ["run", "start:local"], {
    cwd,
    env: { ...env, PORT: String(port) },
    stdio: "inherit",
  });
  const started = await waitFor(() => appReady(appUrl, 1000), {
    timeoutMs: 30000,
  });
  if (!started)
    throw new BootstrapError(
      "The local app did not become ready on loopback before the readiness deadline.",
    );
  return { action: "start", url: appUrl };
}

export function cleanup(owned) {
  for (const child of [owned.app, owned.ollama]) {
    if (child && !child.killed) child.kill("SIGTERM");
  }
}

async function waitForAppExit(owned) {
  if (!owned.app) return;
  await new Promise((resolve) => owned.app.once("exit", resolve));
}

export async function main({
  cwd = process.cwd(),
  env = process.env,
  args = process.argv.slice(2),
} = {}) {
  const prepareOnly = args.includes("--prepare-only");
  const localEnv = loadLocalEnv(cwd, env);
  const owned = {};
  const controller = new AbortController();
  const onSignal = (signal) => {
    console.log(`\nReceived ${signal}; stopping bootstrap-owned processes.`);
    controller.abort();
    cleanup(owned);
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);

  try {
    stage(
      "prerequisites",
      "checking local platform, Node/npm, lockfile, and loopback app URL",
    );
    prerequisites({ cwd, env: localEnv });

    stage("dependencies", "preparing locked Node dependencies when needed");
    const dependencyResult = ensureDependencies({ cwd, env: localEnv });
    console.log(`Dependencies: ${dependencyResult}.`);

    stage(
      "database",
      "checking schema before deciding whether migration is needed",
    );
    const db = ensureDatabase({ cwd, env: localEnv });
    console.log(
      `Database schema: ${db.schemaVersion}/${db.latestSchemaVersion}; migration ${db.needsMigration ? "ran" : "skipped"}; integrity ${db.integrity}.`,
    );

    const memory = configuredMemory(localEnv, {
      memoryUserDisabled: Boolean(db.memoryUserDisabled),
    });
    stage(
      "ollama",
      "ensuring configured loopback embedding daemon/model only when effective memory uses Ollama",
    );
    const ollama = await ensureOllama({
      cwd,
      env: localEnv,
      memory,
      owned,
      signal: controller.signal,
    });
    console.log(
      `Ollama: ${ollama.action}${ollama.model ? ` model=${ollama.model} pull=${ollama.pull}` : ` (${ollama.reason})`}.`,
    );

    stage("build", "building the production-local app");
    run("npm", ["run", "build"], { cwd, env: localEnv, stdio: "inherit" });

    stage("doctor", "running final redacted readiness diagnostics");
    run("npm", ["run", "doctor"], { cwd, env: localEnv, stdio: "inherit" });

    if (prepareOnly) {
      console.log(
        "Prepare-only requested; app start skipped after successful doctor gate.",
      );
      cleanup(owned);
      return 0;
    }

    stage("app", "starting or reusing the loopback production server");
    const app = await ensureApp({ cwd, env: localEnv, owned });
    console.log(
      `App ready: ${app.action} ${app.url}. Press Ctrl-C to stop bootstrap-owned processes.`,
    );
    await waitForAppExit(owned);
    cleanup(owned);
    return 0;
  } catch (error) {
    cleanup(owned);
    if (error instanceof BootstrapError) {
      console.error(`\nBootstrap failed: ${error.message}`);
      if (error.remediation) console.error(`Remediation: ${error.remediation}`);
      return error.code;
    }
    console.error(
      `\nBootstrap failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return 1;
  } finally {
    process.removeListener("SIGINT", onSignal);
    process.removeListener("SIGTERM", onSignal);
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main({
    cwd: process.cwd(),
    env: process.env,
    args: process.argv.slice(2),
  }).then((code) => {
    process.exitCode = code;
  });
}
