import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { syntheticWindowsInput } from "../scripts/desktop/windows_smoke_seed";
import { verify } from "../scripts/desktop/smoke_recipe";

describe("finite Windows in-memory authored input adapter", () => {
  it("uses the existing representative recipe with no filesystem/private selection", () => {
    const bytes = syntheticWindowsInput("2026-11-17");
    expect(bytes.subarray(0, 16).toString()).toBe("SQLite format 3\0");
    const db = new Database(bytes);
    try {
      expect(verify(db, "synthetic")).toBeTruthy();
      expect(db.prepare("pragma integrity_check").get()).toEqual({
        integrity_check: "ok",
      });
      expect(
        db.prepare("select count(*) as n from trainer_profile").get(),
      ).toEqual({ n: 1 });
    } finally {
      db.close();
    }
    expect(bytes.equals(syntheticWindowsInput("2026-11-17"))).toBe(true);
  });

  it("refuses invalid anchors before any state is published", () => {
    for (const anchor of ["2026-02-30", "../private", "2026-11-17\nsecret"])
      expect(() => syntheticWindowsInput(anchor)).toThrow();
  });
});
