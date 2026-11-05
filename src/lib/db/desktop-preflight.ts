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
    const versionRecord =
      currentSchemaVersion(db) === LATEST_SCHEMA_VERSION
        ? (db
            .prepare(
              "select value from app_metadata where key='schema_version'",
            )
            .get() as { value?: string } | undefined)
        : undefined;
    if (versionRecord?.value !== String(LATEST_SCHEMA_VERSION))
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
      ["conversation_history_control", ["id", "privacy_generation"]],
      [
        "conversation_turn",
        [
          "admission_seq",
          "turn_id",
          "conversation_id",
          "user_id",
          "assistant_id",
          "source_version",
          "summary_eligible",
          "status",
          "boot_id",
          "privacy_generation",
        ],
      ],
      ["conversation_completion", ["event_seq", "turn_id"]],
      [
        "conversation_segment",
        [
          "format_version",
          "revision",
          "privacy_generation",
          "covered_through",
          "compact",
          "compact_sha256",
          "compact_characters",
          "policy_identity",
        ],
      ],
      ["conversation_compaction_spend", ["day", "attempts", "reserved_usd"]],
      [
        "conversation_summary_pin",
        ["conversation_id", "format_version", "payload", "seal", "reason"],
      ],
      [
        "summary_state",
        [
          "format_version",
          "revision",
          "frontier",
          "payload",
          "checksum",
          "privacy_generation",
          "published_at",
        ],
      ],
      [
        "summary_control",
        [
          "enabled",
          "configured_enabled",
          "generation",
          "manual_revision",
          "cutoff",
          "job_id",
          "lease_until",
          "model",
          "cap",
          "retry_at",
        ],
      ],
      ["summary_disposition", ["event_seq", "source_id", "reason", "revision"]],
      ["summary_item_disposition", ["item_id", "revision", "reason"]],
      [
        "summary_attempt",
        ["job_id", "started_at", "outcome", "reserved", "usage_json"],
      ],
      ["summary_spend", ["day", "attempts", "reserved_usd"]],
      ["summary_suppression", ["source_id"]],
      [
        "summary_import",
        [
          "id",
          "format_version",
          "selection_json",
          "position",
          "state",
          "privacy_generation",
          "control_generation",
          "manual_revision",
          "cutoff",
        ],
      ],
      ["summary_import_disposition", ["source_id", "manifest_id", "reason"]],
      ["summary_attempt", ["import_id"]],
      ["summary_manual", ["item_id", "payload"]],
      ["summary_original_boundary", ["id", "floor", "clear_floor"]],
      [
        "summary_rebuild",
        [
          "id",
          "format_version",
          "boot",
          "snapshot",
          "selection_json",
          "authority_json",
          "candidate_json",
          "candidate_checksum",
          "dispositions_json",
          "position",
          "state",
          "reason",
          "created_at",
          "deadline",
          "checksum",
        ],
      ],
      ["conversation_title_spend", ["id", "day", "reserved_usd", "usage_json"]],
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
    const controls = db
      .prepare(
        "select id,privacy_generation as generation from conversation_history_control",
      )
      .all() as { id: number; generation: number }[];
    if (
      controls.length !== 1 ||
      controls[0]!.id !== 1 ||
      !Number.isSafeInteger(controls[0]!.generation) ||
      controls[0]!.generation < 0
    )
      throw new Error(
        "Database conversation control is inconsistent; preserve data and use compatible recovery.",
      );
  } finally {
    db.close();
  }
}
