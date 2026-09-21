import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, expect, it, vi } from "vitest";
import type Database from "better-sqlite3";
import { TrainerToolExecutionContext } from "../src/lib/ai/tool-execution-context";
import {
  normalizeActivity,
  normalizeDailyHealth,
} from "../src/lib/garmin/normalize";

beforeEach(() => {
  vi.resetModules();
  process.env.DATABASE_PATH = join(
    mkdtempSync(join(tmpdir(), "local-data-wiring-")),
    "test.sqlite",
  );
});
const garminTables = [
  "garmin_raw_payload",
  "activity_stream_point",
  "activity_lap",
  "activity_detail_availability",
  "garmin_athlete_baseline",
  "garmin_athlete_baseline_attempt",
  "garmin_body_metrics",
  "garmin_body_metric_attempt",
  "garmin_body_weight_history",
  "activity",
  "daily_health",
  "sync_checkpoint",
  "sync_run",
];
const chatTables = ["message", "conversation", "trainer_profile"];
const preserved = [
  "activity_hr_zone_time",
  "activity_detail_attempt",
  "semantic_memory",
  "trainer_memory",
  "training_plan",
  "app_metadata",
  "user",
  "session",
  "account",
  "verification",
];

// Test-only SQLite fixture: seed every exact lifecycle table, including excluded
// domains, then compare complete rows. No primary DB, connector or env file read.
function seed(db: Database.Database, tables: string[]) {
  for (const table of tables) {
    const cols = db.prepare(`pragma table_info(${table})`).all() as Array<{
      name: string;
      type: string;
      notnull: number;
      pk: number;
      dflt_value: unknown;
    }>;
    const required = cols.filter(
      (col) => (col.notnull || col.pk) && col.dflt_value === null,
    );
    db.prepare(
      `insert into ${table} (${required.map((col) => col.name).join(",")}) values (${required.map(() => "?").join(",")})`,
    ).run(
      ...required.map((col) =>
        /int|real/i.test(col.type) ? 1 : `fixture-${col.name}`,
      ),
    );
  }
}
function rows(db: Database.Database, tables: string[]) {
  return Object.fromEntries(
    tables.map((table) => [table, db.prepare(`select * from ${table}`).all()]),
  );
}
async function fixture() {
  const { getDatabase } = await import("../src/lib/db/connection");
  const db = getDatabase();
  seed(db, [...garminTables, ...chatTables, ...preserved]);
  const route = await import("../src/app/api/delete/route");
  return { db, route };
}
function deletionRequest(scope: string) {
  return new Request("http://local.test/api/delete", {
    method: "POST",
    body: JSON.stringify({ scope }),
  });
}

it.each(["chat-profile", "garmin-all"])(
  "production deletion %s preserves exact scope, order, labels and post-commit counts",
  async (scope) => {
    const { db, route } = await fixture();
    const deleted = scope === "chat-profile" ? chatTables : garminTables;
    const retained =
      scope === "chat-profile"
        ? [...garminTables, ...preserved]
        : [...chatTables, ...preserved];
    const before = rows(db, retained);
    db.exec(
      "create table deletion_journal (seq integer primary key, name text)",
    );
    for (const table of deleted)
      db.exec(
        `create trigger journal_${table} after delete on ${table} begin insert into deletion_journal(name) values ('${table}'); end`,
      );
    const response = await route.POST(deletionRequest(scope));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.deleted).toEqual(
      scope === "chat-profile"
        ? ["messages", "conversations", "trainer_profile"]
        : garminTables,
    );
    expect(body.counts.activities).toBe(scope === "chat-profile" ? 1 : 0);
    expect(rows(db, retained)).toEqual(before);
    for (const table of deleted)
      expect(
        db.prepare(`select count(*) as count from ${table}`).get(),
      ).toEqual({ count: 0 });
    expect(
      db.prepare("select name from deletion_journal order by seq").all(),
    ).toEqual(deleted.map((name) => ({ name })));
  },
);

