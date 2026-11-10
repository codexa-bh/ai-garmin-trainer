import {
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  realpathSync,
} from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import Database from "better-sqlite3";
import {
  currentSchemaVersion,
  databaseHasUserData,
  LATEST_SCHEMA_VERSION,
  migrateDatabase,
  runIntegrityCheck,
} from "../src/lib/db/migrations";
import { acquireDatabaseWriter } from "../src/lib/db/writer-ownership";

// Explicit maintenance, never native settings discovery or startup migration.
async function main() {
  const target = process.env.DATABASE_PATH;
  if (
    !target ||
    !isAbsolute(target) ||
    resolve(target) !== target ||
    (existsSync(target)
      ? realpathSync(target) !== target
      : realpathSync(dirname(target)) !== dirname(target))
  )
    throw new Error(
      "Select an explicit canonical DATABASE_PATH after approving the target and recovery plan.",
    );
  const existed = existsSync(target);
  if (
    !existed &&
    ["-wal", "-shm", "-journal"].some((suffix) => existsSync(target + suffix))
  )
    throw new Error(
      "Fresh target has sidecars; preserve and reconcile before initialization.",
    );
  const release = acquireDatabaseWriter(target);
  let db: Database.Database | undefined;
  let backupPath: string | null = null;
  try {
    if (!existed) closeSync(openSync(target, "wx", 0o600));
    db = new Database(target, { fileMustExist: true });
    const before = currentSchemaVersion(db);
    if (runIntegrityCheck(db) !== "ok")
      throw new Error(
        "Pre-upgrade integrity check failed; no migration applied.",
      );
    if (
      existed &&
      (before < LATEST_SCHEMA_VERSION || databaseHasUserData(db))
    ) {
      const parent = join(dirname(target), "backups");
      if (!existsSync(parent)) mkdirSync(parent, { mode: 0o700 });
      const stat = lstatSync(parent);
      if (
        !stat.isDirectory() ||
        realpathSync(parent) !== parent ||
        stat.uid !== process.getuid?.() ||
        (stat.mode & 0o077) !== 0
      )
        throw new Error(
          "Backup directory must be canonical, owner-private and unaliased; existing objects are not adopted.",
        );
      backupPath = join(
        parent,
        `trainer-schema-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.sqlite`,
      );
      closeSync(openSync(backupPath, "wx", 0o600));
      // SQLite's online backup includes committed WAL state. A raw main-file
      // copy is not a recovery backup. Failed/partial output is retained.
      await db.backup(backupPath);
      const backup = new Database(backupPath, { fileMustExist: true });
      try {
        // The new private backup is ours alone. Publish a standalone recovery
        // file, not a WAL-mode header that requires backup-side sidecars.
        backup.pragma("journal_mode = DELETE");
        if (
          runIntegrityCheck(backup) !== "ok" ||
          currentSchemaVersion(backup) !== before ||
          backup.prepare("pragma foreign_key_check").all().length
        )
          throw new Error(
            "Recovery backup verification failed; no migration applied.",
          );
      } finally {
        backup.close();
      }
    }
    const result = migrateDatabase(db);
    console.log(
      JSON.stringify({
        ok: true,
        schemaVersionBefore: before,
        schemaVersionAfter: result.toVersion,
        latestSchemaVersion: LATEST_SCHEMA_VERSION,
        applied: result.applied,
        backupPath,
        integrity: result.integrity,
        rollback:
          "Backup is pre-upgrade recovery data, not automatic restore authority. Preserve newer writes; use a compatible forward fix or separately reconciled restore.",
      }),
    );
  } finally {
    db?.close();
    release();
  }
}
main().catch(() => {
  console.error(
    "Migration failed. Preserve the target and any backup/partial output; reconcile ownership and failure before retrying.",
  );
  process.exitCode = 1;
});
