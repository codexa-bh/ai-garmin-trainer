// Finite authored smoke input, not an application dataset or a migration path.
import {
  closeSync,
  lstatSync,
  mkdirSync,
  openSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { sql } from "drizzle-orm";
import {
  currentSchemaVersion,
  LATEST_SCHEMA_VERSION,
  migrateDatabase,
  runIntegrityCheck,
} from "../../src/lib/db/migrations";
import {
  activity,
  conversation,
  dailyHealth,
  message,
  trainerProfile,
} from "../../src/lib/db/schema";

export const RECIPE_VERSION = 1;
const DAY = 86_400_000;

export function anchorTime(anchor: string): number {
  const value = Date.parse(anchor + "T12:00:00Z");
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(anchor) ||
    !Number.isFinite(value) ||
    new Date(value).toISOString().slice(0, 10) !== anchor
  )
    throw new Error("A real UTC YYYY-MM-DD anchor is required.");
  return value;
}

export function populate(db: Database.Database, anchor: string) {
  const time = anchorTime(anchor);
  migrateDatabase(db);
  // Migration metadata otherwise carries wall-clock time, breaking logical reproducibility.
  db.prepare(
    "update app_metadata set updated_at=? where key='schema_version'",
  ).run(time);
  const store = drizzle(db);
  store
    .insert(trainerProfile)
    .values({
      id: "default",
      goalsJson: JSON.stringify([
        "Fictional autumn walking consistency",
        "Keep recovery days comfortable",
      ]),
      sportsJson: JSON.stringify(["walking", "cycling"]),
      constraintsJson: JSON.stringify([
        "Synthetic example: two short weekday sessions",
      ]),
      preferencesJson: JSON.stringify({
        note: "Entirely authored smoke example; not athlete advice",
      }),
      updatedAt: new Date(time),
    })
    .run();
  for (let index = 0; index < 3; index++) {
    const id = index === 0 ? "default" : `synthetic-chat-${index}`;
    const stamp = time - index * DAY;
    store
      .insert(conversation)
      .values({
        id,
        title: [
          "Synthetic recovery planning",
          "Synthetic weekend walk",
          "Synthetic cycling questions",
        ][index],
        createdAt: sql`${stamp}`,
        updatedAt: sql`${stamp + 3000}`,
      })
      .run();
    for (let turn = 0; turn < 4; turn++) {
      store
        .insert(message)
        .values({
          id: `synthetic-turn-${index}-${turn}`,
          conversationId: id,
          role: turn % 2 ? "assistant" : "user",
          content:
            turn % 2
              ? "This fictional saved discussion compares a comfortable short session with a rest day. No provider was called, and these authored examples do not describe a real athlete."
              : "For this synthetic example, how could I fit a relaxed walk around a busy week while keeping time for recovery?",
          createdAt: sql`${stamp + turn * 1000}`,
        })
        .run();
    }
  }
  for (let index = 0; index < 8; index++) {
    store
      .insert(activity)
      .values({
        id: `synthetic-activity-${index}`,
        garminId: `synthetic-${index}`,
        name: `Fictional ${index % 2 ? "cycle" : "walk"} ${index + 1}`,
        sport: index % 2 ? "cycling" : "walking",
        startedAt: new Date(time - index * 2 * DAY),
        durationSec: 1800 + index * 120,
        distanceMeters: 2400 + index * 400,
        calories: 180 + index * 15,
        avgHeartRate: 102 + index,
        maxHeartRate: 130 + index,
        steps: index % 2 ? 0 : 3400 + index * 100,
      })
      .run();
  }
  for (let index = 0; index < 21; index++) {
    if (index === 10) continue; // Missing civil date, not an invented zero.
    const partial = index === 9;
    store
      .insert(dailyHealth)
      .values({
        date: new Date(time - index * DAY).toISOString().slice(0, 10),
        sleepMinutes: partial ? null : 420 + index,
        sleepScore: partial ? null : 72 + (index % 14),
        sleepDeepMinutes: partial ? null : 65,
        sleepLightMinutes: partial ? null : 255 + index,
        sleepRemMinutes: partial ? null : 85,
        sleepAwakeMinutes: partial ? null : 15,
        sleepNapMinutes: partial ? null : 0,
        restingHeartRate: 55 + (index % 4),
        hrvStatus: partial ? null : "BALANCED",
        hrvMs: partial ? null : 42 + (index % 9),
        stressAvg: partial ? null : 20 + (index % 10),
        steps: index === 8 ? 0 : 6000 + index * 110,
        calories: partial ? null : 2100,
        activeCalories: partial ? null : 400,
        restingCalories: partial ? null : 1700,
        totalCalories: partial ? null : 2100,
        intensityMinutes: index === 8 ? 0 : 25,
        bodyBatteryAvg: partial ? null : 61,
        bodyBatteryMorning: partial ? null : 85,
        bodyBatteryEvening: partial ? null : 37,
        availability: partial ? "partial" : "complete",
      })
      .run();
  }
}

