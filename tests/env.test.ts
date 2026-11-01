import { describe, expect, it } from "vitest";
import {
  getOptionalEnv,
  isLlmDebugTraceEnabled,
  requireRuntimeEnv,
} from "../src/lib/env";

describe("environment", () => {
  it("keeps LLM debug traces enabled for local development visibility", () => {
    expect(isLlmDebugTraceEnabled(getOptionalEnv({}))).toBe(true);
    expect(
      isLlmDebugTraceEnabled(getOptionalEnv({ LLM_DEBUG_TRACES: "false" })),
    ).toBe(true);
    expect(
      isLlmDebugTraceEnabled(getOptionalEnv({ LLM_DEBUG_TRACES: "0" })),
    ).toBe(true);
    expect(
      isLlmDebugTraceEnabled(getOptionalEnv({ LLM_DEBUG_TRACES: "true" })),
    ).toBe(true);
    expect(
      isLlmDebugTraceEnabled(getOptionalEnv({ LLM_DEBUG_TRACES: "1" })),
    ).toBe(true);
  });

  it("accepts missing/blank history limits without supplying a sentinel date", () => {
    for (const date of [undefined, ""])
      expect(
        requireRuntimeEnv({
          DATABASE_PATH: "./x.sqlite",
          GARMIN_HISTORY_START_DATE: date,
        }).GARMIN_HISTORY_START_DATE,
      ).toBeUndefined();
  });
  it("preserves valid legacy limits and rejects malformed/future calendar dates", () => {
    expect(
      requireRuntimeEnv({ GARMIN_HISTORY_START_DATE: "2020-02-29" })
        .GARMIN_HISTORY_START_DATE,
    ).toBe("2020-02-29");
    for (const date of ["2020-02-30", "garbage", "9999-01-01"])
      expect(() =>
        requireRuntimeEnv({ GARMIN_HISTORY_START_DATE: date }),
      ).toThrow();
  });
});
