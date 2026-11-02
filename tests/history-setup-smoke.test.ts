// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
import { waitFor } from "@testing-library/dom";
import fields from "../src-tauri/ui/settings-fields.json";

declare global {
  interface Window {
    __trainerHistorySetup: (action: string) => Record<string, boolean>;
    __trainerHistoryRestore: () => void;
  }
}
afterEach(() => {
  window.__trainerHistoryRestore?.();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});
async function setup(firstRun: boolean, historyLimit = "") {
  document.documentElement.innerHTML = readFileSync(
    "src-tauri/ui/index.html",
    "utf8",
  ).replace(/<script[^>]*>.*?<\/script>/gs, "");
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockImplementation(
    () => [{ width: 10 }] as unknown as DOMRectList,
  );
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  let saved = !firstRun;
  let savedFields: Record<string, string> = {
    DATABASE_PATH: "/private/task-copy/trainer.sqlite",
    GARMIN_HISTORY_START_DATE: historyLimit,
  };
  const invoke = vi.fn(
    async (
      command: string,
      args?: {
        input?: {
          settings?: { fields: Record<string, string> };
          fields?: Record<string, string>;
        };
      },
    ) => {
      if (command === "read_settings")
        return {
          revision: "test-revision",
          fields: saved ? savedFields : {},
          keys: {
            OPENAI_API_KEY: "not configured",
            DEEPSEEK_API_KEY: "not configured",
            OPENROUTER_API_KEY: "not configured",
          },
          chatCatalog: { version: 1, entries: [], defaultEntryId: null },
          saved,
          running: saved,
        };
      if (command === "read_onboarding")
        return {
          id: "task-operation",
          eligible: !saved,
          database: "/private/task-copy/trainer.sqlite",
          databaseCommitted: false,
          settingsCommitted: saved,
        };
      if (command === "setup_status") return "";
      if (command === "auth_status") return { state: "idle", id: "none" };
      if (command === "finish_onboarding" || command === "save_settings") {
        savedFields =
          args?.input?.settings?.fields ?? args?.input?.fields ?? {};
        saved = true;
        return "Settings committed. Quit and reopen to apply; the running backend is unchanged.";
      }
      throw Error("Unexpected native capability");
    },
  );
  Object.defineProperty(window, "__TAURI__", {
    configurable: true,
    value: { core: { invoke }, event: { listen: vi.fn(async () => {}) } },
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ json: async () => fields })),
  );
  window.eval(readFileSync("src-tauri/ui/setup.js", "utf8"));
  window.eval(readFileSync("src-tauri/debug/history-setup.js", "utf8"));
  await waitFor(() =>
    expect(window.__trainerHistorySetup("observe").ready).toBe(true),
  );
  return invoke;
}
it("reports pending readiness without authorizing a premature mutation", () => {
  document.documentElement.innerHTML = readFileSync(
    "src-tauri/ui/index.html",
    "utf8",
  ).replace(/<script[^>]*>.*?<\/script>/gs, "");
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  window.eval(readFileSync("src-tauri/debug/history-setup.js", "utf8"));
  expect(window.__trainerHistorySetup("observe")).toMatchObject({
    ok: true,
    ready: false,
  });
  expect(window.__trainerHistorySetup("finish").ok).toBe(false);
});
it("drives genuine no-date first-run semantics through the real setup owner, without auth", async () => {
  const invoke = await setup(true);
  expect(window.__trainerHistorySetup("observe")).toMatchObject({
    firstRun: true,
    dataStep: true,
    automaticHistory: true,
    privateControlsAbsent: true,
  });
  expect(window.__trainerHistorySetup("useExisting").ok).toBe(true);
  const selection = document.getElementById(
    "database-selection",
  ) as HTMLSelectElement;
  expect(selection.value).toBe("use-existing");
  expect(window.__trainerHistorySetup("capture").ok).toBe(true);
  expect(getComputedStyle(selection.selectedOptions[0]).visibility).toBe(
    "visible",
  );
  expect(
    getComputedStyle(document.getElementById("DATABASE_PATH")!).visibility,
  ).toBe("hidden");
  for (const option of document.querySelectorAll(
    "#settings select:not(#database-selection) option",
  ))
    expect(getComputedStyle(option).visibility).toBe("hidden");
  window.__trainerHistoryRestore();
  expect(selection.selectedOptions[0].style.visibility).toBe("");
  for (let i = 0; i < 3; i++)
    expect(window.__trainerHistorySetup("next").ok).toBe(true);
  expect(window.__trainerHistorySetup("observe").reviewStep).toBe(true);
  expect(window.__trainerHistorySetup("finish").ok).toBe(true);
  await waitFor(() =>
    expect(invoke).toHaveBeenCalledWith(
      "finish_onboarding",
      expect.objectContaining({
        input: expect.objectContaining({
          selection: "use-existing",
          settings: expect.objectContaining({
            fields: expect.objectContaining({ GARMIN_HISTORY_START_DATE: "" }),
          }),
        }),
      }),
    ),
  );
  expect(
    invoke.mock.calls.some(([command]) =>
      ["start_auth", "adopt_provider_settings", "choose_path"].includes(
        command,
      ),
    ),
  ).toBe(false);
});
it("clears a persisted optional limit through the real semantic Save without changing other fields", async () => {
  const invoke = await setup(false, "2024-01-01");
  const before = Object.fromEntries(
    fields
      .filter((field) => field.key !== "GARMIN_MCP_TOKEN_DIR")
      .map((field) => [
        field.key,
        (document.getElementById(field.key) as HTMLInputElement).value,
      ]),
  );
  expect(window.__trainerHistorySetup("observe").formValid).toBe(true);
  expect(window.__trainerHistorySetup("automatic").automaticHistory).toBe(true);
  expect(window.__trainerHistorySetup("save").ok).toBe(true);
  await waitFor(() =>
    expect(invoke).toHaveBeenCalledWith("save_settings", expect.anything()),
  );
  const sent = invoke.mock.calls.find(
    ([command]) => command === "save_settings",
  )![1]!.input!;
  expect(sent.fields?.GARMIN_HISTORY_START_DATE).toBe("");
  expect(window.__trainerHistorySetup("observe").saveSubmitted).toBe(true);
  for (const [key, value] of Object.entries(before))
    if (key !== "GARMIN_HISTORY_START_DATE")
      expect(sent.fields?.[key]).toBe(value);
});
it("an active limit cannot be blank and is never silently switched to automatic", async () => {
  const invoke = await setup(false, "2024-01-01");
  const date = document.getElementById(
    "GARMIN_HISTORY_START_DATE",
  ) as HTMLInputElement;
  date.value = "";
  window.__trainerHistorySetup("save");
  expect(date.value).toBe("");
  expect(date.required).toBe(true);
  expect(date.disabled).toBe(false);
  expect(window.__trainerHistorySetup("observe").automaticHistory).toBe(false);
  expect(window.__trainerHistorySetup("observe")).toMatchObject({
    saveSubmitted: false,
    historyValidationBlocked: true,
    historyValueMissing: true,
  });
  expect(
    invoke.mock.calls.some(([command]) => command === "save_settings"),
  ).toBe(false);
});
it("automatic mode preserves unrelated active-field constraint validation", async () => {
  const invoke = await setup(false, "2024-01-01");
  window.__trainerHistorySetup("automatic");
  (document.getElementById("MEMORY_EMBEDDING_DIMS") as HTMLInputElement).value =
    "0";
  expect(window.__trainerHistorySetup("observe").formValid).toBe(false);
  window.__trainerHistorySetup("save");
  expect(window.__trainerHistorySetup("observe").saveSubmitted).toBe(false);
  expect(
    invoke.mock.calls.some(([command]) => command === "save_settings"),
  ).toBe(false);
});
it("nonempty invalid saved dates remain Limited until explicitly corrected or changed", async () => {
  const invoke = await setup(false, "not-a-date");
  const choice = document.getElementById("history-limited") as HTMLInputElement;
  const date = document.getElementById(
    "GARMIN_HISTORY_START_DATE",
  ) as HTMLInputElement;
  expect(choice.checked).toBe(true);
  expect(date.required).toBe(true);
  expect(date.disabled).toBe(false);
  expect(window.__trainerHistorySetup("observe")).toMatchObject({
    automaticHistory: false,
    formValid: false,
  });
  window.__trainerHistorySetup("save");
  expect(
    invoke.mock.calls.some(([command]) => command === "save_settings"),
  ).toBe(false);
  window.__trainerHistorySetup("automatic");
  expect(choice.checked).toBe(false);
  expect(date.disabled).toBe(true);
  expect(window.__trainerHistorySetup("observe").automaticHistory).toBe(true);
});
it("supports only fixed optional-limit/automatic actions, next-launch Save and reversible private capture", async () => {
  const invoke = await setup(false);
  expect(window.__trainerHistorySetup("legacyLimit")).toMatchObject({
    ok: true,
    legacyLimit: true,
    automaticHistory: false,
  });
  expect(window.__trainerHistorySetup("save").ok).toBe(true);
  await waitFor(() =>
    expect(window.__trainerHistorySetup("observe").savedForNextLaunch).toBe(
      true,
    ),
  );
  expect(invoke).toHaveBeenCalledWith(
    "save_settings",
    expect.objectContaining({
      input: expect.objectContaining({
        fields: expect.objectContaining({
          GARMIN_HISTORY_START_DATE: "2024-01-01",
        }),
      }),
    }),
  );
  expect(window.__trainerHistorySetup("automatic").automaticHistory).toBe(true);
  expect(window.__trainerHistorySetup("capture").ok).toBe(true);
  expect(
    getComputedStyle(document.getElementById("DATABASE_PATH")!).visibility,
  ).toBe("hidden");
  window.__trainerHistoryRestore();
  expect(document.getElementById("DATABASE_PATH")!.style.visibility).toBe("");
  for (const action of ["auth", "mfa", "input", "eval"])
    expect(window.__trainerHistorySetup(action).ok).toBe(false);
  for (const value of Object.values(window.__trainerHistorySetup("observe")))
    expect(typeof value).toBe("boolean");
});
