import Database from "better-sqlite3";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertDesktopDatabase } from "../src/lib/db/desktop-preflight";
import { realLocalPath } from "../src/lib/db/local-path";
import { describe, expect, it } from "vitest";
import { syntheticWindowsInput } from "../scripts/desktop/windows_smoke_seed";
import { verify } from "../scripts/desktop/smoke_recipe";
import { desktopValidationFailureCode } from "../scripts/desktop/settings";

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

  it("passes the actual desktop readonly preflight after binary file publication", () => {
    const root = realLocalPath(
      mkdtempSync(join(tmpdir(), "windows-seed-preflight-")),
    );
    try {
      const path = join(root, "trainer.sqlite");
      writeFileSync(path, syntheticWindowsInput("2026-11-17"), {
        flag: "wx",
        mode: 0o600,
      });
      expect(() => assertDesktopDatabase(path)).not.toThrow();
    } finally {
      rmSync(root, { recursive: true });
    }
  });

  it("keeps validator failure metadata finite and free of exception values", () => {
    for (const message of ["private path/key", "constructor", "__proto__"])
      expect(desktopValidationFailureCode(new Error(message))).toBe(
        "unavailable",
      );
    expect(desktopValidationFailureCode({ code: "private-capability" })).toBe(
      "unavailable",
    );
    expect(
      desktopValidationFailureCode({
        code: "SQLITE_CANTOPEN",
        message: "private path/key",
      }),
    ).toBe("SQLITE_CANTOPEN");
    expect(
      desktopValidationFailureCode(
        new Error(
          "Select a canonical absolute local path, without aliases or expansion.",
        ),
      ),
    ).toBe("canonical-path");
  });

  it("refuses invalid anchors before any state is published", () => {
    for (const anchor of ["2026-02-30", "../private", "2026-11-17\nsecret"])
      expect(() => syntheticWindowsInput(anchor)).toThrow();
  });
});
