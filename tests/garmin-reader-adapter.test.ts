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
  it("reads only curated primary evidence, never archives devices and reports conservative unknown/fatal failures", async () => {
    const f = fixture();
    vi.mocked(f.ports.connector.callTool).mockResolvedValue(
      '[{"device_id":1,"is_primary":true,"last_sync_time":"2020-01-02T12:00:00Z","serial_number":"private"}]',
    );
    expect(await f.reader.primaryUpload!()).toEqual({
      kind: "known",
      primaryId: "1",
      uploadedAt: "2020-01-02T12:00:00.000Z",
    });
    expect(f.ports.connector.callTool).toHaveBeenLastCalledWith(
      "get_devices",
      {},
    );
    expect(f.ports.archive).not.toHaveBeenCalled();
    for (const text of [
      "No devices found.",
      "[invalid",
      "{}",
      "unexpected private reply",
      '[{"device_id":1}]',
    ]) {
      vi.mocked(f.ports.connector.callTool).mockResolvedValue(text);
      const evidence = await f.reader.primaryUpload!();
      expect(evidence.kind).toBe("unknown");
      expect(JSON.stringify(evidence)).not.toContain("private");
    }
    for (const text of ["401 token private", "429 rate limit private"]) {
      vi.mocked(f.ports.connector.callTool).mockResolvedValue(text);
      await expect(f.reader.primaryUpload!()).rejects.toThrow(/Garmin/);
    }
  });
  describe("single matched last-used fallback", () => {
    const watch =
      '[{"device_id":3456789012,"is_primary":true,"device_name":"private"},{"device_id":7,"is_primary":false,"last_sync_time":"2020-01-02T12:00:00Z"}]';
    function withFallback(
      devices: string,
      reply: string | (() => Promise<string>),
      control?: GarminReaderAdapters["control"],
    ) {
      const journal: string[] = [];
      const dedicated = {
        start: vi.fn(async () => {
          journal.push("fallback:start");
        }),
        close: vi.fn(() => {
          journal.push("fallback:close");
        }),
        callTool: vi.fn(async (name: string) => {
          journal.push(name);
          return typeof reply === "string" ? reply : reply();
        }),
      };
      const f = fixture();
      vi.mocked(f.ports.connector.callTool).mockImplementation(async (name) => {
        journal.push(name);
        return devices;
      });
      const lastUsedConnector = vi.fn(() => dedicated);
      const reader = createGarminReader({
        ...f.ports,
        control,
        lastUsedConnector,
      });
      return { reader, journal, dedicated, lastUsedConnector, ports: f.ports };
    }
    const matching =
      '{"user_device_id":"3456789012","device_name":"private","last_upload_time":"2020-01-03 08:00:00"}';

    it("uses one dedicated read only for a valid selected ID without usable direct time", async () => {
      const f = withFallback(watch, matching);
      const evidence = await f.reader.primaryUpload!();
      expect(evidence).toEqual({
        kind: "known",
        primaryId: "3456789012",
        uploadedAt: "2020-01-03T08:00:00.000Z",
        uploadedThrough: "2020-01-03T08:00:00.999Z",
        via: "last-used",
      });
      expect(f.journal).toEqual([
        "get_devices",
        "fallback:start",
        "get_device_last_used",
        "fallback:close",
      ]);
      expect(f.dedicated.callTool).toHaveBeenCalledExactlyOnceWith(
        "get_device_last_used",
        {},
      );
      expect(f.ports.archive).not.toHaveBeenCalled();
      expect(JSON.stringify(evidence)).not.toContain("private");
    });

    it("makes zero fallback calls for direct evidence, ambiguity or invalid selected identity", async () => {
      for (const devices of [
        '[{"device_id":1,"last_sync_time":"2020-01-02T12:00:00Z"}]',
        '[{"device_id":1},{"device_id":2}]',
        '[{"device_id":1,"is_primary":true},{"device_id":2,"is_primary":true}]',
        '[{"device_id":9007199254740993,"is_primary":true}]',
        '[{"device_id":12.0}]',
        "[]",
        "No devices found.",
        "[invalid",
      ]) {
        const f = withFallback(devices, matching);
        await f.reader.primaryUpload!();
        expect(f.lastUsedConnector).not.toHaveBeenCalled();
        expect(f.journal).toEqual(["get_devices"]);
      }
    });

    it.each([
      [
        "no last-used device",
        "No last used device found.",
        "last-used-unavailable",
      ],
      [
        "bike with newer upload",
        '{"user_device_id":7,"last_upload_time":"2020-01-03 08:00:00"}',
        "last-used-mismatch",
      ],
      [
        "unsafe numeric ID",
        '{"user_device_id":3456789012.0,"last_upload_time":"2020-01-03 08:00:00"}',
        "last-used-invalid",
      ],
      ["malformed JSON", "{private", "last-used-invalid"],
      ["empty object", "{}", "last-used-invalid"],
      [
        "generic error text",
        "Error retrieving last used device: private",
        "last-used-unavailable",
      ],
    ])(
      "keeps %s unknown with a fixed reason and no retry",
      async (_label, reply, reason) => {
        const f = withFallback(watch, reply);
        const evidence = await f.reader.primaryUpload!();
        expect(evidence).toEqual({ kind: "unknown", reason });
        expect(JSON.stringify(evidence)).not.toContain("private");
        expect(f.dedicated.callTool).toHaveBeenCalledTimes(1);
        expect(f.dedicated.close).toHaveBeenCalledTimes(1);
      },
    );

    it("reports unproven conversion as unavailable without dispatch", async () => {
      const f = fixture();
      vi.mocked(f.ports.connector.callTool).mockResolvedValue(watch);
      const reader = createGarminReader({
        ...f.ports,
        lastUsedConnector: () => null,
      });
      expect(await reader.primaryUpload!()).toEqual({
        kind: "unknown",
        reason: "last-used-unavailable",
      });
      expect(await createGarminReader(f.ports).primaryUpload!()).toEqual({
        kind: "unknown",
        reason: "last-used-unavailable",
      });
    });

    it("keeps auth/rate-limit fatal, and never falls back after a fatal get_devices reply", async () => {
      for (const text of ["401 token private", "429 rate limit private"]) {
        const failed = vi.fn();
        const control = {
          admit: vi.fn(),
          failed,
          remainingMs: () => 60_000,
          cancelled: () => false,
        };
        const f = withFallback(watch, text, control);
        await expect(f.reader.primaryUpload!()).rejects.toThrow(/Garmin/);
        expect(failed).toHaveBeenCalled();
        expect(f.dedicated.close).toHaveBeenCalled();
        const g = withFallback(text, matching, control);
        await expect(g.reader.primaryUpload!()).rejects.toThrow(/Garmin/);
        expect(g.lastUsedConnector).not.toHaveBeenCalled();
      }
    });

    it("admits the fallback read like any other, honours cancellation/budget and closes the dedicated process", async () => {
      let cancelled = false;
      const admit = vi.fn(() => {
        if (admit.mock.calls.length === 2) cancelled = true;
      });
      const control = {
        admit,
        failed: vi.fn(),
        remainingMs: () => 60_000,
        cancelled: () => cancelled,
      };
      const f = withFallback(watch, matching, control);
      await expect(f.reader.primaryUpload!()).rejects.toThrow(/cancelled/);
      expect(admit).toHaveBeenCalledTimes(2);
      expect(f.dedicated.callTool).not.toHaveBeenCalled();
      expect(f.dedicated.close).toHaveBeenCalledTimes(1);
      const exhausted = withFallback(watch, matching, {
        admit: vi.fn(),
        failed: vi.fn(),
        remainingMs: () => 0,
        cancelled: () => false,
      });
      await expect(exhausted.reader.primaryUpload!()).rejects.toThrow(/budget/);
      expect(exhausted.lastUsedConnector).not.toHaveBeenCalled();
      // A thrown connector failure stays a truthful failure, not evidence.
      const thrown = withFallback(watch, async () => {
        throw new Error("Garmin connector request failed");
      });
      await expect(thrown.reader.primaryUpload!()).rejects.toThrow(
        /connector request failed/,
      );
      expect(thrown.dedicated.close).toHaveBeenCalledTimes(1);
    });

    it("closing the reader during the fallback also closes the dedicated process", async () => {
      let release!: (text: string) => void;
      const f = withFallback(
        watch,
        () => new Promise<string>((resolve) => (release = resolve)),
      );
      const pending = f.reader.primaryUpload!();
      await vi.waitFor(() => expect(f.dedicated.callTool).toHaveBeenCalled());
      f.reader.close();
      expect(f.dedicated.close).toHaveBeenCalled();
      release(matching);
      await pending;
    });
  });
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

  it("accepts the pinned connector's exact between-date empty battery/body/weight replies", async () => {
    const f = fixture();
    vi.mocked(f.ports.connector.callTool).mockImplementation(async (name) => {
      if (name === "get_stats") return "No stats found for 2026-11-02";
      if (name === "get_sleep_summary")
        return "No sleep data found for 2026-11-02";
      if (name === "get_body_battery")
        return "No body battery data found between 2026-11-02 and 2026-11-02";
      if (name === "get_body_composition")
        return "No body composition data found between 2026-10-01 and 2026-10-30";
      return "No weight measurements found between 2026-10-01 and 2026-10-30.";
    });
    expect(await f.reader.dailyHealth("2026-11-02")).toMatchObject({
      availability: "missing",
    });
    expect(await f.reader.bodyComposition("2026-10-01", "2026-10-30")).toEqual(
      {},
    );
    expect(await f.reader.weighIns("2026-10-01", "2026-10-30")).toEqual({});
  });
  it("keeps valid stats when a pinned curated battery summary has no level metric", async () => {
    const f = fixture();
    vi.mocked(f.ports.connector.callTool).mockImplementation(async (name) =>
      JSON.stringify(
        name === "get_stats"
          ? { total_steps: 20 }
          : name === "get_sleep_summary"
            ? {}
            : [{ date: "2026-11-02", charged: 0, drained: null, events: [] }],
      ),
    );
    expect(await f.reader.dailyHealth("2026-11-02")).toMatchObject({
      steps: 20,
      bodyBatteryMorning: null,
      bodyBatteryEvening: null,
    });
    vi.mocked(f.ports.connector.callTool).mockImplementation(async (name) =>
      JSON.stringify(
        name === "get_stats"
          ? { total_steps: 20 }
          : name === "get_sleep_summary"
            ? {}
            : [
                {
                  date: "2026-11-02",
                  charged: "Error",
                  drained: null,
                  events: [],
                },
              ],
      ),
    );
    await expect(f.reader.dailyHealth("2026-11-02")).rejects.toThrow(
      "unrecognized",
    );
  });
  it.each([
    { stats: { date: "2026-11-02", daily_step_goal: 10000 }, sleep: {} },
    { stats: {}, sleep: { awake_count: 0, avg_spo2_percent: 98 } },
  ])(
    "accepts reviewed metadata-only curated health without inventing metrics: %j",
    async ({ stats, sleep }) => {
      const f = fixture();
      vi.mocked(f.ports.connector.callTool).mockImplementation(async (name) =>
        JSON.stringify(
          name === "get_stats"
            ? stats
            : name === "get_sleep_summary"
              ? sleep
              : [],
        ),
      );
      expect(await f.reader.dailyHealth("2026-11-02")).toMatchObject({
        availability: "missing",
        steps: null,
        sleepMinutes: null,
      });
    },
  );
  it.each([
    { date: "2026-11-01", daily_step_goal: 10000 },
    { date: "2026-11-02", daily_step_goal: "invalid" },
    { date: "2026-11-02", private_unknown: 1 },
  ])(
    "rejects wrong-date, malformed and unknown stats metadata: %j",
    async (stats) => {
      const f = fixture();
      vi.mocked(f.ports.connector.callTool).mockImplementation(async (name) =>
        JSON.stringify(name === "get_stats" ? stats : {}),
      );
      await expect(f.reader.dailyHealth("2026-11-02")).rejects.toThrow(
        "unrecognized",
      );
      expect(f.ports.archive).not.toHaveBeenCalled();
    },
  );
  it.each([
    "Error retrieving weight measurements: network unavailable",
    "No weight measurements found between 2026-10-01 and 2026-10-30. Error retrieving data",
    "No unreviewed data found between 2026-10-01 and 2026-10-30",
    "No weight measurements found between unknown and unknown",
  ])(
    "does not reinterpret errors or unreviewed empty text as successful coverage: %s",
    async (text) => {
      const f = fixture();
      vi.mocked(f.ports.connector.callTool).mockResolvedValue(text);
      await expect(
        f.reader.weighIns("2026-10-01", "2026-10-30"),
      ).rejects.toThrow();
      expect(f.ports.archive).not.toHaveBeenCalled();
    },
  );
  it("archives an activity page before normalization can fail and retains page size/continuation", async () => {
    const f = fixture();
    vi.mocked(f.ports.connector.callTool).mockResolvedValueOnce(
      '{"activities":[null],"has_more":false}',
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

  it("rejects unrecognized text without reflecting it and treats array detail as unrecognized", async () => {
    const f = fixture();
    vi.mocked(f.ports.connector.callTool).mockResolvedValueOnce(
      "  not supported  ",
    );
    await expect(f.reader.profile()).rejects.toThrow(
      "upstream details are withheld",
    );
    vi.mocked(f.ports.connector.callTool).mockResolvedValueOnce("[]");
    expect(await f.reader.activityDetail("1")).toMatchObject({
      recognized: false,
      detail: { status: "unsupported" },
    });
    vi.mocked(f.ports.connector.callTool).mockResolvedValueOnce("[]");
    expect(await f.reader.activityEffort("1")).toBeNull();
  });
});
