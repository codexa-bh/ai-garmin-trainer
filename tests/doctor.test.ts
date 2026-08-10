import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runDoctor } from "../src/lib/diagnostics/doctor";
import {
  redactDiagnosticValue,
  redactSensitiveText,
} from "../src/lib/diagnostics/redaction";
import {
  GARMIN_MCP_PACKAGE_URL,
  GARMIN_MCP_SDK_REQUIREMENT,
} from "../src/lib/garmin/client";

const baseEnv = {
  NEXT_PUBLIC_APP_URL: "http://localhost:3000",
  DATABASE_PATH: join(
    mkdtempSync(join(tmpdir(), "doctor-db-")),
    "trainer.sqlite",
  ),
  GARMIN_HISTORY_START_DATE: "2024-01-01",
  GARMIN_MCP_COMMAND: "uvx",
  GARMIN_MCP_ARGS: `--from ${GARMIN_MCP_PACKAGE_URL} --with ${GARMIN_MCP_SDK_REQUIREMENT} garmin-mcp`,
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

  it("reports the explicit Garmin MCP SDK compatibility requirement", () => {
    writeFileSync(join(baseEnv.GARMIN_MCP_TOKEN_DIR, "state.json"), "{}\n");
    const report = runDoctor(baseEnv);
    const garminFacts = report.facts.garmin as {
      mcpSdkRequirement: string;
      configuredMcpSdkConstraint: string;
      effectiveMcpSdkConstraint: string;
    };

    expect(report.checks).toContainEqual(
      expect.objectContaining({
        id: "garmin.mcp_sdk",
        status: "pass",
        className: "garmin.mcp_sdk_pinned",
      }),
    );
    expect(garminFacts).toMatchObject({
      mcpSdkRequirement: GARMIN_MCP_SDK_REQUIREMENT,
      configuredMcpSdkConstraint: "exact",
      effectiveMcpSdkConstraint: "exact",
    });
  });

  it("warns when a stale local override relies on runtime MCP SDK injection", () => {
    writeFileSync(join(baseEnv.GARMIN_MCP_TOKEN_DIR, "state.json"), "{}\n");
    const report = runDoctor({
      ...baseEnv,
      GARMIN_MCP_ARGS: `--from ${GARMIN_MCP_PACKAGE_URL} garmin-mcp`,
    });

    expect(report.ok).toBe(true);
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        id: "garmin.mcp_sdk",
        status: "warn",
        className: "garmin.mcp_sdk_injected",
      }),
    );
  });

  it("fails when an incompatible MCP SDK requirement is configured", () => {
    const report = runDoctor({
      ...baseEnv,
      GARMIN_MCP_ARGS: `--from ${GARMIN_MCP_PACKAGE_URL} --with mcp==2.0.0 garmin-mcp`,
    });

    expect(report.ok).toBe(false);
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        id: "garmin.mcp_sdk",
        status: "fail",
        className: "garmin.mcp_sdk_incompatible",
      }),
    );
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
