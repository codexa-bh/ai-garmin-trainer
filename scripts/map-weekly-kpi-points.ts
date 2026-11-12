// Explicit operator-approved per-measurement point mapping; no automatic startup,
// weight choice or rescoring. Narrative and structured source bytes are hash-bound.
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
  mapKpiPoints,
  type ReviewedKpiPointMapping,
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
  mappings: (ReviewedKpiPointMapping & {
    sourceSha256: string;
    stateSha256: string;
  })[];
};
if (input.version !== 1 || !Array.isArray(input.mappings))
  throw new Error("Unsupported point-mapping manifest.");
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
    const sha = (value: string | undefined) =>
      value === undefined
        ? null
        : createHash("sha256").update(value).digest("hex");
    for (const mapping of input.mappings) {
      const week = mapping.source.weekStart;
      const narrative = database
        .prepare("select document_json from weekly_artifact where week_start=?")
        .get(week) as { document_json: string } | undefined;
      const state = database
        .prepare("select state_json from weekly_kpi where week_start=?")
        .get(week) as { state_json: string } | undefined;
      const reconciled =
        narrative?.document_json ===
          JSON.stringify(mapping.replacement.record) &&
        state?.state_json === JSON.stringify(mapping.replacement.state);
      if (
        !reconciled &&
        (sha(narrative?.document_json) !== mapping.sourceSha256 ||
          sha(state?.state_json) !== mapping.stateSha256)
      )
        throw new Error(
          "Narrative or structured source bytes changed; review before mutation.",
        );
    }
    return mapKpiPoints(
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
      "Post-mapping integrity refused; preserve and diagnose, do not replay.",
    );
  console.log(
    JSON.stringify({
      ok: true,
      ...result,
      schemaVersion: LATEST_SCHEMA_VERSION,
      integrity: "ok",
      foreignKeys: "ok",
      preserved:
        "identities, references, targets, values, totals unless reviewed, unlisted weeks and unrelated data",
    }),
  );
} finally {
  db?.close();
  release();
}
