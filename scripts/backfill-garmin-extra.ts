// Explicit, separately authorized maintenance backfill of the additional Garmin
// evidence groups over a selected stopped database. Never startup, Settings
// discovery, migration or implicit replay. See docs/garmin-extra-backfill.md.
import { createHash } from "node:crypto";
import { existsSync, lstatSync, realpathSync } from "node:fs";
import { isAbsolute } from "node:path";
import Database from "better-sqlite3";
import { acquireDatabaseWriter } from "../src/lib/db/writer-ownership";
import {
  currentSchemaVersion,
  LATEST_SCHEMA_VERSION,
  runIntegrityCheck,
} from "../src/lib/db/migrations";
import { createExtraBackfillStore } from "../src/lib/db/extra-data-repository";
import {
  createBackfillControl,
  createExtraBackfill,
} from "../src/lib/garmin/extra-backfill";
import { createOfficialReader } from "../src/lib/garmin/official-reader";

const LIMITS = {
  // Per invocation; a stop is resumable under fresh authority, never automatic.
  maxRequests: { default: 150, max: 1000 },
  maxSeconds: { default: 600, max: 3600 },
  intervalMs: 1000,
};

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
function bounded(name: keyof typeof LIMITS, raw: string | undefined) {
  const limit = LIMITS[name] as { default: number; max: number };
  if (raw === undefined) return limit.default;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > limit.max)
    throw new Error(`--${name} must be an integer from 1 to ${limit.max}.`);
  return value;
}

async function readKey(): Promise<string> {
  if (process.stdin.isTTY)
    throw new Error(
      "Pipe the Personal API key on stdin; it is never accepted from argv or the environment.",
    );
  let input = "";
  for await (const chunk of process.stdin) {
    input += chunk;
    if (input.length > 4096) throw new Error("Key input is too large.");
  }
  const key = input.trim();
  if (!key || /\s/.test(key)) throw new Error("Key input is empty or invalid.");
  return key;
}

async function main() {
  const target = process.env.DATABASE_PATH;
  if (
    !target ||
    !isAbsolute(target) ||
    !existsSync(target) ||
    realpathSync(target) !== target
  )
    throw new Error(
      "Select an explicit canonical existing DATABASE_PATH after approving the target and recovery plan.",
    );
  const stat = lstatSync(target);
  if (!stat.isFile() || stat.nlink !== 1)
    throw new Error("Database must be a regular, unaliased local file.");
  const startDate = argument("from");
  const endDate = argument("to");
  if (!startDate || !endDate)
    throw new Error("Explicit --from YYYY-MM-DD and --to YYYY-MM-DD required.");
  const maxRequests = bounded("maxRequests", argument("max-requests"));
  const maxMs = bounded("maxSeconds", argument("max-seconds")) * 1000;
  const key = await readKey();
  const release = acquireDatabaseWriter(target);
  let db: Database.Database | undefined;
  let cancelled = false;
  const onSignal = () => {
    cancelled = true;
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  try {
    db = new Database(target, { fileMustExist: true });
    const schemaVersion = currentSchemaVersion(db);
    if (
      schemaVersion !== LATEST_SCHEMA_VERSION ||
      runIntegrityCheck(db) !== "ok"
    )
      throw new Error(
        "Explicit schema migration and integrity verification required before semantic backfill.",
      );
    const store = createExtraBackfillStore(db);
    const control = createBackfillControl({
      maxRequests,
      maxMs,
      intervalMs: LIMITS.intervalMs,
      clock: () => Date.now(),
      wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      cancelled: () => cancelled,
    });
    const reader = createOfficialReader({
      control,
      apiKey: () => key,
      fetch,
      // Maintenance never archives raw payloads.
      archive: () => undefined,
    });
    const result = await createExtraBackfill({ store, reader }).run({
      startDate,
      endDate,
      // Bound to the selected file, never to key material.
      target: createHash("sha256").update(target).digest("hex").slice(0, 32),
      schemaVersion,
      cancelled: () => cancelled,
    });
    const integrity = runIntegrityCheck(db);
    const foreignKeys = db.prepare("pragma foreign_key_check").all().length;
    console.log(
      JSON.stringify({
        ok: result.status === "completed" && integrity === "ok" && !foreignKeys,
        ...result,
        requests: {
          total: control.requests(),
          byEndpoint: reader.requestStats().byEndpoint,
        },
        coverage: store.coverageCounts(startDate, endDate),
        integrity,
        foreignKeys: foreignKeys ? "violations" : "ok",
        redaction:
          "Counts and closed reasons only: no key, IDs, measurements, payloads or paths.",
      }),
    );
    if (result.status !== "completed") process.exitCode = 1;
  } finally {
    db?.close();
    release();
  }
}

main().catch((error) => {
  console.error(
    JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message.slice(0, 300) : "failed",
      next: "Preserve the target and any backup; inspect before any separately authorized retry.",
    }),
  );
  process.exitCode = 1;
});
