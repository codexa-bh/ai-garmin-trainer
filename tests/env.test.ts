import { describe, expect, it } from "vitest";
import { isEmailAllowed, requireRuntimeEnv } from "../src/lib/env";

describe("environment and allowlist", () => {
  it("fails closed for unallowlisted Google emails", () => {
    expect(
      isEmailAllowed("owner@example.com", {
        ALLOWED_GOOGLE_EMAILS: "owner@example.com",
      }),
    ).toBe(true);
    expect(
      isEmailAllowed("other@example.com", {
        ALLOWED_GOOGLE_EMAILS: "owner@example.com",
      }),
    ).toBe(false);
  });

  it("requires Garmin history start date for runtime", () => {
    expect(() =>
      requireRuntimeEnv({
        ALLOWED_GOOGLE_EMAILS: "owner@example.com",
        DATABASE_PATH: "./x.sqlite",
        NEXT_PUBLIC_APP_URL: "http://localhost:3000",
        BETTER_AUTH_SECRET: "1234567890123456",
        GOOGLE_CLIENT_ID: "id",
        GOOGLE_CLIENT_SECRET: "secret",
      }),
    ).toThrow(/GARMIN_HISTORY_START_DATE/);
  });
});
