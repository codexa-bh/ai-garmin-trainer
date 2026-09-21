import { describe, expect, it, vi } from "vitest";
import {
  createGarminReader,
  type GarminReaderAdapters,
} from "../src/lib/garmin/reader-adapter";

function fixture() {
  const journal: string[] = [];
  const ports: GarminReaderAdapters = {
    connector: {
      start: vi.fn(async () => {}),
      close: vi.fn(),
      callTool: vi.fn(async (name) => {
        journal.push(name);
        return "{}";
      }),
    },
    fit: {
      baseline: vi.fn(async () => {
        journal.push("fit:baseline");
        return undefined;
      }),
      altitude: vi.fn(async () => {
        journal.push("fit:altitude");
        return undefined;
      }),
      distance: vi.fn(async () => {
        journal.push("fit:distance");
        return undefined;
      }),
      speed: vi.fn(async () => {
        journal.push("fit:speed");
        return undefined;
      }),
    },
    archive: vi.fn((input) => {
      journal.push(`archive:${input.sourceTool}`);
    }),
  };
  return { ports, reader: createGarminReader(ports), journal };
}

describe("concrete Garmin wire/FIT/archive adapter", () => {
  it("fetches all health endpoints before parsing and archives only after all parse successfully", async () => {
    const f = fixture();
    vi.mocked(f.ports.connector.callTool).mockImplementation(async (name) => {
      f.journal.push(name);
      return name === "get_stats" ? "{invalid" : "{}";
    });
    await expect(f.reader.dailyHealth("2026-09-21")).rejects.toThrow();
    expect(f.journal).toEqual([
      "get_stats",
      "get_sleep_summary",
      "get_body_battery",
    ]);
    expect(f.ports.archive).not.toHaveBeenCalled();
    vi.mocked(f.ports.connector.callTool).mockImplementation(async (name) => {
      f.journal.push(name);
      return "{}";
    });
    f.journal.length = 0;
    expect(await f.reader.dailyHealth("2026-09-21")).toMatchObject({
      date: "2026-09-21",
      availability: "missing",
    });
    expect(f.journal).toEqual([
      "get_stats",
      "get_sleep_summary",
      "get_body_battery",
      "archive:get_stats",
      "archive:get_sleep_summary",
      "archive:get_body_battery",
    ]);
    expect(f.ports.connector.callTool).toHaveBeenLastCalledWith(
      "get_body_battery",
      { start_date: "2026-09-21", end_date: "2026-09-21" },
    );
  });

  it("archives an activity page before normalization can fail and retains page size/continuation", async () => {
    const f = fixture();
    vi.mocked(f.ports.connector.callTool).mockResolvedValueOnce(
      '{"activities":[null]}',
    );
    await expect(
      f.reader.activityPage("2026-09-19", "2026-09-21", 3),
    ).rejects.toThrow();
    expect(f.ports.archive).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceTool: "get_activities_by_date",
        subjectId: "2026-09-19:2026-09-21:page:3",
      }),
    );
    vi.mocked(f.ports.connector.callTool).mockResolvedValueOnce(
      '{"activities":[],"has_more":true,"next_page":9}',
    );
    expect(await f.reader.activityPage("2026-09-19", "2026-09-21", 3)).toEqual({
      activities: [],
      hasMore: true,
      nextPage: 9,
    });
    expect(f.ports.connector.callTool).toHaveBeenLastCalledWith(
      "get_activities_by_date",
      {
        start_date: "2026-09-19",
        end_date: "2026-09-21",
        page: 3,
        page_size: 100,
      },
    );
  });

  it("tries FIT supplements in altitude/distance/speed order before archive, preserving absent fallback behavior", async () => {
    const f = fixture();
    vi.mocked(f.ports.connector.callTool).mockImplementation(async (name) => {
      f.journal.push(name);
      return JSON.stringify({
        records: [{ timestamp: "2026-09-21T12:00:00Z", heart_rate_bpm: 140 }],
      });
    });
    const result = await f.reader.activityDetail("1");
    expect(f.journal).toEqual([
      "get_activity_fit_data",
      "fit:altitude",
      "fit:distance",
      "fit:speed",
      "archive:get_activity_fit_data",
    ]);
    expect(result).toMatchObject({
      recognized: true,
      detail: { garminId: "1", recordCount: 1, hasHeartRate: true },
    });
    expect(f.ports.connector.callTool).toHaveBeenCalledWith(
      "get_activity_fit_data",
      { activity_id: "1", include_records: true },
    );
  });

  it("does not archive after a supplement exception or replace an existing measured field", async () => {
    const f = fixture();
    vi.mocked(f.ports.connector.callTool).mockResolvedValue(
      JSON.stringify({
        records: [
          {
            timestamp: "2026-09-21T12:00:00Z",
            enhanced_altitude: 200,
            distance: 10,
            enhanced_speed: 3,
          },
        ],
      }),
    );
    await f.reader.activityDetail("1");
    expect(f.ports.fit.altitude).not.toHaveBeenCalled();
    expect(f.ports.fit.distance).not.toHaveBeenCalled();
    expect(f.ports.fit.speed).not.toHaveBeenCalled();
    vi.mocked(f.ports.connector.callTool).mockResolvedValue(
      '{"records":[{"heart_rate_bpm":140}]}',
    );
    vi.mocked(f.ports.fit.altitude).mockRejectedValue(
      new Error("supplement failure"),
    );
    vi.mocked(f.ports.archive).mockClear();
    await expect(f.reader.activityDetail("1")).rejects.toThrow(
      "supplement failure",
    );
    expect(f.ports.archive).not.toHaveBeenCalled();
  });

  it("falls back to local FIT only after exhausting recent candidates and uses no detail records", async () => {
    const f = fixture();
    vi.mocked(f.ports.connector.callTool)
      .mockRejectedValueOnce(new Error("unsupported"))
      .mockResolvedValueOnce("{}");
    await f.reader.fitBaseline(["1", "2"]);
    expect(f.ports.fit.baseline).toHaveBeenCalledWith(["1", "2"]);
    expect(f.ports.connector.callTool).toHaveBeenNthCalledWith(
      2,
      "get_activity_fit_data",
      { activity_id: "2", include_records: false },
    );
    vi.mocked(f.ports.fit.baseline).mockClear();
    vi.mocked(f.ports.connector.callTool).mockResolvedValueOnce(
      '{"zonesTarget":{}}',
    );
    expect(await f.reader.fitBaseline(["1"])).toEqual({ zonesTarget: {} });
    expect(f.ports.fit.baseline).not.toHaveBeenCalled();
  });

  it("retains non-JSON text as a message object and treats array detail as unrecognized", async () => {
    const f = fixture();
    vi.mocked(f.ports.connector.callTool).mockResolvedValueOnce(
      "  not supported  ",
    );
    expect(await f.reader.profile()).toEqual({ message: "not supported" });
    vi.mocked(f.ports.connector.callTool).mockResolvedValueOnce("[]");
    expect(await f.reader.activityDetail("1")).toMatchObject({
      recognized: false,
      detail: { status: "unsupported" },
    });
    vi.mocked(f.ports.connector.callTool).mockResolvedValueOnce("[]");
    expect(await f.reader.activityEffort("1")).toBeNull();
  });
});
