import { describe, expect, it } from "vitest";
import { requireRuntimeEnv } from "../src/lib/env";

describe("environment", () => {
  it("requires Garmin history start date for runtime", () => {
    expect(() =>
      requireRuntimeEnv({
        DATABASE_PATH: "./x.sqlite",
        NEXT_PUBLIC_APP_URL: "http://localhost:3000",
      }),
    ).toThrow(/GARMIN_HISTORY_START_DATE/);
  });
});
