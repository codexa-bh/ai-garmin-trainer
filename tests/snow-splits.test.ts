import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import FitParser from "fit-file-parser";
import { decodeActivityFit } from "../src/lib/garmin/official-fit";
import { buildFit } from "./official-fit-fixture";

const run = {
  index: 7,
  type: 29,
  start: 0,
  end: 5,
  elapsedMs: 5125,
  timerMs: 4000,
  movingMs: 3000,
  distanceCm: 12345,
  avgSpeedMmps: 1250,
  maxSpeedMmps: 3000,
  verticalMmps: -1250,
  elevation5: 2000,
  ascent: 0,
  descent: 12,
  startLat: 536870912,
  startLon: -536870912,
  endLat: 0,
  endLon: 0,
};
const lift = { index: 8, type: 28, start: 6, end: 20 };
const evidence = async (
  snowSplits: NonNullable<Parameters<typeof buildFit>[0]>["snowSplits"] = [
    run,
    lift,
  ],
  sessions = 1,
) =>
  (await decodeActivityFit(buildFit({ sport: 14, snowSplits, sessions })))
    .extras.snowSplits!;

describe("individual FIT snow evidence", () => {
  it("decodes the actual finite native Sync fixture's authored FIT bytes", async () => {
    const bytes = execFileSync("python3", [
      "-c",
      "import sys; sys.path.insert(0,'scripts/desktop'); from history_fixture import fit_file; sys.stdout.buffer.write(fit_file(14))",
    ]);
    const result = (await decodeActivityFit(bytes)).extras.snowSplits!;
    expect(result.status).toBe("populated");
    expect(result.rows.map((r) => r.splitType)).toEqual([
      "run",
      "lift",
      "run",
      "lift",
    ]);
    expect(result.rows[0]).toMatchObject({
      distanceMeters: 123.45,
      elapsedSeconds: 5.125,
      startElevationMeters: -100,
      avgVerticalSpeedMps: -1.25,
    });
  });
  it.each([13, 14])(
    "uses actual parser units for snow sport %i",
    async (sport) => {
      const bytes = buildFit({ sport, snowSplits: [run, lift] });
      const raw = await new FitParser({
        force: false,
        mode: "list",
      }).parseAsync(Buffer.from(bytes));
      expect(raw.splits?.[0]).toMatchObject({
        message_index: { value: 7 },
        total_elapsed_time: 5.125,
        start_elevation: -100,
        start_position_lat: 45,
        avg_vert_speed: -1.25,
      });
      const result = (await decodeActivityFit(bytes)).extras.snowSplits!;
      expect(result.status).toBe("populated");
      expect(result.rows[0]).toMatchObject({
        splitKey: "index:7",
        splitType: "run",
        elapsedSeconds: 5.125,
        timerSeconds: 4,
        movingSeconds: 3,
        distanceMeters: 123.45,
        avgSpeedMps: 1.25,
        maxSpeedMps: 3,
        avgVerticalSpeedMps: -1.25,
        ascentMeters: 0,
        descentMeters: 12,
        startElevationMeters: -100,
        startLat: 45,
        startLon: -45,
        endLat: 0,
        endLon: 0,
      });
      expect(result.rows[1]).toMatchObject({
        splitType: "lift",
        movingSeconds: null,
        distanceMeters: null,
      });
    },
  );
  it("retains source identity independently of ordering", async () => {
    const a = await evidence();
    const b = await evidence([lift, run]);
    expect(a.rows.map((r) => r.splitKey).sort()).toEqual(
      b.rows.map((r) => r.splitKey).sort(),
    );
    expect(b.rows[0].sourceOrder).toBe(0);
  });
  it("keeps missing instants/metrics unknown, including invalid markers", async () => {
    const result = await evidence([
      {
        index: 0,
        type: 29,
        maxSpeedMmps: 0xffffffff,
        startLat: 0x7fffffff,
        startLon: 0,
        elapsedMs: 0,
      },
    ]);
    expect(result.rows[0]).toMatchObject({
      startTime: null,
      endTime: null,
      maxSpeedMps: null,
      startLat: null,
      startLon: null,
      elapsedSeconds: 0,
    });
  });
  it("does not fabricate individual rows from summaries or drop valid rows on count disagreement", async () => {
    expect(
      (await decodeActivityFit(buildFit({ splitSummaryCount: 99 }))).extras
        .snowSplits,
    ).toMatchObject({ rows: [], status: "empty" });
    const result = (
      await decodeActivityFit(
        buildFit({ splitSummaryCount: 99, snowSplits: [run, lift] }),
      )
    ).extras.snowSplits!;
    expect(result.status).toBe("populated");
    expect(result.rows).toHaveLength(2);
  });
  it.each([
    [{ type: 29 }],
    [run, run],
    [{ ...run, index: 0xffff }],
    [{ ...run, type: 99 }],
    [{ ...run, end: -1 }],
  ])("refuses ambiguous/unverified sets %j", async (...splits) => {
    expect(await evidence(splits)).toMatchObject({
      rows: [],
      status: "unavailable",
    });
  });
  it("refuses multi-session and oversized sets without truncation", async () => {
    expect((await evidence([run], 2)).reason).toBe("ambiguous-sessions");
    expect(
      (
        await evidence(
          Array.from({ length: 2001 }, (_, index) => ({ ...run, index })),
        )
      ).reason,
    ).toBe("split-limit");
  });
});
