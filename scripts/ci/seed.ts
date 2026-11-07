// Fresh synthetic input for CI and finite table smoke. Never imports normal state.
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
import { sql } from "drizzle-orm";
import {
  LATEST_SCHEMA_VERSION,
  currentSchemaVersion,
  migrateDatabase,
  runIntegrityCheck,
} from "../../src/lib/db/migrations";
import {
  activity,
  activityDetailAvailability,
  activityStreamPoint,
  conversation,
  message,
  trainerProfile,
} from "../../src/lib/db/schema";
import { validateSettings } from "../desktop/settings";
import { weeklyCalendar } from "../../src/lib/weekly/calendar";
import { simpleTableFixture, tableFixture } from "./table-fixture";
import type { WeeklyRecord } from "../../src/lib/weekly/contracts";

// Finite Terrain evidence only: actual normalized rows, no personal streams/GPS.
export function seedTerrain(db: Database.Database) {
  const store = drizzle(db);
  for (const [index, variant] of ["supported", "partial", "capped"].entries()) {
    const id = `T0293-${variant}`;
    const points = Array.from(
      {
        length:
          variant === "capped" ? 525 : variant === "supported" ? 601 : 101,
      },
      (_, i) => {
        const distance =
          variant === "capped"
            ? Math.floor(i / 5) * 600 + (i % 5) * 100
            : i * 10;
        return {
          garminId: id,
          elapsedSec: i * (variant === "supported" ? 20 : 10),
          timestamp: new Date(
            Date.UTC(2026, 0, 1) +
              (i * (variant === "supported" ? 20 : 10) +
                (variant === "partial" && i >= 50 ? 60 : 0)) *
                1000,
          ).toISOString(),
          distanceMeters: distance,
          altitudeMeters:
            variant === "capped"
              ? (i % 5) * 10
              : variant === "supported"
                ? i <= 200
                  ? i
                  : i <= 400
                    ? 400 - i
                    : 0
                : i,
          heartRate: variant === "partial" ? null : 125,
        };
      },
    );
    store
      .insert(activity)
      .values({
        id,
        garminId: id,
        name: `T0293 synthetic ${variant}`,
        sport: "hiking",
        startedAt: new Date(Date.UTC(2026, 0, 3 - index)),
        durationSec: points.at(-1)!.elapsedSec,
        distanceMeters: points.at(-1)!.distanceMeters,
      })
      .run();
    store.insert(activityStreamPoint).values(points).run();
    store
      .insert(activityDetailAvailability)
      .values({
        garminId: id,
        source: "T0293-authored",
        status: "available",
        hasStreams: true,
        hasElevation: true,
        hasHeartRate: variant !== "partial",
        recordCount: points.length,
      })
      .run();
  }
}

export function seed(
  scratch: string,
  name: string,
  llmDebug = false,
  tables = false,
  terrain = false,
): string {
  if ([llmDebug, tables, terrain].filter(Boolean).length > 1)
    throw new Error("Synthetic scenarios are exclusive.");
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
    if (llmDebug) {
      const store = drizzle(db);
      store
        .insert(conversation)
        .values({
          id: "default",
          title: "T0243 synthetic disclosure",
          createdAt: new Date(0),
          // Conversation repository raw SQL uses epoch milliseconds, not Drizzle seconds.
          updatedAt: sql`1000`,
        })
        .run();
      store
        .insert(message)
        .values([
          {
            id: "synthetic-missing",
            conversationId: "default",
            role: "assistant",
            content: "T0243 synthetic missing trace",
            createdAt: new Date(0),
          },
          {
            id: "synthetic-trace",
            conversationId: "default",
            role: "assistant",
            content: "T0243 synthetic trace",
            createdAt: sql`1000`,
            groundingJson: JSON.stringify({
              debugTrace: {
                schemaVersion: 1,
                finalAnswer: "T0243 synthetic diagnostic only",
              },
            }),
          },
        ])
        .run();
    }
    if (tables) {
      const store = drizzle(db);
      store
        .insert(conversation)
        .values({
          id: "default",
          title: "T0249 synthetic tables",
          createdAt: new Date(0),
          updatedAt: sql`1000`,
        })
        .run();
      store
        .insert(message)
        .values({
          id: "synthetic-tables",
          conversationId: "default",
          role: "assistant",
          content: `${tableFixture(true)}\n\n${simpleTableFixture}`,
          createdAt: sql`1000`,
        })
        .run();
      const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const { weekStart } = weeklyCalendar(new Date(), timeZone);
      const doc = {
        title: "T0249 synthetic plan",
        contentMarkdown: tableFixture(),
        revision: "synthetic-plan",
        savedAt: new Date(0).toISOString(),
      };
      const record: WeeklyRecord = {
        weekStart,
        timeZone,
        revision: "synthetic-tables",
        original: doc,
        latest: doc,
        review: {
          ...doc,
          title: "T0249 synthetic review",
          contentMarkdown: tableFixture(true),
          revision: "synthetic-review",
          asOf: new Date(0).toISOString(),
          planRevision: doc.revision,
        },
      };
      db.prepare(
        "insert into weekly_artifact (week_start, document_json) values (?, ?)",
      ).run(weekStart, JSON.stringify(record));
    }
    if (terrain) seedTerrain(db);
    if (
      currentSchemaVersion(db) !== LATEST_SCHEMA_VERSION ||
      runIntegrityCheck(db) !== "ok"
    )
      throw new Error("Synthetic schema/integrity gate failed.");
    validateSettings({
      DATABASE_PATH: path,
      AI_PROVIDER: "ollama",
      MEMORY_ENABLED: "false",
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
  if (
    process.argv.length !== 4 &&
    !(
      process.argv.length === 5 &&
      ["--llm-debug", "--markdown-tables", "--terrain"].includes(
        process.argv[4],
      )
    )
  )
    throw new Error(
      "Usage: ci:seed <canonical-private-scratch> <ci-seed-UUID> [--llm-debug|--markdown-tables|--terrain]",
    );
  seed(
    process.argv[2],
    process.argv[3],
    process.argv[4] === "--llm-debug",
    process.argv[4] === "--markdown-tables",
    process.argv[4] === "--terrain",
  );
  console.log(
    "Fresh synthetic current-schema Profile seed ready; no private inputs or credentials.",
  );
}
