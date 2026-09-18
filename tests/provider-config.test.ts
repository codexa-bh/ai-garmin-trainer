import { afterEach, describe, expect, it, vi } from "vitest";
import {
  OLLAMA_CHAT_DEFAULT_BASE_URL,
  OLLAMA_CHAT_DEFAULT_MODEL,
  aiProviderStatus,
  isLoopbackAiBaseUrl,
  selectedMemoryExtractionModel,
  selectedModel,
} from "../src/lib/ai/providers";
import { getOptionalEnv, hasConfiguredSecret } from "../src/lib/env";

function env(input: Record<string, string | undefined>) {
  return getOptionalEnv({
    NEXT_PUBLIC_APP_URL: "http://localhost:3000",
    DATABASE_PATH: "./test.sqlite",
    GARMIN_HISTORY_START_DATE: "2024-01-01",
    ...input,
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
});

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

  it("selects OpenRouter only explicitly and rejects missing or placeholder keys", () => {
    expect(env({}).OPENROUTER_MODEL).toBe("nvidia/nemotron-3.5-lightning:free");
    expect(() => env({ OPENROUTER_MODEL: "   " })).toThrow();
    const status = aiProviderStatus(
      env({
        AI_PROVIDER: "openrouter",
        OPENROUTER_API_KEY: "sentinel-router-key",
      }),
    );
    expect(status).toMatchObject({
      selected: "openrouter",
      selectionMode: "explicit",
      modelName: "nvidia/nemotron-3.5-lightning:free",
      openrouterKeyConfigured: true,
    });
    expect(JSON.stringify(status)).not.toContain("sentinel-router-key");
    for (const key of [undefined, "", "   ", "replace-with-openrouter-key"]) {
      expect(
        aiProviderStatus(
          env({
            AI_PROVIDER: "openrouter",
            OPENROUTER_API_KEY: key,
            DEEPSEEK_API_KEY: "ds-configured",
          }),
        ),
      ).toMatchObject({
        selected: null,
        failureClass: "provider.missing_openrouter_key",
        openrouterKeyConfigured: false,
      });
    }
    expect(
      aiProviderStatus(env({ OPENROUTER_API_KEY: "sentinel-router-key" }))
        .selected,
    ).toBeNull();
    expect(
      aiProviderStatus(
        env({
          OPENROUTER_API_KEY: "sentinel-router-key",
          DEEPSEEK_API_KEY: "ds-configured",
        }),
      ).selected,
    ).toBe("deepseek");
    expect(
      aiProviderStatus(
        env({
          OPENROUTER_API_KEY: "sentinel-router-key",
          OPENAI_API_KEY: "sk-configured",
        }),
      ).selected,
    ).toBe("openai");
  });

  it("keeps OpenRouter out of extraction with and without cloud keys", () => {
    vi.stubEnv("AI_PROVIDER", "openrouter");
    vi.stubEnv("OPENROUTER_API_KEY", "sentinel-router-key");
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("DEEPSEEK_API_KEY", "");
    expect(selectedMemoryExtractionModel()).toBeNull();
    vi.stubEnv("OPENAI_API_KEY", "sk-extractor");
    expect(selectedMemoryExtractionModel()?.provider).toBe("openai");
    vi.stubEnv("DEEPSEEK_API_KEY", "ds-extractor");
    expect(selectedMemoryExtractionModel()?.provider).toBe("deepseek");
    vi.stubEnv("OPENROUTER_API_KEY", "replace-with-openrouter-key");
    expect(() => selectedModel()).toThrow(/OPENROUTER_API_KEY/);
  });

  it("accepts explicit Ollama chat with local defaults and no cloud key", () => {
    const status = aiProviderStatus(env({ AI_PROVIDER: "ollama" }));

    expect(status).toMatchObject({
      requested: "ollama",
      selected: "ollama",
      selectionMode: "explicit",
      modelName: OLLAMA_CHAT_DEFAULT_MODEL,
      deepseekKeyConfigured: false,
      openaiKeyConfigured: false,
      ollamaBaseUrlLoopback: true,
      failureClass: null,
    });
    expect(isLoopbackAiBaseUrl(OLLAMA_CHAT_DEFAULT_BASE_URL)).toBe(true);
  });

  it("rejects explicit Ollama chat configured with a non-loopback endpoint", () => {
    const status = aiProviderStatus(
      env({
        AI_PROVIDER: "ollama",
        OLLAMA_BASE_URL: "https://example.com:11434/v1",
      }),
    );

    expect(status.selected).toBeNull();
    expect(status).toMatchObject({
      failureClass: "provider.ollama_non_loopback",
      ollamaBaseUrlLoopback: false,
    });
    expect(JSON.stringify(status)).not.toContain("https://example.com");
  });

  it("constructs the explicit Ollama chat model through the trainer-chat selector", () => {
    vi.stubEnv("AI_PROVIDER", "ollama");
    vi.stubEnv("OLLAMA_MODEL", "qwen3.5:4b");
    vi.stubEnv("OLLAMA_BASE_URL", "http://127.0.0.1:11434/v1");

    const selection = selectedModel();

    expect(selection).toMatchObject({
      provider: "ollama",
      selectionMode: "explicit",
      modelName: "qwen3.5:4b",
    });
    expect(selection.model).toBeTruthy();
  });

  it("keeps memory extraction off the Ollama chat provider", () => {
    vi.stubEnv("AI_PROVIDER", "ollama");
    vi.stubEnv("OLLAMA_MODEL", "qwen3.5:4b");
    vi.stubEnv("OLLAMA_BASE_URL", "http://127.0.0.1:11434/v1");

    expect(selectedMemoryExtractionModel()).toBeNull();

    vi.stubEnv("DEEPSEEK_API_KEY", "ds-live-memory-key");
    expect(selectedMemoryExtractionModel()).toMatchObject({
      provider: "deepseek",
      selectionMode: "default",
      modelName: "deepseek-chat",
    });
  });
});
