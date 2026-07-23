import { describe, expect, it } from "vitest";
import { aiProviderStatus } from "../src/lib/ai/providers";
import { getOptionalEnv, hasConfiguredSecret } from "../src/lib/env";

function env(input: Record<string, string | undefined>) {
  return getOptionalEnv({
    NEXT_PUBLIC_APP_URL: "http://localhost:3000",
    DATABASE_PATH: "./test.sqlite",
    GARMIN_HISTORY_START_DATE: "2024-01-01",
    ...input,
  });
}

describe("AI provider selection", () => {
  it("defaults to DeepSeek when a valid DeepSeek key is configured", () => {
    const status = aiProviderStatus(
      env({ DEEPSEEK_API_KEY: "ds-live-test-key" }),
    );

    expect(status).toMatchObject({
      requested: "auto",
      selected: "deepseek",
      selectionMode: "default",
      modelName: "deepseek-chat",
    });
  });

  it("falls back to OpenAI in auto mode when DeepSeek is unavailable", () => {
    const status = aiProviderStatus(
      env({
        DEEPSEEK_API_KEY: "replace-with-deepseek-key",
        OPENAI_API_KEY: "sk-live-openai-key",
      }),
    );

    expect(status).toMatchObject({
      requested: "auto",
      selected: "openai",
      selectionMode: "fallback",
      modelName: "gpt-4o-mini",
      deepseekKeyConfigured: false,
      openaiKeyConfigured: true,
    });
  });

  it("honors explicit provider overrides without silently falling through", () => {
    const status = aiProviderStatus(
      env({
        AI_PROVIDER: "deepseek",
        DEEPSEEK_API_KEY: "replace-with-deepseek-key",
        OPENAI_API_KEY: "sk-live-openai-key",
      }),
    );

    expect(status.selected).toBeNull();
    expect(status.failureClass).toBe("provider.missing_deepseek_key");
    expect(status.remediation).toMatch(/remove AI_PROVIDER=deepseek/);
  });

  it("reports an actionable no-provider state when keys are missing or placeholders", () => {
    const status = aiProviderStatus(
      env({
        DEEPSEEK_API_KEY: "replace-with-deepseek-key",
        OPENAI_API_KEY: "replace-with-openai-key",
      }),
    );

    expect(status.selected).toBeNull();
    expect(status.failureClass).toBe("provider.no_configured_key");
    expect(status.remediation).toMatch(
      /placeholder example values are ignored/,
    );
    expect(hasConfiguredSecret("replace-with-openai-key")).toBe(false);
  });
});