it.each(["chat-profile", "garmin-all"])(
  "rolls back every earlier delete if the final %s statement fails",
  async (scope) => {
    const { db, route } = await fixture();
    const all = [...garminTables, ...chatTables, ...preserved];
    const before = rows(db, all);
    const table = scope === "chat-profile" ? "trainer_profile" : "sync_run";
    db.exec(
      `create trigger reject_delete before delete on ${table} begin select raise(abort, 'injected lifecycle failure'); end`,
    );
    await expect(route.POST(deletionRequest(scope))).rejects.toThrow(
      "injected lifecycle failure",
    );
    expect(rows(db, all)).toEqual(before);
  },
);

it.each(["chat-profile", "garmin-all"])(
  "preserves missing-table failure and rollback for %s",
  async (scope) => {
    const { db, route } = await fixture();
    const table = scope === "chat-profile" ? "trainer_profile" : "sync_run";
    db.exec(`drop table ${table}`);
    const remaining = [...garminTables, ...chatTables, ...preserved].filter(
      (name) => name !== table,
    );
    const before = rows(db, remaining);
    await expect(route.POST(deletionRequest(scope))).rejects.toThrow(
      "no such table",
    );
    expect(rows(db, remaining)).toEqual(before);
  },
);

it("rejects unknown scopes and retains uncaught malformed JSON without mutation", async () => {
  const { db, route } = await fixture();
  const before = rows(db, [...garminTables, ...chatTables, ...preserved]);
  const response = await route.POST(deletionRequest("unknown"));
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: "unknown deletion scope" });
  await expect(
    route.POST(
      new Request("http://local.test/api/delete", {
        method: "POST",
        body: "{",
      }),
    ),
  ).rejects.toThrow();
  expect(rows(db, [...garminTables, ...chatTables, ...preserved])).toEqual(
    before,
  );
});

it("wires list/dashboard/health/summary/reference/tool reads to the same populated adapter", async () => {
  const storage = await import("../src/lib/db/repository");
  const activity = normalizeActivity({
    activityId: 1,
    activityType: "running",
    startTimeLocal: "2026-09-01T10:00:00Z",
    activityName: "  Test  ",
    distance: 0,
  });
  storage.upsertActivities([activity]);
  storage.upsertDailyHealth([
    { ...normalizeDailyHealth("2026-09-01", {}), steps: 0 },
  ]);
  const list = await import("../src/app/api/activities/route");
  const page = await (
    await list.GET(
      new Request(
        "http://local.test/api/activities?q=test&limit=NaN&offset=-1",
      ),
    )
  ).json();
  expect(page).toMatchObject({
    limit: 100,
    offset: 0,
    totalApprox: 1,
    nextOffset: null,
    activities: [{ garminId: "1", label: "Test", distanceMeters: 0 }],
  });
  const dashboard =
    await import("../src/app/api/activities/[garminId]/dashboard/route");
  expect(
    (
      await dashboard.GET(new Request("http://local.test"), {
        params: { garminId: "unknown" },
      })
    ).status,
  ).toBe(404);
  const detail = await (
    await dashboard.GET(new Request("http://local.test"), {
      params: { garminId: "1" },
    })
  ).json();
  expect(detail).toMatchObject({
    activity: { garminId: "1" },
    detail: { status: "not_requested" },
    laps: [],
  });
  const health = await import("../src/app/api/health-dashboard/route");
  expect(await (await health.GET()).json()).toMatchObject({
    latestDate: "2026-09-01",
    days: [{ steps: 0 }],
  });
  const summary = await import("../src/app/api/summary/route");
  expect(await (await summary.GET()).json()).toEqual(storage.importSummary());
  const app = await import("../src/lib/local-data/composition");
  expect(app.verifyActivityReference({ garminId: "1" })).toEqual(
    storage.verifyActivityReference({ garminId: "1" }),
  );
  const tool = await import("../src/lib/ai/tool-composition");
  const status = await tool.executeTrainerTool({
    index: 0,
    toolName: "getSyncStatus",
    context: new TrainerToolExecutionContext(),
    input: { availabilityLimit: 1 },
  });
  expect(status.status).toBe("succeeded");
  expect(status.result).toMatchObject({
    counts: storage.dataCounts(),
    availability: [],
  });
});