function inventory(db: Database.Database) {
  return db
    .prepare(
      "select type,name,tbl_name,sql from sqlite_master where name not like 'sqlite_%' order by type,name",
    )
    .all();
}

// Verify existing inputs read-only; never migrate a selected database.
export function verify(db: Database.Database, route: "synthetic" | "private") {
  const reference = new Database(":memory:");
  try {
    migrateDatabase(reference);
    if (
      currentSchemaVersion(db) !== LATEST_SCHEMA_VERSION ||
      runIntegrityCheck(db) !== "ok" ||
      (db.pragma("foreign_key_check") as unknown[]).length ||
      JSON.stringify(inventory(db)) !== JSON.stringify(inventory(reference))
    )
      throw new Error("Smoke schema/integrity/FK/inventory refused.");
  } finally {
    reference.close();
  }
  const allowed = new Set([
    "activity",
    "daily_health",
    "trainer_profile",
    "app_metadata",
    ...(route === "synthetic" ? ["conversation", "message"] : []),
  ]);
  const tables = db
    .prepare(
      "select name from sqlite_master where type='table' and name not like 'sqlite_%'",
    )
    .all() as { name: string }[];
  for (const { name } of tables) {
    const quoted = '"' + name.replaceAll('"', '""') + '"';
    const count = (
      db.prepare(`select count(*) as n from ${quoted}`).get() as { n: number }
    ).n;
    if (count > 256 || (!allowed.has(name) && count !== 0))
      throw new Error("Smoke populated data classes/count refused.");
    const columns = db.prepare(`pragma table_info(${quoted})`).all() as {
      name: string;
      type: string;
    }[];
    for (const row of db.prepare(`select * from ${quoted}`).all() as Record<
      string,
      unknown
    >[]) {
      for (const column of columns) {
        const value = row[column.name];
        if (value === null) continue;
        if (column.type === "INTEGER" || column.type === "REAL") {
          if (
            typeof value !== "number" ||
            !Number.isFinite(value) ||
            (column.type === "INTEGER" &&
              // The importer preserves fractional duration/average-HR metrics;
              // SQLite INTEGER affinity does not make those domain values counters.
              !(
                name === "activity" &&
                ["duration_sec", "avg_heart_rate"].includes(column.name)
              ) &&
              !Number.isInteger(value))
          )
            throw new Error("Nonnumeric/nonfinite smoke value refused.");
        } else if (typeof value !== "string" || value.length > 12000)
          throw new Error("Unbounded/malformed smoke text refused.");
      }
    }
  }
  const profile = db.prepare("select * from trainer_profile").all() as Record<
    string,
    unknown
  >[];
  if (profile.length !== 1 || profile[0].id !== "default")
    throw new Error("Smoke Profile coverage refused.");
  for (const key of ["goals_json", "sports_json", "constraints_json"]) {
    const value: unknown = JSON.parse(String(profile[0][key]));
    if (
      !Array.isArray(value) ||
      !value.every((item) => typeof item === "string" && item.length < 1000)
    )
      throw new Error("Smoke Profile JSON refused.");
  }
  const preferences: unknown = JSON.parse(String(profile[0].preferences_json));
  if (
    !preferences ||
    Array.isArray(preferences) ||
    typeof preferences !== "object"
  )
    throw new Error("Smoke preferences refused.");
  if (
    (
      db
        .prepare(
          "select count(*) as n from app_metadata where key <> 'schema_version'",
        )
        .get() as { n: number }
    ).n
  )
    throw new Error("Unreviewed metadata refused.");
  const health = db
    .prepare("select * from daily_health order by date")
    .all() as Record<string, unknown>[];
  if (
    health.length < 14 ||
    health.some((row) => {
      try {
        anchorTime(String(row.date));
        return !["complete", "partial", "unavailable"].includes(
          String(row.availability),
        );
      } catch {
        return true;
      }
    }) ||
    anchorTime(String(health.at(-1)?.date)) -
      anchorTime(String(health[0]?.date)) <
      13 * DAY
  )
    throw new Error("Smoke Health history coverage refused.");
  const activities = (
    db.prepare("select count(*) as n from activity").get() as { n: number }
  ).n;
  if (!activities) throw new Error("Smoke activity coverage refused.");
  if (route === "synthetic") {
    const chats = db
      .prepare(
        "select id,created_at,updated_at from conversation order by updated_at desc",
      )
      .all() as { id: string; created_at: number; updated_at: number }[];
    if (
      chats.length < 3 ||
      chats.some(
        (chat) => chat.created_at < 1e12 || chat.updated_at < chat.created_at,
      )
    )
      throw new Error("Smoke conversation order refused.");
    for (const chat of chats) {
      const turns = db
        .prepare(
          "select role,content,created_at from message where conversation_id=? order by created_at",
        )
        .all(chat.id) as {
        role: string;
        content: string;
        created_at: number;
      }[];
      if (
        turns.length < 4 ||
        turns.some(
          (turn, index) =>
            !["user", "assistant"].includes(turn.role) ||
            turn.content.length < 60 ||
            turn.created_at !== chat.created_at + index * 1000,
        )
      )
        throw new Error("Smoke turn order/content refused.");
    }
    if (
      (
        db
          .prepare(
            "select count(*) as n from message where conversation_id not in (select id from conversation)",
          )
          .get() as { n: number }
      ).n
    )
      throw new Error("Orphan smoke message refused.");
    const gap = health.some(
      (row, index) =>
        index > 0 &&
        anchorTime(String(row.date)) -
          anchorTime(String(health[index - 1].date)) >
          DAY,
    );
    if (
      !gap ||
      !health.some((row) => row.sleep_minutes === null && row.steps !== null) ||
      !health.some((row) => row.steps === 0 && row.intensity_minutes === 0)
    )
      throw new Error("Smoke missing/partial/zero coverage refused.");
  }
  return {
    schema: LATEST_SCHEMA_VERSION,
    integrity: "ok",
    foreignKeys: "ok",
    inventory: "ok",
    coverage: "ok",
    activities,
    healthDays: health.length,
  };
}

