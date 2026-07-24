import { describe, expect, it } from "vitest";
import {
  getOptionalEnv,
  isLlmDebugTraceEnabled,
  requireRuntimeEnv,
} from "../src/lib/env";

describe("environment", () => {
  it("keeps LLM debug traces disabled by default and enables only true-like env values", () => {
    expect(isLlmDebugTraceEnabled(getOptionalEnv({}))).toBe(false);
    expect(
      isLlmDebugTraceEnabled(getOptionalEnv({ LLM_DEBUG_TRACES: "false" })),
    ).toBe(false);
    expect(
      isLlmDebugTraceEnabled(getOptionalEnv({ LLM_DEBUG_TRACES: "0" })),
    ).toBe(false);
    expect(
      isLlmDebugTraceEnabled(getOptionalEnv({ LLM_DEBUG_TRACES: "true" })),
    ).toBe(true);
    expect(
      isLlmDebugTraceEnabled(getOptionalEnv({ LLM_DEBUG_TRACES: "1" })),
    ).toBe(true);
  });

  it("requires Garmin history start date for runtime", () => {
    expect(() =>
      requireRuntimeEnv({
        DATABASE_PATH: "./x.sqlite",
        NEXT_PUBLIC_APP_URL: "http://localhost:3000",
      }),
    ).toThrow(/GARMIN_HISTORY_START_DATE/);
  });
});
