// CI-only fresh synthetic input. Never discovers/imports normal app state.
import {
  closeSync,
  lstatSync,
  mkdirSync,
  openSync,
  realpathSync,
} from "node:fs";
import { isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import {
  LATEST_SCHEMA_VERSION,
  currentSchemaVersion,
  migrateDatabase,
  runIntegrityCheck,
} from "../../src/lib/db/migrations";
import { trainerProfile } from "../../src/lib/db/schema";
import { validateSettings } from "../desktop/settings";

export function seed(scratch: string, name: string): string {
  const stat = lstatSync(scratch);
  if (
    !isAbsolute(scratch) ||
    realpathSync(scratch) !== scratch ||
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    stat.uid !== process.getuid?.() ||
    (stat.mode & 0o077) !== 0 ||
    !/^ci-seed-[0-9a-f-]{36}$/.test(name)
  )
    throw new Error(
      "Explicit canonical owner-private scratch and unique seed required.",
    );
  const root = join(scratch, name);
  mkdirSync(root, { mode: 0o700 }); // Exclusive: reused/aliased destination refuses.
  const path = join(root, "synthetic.sqlite");
  closeSync(openSync(path, "wx", 0o600));
  const db = new Database(path, { fileMustExist: true });
  try {
    migrateDatabase(db);
    drizzle(db)
      .insert(trainerProfile)
      .values({
        id: "default",
        goalsJson: JSON.stringify(["CI synthetic initial goal"]),
        sportsJson: JSON.stringify(["CI synthetic walking"]),
        constraintsJson: "[]",
        preferencesJson: "{}",
        updatedAt: new Date(0),
      })
      .run();
    if (
      currentSchemaVersion(db) !== LATEST_SCHEMA_VERSION ||
      runIntegrityCheck(db) !== "ok"
    )
      throw new Error("Synthetic schema/integrity gate failed.");
    validateSettings({
      DATABASE_PATH: path,
      AI_PROVIDER: "ollama",
      MEMORY_ENABLED: "false",
      GARMIN_HISTORY_START_DATE: "2024-01-01",
    });
  } finally {
    db.close();
  }
  return path;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  if (process.argv.length !== 4)
    throw new Error(
      "Usage: ci:seed <canonical-private-scratch> <ci-seed-UUID>",
    );
  seed(process.argv[2], process.argv[3]);
  console.log(
    "Fresh synthetic current-schema Profile seed ready; no private inputs or credentials.",
  );
}
