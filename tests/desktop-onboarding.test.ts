import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { freshDatabase } from "../scripts/desktop/initialize";
import { activationEnvironment } from "../scripts/desktop/settings";
import {
  currentSchemaVersion,
  LATEST_SCHEMA_VERSION,
  runIntegrityCheck,
} from "../src/lib/db/migrations";

describe("fresh-only desktop initialization", () => {
  it("uses the authoritative complete schema without any filesystem target or WAL", () => {
    const bytes = freshDatabase({ version: 1 });
    expect(bytes.subarray(0, 16).toString()).toBe("SQLite format 3\0");
    const db = new Database(bytes);
    try {
      expect(currentSchemaVersion(db)).toBe(LATEST_SCHEMA_VERSION);
      expect(runIntegrityCheck(db)).toBe("ok");
      expect(
        db.prepare("select count(*) as count from activity").get(),
      ).toEqual({ count: 0 });
      expect(
        db.prepare("select count(*) as count from conversation").get(),
      ).toEqual({ count: 0 });
      expect(db.prepare("pragma journal_mode").get()).toEqual({
        journal_mode: "memory",
      });
    } finally {
      db.close();
    }
    // Migration timestamps are intentionally fresh, not byte-identical seeds.
    const independent = new Database(freshDatabase({ version: 1 }));
    try {
      expect(currentSchemaVersion(independent)).toBe(LATEST_SCHEMA_VERSION);
      expect(runIntegrityCheck(independent)).toBe("ok");
      expect(
        independent.prepare("select count(*) as count from activity").get(),
      ).toEqual({ count: 0 });
    } finally {
      independent.close();
    }
  });
  it("refuses selected-path, settings, control and unsupported protocol inputs", () => {
    for (const input of [
      null,
      [],
      {},
      { version: 2 },
      { version: 1, database: "/private/original.sqlite" },
      { version: 1, secrets: {} },
    ])
      expect(() => freshDatabase(input)).toThrow();
  });
  it("separates fresh configuration readiness from existing-file admission and remote availability", () => {
    const frame = {
      version: 1,
      fields: {
        DATABASE_PATH: "/private/uncreated/new.sqlite",
        GARMIN_HISTORY_START_DATE: "2025-01-01",
        AI_PROVIDER: "openai",
      },
      secrets: { OPENAI_API_KEY: "sentinel-configured-only" },
    };
    expect(activationEnvironment(frame, "new").AI_MODEL).toBe("gpt-6-luna");
    expect(() => activationEnvironment(frame)).toThrow();
    expect(() =>
      activationEnvironment({ ...frame, secrets: {} }, "new"),
    ).toThrow();
    expect(() =>
      activationEnvironment(
        { ...frame, secrets: { OPENAI_API_KEY: "your-api-key" } },
        "new",
      ),
    ).toThrow();
    expect(
      activationEnvironment(
        {
          ...frame,
          fields: { ...frame.fields, AI_PROVIDER: "ollama" },
          secrets: {},
        },
        "new",
      ).MEMORY_ENABLED,
    ).toBe("false");
  });
});
