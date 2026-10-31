import { afterEach, describe, expect, it } from "vitest";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import {
  validateSettings,
  activationEnvironment,
  SECRET_SLOTS,
} from "../scripts/desktop/settings";
import { getOptionalEnv } from "../src/lib/env";
import fields from "../src-tauri/ui/settings-fields.json";

const roots: string[] = [];
function baseline() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "trainer-settings-")));
  roots.push(root);
  chmodSync(root, 0o700);
  const path = join(root, "existing ü.sqlite");
  writeFileSync(path, "test-only-path-check");
  return {
    root,
    fields: {
      DATABASE_PATH: path,
      GARMIN_HISTORY_START_DATE: "2025-01-01",
      AI_PROVIDER: "openai",
    },
  };
}
afterEach(() => {
  roots
    .splice(0)
    .forEach((root) => rmSync(root, { recursive: true, force: true }));
});

describe("desktop editable settings", () => {
  it("uses authoritative defaults and exposes exactly the supported field inventory", () => {
    const base = baseline();
    const result = validateSettings(base.fields);
    const env = getOptionalEnv();
    for (const field of fields) {
      if (
        "default" in field &&
        field.default &&
        !field.key.startsWith("GARMIN_FIT_")
      )
        expect(field.default).toBe((env as Record<string, unknown>)[field.key]);
    }
    expect(result.AI_MODEL).toBe(env.AI_MODEL);
    expect(result.MEMORY_EMBEDDING_DIMS).toBe(env.MEMORY_EMBEDDING_DIMS);
    expect(result.DATABASE_PATH).toBe(base.fields.DATABASE_PATH);
    for (const excluded of [
      ...SECRET_SLOTS,
      "NODE_OPTIONS",
      "NEXT_PUBLIC_APP_URL",
      "GARMIN_MCP_ARGS",
      "LLM_DEBUG_TRACES",
      "TRAINER_DESKTOP_NONCE",
      "GARMIN_MCP_TRANSPORT",
    ]) {
      expect(fields.some((field) => field.key === excluded)).toBe(false);
      expect(() =>
        validateSettings({ ...base.fields, [excluded]: "sentinel-secret" }),
      ).toThrow();
    }
  });
  it("rejects missing/aliased/relative paths, bad typed values, remote Ollama and secret-bearing endpoints", () => {
    const base = baseline();
    const alias = join(base.root, "alias");
    symlinkSync(base.fields.DATABASE_PATH, alias);
    for (const change of [
      { DATABASE_PATH: "" },
      { DATABASE_PATH: "relative.sqlite" },
      { DATABASE_PATH: alias },
      { DATABASE_PATH: "$HOME/db" },
      { GARMIN_MCP_TOKEN_DIR: base.fields.DATABASE_PATH },
      { AI_PROVIDER: "unknown" },
      { AI_MODEL: " " },
      { GARMIN_HISTORY_START_DATE: "2025-02-30" },
      { GARMIN_HISTORY_START_DATE: "9999-01-01" },
      { MEMORY_ENABLED: "yes" },
      { MEMORY_EMBEDDING_DIMS: "8garbage" },
      { MEMORY_TIMEOUT_MS: "0" },
      { MEMORY_EXTRACTION_TIMEOUT_MS: "9999999" },
      { OLLAMA_BASE_URL: "https://remote.example/v1" },
      { MEMORY_EMBEDDING_BASE_URL: "https://user:secret@example.com/v1" },
      { MEMORY_EMBEDDING_BASE_URL: "https://example.com/v1?key=secret" },
      { GARMIN_MCP_COMMAND: "uvx --unsafe" },
      { GARMIN_FIT_SPEED_COMMAND: "./uv" },
      { AI_MODEL: "bad\nmodel" },
    ])
      expect(() => validateSettings({ ...base.fields, ...change })).toThrow();
    expect(
      validateSettings({ ...base.fields, GARMIN_MCP_TOKEN_DIR: base.root })
        .GARMIN_MCP_TOKEN_DIR,
    ).toBe(base.root);
    chmodSync(base.root, 0o755);
    expect(() =>
      validateSettings({ ...base.fields, GARMIN_MCP_TOKEN_DIR: base.root }),
    ).toThrow();
  });
  it("keeps secrets out of persistence and rejects missing/unknown/placeholder activation slots without fallback", () => {
    const base = baseline();
    const secret = "sentinel-provider-private";
    const frame = {
      version: 1,
      fields: base.fields,
      secrets: { OPENAI_API_KEY: secret },
    };
    expect(activationEnvironment(frame).OPENAI_API_KEY).toBe(secret);
    expect(JSON.stringify(validateSettings(base.fields))).not.toContain(secret);
    for (const secrets of [
      {},
      { OPENAI_API_KEY: "your-api-key" },
      { OPENAI_API_KEY: secret, OTHER: secret },
      { OPENAI_API_KEY: "bad\nkey" },
    ])
      expect(() => activationEnvironment({ ...frame, secrets })).toThrow();
    expect(() => activationEnvironment({ ...frame, version: 2 })).toThrow();
    expect(
      activationEnvironment({
        ...frame,
        fields: { ...base.fields, AI_PROVIDER: "ollama" },
        secrets: {},
      }).AI_PROVIDER,
    ).toBe("ollama");
    expect(() =>
      activationEnvironment({
        ...frame,
        fields: { ...base.fields, AI_PROVIDER: "deepseek" },
      }),
    ).toThrow();
  });
  it("packages the private auth worker and lock, and preserves native liveness/remote capability exclusions", () => {
    const assembly = readFileSync("scripts/desktop/assemble.mjs", "utf8");
    expect(assembly).toContain("garmin_auth.py.lock");
    const supervisor = readFileSync("src-tauri/src/supervisor.rs", "utf8");
    expect(supervisor).toContain(".env_clear()");
    expect(supervisor).toContain("write_all(snapshot)");
    expect(supervisor).not.toContain(".arg(config)");
    const capability = JSON.parse(
      readFileSync("src-tauri/capabilities/setup.json", "utf8"),
    );
    expect(capability.windows).toEqual(["setup"]);
    expect(capability.remote).toBeUndefined();
    expect(readFileSync("scripts/desktop/config.ts", "utf8")).not.toMatch(
      /(?:processEnv|readFileSync|loadEnvConfig)\s*\(/,
    );
  });
  it("runs deterministic Python auth API/privacy/challenge regressions without a network login", () => {
    const result = spawnSync(
      "/usr/bin/python3",
      ["tests/desktop-auth.test.py"],
      {
        encoding: "utf8",
        env: {
          NODE_ENV: "test",
          PATH: "/usr/bin:/bin",
          PYTHONDONTWRITEBYTECODE: "1",
        },
        timeout: 15000,
      },
    );
    expect(result.stderr).not.toContain("sentinel-password");
    expect(result.status, result.stderr).toBe(0);
  });
  it("uses locked reviewed library and never passes password/email to worker argv/environment", () => {
    const lock = readFileSync("scripts/desktop/garmin_auth.py.lock", "utf8");
    expect(lock).toMatch(/name = "garminconnect"\s+version = "0.3.2"/);
    const auth = readFileSync("src-tauri/src/auth.rs", "utf8");
    expect(auth).toContain("env_clear()");
    expect(auth).not.toMatch(/\.arg\(&?(email|password|code)\)/);
    expect(auth).toContain("Duration::from_secs(180)");
    expect(auth).toContain("RENAME_EXCL");
    // Also parse the worker without importing/network/dependency acquisition.
    execFileSync("/usr/bin/python3", [
      "-c",
      "import ast;ast.parse(open('scripts/desktop/garmin_auth.py').read())",
    ]);
  });
});
