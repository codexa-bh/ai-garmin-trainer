import Database from "better-sqlite3";
import { lstatSync, realpathSync } from "node:fs";
import { isAbsolute } from "node:path";
import {
  currentSchemaVersion,
  LATEST_SCHEMA_VERSION,
  runIntegrityCheck,
} from "./migrations";

export function assertDesktopDatabase(path: string): void {
  if (!isAbsolute(path))
    throw new Error("Desktop adoption requires an explicit absolute database.");
  const stat = lstatSync(path);
  if (
    !stat.isFile() ||
    stat.size === 0 ||
    stat.nlink !== 1 ||
    realpathSync(path) !== path
  )
    throw new Error(
      "Select an existing regular database, not an empty file or alias.",
    );
  const db = new Database(path, { readonly: true, fileMustExist: true });
  try {
    if (currentSchemaVersion(db) !== LATEST_SCHEMA_VERSION)
      throw new Error(
        "Database schema is not supported. Back up and explicitly upgrade a disposable copy using the source tools first.",
      );
    if (runIntegrityCheck(db) !== "ok")
      throw new Error("Database integrity check failed.");
    // Compatibility DDL must also be a no-op; a version label alone is insufficient.
    for (const [table, columns] of [
      [
        "activity",
        [
          "name",
          "max_heart_rate",
          "steps",
          "elevation_gain_meters",
          "elevation_loss_meters",
        ],
      ],
      ["activity_detail_attempt", ["garmin_id", "status"]],
    ] as const) {
      const actual = db.prepare(`pragma table_info(${table})`).all() as {
        name: string;
      }[];
      if (
        columns.some((name) => !actual.some((column) => column.name === name))
      )
        throw new Error(
          "Database compatibility structure is incomplete; repair a backed-up copy before adoption.",
        );
    }
  } finally {
    db.close();
  }
}
