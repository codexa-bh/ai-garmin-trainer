import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";

it("projects equal canonical values through normalized storage, API and production tool, and recomputes on changes", async () => {
  process.env.DATABASE_PATH = join(
    mkdtempSync(join(tmpdir(), "terrain-api-")),
    "test.sqlite",
  );
  vi.resetModules();
  const { getDatabase } = await import("../src/lib/db/connection");
  const db = getDatabase();
  db.prepare(
    "insert into activity (id,garmin_id,sport,started_at,duration_sec,distance_meters) values ('synthetic','synthetic','walking',1,1000,1000)",
  ).run();
  const insert = db.prepare(
    "insert into activity_stream_point (garmin_id,elapsed_sec,timestamp,distance_meters,altitude_meters,heart_rate) values ('synthetic',?,?,?,?,?)",
  );
  for (let i = 0; i <= 100; i++)
    insert.run(
      i,
      new Date(Date.UTC(2026, 0, 1) + i * 10000).toISOString(),
      i * 10,
      i,
      120,
    );
  const { analyzeActivityTerrain } =
    await import("../src/lib/local-data/composition");
  const { GET } =
    await import("../src/app/api/activities/[garminId]/dashboard/route");
  const response = await GET(
    new Request("http://localhost/api/activities/synthetic/dashboard"),
    { params: { garminId: "synthetic" } },
  );
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.terrainSections).toEqual(analyzeActivityTerrain("synthetic"));
  const { executeTrainerTool } = await import("../src/lib/ai/tool-composition");
  const { TrainerToolExecutionContext } =
    await import("../src/lib/ai/tool-execution-context");
  const context = new TrainerToolExecutionContext();
  const step = await executeTrainerTool({
    toolName: "analyzeActivityTerrain",
    input: { garminId: "synthetic", maxRows: 20 },
    index: 1,
    context,
  });
  const result = step.result as {
    rows: unknown[];
    analysis: Record<string, unknown>;
  };
  expect(result.rows).toEqual(body.terrainSections.sections);
  expect({ ...result.analysis, sections: result.rows }).toEqual(
    body.terrainSections,
  );
  expect(JSON.stringify(result)).not.toMatch(
    /"lat"|"lon"|sessionJson|raw_payload|DATABASE_PATH/,
  );
  db.prepare(
    "update activity_stream_point set altitude_meters = altitude_meters*2",
  ).run();
  expect(analyzeActivityTerrain("synthetic").ascentMeters).toBe(200);
  expect(analyzeActivityTerrain("missing").reason).toBe("unknown_activity");
  context.dispose();
  db.close();
});
