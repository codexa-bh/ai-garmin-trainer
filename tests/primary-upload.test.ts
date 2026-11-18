import { describe, expect, it } from "vitest";
import {
  lastUsedUpload,
  parseCuratedDeviceJson,
  primaryUpload,
  selectPrimary,
} from "../src/lib/garmin/primary-upload";

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
  it("retains validated selected identity only when direct time is unusable", () => {
    expect(selectPrimary([{ device_id: 123 }], now)).toEqual({
      kind: "selected",
      primaryId: "123",
      upload: { kind: "unknown", reason: "invalid-upload" },
    });
    expect(
      selectPrimary(
        [
          { device_id: "bike", is_primary: false },
          { device_id: 3456789012, is_primary: true, last_sync_time: null },
        ],
        now,
      ),
    ).toMatchObject({ kind: "selected", primaryId: "3456789012" });
    for (const payload of [
      [{ device_id: 1 }, { device_id: 2 }],
      [
        { device_id: 1, is_primary: true },
        { device_id: 2, is_primary: true },
      ],
      [{ device_id: 1.5 }],
      [{ device_id: "has space" }],
      [{ device_id: Number.MAX_SAFE_INTEGER + 1 }],
      [{}],
      [],
    ])
      expect(selectPrimary(payload, now).kind).toBe("unselected");
  });
  it("keeps numeric IDs only when their JSON spelling is a lossless canonical integer", () => {
    for (const [text, id] of [
      ['{"user_device_id":3456789012}', 3456789012],
      ['{"user_device_id":"3456789012"}', "3456789012"],
      ['{"user_device_id":"00123"}', "00123"],
    ] as const)
      expect(
        (parseCuratedDeviceJson(text) as { user_device_id: unknown })
          .user_device_id,
      ).toBe(id);
    for (const text of [
      '{"user_device_id":9007199254740993}',
      '{"user_device_id":12.0}',
      '{"user_device_id":1e3}',
      '{"user_device_id":-5}',
      '{"user_device_id":0}',
    ])
      expect(
        (parseCuratedDeviceJson(text) as { user_device_id: unknown })
          .user_device_id,
      ).toBeNaN();
    // Other numeric fields are unaffected.
    expect(parseCuratedDeviceJson('{"battery":1.5}')).toEqual({ battery: 1.5 });
  });
});

describe("matched last-used upload interval", () => {
  const reply = (extra: Record<string, unknown> = {}) => ({
    user_device_id: 123,
    device_name: "private",
    last_upload_time: "2026-11-16 10:00:00",
    ...extra,
  });
  it("matches the selected ID losslessly across number/string and keeps a whole-second UTC interval", () => {
    for (const id of [123, "123"])
      expect(lastUsedUpload(reply({ user_device_id: id }), "123", now)).toEqual(
        {
          kind: "known",
          primaryId: "123",
          uploadedAt: "2026-11-16T10:00:00.000Z",
          uploadedThrough: "2026-11-16T10:00:00.999Z",
          via: "last-used",
        },
      );
    expect(JSON.stringify(lastUsedUpload(reply(), "123", now))).not.toContain(
      "private",
    );
  });
  it("is independent of the host timezone", () => {
    const zone = process.env.TZ;
    try {
      for (const tz of ["America/Los_Angeles", "Pacific/Kiritimati", "UTC"]) {
        process.env.TZ = tz;
        expect(lastUsedUpload(reply(), "123", now)).toMatchObject({
          uploadedAt: "2026-11-16T10:00:00.000Z",
        });
      }
    } finally {
      process.env.TZ = zone;
    }
  });
  it.each([
    [
      "other device (bike)",
      reply({ user_device_id: 456 }),
      "last-used-mismatch",
    ],
    [
      "padded textual ID",
      reply({ user_device_id: "0123" }),
      "last-used-mismatch",
    ],
    ["unsafe numeric ID", reply({ user_device_id: NaN }), "last-used-invalid"],
    ["missing ID", reply({ user_device_id: undefined }), "last-used-invalid"],
    [
      "missing time",
      reply({ last_upload_time: undefined }),
      "last-used-invalid",
    ],
    [
      "offset text",
      reply({ last_upload_time: "2026-11-16T10:00:00Z" }),
      "last-used-invalid",
    ],
    [
      "fractional text",
      reply({ last_upload_time: "2026-11-16 10:00:00.5" }),
      "last-used-invalid",
    ],
    [
      "impossible date",
      reply({ last_upload_time: "2026-02-30 10:00:00" }),
      "last-used-invalid",
    ],
    [
      "future",
      reply({ last_upload_time: "2026-11-16 12:00:01" }),
      "last-used-invalid",
    ],
    [
      "future within truncated second",
      reply({ last_upload_time: "2026-11-16 12:00:00" }),
      "last-used-invalid",
    ],
    [
      "ancient",
      reply({ last_upload_time: "1999-12-31 23:59:59" }),
      "last-used-invalid",
    ],
    ["array", [reply()], "last-used-invalid"],
  ])("fails closed for %s", (_label, payload, reason) =>
    expect(lastUsedUpload(payload, "123", now)).toEqual({
      kind: "unknown",
      reason,
    }),
  );
  it("accepts a second that has entirely elapsed before observation", () => {
    expect(
      lastUsedUpload(
        reply({ last_upload_time: "2026-11-16 11:59:59" }),
        "123",
        now,
      ).kind,
    ).toBe("known");
  });
});
