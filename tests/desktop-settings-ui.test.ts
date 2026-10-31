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
      expect(document.getElementById(field.key)).not.toBeNull();
    expect(input("OPENAI_API_KEY").value).toBe("");
    expect(input("OPENAI_API_KEY").disabled).toBe(true);
    expect(document.getElementById("OPENAI_API_KEY-status")?.textContent).toBe(
      "configured",
    );
    expect(document.getElementById("LLM_DEBUG_TRACES")).toBeNull();
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
    expect(document.getElementById("status")?.textContent).toContain(
      "retained",
    );
  });
});
