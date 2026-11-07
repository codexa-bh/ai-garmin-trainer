import Database from "better-sqlite3";
import { expect, it } from "vitest";
import { seedActivityLabels } from "../scripts/ci/seed";
import { migrateDatabase } from "../src/lib/db/migrations";

it("seeds only three exact authored activity types without streams", () => {
  const db = new Database(":memory:");
  try {
    migrateDatabase(db);
    seedActivityLabels(db);
    expect(
      db
        .prepare(
          "select garmin_id as id, sport from activity order by started_at desc",
        )
        .all(),
    ).toEqual([
      { id: "T0295-strength_training", sport: "strength_training" },
      { id: "T0295-gravel_cycling", sport: "gravel_cycling" },
      { id: "T0295-hiking", sport: "hiking" },
    ]);
    expect(
      db
        .prepare("select started_at as value from activity where garmin_id = ?")
        .get("T0295-strength_training"),
    ).toEqual({ value: Date.UTC(2026, 0, 3) });
    expect(
      db.prepare("select count(*) as n from activity_stream_point").get(),
    ).toEqual({ n: 0 });
    expect(db.pragma("integrity_check", { simple: true })).toBe("ok");
    expect(() => seedActivityLabels(db)).toThrow();
  } finally {
    db.close();
  }
});
