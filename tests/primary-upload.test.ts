import { describe, expect, it } from "vitest";
import { primaryUpload } from "../src/lib/garmin/primary-upload";

const now = new Date("2026-11-16T12:00:00Z");
const device = { device_id: 123, last_sync_time: "2026-11-16T10:00:00Z" };
describe("curated primary upload", () => {
  it("uses exactly one flag or an unflagged singleton, never another device", () => {
    expect(primaryUpload([device], now)).toEqual({
      kind: "known",
      primaryId: "123",
      uploadedAt: new Date(device.last_sync_time).toISOString(),
    });
    expect(
      primaryUpload(
        [
          { ...device, is_primary: true },
          { ...device, device_id: 2, last_sync_time: "2026-11-16T11:00:00Z" },
        ],
        now,
      ),
    ).toMatchObject({ kind: "known", primaryId: "123" });
    for (const payload of [
      [],
      [device, device],
      [
        { ...device, is_primary: true },
        { ...device, is_primary: true },
      ],
      [{ ...device, is_primary: "true" }],
      [null],
      {},
    ])
      expect(primaryUpload(payload, now).kind).toBe("unknown");
  });
  it("accepts epoch seconds/milliseconds and offset-bearing instants only", () => {
    for (const timestamp of [
      1794823200,
      1794823200000,
      "2026-11-16T11:00:00+01:00",
    ])
      expect(
        primaryUpload([{ ...device, last_sync_time: timestamp }], now),
      ).toMatchObject({
        kind: "known",
        uploadedAt: new Date(device.last_sync_time).toISOString(),
      });
    for (const timestamp of [
      null,
      undefined,
      NaN,
      Infinity,
      -1,
      100,
      "1794823200000",
      "2026-11-16 10:00:00",
      "2026-11-16T10:00:00",
      "2026-02-30T10:00:00Z",
      "2026-11-17T10:00:00Z",
    ])
      expect(
        primaryUpload([{ ...device, last_sync_time: timestamp }], now),
      ).toMatchObject({ kind: "unknown", reason: "invalid-upload" });
  });
});
