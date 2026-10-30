import { describe, expect, it } from "vitest";
import { utcDateTimeSchema } from "../src/lib/training-plan/snapshot";

describe("preserved UTC document timestamp wire grammar with patched Zod", () => {
  it.each([
    "2026-10-30T12:34Z",
    "2026-10-30T12:34:56Z",
    "2024-02-29T23:59:59.123456Z",
  ])("accepts existing format %s", (value) => {
    expect(utcDateTimeSchema.safeParse(value).success).toBe(true);
  });
  it.each([
    "2026-02-29T12:00Z",
    "2026-10-30T25:00:00Z",
    "2026-10-30T12:34",
    "2026-10-30T12:34+02:00",
    "not-a-date",
  ])("rejects invalid or non-UTC format %s", (value) => {
    expect(utcDateTimeSchema.safeParse(value).success).toBe(false);
  });
});
