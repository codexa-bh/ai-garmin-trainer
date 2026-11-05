// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
import { waitFor } from "@testing-library/dom";
import fields from "../src-tauri/ui/settings-fields.json";
const summaryChoice = JSON.stringify({
  version: 1,
  entryId: "entry_summary_local",
  provider: "ollama",
  modelId: "synthetic-memory:small",
});
const summaryCatalog = {
  version: 1,
  entries: [
    {
      id: "entry_summary_local",
      provider: "ollama",
      modelId: "synthetic-memory:small",
    },
    {
      id: "entry_summary_cloud",
      provider: "openai",
      modelId: "synthetic-title:small",
    },
    {
      id: "entry_summary_other",
      provider: "ollama",
      modelId: "synthetic-chat:large",
    },
  ],
  defaultEntryId: null,
};

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
  const dialog = document.getElementById(
    "restart-required",
  ) as HTMLDialogElement;
  dialog.showModal = vi.fn(() => {
    dialog.open = true;
  });
  dialog.close = vi.fn(() => {
    dialog.open = false;
    dialog.dispatchEvent(new Event("close"));
  });
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
          chatCatalog: summaryCatalog,
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
        const message =
          "Settings committed. Live fields applied for subsequent operations; captured work is unchanged. Other saved settings are pending explicit quit/reopen.";
        return command === "save_settings"
          ? { message, restartRequired: true }
          : message;
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
it("changes only the three summary scalars through real form Save and masks everything else", async () => {
  const invoke = await setup(false);
  const before = Object.fromEntries(
    fields
      .filter((field) => field.key !== "GARMIN_MCP_TOKEN_DIR")
      .map((field) => [
        field.key,
        (document.getElementById(field.key) as HTMLInputElement).value,
      ]),
  );
  expect(window.__trainerHistorySetup("observe").summaryOff).toBe(true);
  expect(window.__trainerHistorySetup("summaryOn").summaryOn).toBe(true);
  expect(window.__trainerHistorySetup("captureSummaryWide").ok).toBe(true);
  for (const key of ["SUMMARY_ENABLED", "SUMMARY_MODEL", "SUMMARY_CHAR_LIMIT"])
    expect(getComputedStyle(document.getElementById(key)!).visibility).toBe(
      "visible",
    );
  expect(
    getComputedStyle(document.getElementById("DATABASE_PATH")!).visibility,
  ).toBe("hidden");
  expect(
    getComputedStyle(document.getElementById("OPENAI_API_KEY")!).visibility,
  ).toBe("hidden");
  window.__trainerHistoryRestore();
  expect(window.__trainerHistorySetup("save").ok).toBe(true);
  await waitFor(() =>
    expect(invoke).toHaveBeenCalledWith("save_settings", expect.anything()),
  );
  const sent = invoke.mock.calls.find(
    ([command]) => command === "save_settings",
  )![1]!.input!.fields!;
  expect(sent).toMatchObject({
    SUMMARY_ENABLED: "true",
    SUMMARY_MODEL: summaryChoice,
    SUMMARY_CHAR_LIMIT: "6000",
  });
  for (const [key, value] of Object.entries(before))
    if (!key.startsWith("SUMMARY_")) expect(sent[key]).toBe(value);
  expect(
    invoke.mock.calls.some(([command]) =>
      ["start_auth", "adopt_provider_settings", "choose_path"].includes(
        command,
      ),
    ),
  ).toBe(false);
});
it("keeps exact shared identity unavailable after a catalog edit, without selecting the new model", async () => {
  await setup(false);
  window.__trainerHistorySetup("summaryOn");
  const input = document.getElementById(
    "entry_summary_local-modelId",
  ) as HTMLInputElement;
  input.value = "A-Different:Exact";
  input.dispatchEvent(new Event("input", { bubbles: true }));
  const choice = document.getElementById("SUMMARY_MODEL") as HTMLSelectElement;
  expect(choice.value).toBe(summaryChoice);
  expect(choice.selectedOptions[0].textContent).toBe(
    "Ollama / synthetic-memory:small — unavailable; reselect explicitly",
  );
  expect(window.__trainerHistorySetup("captureSummaryWide").ok).toBe(false);
});

