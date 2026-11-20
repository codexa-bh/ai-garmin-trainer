import { describe, expect, it } from "vitest";
import {
  decodeActivityFit,
  estimatedZoneTime,
  exactZoneTime,
} from "../src/lib/garmin/official-fit";
import {
  FitAdmissionError,
  admitFitBytes,
} from "../src/lib/garmin/official-zip";
import { normalizeActivityDetail } from "../src/lib/garmin/detail-normalize";
import { buildFit, buildZip } from "./official-fit-fixture";

const NOW = new Date("2026-09-21T12:00:00Z");

describe("ZIP/FIT admission", () => {
  it("admits the expected single deflated FIT entry", () => {
    const fit = buildFit();
    expect(Buffer.from(admitFitBytes(buildZip(fit)))).toEqual(Buffer.from(fit));
    expect(Buffer.from(admitFitBytes(buildZip(fit, { method: 0 })))).toEqual(
      Buffer.from(fit),
    );
  });

  it.each([
    ["path traversal", { name: "../evil.fit" }, "entry-name"],
    ["absolute path", { name: "/etc/x.fit" }, "entry-name"],
    ["nested path", { name: "dir/a.fit" }, "entry-name"],
    ["non-fit name", { name: "a.txt" }, "entry-name"],
    ["encryption", { flags: 1 }, "encrypted"],
    ["multiple entries", { entries: 2 }, "unexpected-entry-count"],
    ["bad crc", { corruptCrc: true }, "checksum"],
    ["corrupt deflate", { corruptData: true }, "corrupt"],
  ])("refuses %s", (_label, options, reason) => {
    expect(() => admitFitBytes(buildZip(buildFit(), options))).toThrowError(
      new FitAdmissionError(reason),
    );
  });

  it("refuses an expansion-ratio zip bomb before inflating", () => {
    const bomb = buildZip(buildFit(), { declaredExpanded: 7_000_000 });
    expect(() => admitFitBytes(bomb)).toThrowError(/ratio/);
  });

  it("refuses oversize, empty and non-archive input", () => {
    expect(() => admitFitBytes(new Uint8Array(0))).toThrowError(/empty/);
    expect(() => admitFitBytes(new Uint8Array(5 * 1024 * 1024))).toThrowError(
      /too-large/,
    );
    expect(() =>
      admitFitBytes(
        Uint8Array.from([
          1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
          21, 22, 23,
        ]),
      ),
    ).toThrowError(/not-a-zip/);
  });

  it("refuses a stored entry that is not a FIT file", () => {
    expect(() =>
      admitFitBytes(
        buildZip(Uint8Array.from(new Array(64).fill(7)), { method: 0 }),
      ),
    ).toThrowError(/not-a-fit/);
  });
});

describe("in-process FIT decode", () => {
  it("decodes streams once into the shape detail normalization already reads", async () => {
    const decoded = await decodeActivityFit(buildZip(buildFit()));
    const detail = normalizeActivityDetail("100", decoded.detail);
    expect(detail.status).toBe("available");
    expect(detail.recordCount).toBe(3);
    expect(detail.lapCount).toBe(1);
    expect(detail.hasHeartRate).toBe(true);
    expect(detail.stream[0]).toMatchObject({
      heartRate: 120,
      altitudeMeters: 500,
      speedMps: 3,
    });
    expect(detail.stream[2].distanceMeters).toBeCloseTo(6);
  });

  it("maps session time_in_zone to zones 1–5 with lower bounds from the previous high boundary", async () => {
    const decoded = await decodeActivityFit(
      buildZip(
        buildFit({
          sessionZones: [11, 100, 200, 300, 400, 500, 77],
          highBoundaries: [100, 115, 130, 145, 160, 175],
        }),
      ),
    );
    const zones = exactZoneTime("100", decoded, NOW)!;
    expect(zones.source).toBe("garmin_official_fit");
    expect(zones.buckets).toEqual([
      { zone: 1, seconds: 100, sourceLowerBpm: 100 },
      { zone: 2, seconds: 200, sourceLowerBpm: 115 },
      { zone: 3, seconds: 300, sourceLowerBpm: 130 },
      { zone: 4, seconds: 400, sourceLowerBpm: 145 },
      { zone: 5, seconds: 500, sourceLowerBpm: 160 },
    ]);
    // Below-zone-1 (11) and above-zone-5 (77) never enter the five-zone total.
    expect(zones.sourceTotalSeconds).toBe(1500);
  });

  it("never adds lap-referenced buckets to the session totals", async () => {
    const decoded = await decodeActivityFit(
      buildZip(
        buildFit({
          sessionZones: [0, 10, 20, 30, 40, 50],
          lapZones: [0, 5, 5, 5, 5, 5],
        }),
      ),
    );
    expect(
      exactZoneTime("1", decoded, NOW)!.buckets.map((b) => b.seconds),
    ).toEqual([10, 20, 30, 40, 50]);
  });

  it("counts each multisport session once, by reference, without double counting", async () => {
    const decoded = await decodeActivityFit(
      buildZip(
        buildFit({ sessions: 2, sessionZones: [0, 10, 20, 30, 40, 50] }),
      ),
    );
    expect(
      exactZoneTime("1", decoded, NOW)!.buckets.map((b) => b.seconds),
    ).toEqual([20, 40, 60, 80, 100]);
  });

  it("reports unavailable, never zero, when no zone message exists", async () => {
    const decoded = await decodeActivityFit(buildZip(buildFit()));
    expect(exactZoneTime("1", decoded, NOW)).toBeNull();
    // No boundaries stored in the file, so no defensible estimate either.
    expect(estimatedZoneTime("1", decoded, NOW)).toBeNull();
  });

  it("estimates from sampled heart rate with file boundaries, labelled approximate", async () => {
    const decoded = await decodeActivityFit(
      buildZip(
        buildFit({
          highBoundaries: [100, 115, 130, 145, 160, 175],
          records: [
            { at: 0, hr: 105 },
            { at: 10, hr: 120 },
            { at: 20, hr: 150 },
            { at: 30, hr: 150 },
            // A 5-minute pause is not bridged.
            { at: 330, hr: 150 },
            { at: 340, hr: 150 },
          ],
        }),
      ),
    );
    const estimate = estimatedZoneTime("1", decoded, NOW)!;
    expect(estimate.source).toBe("garmin_official_estimate");
    expect(estimate.buckets.map((b) => b.seconds)).toEqual([10, 10, 0, 20, 0]);
  });

  it("returns exact configured-style facts from a zones target", async () => {
    const decoded = await decodeActivityFit(
      buildZip(
        buildFit({ zonesTarget: { max: 188, threshold: 168, ftp: 250 } }),
      ),
    );
    expect(decoded.zonesTarget).toEqual({
      max_heart_rate: 188,
      threshold_heart_rate: 168,
      functional_threshold_power: 250,
    });
  });

  it("maps invalid FIT bytes to a refusal, not an escaped parser error", async () => {
    const junk = Uint8Array.from([
      14, 16, 1, 0, 8, 0, 0, 0, 0x2e, 0x46, 0x49, 0x54, 0, 0, 1, 2, 3,
    ]);
    await expect(
      decodeActivityFit(buildZip(junk, { method: 0 })),
    ).rejects.toBeInstanceOf(FitAdmissionError);
  });

  it("stops before parsing when cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      decodeActivityFit(buildZip(buildFit()), controller.signal),
    ).rejects.toThrow();
  });
});
