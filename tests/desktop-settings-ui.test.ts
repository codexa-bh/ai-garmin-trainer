// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fireEvent, waitFor } from "@testing-library/dom";
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
      if (field.key !== "GARMIN_MCP_TOKEN_DIR")
        expect(document.getElementById(field.key)).not.toBeNull();
    for (const id of ["GARMIN_MCP_TOKEN_DIR", "destination", "auth-parent"])
      expect(document.getElementById(id)).toBeNull();
    expect(document.getElementById("auth")?.hidden).toBe(true);
    expect(document.getElementById("connection-status")?.textContent).toContain(
      "Not connected",
    );
    expect(input("OPENAI_API_KEY").value).toBe("");
    expect(input("OPENAI_API_KEY").disabled).toBe(true);
    expect(document.getElementById("OPENAI_API_KEY-status")?.textContent).toBe(
      "configured",
    );
    expect(document.getElementById("LLM_DEBUG_TRACES")).toBeNull();
    for (const key of ["DATABASE_PATH", "AI_MODEL"]) {
      expect(input(key).autocapitalize).toBe("off");
      expect(input(key).getAttribute("autocorrect")).toBe("off");
      expect(input(key).spellcheck).toBe(false);
    }
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
    fireEvent.click(document.getElementById("connect")!);
    input("email").value = "private@example.invalid";
    input("password").value = "sentinel-password";
    fireEvent.submit(document.getElementById("auth")!);
    await waitFor(() =>
      expect(document.getElementById("mfa-form")?.hidden).toBe(false),
    );
    expect(captured).toEqual({
      email: "private@example.invalid",
      password: "sentinel-password",
    });
    expect(input("password").value).toBe("");
    expect(input("email").value).toBe("");
    input("mfa").value = "sentinel-mfa";
    fireEvent.submit(document.getElementById("mfa-form")!);
    fireEvent.submit(document.getElementById("mfa-form")!);
    await waitFor(() => expect(input("mfa").value).toBe(""));
    expect(
      invoke.mock.calls.filter(([name]) => name === "submit_mfa"),
    ).toHaveLength(1);
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
  it("preserves an exact saved connection through connect-later, provider edits, Save and legacy re-entry", async () => {
    const original = invoke.getMockImplementation()!;
    let legacy = false;
    let submitted: { input: { fields: Record<string, string> } } | undefined;
    invoke.mockImplementation(async (command, args) => {
      const result = await original(command, args);
      if (command === "read_settings")
        return {
          ...result,
          fields: {
            ...result.fields,
            GARMIN_MCP_TOKEN_DIR: "/private/legacy store ü",
          },
          storage: legacy ? "legacy-required" : "private-file",
        };
      if (["save_settings", "adopt_provider_settings"].includes(command))
        submitted = JSON.parse(JSON.stringify(args));
      return result;
    });
    fireEvent.click(document.getElementById("cancel")!);
    await waitFor(() =>
      expect(
        document.getElementById("connection-status")?.textContent,
      ).toContain("Configured — not verified"),
    );
    expect(document.getElementById("connect")?.textContent).toBe(
      "Reconnect Garmin",
    );
    fireEvent.click(document.getElementById("connect-later")!);
    input("AI_MODEL").value = "draft-model";
    fireEvent.submit(document.getElementById("settings")!);
    await waitFor(() =>
      expect(submitted?.input.fields).toMatchObject({
        GARMIN_MCP_TOKEN_DIR: "/private/legacy store ü",
        AI_MODEL: "draft-model",
      }),
    );
    await waitFor(() => expect(input("save").disabled).toBe(false));
    legacy = true;
    fireEvent.click(document.getElementById("cancel")!);
    await waitFor(() =>
      expect(document.getElementById("migration")?.hidden).toBe(false),
    );
    submitted = undefined;
    fireEvent.click(document.getElementById("reenter-provider")!);
    await waitFor(() =>
      expect(submitted?.input.fields.GARMIN_MCP_TOKEN_DIR).toBe(
        "/private/legacy store ü",
      ),
    );
    expect(invoke.mock.calls.some(([name]) => name === "start_auth")).toBe(
      false,
    );
  });
  it("selects only a matching session's verified native destination in draft without a live switch", async () => {
    const original = invoke.getMockImplementation()!;
    let submitted: { input: { fields: Record<string, string> } } | undefined;
    invoke.mockImplementation(async (command, args) => {
      if (command === "auth_status")
        return {
          id: "session-one",
          state: "succeeded",
          destination: "/private/native-owned/garmin-uuid",
        };
      if (command === "save_settings")
        submitted = JSON.parse(JSON.stringify(args));
      return command === "auth_status" ? null : original(command, args);
    });
    input("OPENAI_API_KEY-intent").value = "replace";
    fireEvent.change(input("OPENAI_API_KEY-intent"));
    input("OPENAI_API_KEY").value = "synthetic-provider-draft";
    fireEvent.click(document.getElementById("connect")!);
    input("email").value = "synthetic@example.invalid";
    input("password").value = "synthetic-password";
    fireEvent.submit(document.getElementById("auth")!);
    fireEvent.submit(document.getElementById("auth")!);
    await waitFor(
      () => expect(document.getElementById("use-tokens")?.hidden).toBe(false),
      { timeout: 2000 },
    );
    expect(
      invoke.mock.calls.filter(([name]) => name === "start_auth"),
    ).toHaveLength(1);
    expect(input("OPENAI_API_KEY").value).toBe("synthetic-provider-draft");
    expect(submitted).toBeUndefined();
    fireEvent.click(document.getElementById("use-tokens")!);
    expect(document.getElementById("connection-status")?.textContent).toContain(
      "Pending Save and next explicit launch",
    );
    fireEvent.submit(document.getElementById("settings")!);
    await waitFor(() =>
      expect(submitted?.input.fields.GARMIN_MCP_TOKEN_DIR).toBe(
        "/private/native-owned/garmin-uuid",
      ),
    );
    expect(
      invoke.mock.calls.some(([name]) =>
        ["finish_onboarding", "launch"].includes(name),
      ),
    ).toBe(false);
    listeners["desktop-settings-closed"]({ payload: "" });
  });
  it("ignores late verified polling after exact cancellation", async () => {
    const original = invoke.getMockImplementation()!;
    let resolvePoll: (value: unknown) => void = () => {};
    invoke.mockImplementation(async (command, args) =>
      command === "auth_status"
        ? new Promise((resolve) => {
            resolvePoll = resolve;
          })
        : original(command, args),
    );
    fireEvent.submit(document.getElementById("auth")!);
    await waitFor(
      () =>
        expect(invoke.mock.calls.some(([name]) => name === "auth_status")).toBe(
          true,
        ),
      { timeout: 2000 },
    );
    fireEvent.click(document.getElementById("auth-cancel")!);
    await waitFor(() =>
      expect(document.getElementById("auth-status")?.textContent).toContain(
        "cancelled",
      ),
    );
    resolvePoll({
      id: "session-one",
      state: "succeeded",
      destination: "/private/stale",
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.getElementById("use-tokens")?.hidden).toBe(true);
    expect(document.getElementById("connection-status")?.textContent).toContain(
      "Not connected",
    );
    listeners["desktop-settings-closed"]({ payload: "" });
  });
  it("keeps a published session available for explicit draft re-selection after Save fails", async () => {
    const original = invoke.getMockImplementation()!;
    let fieldsSent: Record<string, string> | undefined;
    invoke.mockImplementation(async (command, args) => {
      if (command === "start_auth")
        return {
          id: "session-one",
          state: "succeeded",
          destination: "/private/new-published",
        };
      if (command === "save_settings") {
        fieldsSent = { ...args.input.fields };
        throw "Save refused; prior settings preserved.";
      }
      return original(command, args);
    });
    fireEvent.submit(document.getElementById("auth")!);
    await waitFor(() =>
      expect(document.getElementById("use-tokens")?.hidden).toBe(false),
    );
    fireEvent.click(document.getElementById("use-tokens")!);
    fireEvent.submit(document.getElementById("settings")!);
    await waitFor(() =>
      expect(document.getElementById("status")?.textContent).toContain(
        "Save refused",
      ),
    );
    expect(fieldsSent?.GARMIN_MCP_TOKEN_DIR).toBe("/private/new-published");
    expect(document.getElementById("connection-status")?.textContent).toContain(
      "Not connected",
    );
    expect(document.getElementById("use-tokens")?.hidden).toBe(false);
    fireEvent.click(document.getElementById("use-tokens")!);
    expect(document.getElementById("connection-status")?.textContent).toContain(
      "Pending Save",
    );
  });
  it("refuses an unmatched polled session without selecting its destination", async () => {
    const original = invoke.getMockImplementation()!;
    invoke.mockImplementation(async (command, args) =>
      command === "auth_status"
        ? {
            id: "foreign-session",
            state: "succeeded",
            destination: "/private/foreign",
          }
        : original(command, args),
    );
    fireEvent.submit(document.getElementById("auth")!);
    await waitFor(
      () =>
        expect(invoke.mock.calls.some(([name]) => name === "auth_status")).toBe(
          true,
        ),
      { timeout: 2000 },
    );
    expect(document.getElementById("use-tokens")?.hidden).toBe(true);
    expect(document.getElementById("connection-status")?.textContent).toContain(
      "Not connected",
    );
    listeners["desktop-settings-closed"]({ payload: "" });
  });
  it.each([
    ["credentials-rejected", "Reconnect needed"],
    ["mfa-rejected", "rejected the MFA"],
    ["unsupported-challenge", "unsupported or repeated"],
    ["network-service", "does not establish credential expiry"],
    ["rate-limited", "does not establish credential expiry"],
    ["auth-unavailable", "tooling unavailable"],
    ["timeout", "timed out"],
    ["publication-refused", "Original stores preserved"],
  ])(
    "reports %s without automatic retry or a false connection",
    async (code, message) => {
      const original = invoke.getMockImplementation()!;
      invoke.mockImplementation(async (command, args) =>
        command === "start_auth"
          ? { id: "session-one", state: "failed", code }
          : original(command, args),
      );
      fireEvent.submit(document.getElementById("auth")!);
      await waitFor(() =>
        expect(document.getElementById("auth-status")?.textContent).toContain(
          message,
        ),
      );
      expect(document.getElementById("use-tokens")?.hidden).toBe(true);
      expect(
        document.getElementById("connection-status")?.textContent,
      ).toContain("Not connected");
      expect(
        invoke.mock.calls.filter(([name]) => name === "start_auth"),
      ).toHaveLength(1);
    },
  );
  async function firstRun() {
    const original = invoke.getMockImplementation()!;
    invoke.mockImplementation(async (command, args) => {
      if (command === "read_settings")
        return { fields: {}, keys: {}, saved: false, running: false };
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
  it("continues without Garmin while retaining provider draft and starting no login", async () => {
    await firstRun();
    input("OPENAI_API_KEY-intent").value = "replace";
    fireEvent.change(input("OPENAI_API_KEY-intent"));
    input("OPENAI_API_KEY").value = "synthetic-provider";
    fireEvent.click(document.getElementById("next")!);
    fireEvent.click(document.getElementById("next")!);
    expect(document.getElementById("connect-later")?.textContent).toBe(
      "Continue without Garmin",
    );
    fireEvent.click(document.getElementById("connect-later")!);
    expect(document.getElementById("review")?.hidden).toBe(false);
    expect(document.getElementById("review-summary")?.textContent).toContain(
      "Garmin: not connected",
    );
    expect(input("OPENAI_API_KEY").value).toBe("synthetic-provider");
    expect(invoke.mock.calls.some(([name]) => name === "start_auth")).toBe(
      false,
    );
  });
  it("cancels a late start after Settings closes instead of selecting it", async () => {
    const original = invoke.getMockImplementation()!;
    let resolveStart: (value: unknown) => void = () => {};
    invoke.mockImplementation(async (command, args) =>
      command === "start_auth"
        ? new Promise((resolve) => {
            resolveStart = resolve;
          })
        : original(command, args),
    );
    fireEvent.submit(document.getElementById("auth")!);
    await waitFor(() =>
      expect(invoke.mock.calls.some(([name]) => name === "start_auth")).toBe(
        true,
      ),
    );
    listeners["desktop-settings-closed"]({ payload: "" });
    resolveStart({
      id: "session-one",
      state: "succeeded",
      destination: "/private/late",
    });
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("cancel_auth", { id: "session-one" }),
    );
    expect(document.getElementById("use-tokens")?.hidden).toBe(true);
    expect(document.getElementById("connection-status")?.textContent).toContain(
      "Not connected",
    );
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
      "Garmin: not connected",
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
