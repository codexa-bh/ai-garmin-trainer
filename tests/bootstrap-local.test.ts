import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

async function bootstrapModule() {
  const modulePath = new URL("../scripts/bootstrap-local.mjs", import.meta.url)
    .href;
  return (await import(modulePath)) as {
    appListenerDecision(input: {
      appReady: boolean;
      portFree: boolean;
    }): string;
    configuredMemory(
      env: Record<string, string | undefined>,
      options?: { memoryUserDisabled?: boolean },
    ): {
      effectiveEnabled: boolean;
      embeddingProvider: string;
      embeddingModel: string;
      embeddingBaseUrl: string;
    };
    databaseMigrationDecision(status: {
      ok: boolean;
      needsMigration: boolean;
    }): string;
    dependencyPreparationDecision(input: {
      nodeModulesPresent: boolean;
      nodeModulesMtimeMs: number;
      lockfileMtimeMs: number;
      packageMtimeMs: number;
    }): string;
    isLoopbackUrl(rawUrl: string): boolean;
    modelInstalled(model: string, installedNames: string[]): boolean;
    normalizeOllamaName(name: string): string;
    ollamaReadinessPlan(input: {
      memory: {
        effectiveEnabled: boolean;
        embeddingProvider: string;
        embeddingModel: string;
        embeddingBaseUrl: string;
      };
      daemonReady: boolean;
      cliAvailable: boolean;
      installedModels: string[];
    }): Record<string, unknown>;
    parseDotEnv(text: string): Record<string, string>;
    prerequisites(input: {
      cwd: string;
      env: Record<string, string | undefined>;
    }): void;
  };
}

const bootstrapSourcePath = fileURLToPath(
  new URL("../scripts/bootstrap-local.mjs", import.meta.url),
);

