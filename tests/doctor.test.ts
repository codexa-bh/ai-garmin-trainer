import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runDoctor } from "../src/lib/diagnostics/doctor";
import { redactDiagnosticValue } from "../src/lib/diagnostics/redaction";

const baseEnv = {
  NEXT_PUBLIC_APP_URL: "http://localhost:3000",
  DATABASE_PATH: join(
    mkdtempSync(join(tmpdir(), "doctor-db-")),
    "trainer.sqlite",
  ),
  GARMIN_HISTORY_START_DATE: "2024-01-01",
  AI_PROVIDER: "openai",
  AI_MODEL: "gpt-4o-mini",
  OPENAI_API_KEY: "sk-testdoctorredacted",
};

describe("source-beta doctor and redaction", () => {
  it("reports stable failure classes without printing secret values", () => {
    const report = runDoctor(baseEnv);
    const text = JSON.stringify(report);
    expect(report.checks.map((item) => item.className)).toContain(
      "network.loopback_only",
    );
    expect(text).not.toContain("sk-testdoctorredacted");
  });

  it("reports native-owned official Garmin access without probing Python, uvx, tokens or Garmin", () => {
    const report = runDoctor(baseEnv);
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        id: "garmin.connection",
        status: "pass",
        className: "garmin.native_settings_owned",
      }),
    );
    expect(report.facts.garmin).toEqual({
      access: "official-personal-api",
      settingsOwner: "native-desktop",
    });
    const text = JSON.stringify(report);
    expect(text).not.toMatch(/python|uvx|garmin_mcp|token dir/i);
  });

  it("fails closed for unsupported LAN/public exposure", () => {
    const report = runDoctor({
      ...baseEnv,
      NEXT_PUBLIC_APP_URL: "http://0.0.0.0:3000",
    });
    expect(report.ok).toBe(false);
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        className: "network.unsupported_exposure",
        remediation: expect.stringContaining("Tauri"),
      }),
    );
    expect(JSON.stringify(report)).not.toContain("start:local");
    expect(report.checks).not.toContainEqual(
      expect.objectContaining({
        remediation: expect.stringContaining("next start"),
      }),
    );
  });

  it("reports DeepSeek-first provider selection and OpenAI memory embedding readiness without retired keys", () => {
    const report = runDoctor({
      ...baseEnv,
      AI_PROVIDER: "auto",
      DEEPSEEK_API_KEY: "ds-live-doctor-key",
      OPENAI_API_KEY: "replace-with-openai-key",
      MEMORY_ENABLED: "true",
      MEMORY_EMBEDDING_PROVIDER: "openai",
      MEMORY_EMBEDDING_API_KEY: "sk-retired-memory-key",
    });
    const providerFacts = report.facts.provider as {
      selected: string;
      selectionMode: string;
      deepseekKeyPresent: boolean;
      openaiKeyPresent: boolean;
    };
    const memoryCheck = report.checks.find(
      (item) => item.id === "memory.embedding",
    );
    const text = JSON.stringify(report);

    expect(providerFacts).toMatchObject({
      selected: "deepseek",
      selectionMode: "default",
      deepseekKeyPresent: true,
      openaiKeyPresent: false,
    });
    expect(memoryCheck).toMatchObject({
      status: "fail",
      className: "memory.embedding_missing_openai_key",
    });
    expect(text).not.toContain("sk-retired-memory-key");
    expect(text).not.toContain("MEMORY_EMBEDDING_API_KEY");
  });

  it("reports OpenRouter configuration without treating it as remote readiness or exposing its key", () => {
    const report = runDoctor({
      ...baseEnv,
      AI_PROVIDER: "openrouter",
      OPENROUTER_API_KEY: "sentinel-router-key",
    });
    expect(report.facts.provider).toMatchObject({
      selected: "openrouter",
      openrouterKeyPresent: true,
      model: "nvidia/nemotron-3.5-lightning:free",
    });
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        className: "provider.openrouter_not_probed",
        status: "warn",
      }),
    );
    expect(JSON.stringify(report)).not.toContain("sentinel-router-key");
    const missing = runDoctor({
      ...baseEnv,
      AI_PROVIDER: "openrouter",
      OPENROUTER_API_KEY: "replace-with-openrouter-key",
    });
    expect(missing.checks).toContainEqual(
      expect.objectContaining({
        className: "provider.missing_openrouter_key",
        status: "fail",
      }),
    );
  });

  it("fails closed for non-loopback Ollama chat URLs without printing the endpoint", () => {
    const report = runDoctor({
      ...baseEnv,
      AI_PROVIDER: "ollama",
      OLLAMA_BASE_URL: "https://example.com:11434/v1",
      OPENAI_API_KEY: "replace-with-openai-key",
    });
    const providerCheck = report.checks.find(
      (item) => item.id === "provider.key",
    );
    const providerFacts = report.facts.provider as {
      selected: string;
      ollamaBaseUrlLoopback: boolean;
    };

    expect(report.ok).toBe(false);
    expect(providerCheck).toMatchObject({
      status: "fail",
      className: "provider.ollama_non_loopback",
    });
    expect(providerFacts).toMatchObject({
      selected: "none",
      ollamaBaseUrlLoopback: false,
    });
    expect(JSON.stringify(report)).not.toContain("https://example.com:11434");
  });

  it("fails closed for non-loopback Ollama memory embedding URLs", () => {
    const report = runDoctor({
      ...baseEnv,
      MEMORY_ENABLED: "true",
      MEMORY_EMBEDDING_PROVIDER: "ollama",
      MEMORY_EMBEDDING_BASE_URL: "https://example.com:11434",
    });
    const memoryCheck = report.checks.find(
      (item) => item.id === "memory.embedding",
    );
    const memoryFacts = report.facts.memory as {
      embeddingProvider: string;
      embeddingConfigured: boolean;
      ollamaBaseUrlLoopback: boolean;
    };

    expect(memoryCheck).toMatchObject({
      status: "fail",
      className: "memory.ollama_non_loopback",
    });
    expect(memoryFacts).toMatchObject({
      embeddingProvider: "ollama",
      embeddingConfigured: true,
      ollamaBaseUrlLoopback: false,
    });
    expect(JSON.stringify(report)).not.toContain("https://example.com:11434");
  });

  it("redacts credentials, token contents, prompts, precise GPS, and raw payload canaries", () => {
    const raw = `OPENAI_API_KEY=sk-live-secret refresh_token="garmin-refresh" prompt="what did I say" lat=46.123456 lon=13.987654 rawPayload="connector body"`;
    const redacted = redactDiagnosticValue(raw);
    expect(redacted).not.toContain("sk-live-secret");
    expect(redacted).not.toContain("garmin-refresh");
    expect(redacted).not.toContain("what did I say");
    expect(redacted).not.toContain("46.123456");
    expect(redacted).not.toContain("connector body");
    expect(redactDiagnosticValue({ apiKey: "sk-live-secret" })).toEqual({
      apiKey: "<redacted>",
    });
  });
});
