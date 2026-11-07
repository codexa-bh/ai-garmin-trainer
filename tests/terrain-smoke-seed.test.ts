import Database from "better-sqlite3";
import { expect, it } from "vitest";
import { seedTerrain } from "../scripts/ci/seed";
import { migrateDatabase } from "../src/lib/db/migrations";
import {
  analyzeTerrainSections,
  type TerrainPoint,
} from "../src/lib/analytics/terrain-sections";

it("authors finite supported/partial/capped normalized Terrain without GPS or private inputs", () => {
  const db = new Database(":memory:");
  try {
    migrateDatabase(db);
    seedTerrain(db);
    for (const variant of ["supported", "partial", "capped"]) {
      const points = db
        .prepare(
          "select elapsed_sec as elapsedSec, timestamp, distance_meters as distanceMeters, altitude_meters as altitudeMeters, heart_rate as heartRate from activity_stream_point where garmin_id=? order by elapsed_sec",
        )
        .all(`T0293-${variant}`) as TerrainPoint[];
      const analysis = analyzeTerrainSections(
        `T0293-${variant}`,
        "hiking",
        points,
      );
      expect(analysis.sections.length).toBe(
        variant === "capped" ? 100 : variant === "partial" ? 2 : 3,
      );
      expect(analysis.status).toBe(
        variant === "supported" ? "available" : "partial",
      );
      expect(analysis.truncated).toBe(variant === "capped");
      expect(analysis.sectionCount).toBe(
        variant === "capped" ? 105 : variant === "partial" ? 2 : 3,
      );
      if (variant === "supported") {
        expect(analysis.sections.map((row) => row.kind)).toEqual([
          "climb",
          "descent",
          "flat",
        ]);
        expect(analysis.sections[1].meanGradePct).toBeLessThan(0);
        expect(analysis.sections[2].meanGradePct).toBe(0);
        expect(analysis.sections.every((row) => row.elapsedSec! > 3600)).toBe(
          true,
        );
      }
      expect(analysis.sections[0].averageHeartRate).toBe(
        variant === "partial" ? null : 125,
      );
    }
    expect(
      db
        .prepare(
          "select count(*) as n from activity_stream_point where lat is not null or lon is not null",
        )
        .get(),
    ).toEqual({ n: 0 });
    expect(db.pragma("integrity_check", { simple: true })).toBe("ok");
    expect(() => seedTerrain(db)).toThrow();
  } finally {
    db.close();
  }
});
