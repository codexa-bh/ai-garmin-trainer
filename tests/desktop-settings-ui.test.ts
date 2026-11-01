// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fireEvent, waitFor, within } from "@testing-library/dom";
import fields from "../src-tauri/ui/settings-fields.json";

const invoke = vi.fn();
let listeners: Record<string, (event: { payload: string }) => void>;
beforeEach(async () => {
  document.documentElement.innerHTML = readFileSync(
    "src-tauri/ui/index.html",
    "utf8",
  ).replace(/<script[^>]*>.*?<\/script>/gs, "");
  listeners = {};
  Object.defineProperty(window, "__TAURI__", {
    configurable: true,
    value: {
      core: { invoke },
      event: {
        listen: vi.fn(async (name, callback) => {
          listeners[name] = callback;
        }),
      },
    },
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ json: async () => fields })),
  );
  invoke.mockReset();
  invoke.mockImplementation(async (command) => {
    if (command === "read_settings")
      return {
        chatCatalog: {
          version: 1,
          entries: [
            {
              id: "entry_existing",
              provider: "openai",
              modelId: "custom/Exact:Tag",
            },
          ],
          defaultEntryId: "entry_existing",
        },
        revision: "revision-one",
        fields: {
          DATABASE_PATH: "/private/test-only.sqlite",
          AI_PROVIDER: "openai",
        },
        keys: {
          OPENAI_API_KEY: "configured",
          DEEPSEEK_API_KEY: "not configured",
          OPENROUTER_API_KEY: "unavailable",
        },
        saved: true,
        running: true,
      };
    if (command === "setup_status") return "";
    if (command === "save_settings")
      return "Saved for next launch; backend unchanged.";
    if (command === "start_auth")
      return { id: "session-one", state: "needs-mfa" };
    if (command === "submit_mfa")
      return { id: "session-one", state: "submitting-mfa" };
    if (command === "cancel_auth")
      return { id: "session-one", state: "cancelled" };
    if (command === "auth_status")
      return { id: "session-one", state: "needs-mfa" };
    return null;
  });
  window.eval(readFileSync("src-tauri/ui/setup.js", "utf8"));
  await waitFor(() =>
    expect(document.getElementById("OPENAI_API_KEY")).not.toBeNull(),
  );
  await waitFor(() =>
    expect(document.getElementById("status")?.textContent).toContain(
      "Saved settings loaded",
    ),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
function input(id: string): HTMLInputElement {
  return document.getElementById(id) as HTMLInputElement;
}

describe("trusted local desktop settings UI", () => {
  it("renders every normal/advanced setting with masked status and no secret readback", () => {
    for (const field of fields)
      expect(document.getElementById(field.key)).not.toBeNull();
    expect(input("OPENAI_API_KEY").value).toBe("");
    expect(input("OPENAI_API_KEY").disabled).toBe(true);
    expect(document.getElementById("OPENAI_API_KEY-status")?.textContent).toBe(
      "configured",
    );
    expect(document.getElementById("LLM_DEBUG_TRACES")).toBeNull();
    for (const key of ["DATABASE_PATH", "AI_MODEL", "GARMIN_MCP_TOKEN_DIR"]) {
      expect(input(key).autocapitalize).toBe("off");
      expect(input(key).getAttribute("autocorrect")).toBe("off");
      expect(input(key).spellcheck).toBe(false);
    }
  });
  it("manages normal catalog rows with durable identities and explicit default removal; preserves separate extraction inputs", async () => {
    const screen = within(document.body);
    expect(input("AI_PROVIDER").closest("label")?.hidden).toBe(true);
    expect(input("AI_MODEL").closest("label")?.hidden).toBe(true);
    expect(
      document.getElementById("extraction-compatibility")?.textContent,
    ).toContain("independent legacy policy openai");
    fireEvent.input(screen.getByLabelText("Exact model ID — chat model 1"), {
      target: { value: "Vendor/Edited:Tag" },
    });
    fireEvent.input(
      screen.getByLabelText("Friendly name (optional) — chat model 1"),
      { target: { value: "Fast" } },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Remove chat model 1" }),
    );
    expect(document.getElementById("status")?.textContent).toContain(
      "explicitly clear",
    );
    expect(screen.getByLabelText("Exact model ID — chat model 1")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add chat model" }));
    fireEvent.change(screen.getByLabelText("Provider — chat model 2"), {
      target: { value: "ollama" },
    });
    fireEvent.input(screen.getByLabelText("Exact model ID — chat model 2"), {
      target: { value: "local:Exact" },
    });
    fireEvent.change(screen.getByLabelText("Default chat model (optional)"), {
      target: { value: "" },
    });
    fireEvent.submit(document.getElementById("settings")!);
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("save_settings", expect.anything()),
    );
    const sent = invoke.mock.calls.find(
      ([name]) => name === "save_settings",
    )![1].input;
    expect(sent.expectedRevision).toBe("revision-one");
    expect(sent.chatCatalog).toMatchObject({
      version: 1,
      defaultEntryId: null,
      entries: [
        {
          id: "entry_existing",
          provider: "openai",
          modelId: "Vendor/Edited:Tag",
          displayName: "Fast",
        },
        { provider: "ollama", modelId: "local:Exact" },
      ],
    });
    expect(sent.chatCatalog.entries[1].id).toMatch(/^entry_[a-f0-9-]+$/);
    expect(sent.fields.AI_PROVIDER).toBe("openai");
    expect(sent.fields.AI_MODEL).toBe("gpt-6-luna");
    await waitFor(() =>
      expect(document.getElementById("status")?.textContent).toContain(
        "backend unchanged",
      ),
    );
    fireEvent.change(screen.getByLabelText("Default chat model (optional)"), {
      target: { value: "" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Remove chat model 1" }),
    );
    expect(screen.queryByLabelText("Exact model ID — chat model 1")).toBeNull();
  });
  it("passes blank explicit replacement for native rejection rather than silently keeping a key", async () => {
    fireEvent.change(input("OPENAI_API_KEY-intent"), {
      target: { value: "replace" },
    });
    fireEvent.submit(document.getElementById("settings")!);
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith(
        "save_settings",
        expect.objectContaining({
          input: expect.objectContaining({
            keys: expect.objectContaining({
              OPENAI_API_KEY: { intent: "replace", value: "" },
            }),
          }),
        }),
      ),
    );
  });
  it("sends unchanged blank keys, explicit replacement/clear and clears transient form values", async () => {
    let submitted: unknown;
    const original = invoke.getMockImplementation()!;
    invoke.mockImplementation(async (command, args) => {
      if (command === "save_settings")
        submitted = JSON.parse(JSON.stringify(args));
      return original(command, args);
    });
    input("DEEPSEEK_API_KEY-intent").value = "clear";
    fireEvent.change(input("DEEPSEEK_API_KEY-intent"));
    input("OPENAI_API_KEY-intent").value = "replace";
    fireEvent.change(input("OPENAI_API_KEY-intent"));
    input("OPENAI_API_KEY").value = "sentinel-secret";
    fireEvent.submit(document.getElementById("settings")!);
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("save_settings", expect.anything()),
    );
    expect(submitted).toMatchObject({
      input: {
        keys: {
          OPENAI_API_KEY: { intent: "replace", value: "sentinel-secret" },
          DEEPSEEK_API_KEY: { intent: "clear" },
          OPENROUTER_API_KEY: { intent: "unchanged" },
        },
      },
    });
    await waitFor(() => expect(input("OPENAI_API_KEY").value).toBe(""));
    await waitFor(() =>
      expect(document.getElementById("status")?.textContent).toContain(
        "backend unchanged",
      ),
    );
    expect(invoke).not.toHaveBeenCalledWith("start_auth", expect.anything());
  });
  async function legacySettings() {
    const original = invoke.getMockImplementation()!;
    invoke.mockImplementation(async (command, args) => {
      const result = await original(command, args);
      if (command === "read_settings")
        return { ...result, storage: "legacy-required", running: false };
      if (command === "adopt_provider_settings")
        throw "Legacy access denied; privately re-enter all configured slots. Originals unchanged.";
      return result;
    });
    fireEvent.click(document.getElementById("cancel")!);
    await waitFor(() =>
      expect(document.getElementById("migration")?.hidden).toBe(false),
    );
  }
  it("discloses plaintext risk and never auto-adopts legacy settings or retries denial", async () => {
    await legacySettings();
    expect(document.body.textContent).toContain("owner-private plaintext");
    expect(document.getElementById("save")?.hidden).toBe(true);
    expect(
      invoke.mock.calls.filter(
        ([command]) => command === "adopt_provider_settings",
      ),
    ).toHaveLength(0);
    fireEvent.click(document.getElementById("adopt-provider")!);
    await waitFor(() =>
      expect(document.getElementById("status")?.textContent).toContain(
        "Legacy access denied",
      ),
    );
    const calls = invoke.mock.calls.filter(
      ([command]) => command === "adopt_provider_settings",
    );
    expect(calls).toHaveLength(1);
    expect(calls[0][1]).toMatchObject({
      readLegacy: true,
      input: { keys: { OPENAI_API_KEY: { intent: "unchanged" } } },
    });
    expect(input("OPENAI_API_KEY").value).toBe("");
  });
  it("sends private re-entry without legacy access and clears transient values on refusal", async () => {
    await legacySettings();
    input("OPENAI_API_KEY-intent").value = "replace";
    fireEvent.change(input("OPENAI_API_KEY-intent"));
    input("OPENAI_API_KEY").value = "synthetic-private-reentry";
    input("OPENROUTER_API_KEY-intent").value = "clear";
    fireEvent.click(document.getElementById("reenter-provider")!);
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith(
        "adopt_provider_settings",
        expect.objectContaining({ readLegacy: false }),
      ),
    );
    const call = invoke.mock.calls.find(
      ([command]) => command === "adopt_provider_settings",
    )!;
    expect(call[1]).toMatchObject({
      input: {
        keys: {
          OPENAI_API_KEY: {
            intent: "replace",
            value: "synthetic-private-reentry",
          },
          OPENROUTER_API_KEY: { intent: "clear" },
        },
      },
    });
    await waitFor(() => expect(input("OPENAI_API_KEY").value).toBe(""));
    expect(document.body.textContent).not.toContain(
      "synthetic-private-reentry",
    );
  });
  it("cancel restores persisted fields without saving or initiating login", async () => {
    input("AI_MODEL").value = "unsaved-model";
    input("OPENAI_API_KEY").value = "unsaved-secret";
    fireEvent.click(document.getElementById("cancel")!);
    await waitFor(() => expect(input("AI_MODEL").value).toBe("gpt-6-luna"));
    expect(input("OPENAI_API_KEY").value).toBe("");
    expect(invoke.mock.calls.some((call) => call[0] === "save_settings")).toBe(
      false,
    );
    expect(invoke.mock.calls.some((call) => call[0] === "start_auth")).toBe(
      false,
    );
  });
  it("clears password/MFA after submission, cancels the exact session, and never persists auth inputs", async () => {
    let captured: unknown;
    invoke.mockClear();
    invoke.mockImplementation(async (command, args) => {
      if (command === "start_auth") {
        captured = JSON.parse(JSON.stringify(args));
        return { id: "session-one", state: "needs-mfa" };
      }
      if (command === "submit_mfa")
        return { id: "session-one", state: "submitting-mfa" };
      if (command === "cancel_auth")
        return { id: "session-one", state: "cancelled" };
      return null;
    });
    input("destination").value = "/private/new-store";
    input("email").value = "private@example.invalid";
    input("password").value = "sentinel-password";
    fireEvent.submit(document.getElementById("auth")!);
    await waitFor(() =>
      expect(document.getElementById("mfa-form")?.hidden).toBe(false),
    );
    expect(captured).toEqual({
      destination: "/private/new-store",
      email: "private@example.invalid",
      password: "sentinel-password",
    });
    expect(input("password").value).toBe("");
    expect(input("email").value).toBe("");
    input("mfa").value = "sentinel-mfa";
    fireEvent.submit(document.getElementById("mfa-form")!);
    await waitFor(() => expect(input("mfa").value).toBe(""));
    fireEvent.click(document.getElementById("auth-cancel")!);
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("cancel_auth", { id: "session-one" }),
    );
    expect(invoke.mock.calls.some((call) => call[0] === "save_settings")).toBe(
      false,
    );
    expect(document.body.textContent).not.toContain("sentinel-password");
    listeners["desktop-settings-closed"]({ payload: "" });
  });
  async function firstRun() {
    const original = invoke.getMockImplementation()!;
    invoke.mockImplementation(async (command, args) => {
      if (command === "read_settings")
        return {
          fields: {},
          keys: {},
          saved: false,
          running: false,
          chatCatalog: { version: 1, entries: [], defaultEntryId: null },
          revision: "absent",
        };
      if (command === "read_onboarding")
        return {
          id: "native-first-run",
          eligible: true,
          database: "/private/task/new ü.sqlite",
          tokens: "/private/task/garmin-tokens",
          databaseCommitted: false,
          settingsCommitted: false,
        };
      return original(command, args);
    });
    fireEvent.click(document.getElementById("cancel")!);
    await waitFor(() =>
      expect(document.getElementById("wizard")?.hidden).toBe(false),
    );
  }
  it("does not erase provider entry when independent optional authentication settles", async () => {
    await firstRun();
    input("OPENAI_API_KEY-intent").value = "replace";
    fireEvent.change(input("OPENAI_API_KEY-intent"));
    input("OPENAI_API_KEY").value = "sentinel-provider";
    input("email").value = "private@example.invalid";
    input("password").value = "sentinel-password";
    fireEvent.submit(document.getElementById("auth")!);
    await waitFor(() =>
      expect(document.getElementById("mfa-form")?.hidden).toBe(false),
    );
    fireEvent.click(document.getElementById("auth-cancel")!);
    await waitFor(() =>
      expect(document.getElementById("auth-status")?.textContent).toContain(
        "cancelled",
      ),
    );
    expect(input("OPENAI_API_KEY").value).toBe("sentinel-provider");
    expect(input("password").value).toBe("");
    listeners["desktop-settings-closed"]({ payload: "" });
    expect(input("OPENAI_API_KEY").value).toBe("");
  });
  function review() {
    for (let index = 0; index < 3; index++)
      fireEvent.click(document.getElementById("next")!);
  }
  it("guides blank data/provider/optional-Garmin/review with private defaults and explicit intents", async () => {
    await firstRun();
    expect(input("DATABASE_PATH").value).toBe("/private/task/new ü.sqlite");
    expect(input("GARMIN_HISTORY_START_DATE").value).toMatch(
      /^\d{4}-\d{2}-\d{2}$/,
    );
    expect(input("database-selection").value).toBe("create-new");
    expect(document.getElementById("save")?.hidden).toBe(true);
    review();
    expect(document.getElementById("review")?.hidden).toBe(false);
    expect(document.getElementById("review-summary")?.textContent).toContain(
      "Garmin: skipped",
    );
    expect(document.getElementById("save")?.textContent).toBe(
      "Finish and open Trainer",
    );
    expect(
      invoke.mock.calls.some(([name]) =>
        ["start_auth", "finish_onboarding", "save_settings"].includes(name),
      ),
    ).toBe(false);
    input("database-selection").value = "use-existing";
    let submitted: unknown;
    const original = invoke.getMockImplementation()!;
    invoke.mockImplementation(async (command, args) => {
      if (command === "finish_onboarding") {
        submitted = JSON.parse(JSON.stringify(args));
        throw "Existing database refused; original preserved.";
      }
      return original(command, args);
    });
    fireEvent.submit(document.getElementById("settings")!);
    await waitFor(() =>
      expect(submitted).toMatchObject({
        input: {
          id: "native-first-run",
          selection: "use-existing",
          settings: {
            fields: { DATABASE_PATH: "/private/task/new ü.sqlite" },
            keys: { OPENAI_API_KEY: { intent: "unchanged" } },
          },
        },
      }),
    );
    await waitFor(() =>
      expect(document.getElementById("status")?.textContent).toContain(
        "original preserved",
      ),
    );
    expect(invoke.mock.calls.some(([name]) => name === "save_settings")).toBe(
      false,
    );
  });
  it("groups normal Memory separately from collapsed maintenance controls with human options", () => {
    expect(input("MEMORY_ENABLED").closest("#memory-control")).not.toBeNull();
    expect(
      input("MEMORY_ENABLED").querySelector('option[value="true"]')
        ?.textContent,
    ).toBe("On");
    expect(
      input("MEMORY_EMBEDDING_PROVIDER").closest("#memory-configuration"),
    ).not.toBeNull();
    for (const key of [
      "MEMORY_EMBEDDING_DIMS",
      "MEMORY_TIMEOUT_MS",
      "MEMORY_EXTRACTION_TIMEOUT_MS",
      ...fields.filter((f) => f.key.endsWith("_COMMAND")).map((f) => f.key),
    ])
      expect(input(key).closest("#advanced-settings")).not.toBeNull();
    expect(
      (document.getElementById("advanced-settings") as HTMLDetailsElement).open,
    ).toBe(false);
    expect(
      document.getElementById("memory-processing")?.closest("details"),
    ).toBeNull();
    expect(
      invoke.mock.calls.some(([command]) => command === "read_memory_status"),
    ).toBe(false);
  });
  it.each(["save", "legacy"])(
    "preserves collapsed/off/disabled custom scalar values through %s without clearing keys",
    async (action) => {
      if (action === "legacy") await legacySettings();
      const custom = {
        MEMORY_ENABLED: "false",
        MEMORY_EMBEDDING_PROVIDER: "ollama",
        MEMORY_EMBEDDING_MODEL: "custom-embedding",
        MEMORY_EMBEDDING_BASE_URL: "http://127.0.0.1:11435",
        MEMORY_EMBEDDING_DIMS: "768",
        MEMORY_TIMEOUT_MS: "15432",
        MEMORY_EXTRACTION_MODE: "off",
        MEMORY_EXTRACTION_TIMEOUT_MS: "5432",
        ...Object.fromEntries(
          fields
            .filter((f) => f.key.endsWith("_COMMAND"))
            .map((f) => [f.key, `/private/synthetic-tools/${f.key}`]),
        ),
      };
      for (const [key, value] of Object.entries(custom))
        input(key).value = value;
      input("MEMORY_EMBEDDING_MODEL").disabled = true;
      fireEvent.change(input("MEMORY_ENABLED"));
      let captured: unknown;
      const original = invoke.getMockImplementation()!;
      invoke.mockImplementation(async (command, args) => {
        if (
          command ===
          (action === "legacy" ? "adopt_provider_settings" : "save_settings")
        )
          captured = JSON.parse(JSON.stringify(args));
        return original(command, args);
      });
      if (action === "legacy")
        fireEvent.click(document.getElementById("reenter-provider")!);
      else fireEvent.submit(document.getElementById("settings")!);
      await waitFor(() =>
        expect(captured).toMatchObject({
          input: {
            fields: custom,
            keys: { OPENAI_API_KEY: { intent: "unchanged" } },
          },
        }),
      );
      expect(
        Object.keys((captured as { input: { fields: object } }).input.fields),
      ).toHaveLength(fields.length);
      await waitFor(() =>
        expect(input("MEMORY_EMBEDDING_MODEL").disabled).toBe(false),
      );
    },
  );
  it("preserves an explicit blank model for validation and reveals invalid collapsed controls", async () => {
    input("MEMORY_EMBEDDING_MODEL").value = "";
    let captured: unknown;
    const original = invoke.getMockImplementation()!;
    invoke.mockImplementation(async (command, args) => {
      if (command === "save_settings")
        captured = JSON.parse(JSON.stringify(args));
      return original(command, args);
    });
    fireEvent.submit(document.getElementById("settings")!);
    await waitFor(() =>
      expect(captured).toMatchObject({
        input: { fields: { MEMORY_EMBEDDING_MODEL: "" } },
      }),
    );
    const disclosure = document.getElementById(
      "advanced-settings",
    ) as HTMLDetailsElement;
    fireEvent.invalid(input("MEMORY_TIMEOUT_MS"));
    expect(disclosure.open).toBe(true);
  });
  it("retains non-secret failed-write drafts but cancel restores persisted custom values without another write", async () => {
    const original = invoke.getMockImplementation()!;
    let writes = 0;
    invoke.mockImplementation(async (command, args) => {
      if (command === "save_settings") {
        writes++;
        throw "Invalid configuration; precommit unchanged";
      }
      const result = await original(command, args);
      if (command === "read_settings")
        return {
          ...result,
          fields: {
            ...result.fields,
            MEMORY_EMBEDDING_MODEL: "persisted-custom",
            MEMORY_TIMEOUT_MS: "15432",
          },
        };
      return result;
    });
    input("MEMORY_EMBEDDING_MODEL").value = "draft-custom";
    input("MEMORY_TIMEOUT_MS").value = "23456";
    fireEvent.submit(document.getElementById("settings")!);
    await waitFor(() =>
      expect(document.getElementById("status")?.textContent).toContain(
        "Non-secret draft retained",
      ),
    );
    expect(input("MEMORY_EMBEDDING_MODEL").value).toBe("draft-custom");
    expect(input("MEMORY_TIMEOUT_MS").value).toBe("23456");
    expect(
      (document.getElementById("memory-configuration") as HTMLDetailsElement)
        .open,
    ).toBe(true);
    fireEvent.click(document.getElementById("cancel")!);
    await waitFor(() =>
      expect(input("MEMORY_EMBEDDING_MODEL").value).toBe("persisted-custom"),
    );
    expect(input("MEMORY_TIMEOUT_MS").value).toBe("15432");
    expect(writes).toBe(1);
  });
  it("distinguishes draft/next-launch from active user-disabled state and never echoes private errors", async () => {
    const original = invoke.getMockImplementation()!;
    invoke.mockImplementation(async (command, args) =>
      command === "read_memory_status"
        ? {
            configuredEnabled: true,
            userDisabled: true,
            effectiveEnabled: false,
            embeddingProvider: "ollama",
            extractionMode: "llm",
            extractionProvider: "deepseek",
            health: "disabled",
            ageMs: null,
          }
        : original(command, args),
    );
    fireEvent.click(document.getElementById("memory-check")!);
    await waitFor(() =>
      expect(document.getElementById("memory-active")?.textContent).toContain(
        "Disabled by the separate Memory panel",
      ),
    );
    expect(input("MEMORY_ENABLED").value).toBe("false");
    expect(document.getElementById("memory-active")?.textContent).toContain(
      "DeepSeek cloud",
    );
    expect(document.getElementById("memory-draft")?.textContent).toContain(
      "Draft: Off",
    );
    fireEvent.click(document.getElementById("cancel")!);
    await waitFor(() =>
      expect(document.getElementById("memory-active")?.textContent).toContain(
        "unknown",
      ),
    );
    invoke.mockImplementation(async (command, args) => {
      if (command === "read_memory_status")
        throw "private-path-key-error-sentinel";
      return original(command, args);
    });
    fireEvent.click(document.getElementById("memory-check")!);
    await waitFor(() =>
      expect(document.getElementById("memory-active")?.textContent).toContain(
        "unavailable or not running",
      ),
    );
    expect(document.body.textContent).not.toContain(
      "private-path-key-error-sentinel",
    );
  });
  it("expires observations and ignores a delayed status after reload/close", async () => {
    const original = invoke.getMockImplementation()!;
    invoke.mockImplementation(async (command, args) =>
      command === "read_memory_status"
        ? {
            configuredEnabled: true,
            userDisabled: false,
            effectiveEnabled: true,
            embeddingProvider: "ollama",
            extractionMode: "off",
            extractionProvider: "off",
            health: "local-observed",
            ageMs: 59999,
          }
        : original(command, args),
    );
    vi.useFakeTimers();
    fireEvent.click(document.getElementById("memory-check")!);
    await vi.advanceTimersByTimeAsync(0);
    expect(document.getElementById("memory-active")?.textContent).toContain(
      "observed recently",
    );
    await vi.advanceTimersByTimeAsync(2);
    expect(document.getElementById("memory-active")?.textContent).toContain(
      "unknown",
    );
    vi.useRealTimers();
    let resolve: (value: unknown) => void = () => {};
    invoke.mockImplementation(async (command, args) =>
      command === "read_memory_status"
        ? new Promise((done) => {
            resolve = done;
          })
        : original(command, args),
    );
    fireEvent.click(document.getElementById("memory-check")!);
    listeners["desktop-settings-closed"]({ payload: "" });
    resolve({
      embeddingProvider: "ollama",
      extractionProvider: "deepseek",
      health: "local-observed",
    });
    await Promise.resolve();
    expect(document.getElementById("memory-active")?.textContent).toContain(
      "unknown",
    );
  });
  it("keeps Memory/custom maintenance draft through first-run navigation and Finish", async () => {
    await firstRun();
    review();
    input("MEMORY_ENABLED").value = "true";
    input("MEMORY_EMBEDDING_MODEL").value = "custom-first-run";
    input("GARMIN_FIT_SPEED_COMMAND").value = "/private/synthetic/uv";
    fireEvent.click(document.getElementById("back")!);
    fireEvent.click(document.getElementById("next")!);
    let captured: unknown;
    const original = invoke.getMockImplementation()!;
    invoke.mockImplementation(async (command, args) => {
      if (command === "finish_onboarding") {
        captured = JSON.parse(JSON.stringify(args));
        throw "precommit failure; unchanged";
      }
      return original(command, args);
    });
    fireEvent.submit(document.getElementById("settings")!);
    await waitFor(() =>
      expect(captured).toMatchObject({
        input: {
          settings: {
            fields: {
              MEMORY_ENABLED: "true",
              MEMORY_EMBEDDING_MODEL: "custom-first-run",
              GARMIN_FIT_SPEED_COMMAND: "/private/synthetic/uv",
            },
          },
        },
      }),
    );
    await waitFor(() =>
      expect(document.getElementById("status")?.textContent).toContain(
        "precommit failure",
      ),
    );
    expect(input("MEMORY_EMBEDDING_MODEL").value).toBe("custom-first-run");
  });
  it("serializes duplicate Finish, allows exact cancellation and exposes committed-state retry", async () => {
    await firstRun();
    review();
    let reject: (reason: string) => void = () => {};
    const original = invoke.getMockImplementation()!;
    invoke.mockImplementation(async (command, args) => {
      if (command === "finish_onboarding")
        return new Promise((_, failure) => {
          reject = failure;
        });
      if (command === "read_onboarding")
        return {
          id: "native-first-run",
          eligible: true,
          database: "/private/task/new ü.sqlite",
          databaseCommitted: true,
          settingsCommitted: true,
        };
      return original(command, args);
    });
    fireEvent.submit(document.getElementById("settings")!);
    fireEvent.submit(document.getElementById("settings")!);
    expect(
      invoke.mock.calls.filter(([name]) => name === "finish_onboarding"),
    ).toHaveLength(1);
    expect(input("DATABASE_PATH").disabled).toBe(true);
    fireEvent.click(document.getElementById("cancel")!);
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("cancel_onboarding", {
        id: "native-first-run",
      }),
    );
    reject("Startup cancelled after settings commit; retained.");
    await waitFor(() =>
      expect(document.getElementById("save")?.textContent).toBe(
        "Retry opening saved Trainer",
      ),
    );
    expect(document.getElementById("review-summary")?.textContent).toContain(
      "Settings committed: true",
    );
    await waitFor(() => expect(input("save").disabled).toBe(false));
    expect(input("DATABASE_PATH").disabled).toBe(true);
    expect(input("AI_PROVIDER").disabled).toBe(true);
    expect(input("OPENAI_API_KEY").disabled).toBe(true);
    expect(document.getElementById("back")?.hidden).toBe(true);
    expect(document.getElementById("next")?.hidden).toBe(true);
    expect(document.getElementById("status")?.textContent).toContain(
      "retained",
    );
  });
});
