// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { waitFor } from "@testing-library/dom";
import fields from "../src-tauri/ui/settings-fields.json";
import { legacyChatCatalog } from "../src/lib/model-settings/catalog";

const invoke = vi.fn();
const controller = window as typeof window & {
  __trainerSetupSmoke: (action: unknown) => Record<string, boolean>;
  __trainerSetupSmokeRestore: () => void;
};
beforeEach(async () => {
  document.documentElement.innerHTML = readFileSync(
    "src-tauri/ui/index.html",
    "utf8",
  ).replace(/<script[^>]*>.*?<\/script>/gs, "");
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockImplementation(
    () => [{ width: 10 }] as unknown as DOMRectList,
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ json: async () => fields })),
  );
  Object.defineProperty(window, "__TAURI__", {
    configurable: true,
    value: { core: { invoke }, event: { listen: vi.fn(async () => {}) } },
  });
  invoke.mockReset();
  invoke.mockImplementation(async (command) => {
    if (command === "read_settings")
      return {
        revision: "synthetic-revision",
        chatCatalog: legacyChatCatalog(
          { AI_PROVIDER: "ollama" },
          { openai: false, deepseek: false },
        ),
        fields: {
          DATABASE_PATH: "/private/run/trainer.sqlite",
          AI_PROVIDER: "ollama",
          MEMORY_ENABLED: "false",
          GARMIN_HISTORY_START_DATE: "2024-01-01",
        },
        keys: {
          OPENAI_API_KEY: "not configured",
          DEEPSEEK_API_KEY: "not configured",
          OPENROUTER_API_KEY: "not configured",
        },
        saved: true,
        running: true,
      };
    if (command === "read_onboarding") return { eligible: false };
    if (command === "save_settings")
      return "Settings committed. Quit and reopen to apply; the running backend is unchanged.";
    return "";
  });
  window.eval(readFileSync("src-tauri/ui/setup.js", "utf8"));
  window.eval(readFileSync("src-tauri/debug/setup-smoke.js", "utf8"));
  await waitFor(() =>
    expect(controller.__trainerSetupSmoke("observe").ready).toBe(true),
  );
});
afterEach(() => {
  controller.__trainerSetupSmokeRestore();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("drives only actual Connect/later/cancel/Save controls without authentication", async () => {
  expect(controller.__trainerSetupSmoke("observe")).toMatchObject({
    notConnected: true,
    manualControlsAbsent: true,
    formVisible: false,
  });
  expect(controller.__trainerSetupSmoke("connect").formVisible).toBe(true);
  expect(controller.__trainerSetupSmoke("later").formVisible).toBe(false);
  expect(controller.__trainerSetupSmoke("cancel").ok).toBe(true);
  await waitFor(() =>
    expect(document.getElementById("status")?.textContent).toContain(
      "Edits cancelled",
    ),
  );
  expect(controller.__trainerSetupSmoke("save").ok).toBe(true);
  await waitFor(() =>
    expect(controller.__trainerSetupSmoke("observe").savedForNextLaunch).toBe(
      true,
    ),
  );
  const commands = invoke.mock.calls.map(([command]) => command);
  expect(commands).toContain("save_settings");
  expect(
    commands.some((name) =>
      [
        "start_auth",
        "submit_mfa",
        "choose_path",
        "finish_onboarding",
        "adopt_provider_settings",
      ].includes(name),
    ),
  ).toBe(false);
});
it("refuses private/arbitrary actions and never reads secrets, paths or copied text back", () => {
  for (const id of ["email", "password", "mfa", "OPENAI_API_KEY"])
    (document.getElementById(id) as HTMLInputElement).value =
      "private-sentinel";
  invoke.mockClear();
  for (const action of [
    "auth",
    "email",
    "mfa",
    "input",
    "picker",
    "finish",
    "eval",
    { target: "password" },
  ])
    expect(controller.__trainerSetupSmoke(action).ok).toBe(false);
  expect(invoke).not.toHaveBeenCalled();
  expect(JSON.stringify(controller.__trainerSetupSmoke("observe"))).not.toMatch(
    /private-sentinel|trainer.sqlite|provider-key/,
  );
  expect(controller.__trainerSetupSmoke("capture").ok).toBe(true);
  for (const id of [
    "DATABASE_PATH",
    "OPENAI_API_KEY",
    "email",
    "password",
    "mfa",
  ])
    expect(getComputedStyle(document.getElementById(id)!).visibility).toBe(
      "hidden",
    );
  expect(
    getComputedStyle(document.getElementById("garmin-fields")!).position,
  ).toBe("fixed");
  controller.__trainerSetupSmokeRestore();
  expect(
    (document.getElementById("DATABASE_PATH") as HTMLElement).style.cssText,
  ).toBe("");
});
it("refuses capture and restores styles when the privacy mask is not effective", () => {
  const original = window.getComputedStyle.bind(window);
  vi.spyOn(window, "getComputedStyle").mockImplementation((element, pseudo) => {
    const computed = original(element, pseudo);
    return element.id === "DATABASE_PATH"
      ? new Proxy(computed, {
          get(target, key) {
            return key === "visibility" ? "visible" : Reflect.get(target, key);
          },
        })
      : computed;
  });
  expect(controller.__trainerSetupSmoke("capture").ok).toBe(false);
  expect(
    (document.getElementById("garmin-fields") as HTMLElement).style.cssText,
  ).toBe("");
});
it("captures only verified static intro text at its real geometry and restores it", () => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
    new DOMRect(24, 24, 800, 45),
  );
  const intro = Array.from(document.querySelector("main")!.children).slice(
    0,
    3,
  );
  const before = intro.map((el) => el.getBoundingClientRect().toJSON());
  invoke.mockClear();
  expect(controller.__trainerSetupSmoke("captureIntro").ok).toBe(true);
  for (const element of document.body.querySelectorAll("*")) {
    if (!(element instanceof HTMLElement)) continue;
    expect(getComputedStyle(element).visibility).toBe(
      intro.includes(element) ? "visible" : "hidden",
    );
  }
  expect(intro.map((el) => el.getBoundingClientRect().toJSON())).toEqual(
    before,
  );
  expect(invoke).not.toHaveBeenCalled();
  controller.__trainerSetupSmokeRestore();
  for (const element of document.body.querySelectorAll("*"))
    expect((element as HTMLElement).style.cssText).toBe("");
});
it.each([
  "private-text",
  "nested-control",
  "hidden",
  "overflow",
  "ineffective-mask",
])("refuses intro capture on %s and restores every style", (scenario) => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
    new DOMRect(24, 24, scenario === "overflow" ? 2000 : 800, 45),
  );
  const notice = document.querySelector("main > p") as HTMLElement;
  if (scenario === "private-text") notice.textContent = "private-sentinel";
  if (scenario === "nested-control")
    notice.append(document.createElement("input"));
  if (scenario === "hidden") notice.hidden = true;
  if (scenario === "ineffective-mask") {
    const original = window.getComputedStyle.bind(window);
    vi.spyOn(window, "getComputedStyle").mockImplementation(
      (element, pseudo) => {
        const computed = original(element, pseudo);
        return element.id === "DATABASE_PATH"
          ? new Proxy(computed, {
              get(target, key) {
                return key === "visibility"
                  ? "visible"
                  : Reflect.get(target, key);
              },
            })
          : computed;
      },
    );
  }
  expect(controller.__trainerSetupSmoke("captureIntro").ok).toBe(false);
  for (const element of document.body.querySelectorAll("*"))
    expect((element as HTMLElement).style.cssText).toBe("");
});
it("expires the intro privacy mask if native capture completion never arrives", () => {
  vi.useFakeTimers();
  try {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
      new DOMRect(24, 24, 800, 45),
    );
    expect(controller.__trainerSetupSmoke("captureIntro").ok).toBe(true);
    vi.advanceTimersByTime(5000);
    expect(
      (document.querySelector("main > p") as HTMLElement).style.cssText,
    ).toBe("");
  } finally {
    vi.useRealTimers();
  }
});
it("refuses disabled, hidden or ambiguous controls before dispatch", () => {
  const button = document.getElementById("connect") as HTMLButtonElement;
  button.disabled = true;
  expect(controller.__trainerSetupSmoke("connect").ok).toBe(false);
  button.disabled = false;
  button.hidden = true;
  expect(controller.__trainerSetupSmoke("connect").ok).toBe(false);
  button.hidden = false;
  button.parentElement?.append(button.cloneNode(true));
  expect(controller.__trainerSetupSmoke("connect").ok).toBe(false);
});