export function recipe(scratch: string, name: string, anchor: string) {
  anchorTime(anchor);
  const info = lstatSync(scratch);
  if (
    !isAbsolute(scratch) ||
    realpathSync(scratch) !== scratch ||
    !info.isDirectory() ||
    info.uid !== process.getuid?.() ||
    (info.mode & 0o777) !== 0o700 ||
    !/^smoke-input-[0-9a-f-]{36}$/.test(name)
  )
    throw new Error(
      "Canonical private scratch and exclusive input name required.",
    );
  const root = join(scratch, name);
  mkdirSync(root, { mode: 0o700 });
  const db = new Database(":memory:");
  try {
    populate(db, anchor);
    const checks = verify(db, "synthetic");
    const path = join(root, "synthetic.sqlite");
    const fd = openSync(path, "wx", 0o600);
    try {
      writeFileSync(fd, db.serialize());
    } finally {
      closeSync(fd);
    }
    return { path, recipeVersion: RECIPE_VERSION, anchor, ...checks };
  } finally {
    db.close();
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  if (process.argv.length === 6 && process.argv[2] === "create")
    console.log(
      JSON.stringify(recipe(process.argv[3], process.argv[4], process.argv[5])),
    );
  else if (
    process.argv.length === 5 &&
    process.argv[2] === "verify" &&
    ["synthetic", "private"].includes(process.argv[4])
  ) {
    const db = new Database(process.argv[3], {
      readonly: true,
      fileMustExist: true,
      timeout: 3000,
    });
    try {
      console.log(
        JSON.stringify(verify(db, process.argv[4] as "synthetic" | "private")),
      );
    } finally {
      db.close();
    }
  } else
    throw new Error(
      "Usage: smoke_recipe.ts create <private-scratch> <smoke-input-UUID> <UTC-date> | verify <database> synthetic|private",
    );
}
