import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runDoctor } from "../src/lib/diagnostics/doctor";
import {
  redactDiagnosticValue,
  redactSensitiveText,
} from "../src/lib/diagnostics/redaction";

const baseEnv = {
  NEXT_PUBLIC_APP_URL: "http://localhost:3000",
  DATABASE_PATH: join(
    mkdtempSync(join(tmpdir(), "doctor-db-")),
    "trainer.sqlite",
  ),
  GARMIN_HISTORY_START_DATE: "2024-01-01",
  GARMIN_MCP_COMMAND: "uvx",
  GARMIN_MCP_ARGS:
    "--from git+https://github.com/Taxuspt/garmin_mcp.git@2974244bfda1595b00836b3f942f579ec2d6f7d6 garmin-mcp",
  GARMIN_MCP_TOKEN_DIR: mkdtempSync(join(tmpdir(), "doctor-token-")),
  AI_PROVIDER: "openai",
  AI_MODEL: "gpt-4o-mini",
  OPENAI_API_KEY: "sk-testdoctorredacted",
};

describe("source-beta doctor and redaction", () => {
  it("reports stable failure classes without printing secret values", () => {
    writeFileSync(join(baseEnv.GARMIN_MCP_TOKEN_DIR, "state.json"), "{}\n");
    const report = runDoctor(baseEnv);
    const text = JSON.stringify(report);
    expect(report.checks.map((item) => item.className)).toContain(
      "network.loopback_only",
    );
    expect(text).not.toContain("sk-testdoctorredacted");
  });

  it("fails closed for unsupported LAN/public exposure", () => {
    const report = runDoctor({
      ...baseEnv,
      NEXT_PUBLIC_APP_URL: "http://0.0.0.0:3000",
    });
    expect(report.ok).toBe(false);
    expect(report.checks).toContainEqual(
      expect.objectContaining({ className: "network.unsupported_exposure" }),
    );
  });

  it("reports DeepSeek-first provider selection and OpenAI memory embedding readiness without retired keys", () => {
    writeFileSync(join(baseEnv.GARMIN_MCP_TOKEN_DIR, "state.json"), "{}\n");
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
    const redacted = redactSensitiveText(raw);
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
