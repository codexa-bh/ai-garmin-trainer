import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  process.env.DATABASE_PATH = join(
    mkdtempSync(join(tmpdir(), "trainer-memory-config-")),
    "test.sqlite",
  );
});

async function modules() {
  const envModule = await import("../src/lib/env");
  const memoryModule = await import("../src/lib/memory/config");
  return { ...envModule, ...memoryModule };
}

describe("memory runtime configuration", () => {
  it("ignores the retired memory-only embedding API key", async () => {
    const { getOptionalEnv, memoryRuntimeConfig, memoryConfigProblems } =
      await modules();
    const env = getOptionalEnv({
      MEMORY_ENABLED: "true",
      MEMORY_EMBEDDING_PROVIDER: "openai",
      MEMORY_EMBEDDING_API_KEY: "sk-retired-memory-key",
      OPENAI_API_KEY: "replace-with-openai-key",
    });

    const config = memoryRuntimeConfig(env);

    expect(config.embeddingApiKey).toBeUndefined();
    expect(memoryConfigProblems(config)).toContain(
      "memory embedding OpenAI key missing or placeholder",
    );
  });

  it("uses the existing OpenAI provider key for OpenAI-compatible embeddings", async () => {
    const { getOptionalEnv, memoryRuntimeConfig, memoryConfigProblems } =
      await modules();
    const env = getOptionalEnv({
      MEMORY_ENABLED: "true",
      MEMORY_EMBEDDING_PROVIDER: "openai",
      OPENAI_API_KEY: "sk-live-openai-key",
    });

    const config = memoryRuntimeConfig(env);

    expect(config.embeddingApiKey).toBe("sk-live-openai-key");
    expect(memoryConfigProblems(config)).toEqual([]);
  });

  it("accepts Ollama embeddings with local defaults and no provider key", async () => {
    const { getOptionalEnv, memoryRuntimeConfig, memoryConfigProblems } =
      await modules();
    const env = getOptionalEnv({
      MEMORY_ENABLED: "true",
      MEMORY_EMBEDDING_PROVIDER: "ollama",
      OPENAI_API_KEY: "replace-with-openai-key",
    });

    const config = memoryRuntimeConfig(env);

    expect(config.embeddingProvider).toBe("ollama");
    expect(config.embeddingModel).toBe("nomic-embed-text");
    expect(config.embeddingBaseUrl).toBe("http://127.0.0.1:11434");
    expect(config.embeddingApiKey).toBeUndefined();
    expect(memoryConfigProblems(config)).toEqual([]);
  });

  it("rejects non-loopback Ollama embedding base URLs", async () => {
    const { getOptionalEnv, memoryRuntimeConfig, memoryConfigProblems } =
      await modules();
    const env = getOptionalEnv({
      MEMORY_ENABLED: "true",
      MEMORY_EMBEDDING_PROVIDER: "ollama",
      MEMORY_EMBEDDING_BASE_URL: "https://example.com:11434",
    });

    const config = memoryRuntimeConfig(env);

    expect(memoryConfigProblems(config)).toContain(
      "memory embedding Ollama base URL must be loopback/local",
    );
  });

  it("keeps deterministic embeddings explicit and keyless", async () => {
    const { getOptionalEnv, memoryRuntimeConfig, memoryConfigProblems } =
      await modules();
    const env = getOptionalEnv({
      MEMORY_ENABLED: "true",
      MEMORY_EMBEDDING_PROVIDER: "deterministic",
      OPENAI_API_KEY: "replace-with-openai-key",
    });

    const config = memoryRuntimeConfig(env);

    expect(config.embeddingProvider).toBe("deterministic");
    expect(config.embeddingApiKey).toBeUndefined();
    expect(memoryConfigProblems(config)).toEqual([]);
  });
});