it("summary capture reveals text-free containers only and restores after direct-text refusal", async () => {
  await setup(false);
  window.__trainerHistorySetup("summaryOn");
  const model = document.getElementById("SUMMARY_MODEL")!;
  const container = model.parentElement!.parentElement!;
  expect(window.__trainerHistorySetup("captureSummaryWide").ok).toBe(true);
  expect(getComputedStyle(container).visibility).toBe("visible");
  expect(
    getComputedStyle(document.getElementById("DATABASE_PATH")!).visibility,
  ).toBe("hidden");
  window.__trainerHistoryRestore();
  container.append(document.createTextNode("private-direct-text-sentinel"));
  expect(window.__trainerHistorySetup("captureSummaryWide").ok).toBe(false);
  expect(container.style.visibility).toBe("");
  expect(model.style.visibility).toBe("");
});
it("summary capture refuses unknown copy/options/nesting and noncanonical cap without private readback", async () => {
  await setup(false);
  window.__trainerHistorySetup("summaryOn");
  const model = document.getElementById("SUMMARY_MODEL") as HTMLSelectElement;
  model.append(new Option("Unexpected private label", "unknown"));
  expect(window.__trainerHistorySetup("captureSummaryNarrow").ok).toBe(false);
  model.lastElementChild!.remove();
  const label = model.parentElement!;
  label.firstChild!.textContent = "Unexpected private copy";
  expect(window.__trainerHistorySetup("captureSummaryWide").ok).toBe(false);
  expect(model.style.visibility).toBe("");
  expect(window.__trainerHistorySetup("summary:any").ok).toBe(false);
  expect(window.__trainerHistorySetup("summaryOff").summaryOff).toBe(true);
});
it("proves history off/on/required visibility and rejects empty-date Save without native mutation", async () => {
  const invoke = await setup(false);
  expect(window.__trainerHistorySetup("observe")).toMatchObject({
    automaticHistory: true,
    historyDateVisible: false,
    historyDateRequired: false,
    technicalControlsAbsent: true,
  });
  expect(window.__trainerHistorySetup("historyRequired")).toMatchObject({
    ok: true,
    automaticHistory: false,
    historyDateVisible: true,
    historyDateRequired: true,
    formValid: false,
  });
  expect(window.__trainerHistorySetup("captureHistoryWide").ok).toBe(true);
  expect(
    getComputedStyle(document.getElementById("history-help")!).visibility,
  ).toBe("visible");
  expect(
    getComputedStyle(document.getElementById("OPENAI_API_KEY")!).visibility,
  ).toBe("hidden");
  window.__trainerHistoryRestore();
  window.__trainerHistorySetup("save");
  expect(window.__trainerHistorySetup("observe")).toMatchObject({
    saveSubmitted: false,
    historyValidationBlocked: true,
    historyValueMissing: true,
  });
  expect(
    invoke.mock.calls.some(([command]) => command === "save_settings"),
  ).toBe(false);
  window.__trainerHistorySetup("legacyLimit");
  expect(window.__trainerHistorySetup("captureHistoryNarrow").ok).toBe(true);
  window.__trainerHistoryRestore();
  window.__trainerHistorySetup("automatic");
  expect(window.__trainerHistorySetup("captureHistoryNarrow").ok).toBe(true);
  expect(
    document.getElementById("GARMIN_HISTORY_START_DATE")!.closest("label")
      ?.hidden,
  ).toBe(true);
});
it.each([
  "memory-help",
  "memory-model-help",
  "memory-size-help",
  "memory-off-help",
  "memory-draft",
  "history-help",
])("refuses unverified %s copy and restores all styles", async (id) => {
  await setup(false);
  document.getElementById(id)!.append(document.createElement("span"));
  const action =
    id === "history-help" ? "captureHistoryWide" : "captureSummaryWide";
  expect(window.__trainerHistorySetup(action).ok).toBe(false);
  expect(document.getElementById("DATABASE_PATH")!.style.visibility).toBe("");
  expect(document.getElementById(id)!.style.visibility).toBe("");
});
it("refuses technical UI regressions rather than masking them as proof of removal; expires capture masks", async () => {
  await setup(false);
  const injected = document.createElement("button");
  injected.id = "memory-check";
  document.body.append(injected);
  expect(window.__trainerHistorySetup("observe").technicalControlsAbsent).toBe(
    false,
  );
  expect(window.__trainerHistorySetup("captureSummaryWide").ok).toBe(false);
  injected.remove();
  vi.useFakeTimers();
  expect(window.__trainerHistorySetup("captureSummaryWide").ok).toBe(true);
  expect(
    getComputedStyle(document.getElementById("memory-help")!).visibility,
  ).toBe("visible");
  await vi.advanceTimersByTimeAsync(10001);
  expect(document.getElementById("DATABASE_PATH")!.style.visibility).toBe("");
  vi.useRealTimers();
});
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
  (document.getElementById("SUMMARY_CHAR_LIMIT") as HTMLInputElement).value =
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
it("never confuses live-only, unknown, unapplied or arbitrary Save feedback with pending history restart", async () => {
  await setup(false);
  const status = document.getElementById("status")!;
  for (const message of [
    "Settings committed. Live fields applied for subsequent operations; captured work is unchanged.",
    "Settings committed. Live outcome unknown. Other saved settings are pending explicit quit/reopen.",
    "Settings committed. Live fields not applied. Other saved settings are pending explicit quit/reopen.",
    "Settings committed. Arbitrary private text pending explicit quit/reopen.",
  ]) {
    status.textContent = message;
    expect(window.__trainerHistorySetup("observe").savedForNextLaunch).toBe(
      false,
    );
  }
  status.textContent =
    "Settings committed. Quit and reopen to apply; the running backend is unchanged.";
  expect(window.__trainerHistorySetup("observe").savedForNextLaunch).toBe(true);
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
  expect(window.__trainerHistorySetup("capture").ok).toBe(false);
  expect(window.__trainerHistorySetup("dismissRestart").ok).toBe(true);
  expect(
    (document.getElementById("restart-required") as HTMLDialogElement).open,
  ).toBe(false);
  expect(
    invoke.mock.calls.filter(([command]) => command === "save_settings"),
  ).toHaveLength(1);
  expect(window.__trainerHistorySetup("dismissRestart").ok).toBe(false);
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
