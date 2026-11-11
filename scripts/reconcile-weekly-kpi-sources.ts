// Explicit reviewed source-binding maintenance; no automatic startup or rescoring.
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
  reconcileKpiSources,
  type ReviewedKpiSourceMapping,
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
    "Explicit canonical DATABASE_PATH and reviewed private manifest required.",
  );
const info = lstatSync(manifest);
if (
  !info.isFile() ||
  info.nlink !== 1 ||
  info.uid !== process.getuid?.() ||
  info.size > 4 * 1024 * 1024 ||
  (info.mode & 0o077) !== 0
)
  throw new Error(
    "Reviewed manifest must be bounded, owner-private and unaliased.",
  );
const input = JSON.parse(readFileSync(manifest, "utf8")) as {
  version: number;
  mappings: (ReviewedKpiSourceMapping & { sourceSha256: string })[];
};
if (input.version !== 1 || !Array.isArray(input.mappings))
  throw new Error("Unsupported source-binding manifest.");
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
      "Current schema and integrity required; no implicit migration.",
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
          "Narrative source bytes changed; review before mutation.",
        );
    }
    return reconcileKpiSources(
      createWeeklyStore(() => database),
      input.mappings,
    );
  })();
  if (
    runIntegrityCheck(db) !== "ok" ||
    db.prepare("pragma foreign_key_check").all().length
  )
    throw new Error(
      "Post-reconciliation integrity refused; preserve and diagnose, do not replay.",
    );
  console.log(
    JSON.stringify({
      ok: true,
      ...result,
      schemaVersion: LATEST_SCHEMA_VERSION,
      integrity: "ok",
      foreignKeys: "ok",
      preserved:
        "narrative, targets, values, scores, identities and unrelated data",
    }),
  );
} finally {
  db?.close();
  release();
}
