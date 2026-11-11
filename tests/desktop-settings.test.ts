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
  decodePrivateFrame,
  PRIVATE_FRAME_LIMIT,
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

it("bounds the two-document v4 frame without widening legacy commands or bypassing activation validation", () => {
  const payload = {
    version: 4,
    activation: { version: 2, padding: "x".repeat(70000) },
    chatgpt: { padding: "y".repeat(70000) },
  };
  const bytes = Buffer.from(JSON.stringify(payload));
  expect(bytes.length).toBeGreaterThan(128 * 1024);
  expect(decodePrivateFrame(bytes)).toEqual(payload);
  expect(() => activationEnvironment(decodePrivateFrame(bytes))).toThrow(); // Framing is not schema admission.
  for (const version of [1, 2, 3, 5])
    expect(() =>
      decodePrivateFrame(Buffer.from(JSON.stringify({ ...payload, version }))),
    ).toThrow("Activation too large");
  expect(() =>
    decodePrivateFrame(Buffer.alloc(PRIVATE_FRAME_LIMIT, 32)),
  ).toThrow("Activation too large");
  expect(() => decodePrivateFrame(Buffer.from("{private-invalid"))).toThrow(
    "Invalid activation",
  );
});
describe("desktop editable settings", () => {
  it("activates existing or new configurations without a date, preserves a valid legacy limit and clears it explicitly", () => {
    const base = baseline();
    const automatic: Record<string, string> = { ...base.fields };
    delete automatic.GARMIN_HISTORY_START_DATE;
    for (const fields of [
      automatic,
      { ...automatic, GARMIN_HISTORY_START_DATE: "" },
    ]) {
      expect(
        validateSettings(fields).GARMIN_HISTORY_START_DATE,
      ).toBeUndefined();
      for (const mode of ["existing", "new"] as const) {
        const active = activationEnvironment(
          {
            version: 1,
            fields,
            secrets: { OPENAI_API_KEY: "sentinel-configured-only" },
          },
          mode,
        );
        expect(active.GARMIN_HISTORY_START_DATE).toBeUndefined();
        expect(active.DATABASE_PATH).toBe(base.fields.DATABASE_PATH);
      }
    }
    expect(validateSettings(base.fields).GARMIN_HISTORY_START_DATE).toBe(
      "2025-01-01",
    );
  });
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
  it("keeps secrets out of non-secret validation and rejects missing/unknown/placeholder activation slots without fallback", () => {
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
  it("validates private activation v2 without inventing a default or requiring a chat key; preserves inactive legacy embedding fields without requiring their key", () => {
    const base = baseline();
    const frame = {
      version: 2,
      fields: base.fields,
      secrets: {},
      chatCatalog: { version: 1, entries: [], defaultEntryId: null },
    };
    const activated = activationEnvironment(frame);
    expect(JSON.parse(activated.CHAT_MODEL_CATALOG)).toEqual(frame.chatCatalog);
    expect(activated.AI_PROVIDER).toBe("openai"); // extraction intent, not chat
    const configured = {
      ...frame,
      chatCatalog: {
        version: 1,
        entries: [
          {
            id: "entry_custom",
            provider: "openrouter",
            modelId: "Vendor/Model:Exact",
          },
        ],
        defaultEntryId: "entry_custom",
      },
    };
    expect(
      JSON.parse(activationEnvironment(configured).CHAT_MODEL_CATALOG),
    ).toEqual(configured.chatCatalog);
    expect(
      activationEnvironment({
        ...frame,
        fields: {
          ...base.fields,
          MEMORY_ENABLED: "true",
          MEMORY_EMBEDDING_PROVIDER: "openai",
        },
      }).MEMORY_ENABLED,
    ).toBe("true");
    for (const bad of [
      { ...frame, version: 3 },
      { ...frame, chatCatalog: undefined },
      { ...frame, endpoint: "no" },
      {
        ...frame,
        chatCatalog: { ...frame.chatCatalog, defaultEntryId: "entry_missing" },
      },
      { ...frame, secrets: { OPENAI_API_KEY: "placeholder-key" } },
    ])
      expect(() => activationEnvironment(bad)).toThrow();
    expect(() =>
      validateSettings({ ...base.fields, CHAT_MODEL_CATALOG: "{}" }),
    ).toThrow();
  });
  it("binds retained original intent to its selected DB across Save-before-Trainer-read and deletion", () => {
    const base = baseline();
    const prior = {
      version: 1,
      entries: [
        { id: "entry_prior", provider: "ollama", modelId: "Prior/Exact:Tag" },
      ],
      defaultEntryId: "entry_prior",
    };
    const frame = {
      version: 3,
      fields: base.fields,
      secrets: {},
      chatCatalog: { version: 1, entries: [], defaultEntryId: null },
      selectionCompatibility: {
        database: base.fields.DATABASE_PATH,
        catalog: prior,
      },
    };
    expect(
      JSON.parse(activationEnvironment(frame).CHAT_SELECTION_COMPATIBILITY),
    ).toEqual(prior);
    expect(
      JSON.parse(
        activationEnvironment({
          ...frame,
          selectionCompatibility: {
            database: "/private/different.sqlite",
            catalog: prior,
          },
        }).CHAT_SELECTION_COMPATIBILITY,
      ),
    ).toBeNull();
    for (const bad of [
      null,
      {},
      {
        database: base.fields.DATABASE_PATH,
        catalog: { ...prior, version: 99 },
      },
      { ...frame.selectionCompatibility, secret: "no" },
    ])
      expect(() =>
        activationEnvironment({ ...frame, selectionCompatibility: bad }),
      ).toThrow();
    expect(() =>
      validateSettings({
        ...base.fields,
        CHAT_SELECTION_COMPATIBILITY: "null",
      }),
    ).toThrow();
  });
  it.each(["auto", "openai", "deepseek", "ollama", "openrouter"] as const)(
    "catalog changes never retarget extraction/title legacy policy %s",
    async (provider) => {
      const adapters = await import("../src/lib/ai/providers");
      for (const [openai, deepseek] of [
        [true, true],
        [true, false],
        [false, true],
        [false, false],
      ]) {
        const prior = { ...process.env };
        try {
          process.env.AI_PROVIDER = provider;
          process.env.AI_MODEL = "independent-openai";
          process.env.DEEPSEEK_MODEL = "independent-deepseek";
          process.env.OPENAI_API_KEY = openai
            ? "synthetic-key"
            : "placeholder-key";
          process.env.DEEPSEEK_API_KEY = deepseek
            ? "synthetic-key"
            : "placeholder-key";
          const before = adapters.selectedMemoryExtractionModel();
          process.env.CHAT_MODEL_CATALOG = JSON.stringify({
            version: 1,
            entries: [
              {
                id: "entry_changed",
                provider: "openrouter",
                modelId: "different",
              },
            ],
            defaultEntryId: "entry_changed",
          });
          const after = adapters.selectedMemoryExtractionModel();
          expect(after?.provider).toBe(before?.provider);
          expect(after?.modelName).toBe(before?.modelName);
          if (before) expect(["openai", "deepseek"]).toContain(before.provider);
        } finally {
          process.env = prior;
        }
      }
    },
  );
  it("isolates Keychain to explicit read-only adoption and preserves private DTO/IPC boundaries", () => {
    const main = readFileSync("src-tauri/src/main.rs", "utf8");
    expect(main.match(/&keychain::Keychain/g)).toHaveLength(1);
    const adoption = main.slice(
      main.indexOf("async fn adopt_provider_settings"),
      main.indexOf("fn read_onboarding"),
    );
    expect(adoption).toContain("setup_only(&window)");
    expect(adoption).toContain("&keychain::Keychain");
    expect(adoption).toContain('"--validate-existing-activation"');
    const legacy = readFileSync("src-tauri/src/keychain.rs", "utf8");
    expect(legacy).not.toMatch(/SecKeychain(?:Add|ItemDelete)|fn present/);
    const setup = readFileSync("src-tauri/permissions/setup.toml", "utf8");
    expect(setup).toContain('"adopt_provider_settings"');
    expect(setup).toContain('"read_memory_status"');
    const memoryRead = main.slice(
      main.indexOf("async fn read_memory_status"),
      main.indexOf("async fn save_settings"),
    );
    expect(memoryRead).toContain("setup_only(&window)");
    expect(memoryRead.replace(/\s+/g, "")).toContain(
      "runtime.service.try_lock()",
    );
    expect(memoryRead).not.toContain("settings_path");
    expect(memoryRead).not.toContain("keychain");
    const settings = readFileSync("src-tauri/src/settings.rs", "utf8");
    const snapshot = settings.slice(
      settings.indexOf("pub struct Snapshot"),
      settings.indexOf("const LEGACY"),
    );
    expect(snapshot).not.toContain("Settings");
    expect(snapshot).not.toContain("secrets");
  });
  it("refuses private setup mutation in both admitted modes before auth or managed allocation", () => {
    const main = readFileSync("src-tauri/src/main.rs", "utf8");
    const guard = main.slice(
      main.indexOf("fn private_setup_only"),
      main.indexOf("fn stop_runtime"),
    );
    expect(guard).toContain("isolated_run::Admission");
    expect(guard).toContain("smoke_config::Config");
    for (const name of [
      "adopt_provider_settings",
      "finish_onboarding",
      "choose_path",
      "start_auth",
      "submit_mfa",
    ]) {
      const from = main.indexOf(`fn ${name}(`);
      expect(from).toBeGreaterThan(-1);
      const next = main.indexOf("#[tauri::command]", from);
      const body = main.slice(from, next === -1 ? undefined : next);
      expect(body).toContain("private_setup_only(&window)?");
      if (name === "start_auth")
        expect(body.indexOf("private_setup_only")).toBeLessThan(
          body.indexOf(".start_managed("),
        );
    }
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