describe("local bootstrap orchestration decisions", () => {
  it("parses local env files without exposing comments or quotes", async () => {
    const { parseDotEnv } = await bootstrapModule();
    expect(
      parseDotEnv(
        "# comment\nMEMORY_ENABLED=true\nAI_MODEL='gpt-test'\nEMPTY=\n",
      ),
    ).toEqual({
      MEMORY_ENABLED: "true",
      AI_MODEL: "gpt-test",
      EMPTY: "",
    });
  });

  it("accepts only loopback app and Ollama URLs", async () => {
    const { isLoopbackUrl } = await bootstrapModule();
    expect(isLoopbackUrl("http://127.0.0.1:11434")).toBe(true);
    expect(isLoopbackUrl("http://localhost:3000")).toBe(true);
    expect(isLoopbackUrl("https://example.com:11434")).toBe(false);
    expect(isLoopbackUrl("not a url")).toBe(false);
  });

  it("normalizes Ollama latest tags without substituting a different model", async () => {
    const { modelInstalled, normalizeOllamaName } = await bootstrapModule();
    expect(normalizeOllamaName("nomic-embed-text")).toBe(
      "nomic-embed-text:latest",
    );
    expect(
      modelInstalled("nomic-embed-text", ["nomic-embed-text:latest"]),
    ).toBe(true);
    expect(modelInstalled("nomic-embed-text", ["all-minilm:latest"])).toBe(
      false,
    );
  });

  it("skips Ollama work when effective memory is disabled or non-Ollama", async () => {
    const { configuredMemory, ollamaReadinessPlan } = await bootstrapModule();
    expect(
      ollamaReadinessPlan({
        memory: configuredMemory({
          MEMORY_ENABLED: "false",
          MEMORY_EMBEDDING_PROVIDER: "ollama",
        }),
        daemonReady: false,
        cliAvailable: false,
        installedModels: [],
      }),
    ).toEqual({ action: "skip", reason: "memory disabled" });
    expect(
      ollamaReadinessPlan({
        memory: configuredMemory({
          MEMORY_ENABLED: "true",
          MEMORY_EMBEDDING_PROVIDER: "openai",
        }),
        daemonReady: false,
        cliAvailable: false,
        installedModels: [],
      }),
    ).toEqual({ action: "skip", reason: "non-Ollama memory provider" });
  });

  it("fails closed for non-loopback Ollama URLs before daemon or pull actions", async () => {
    const { configuredMemory, ollamaReadinessPlan } = await bootstrapModule();
    expect(
      ollamaReadinessPlan({
        memory: configuredMemory({
          MEMORY_ENABLED: "true",
          MEMORY_EMBEDDING_PROVIDER: "ollama",
          MEMORY_EMBEDDING_BASE_URL: "https://example.com:11434",
        }),
        daemonReady: true,
        cliAvailable: true,
        installedModels: ["nomic-embed-text:latest"],
      }),
    ).toEqual({ action: "fail", reason: "non-loopback Ollama URL" });
  });

  it("reuses an existing daemon and installed model without pull", async () => {
    const { configuredMemory, ollamaReadinessPlan } = await bootstrapModule();
    const memory = configuredMemory({
      MEMORY_ENABLED: "true",
      MEMORY_EMBEDDING_PROVIDER: "ollama",
      MEMORY_EMBEDDING_MODEL: "nomic-embed-text",
      MEMORY_EMBEDDING_BASE_URL: "http://127.0.0.1:11434",
    });
    expect(
      ollamaReadinessPlan({
        memory,
        daemonReady: true,
        cliAvailable: true,
        installedModels: ["nomic-embed-text:latest"],
      }),
    ).toEqual({ action: "reuse", model: "nomic-embed-text", pull: false });
  });

  it("plans a visible model pull when the daemon is ready but the model is absent", async () => {
    const { configuredMemory, ollamaReadinessPlan } = await bootstrapModule();
    const memory = configuredMemory({
      MEMORY_ENABLED: "true",
      MEMORY_EMBEDDING_PROVIDER: "ollama",
      MEMORY_EMBEDDING_MODEL: "nomic-embed-text",
      MEMORY_EMBEDDING_BASE_URL: "http://127.0.0.1:11434",
    });
    expect(
      ollamaReadinessPlan({
        memory,
        daemonReady: true,
        cliAvailable: true,
        installedModels: [],
      }),
    ).toEqual({ action: "reuse", model: "nomic-embed-text", pull: true });
  });

  it("plans daemon startup only when the daemon is missing and the CLI is available", async () => {
    const { configuredMemory, ollamaReadinessPlan } = await bootstrapModule();
    const memory = configuredMemory({
      MEMORY_ENABLED: "true",
      MEMORY_EMBEDDING_PROVIDER: "ollama",
      MEMORY_EMBEDDING_MODEL: "nomic-embed-text",
      MEMORY_EMBEDDING_BASE_URL: "http://127.0.0.1:11434",
    });
    expect(
      ollamaReadinessPlan({
        memory,
        daemonReady: false,
        cliAvailable: true,
        installedModels: ["nomic-embed-text:latest"],
      }),
    ).toEqual({ action: "start", model: "nomic-embed-text", pull: false });
    expect(
      ollamaReadinessPlan({
        memory,
        daemonReady: false,
        cliAvailable: false,
        installedModels: [],
      }),
    ).toEqual({ action: "fail", reason: "missing Ollama CLI" });
  });

  it("requires the CLI when the configured model must be pulled", async () => {
    const { configuredMemory, ollamaReadinessPlan } = await bootstrapModule();
    const memory = configuredMemory({
      MEMORY_ENABLED: "true",
      MEMORY_EMBEDDING_PROVIDER: "ollama",
      MEMORY_EMBEDDING_MODEL: "nomic-embed-text",
      MEMORY_EMBEDDING_BASE_URL: "http://127.0.0.1:11434",
    });
    expect(
      ollamaReadinessPlan({
        memory,
        daemonReady: true,
        cliAvailable: false,
        installedModels: [],
      }),
    ).toEqual({ action: "fail", reason: "missing Ollama CLI for model pull" });
  });

  it("runs migration only for missing or outdated schema status", async () => {
    const { databaseMigrationDecision } = await bootstrapModule();
    expect(databaseMigrationDecision({ ok: true, needsMigration: false })).toBe(
      "skip",
    );
    expect(databaseMigrationDecision({ ok: true, needsMigration: true })).toBe(
      "migrate",
    );
    expect(
      databaseMigrationDecision({ ok: false, needsMigration: false }),
    ).toBe("fail");
  });

  it("prepares dependencies only when node_modules is absent or stale", async () => {
    const { dependencyPreparationDecision } = await bootstrapModule();
    expect(
      dependencyPreparationDecision({
        nodeModulesPresent: false,
        nodeModulesMtimeMs: 0,
        lockfileMtimeMs: 2,
        packageMtimeMs: 1,
      }),
    ).toBe("install");
    expect(
      dependencyPreparationDecision({
        nodeModulesPresent: true,
        nodeModulesMtimeMs: 3,
        lockfileMtimeMs: 2,
        packageMtimeMs: 1,
      }),
    ).toBe("skip");
  });

  it("refuses ambiguous app-port conflicts and reuses verified app listeners", async () => {
    const { appListenerDecision } = await bootstrapModule();
    expect(appListenerDecision({ appReady: true, portFree: false })).toBe(
      "reuse",
    );
    expect(appListenerDecision({ appReady: false, portFree: true })).toBe(
      "start",
    );
    expect(appListenerDecision({ appReady: false, portFree: false })).toBe(
      "fail-conflict",
    );
  });

  it("fails prerequisites for unsupported non-loopback app URLs without printing values", async () => {
    const { prerequisites } = await bootstrapModule();
    expect(() =>
      prerequisites({
        cwd: fileURLToPath(new URL("..", import.meta.url)),
        env: { NEXT_PUBLIC_APP_URL: "http://0.0.0.0:3000" },
      }),
    ).toThrow(/loopback\/local/);
  });

  it("keeps subprocess, timeout, cancellation, and ownership boundaries explicit", () => {
    const source = readFileSync(bootstrapSourcePath, "utf8");
    expect(source).toMatch(/startOwnedProcess\(\s*"ollama",\s*\["serve"\]/);
    expect(source).toMatch(
      /run\(\s*"ollama",\s*\["pull",\s*memory\.embeddingModel\]/,
    );
    expect(source).toMatch(/spawn\(\s*"npm",\s*\["run",\s*"start:local"\]/);
    expect(source).toContain("AbortController");
    expect(source).toContain('child.kill("SIGTERM")');
    expect(source).not.toContain("shell: true");
    expect(source).not.toMatch(/pkill|killall/);
  });
});
