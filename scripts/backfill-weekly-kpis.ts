// Explicit finite reviewed mapping application. No extraction/provider/startup path.
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute } from "node:path";
import Database from "better-sqlite3";
import { acquireDatabaseWriter } from "../src/lib/db/writer-ownership";
import {
  currentSchemaVersion,
  LATEST_SCHEMA_VERSION,
  runIntegrityCheck,
} from "../src/lib/db/migrations";
import { createWeeklyStore } from "../src/lib/db/weekly-repository";
import {
  backfillWeeklyKpis,
  type ReviewedKpiMapping,
} from "../src/lib/weekly/backfill";

const target = process.env.DATABASE_PATH;
const manifest = process.argv[2];
if (
  !target ||
  !isAbsolute(target) ||
  realpathSync(target) !== target ||
  !manifest ||
  !isAbsolute(manifest) ||
  realpathSync(manifest) !== manifest
)
  throw new Error(
    "Explicit canonical DATABASE_PATH and reviewed private manifest path required.",
  );
const stat = lstatSync(manifest);
if (
  !stat.isFile() ||
  stat.nlink !== 1 ||
  stat.uid !== process.getuid?.() ||
  stat.size > 4 * 1024 * 1024 ||
  (stat.mode & 0o077) !== 0
)
  throw new Error(
    "Reviewed manifest must be bounded, owner-private and unaliased.",
  );
const input = JSON.parse(readFileSync(manifest, "utf8")) as {
  version: number;
  mappings: (ReviewedKpiMapping & { sourceSha256: string })[];
};
if (input.version !== 1 || !Array.isArray(input.mappings))
  throw new Error("Unsupported mapping manifest.");
const release = acquireDatabaseWriter(target);
let db: Database.Database | undefined;
try {
  db = new Database(target, { fileMustExist: true });
  const database = db;
  if (
    currentSchemaVersion(db) !== LATEST_SCHEMA_VERSION ||
    runIntegrityCheck(db) !== "ok"
  )
    throw new Error(
      "Explicit schema migration and integrity verification required before semantic backfill.",
    );
  const result = db.transaction(() => {
    for (const mapping of input.mappings) {
      const row = database
        .prepare("select document_json from weekly_artifact where week_start=?")
        .get(mapping.source.weekStart) as { document_json: string } | undefined;
      if (
        !row ||
        createHash("sha256").update(row.document_json).digest("hex") !==
          mapping.sourceSha256
      )
        throw new Error(
          "Historical source bytes changed; review the affected mapping before mutation.",
        );
    }
    return backfillWeeklyKpis(
      createWeeklyStore(() => database),
      input.mappings,
      new Date(),
    );
  })();
  if (
    runIntegrityCheck(db) !== "ok" ||
    db.prepare("pragma foreign_key_check").all().length
  )
    throw new Error(
      "Post-backfill integrity verification failed; preserve the target and diagnose, do not replay blindly.",
    );
  console.log(
    JSON.stringify({
      ok: true,
      schemaVersion: LATEST_SCHEMA_VERSION,
      ...result,
      integrity: "ok",
      foreignKeys: "ok",
      sourceDocuments: "preserved",
    }),
  );
} finally {
  db?.close();
  release();
}
