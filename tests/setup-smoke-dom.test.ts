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
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
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
      return "Settings committed. Live fields applied for subsequent operations; captured work is unchanged.";
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
    expect(controller.__trainerSetupSmoke("observe").liveApplied).toBe(true),
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
it.each(["liveCatalog", "liveRotate", "liveClear", "liveEmpty"])(
  "uses only fixed synthetic %s form presets and never returns values",
  async (action) => {
    if (action === "liveClear" || action === "liveEmpty") {
      const previous = invoke.getMockImplementation()!;
      invoke.mockImplementation(async (command, args) => {
        const result = await previous(command, args);
        return command === "read_settings"
          ? {
              ...result,
              keys: {
                OPENAI_API_KEY: "configured",
                DEEPSEEK_API_KEY: "configured",
                OPENROUTER_API_KEY: "configured",
              },
            }
          : result;
      });
      controller.__trainerSetupSmoke("cancel");
      await waitFor(() =>
        expect(
          document.getElementById("OPENAI_API_KEY-status")?.textContent,
        ).toBe("Configured — saved key hidden"),
      );
    }
    let submitted: Record<string, unknown> | undefined;
    const original = invoke.getMockImplementation()!;
    invoke.mockImplementation(async (command, args) => {
      if (command === "save_settings") submitted = structuredClone(args.input);
      return original(command, args);
    });
    expect(controller.__trainerSetupSmoke(action).ok).toBe(true);
    expect(invoke.mock.calls.some(([name]) => name === "save_settings")).toBe(
      false,
    );
    expect(controller.__trainerSetupSmoke("save").ok).toBe(true);
    await waitFor(() =>
      expect(controller.__trainerSetupSmoke("observe").liveApplied).toBe(true),
    );
    const payload = submitted as {
      chatCatalog: {
        entries: Array<{ provider: string; modelId: string }>;
        defaultEntryId: string | null;
      };
      fields: Record<string, string>;
      keys: Record<string, unknown>;
    };
    if (action === "liveCatalog") {
      expect(
        payload.chatCatalog.entries.find(
          (entry: { provider: string }) => entry.provider === "openai",
        )?.modelId,
      ).toBe("Synthetic/Live:one");
      expect(payload.chatCatalog.defaultEntryId).toBe("entry_legacy_openai");
    }
    if (action === "liveRotate")
      expect(payload.fields.MEMORY_EMBEDDING_DIMS).toBe("2048");
    for (const slot of [
      "OPENAI_API_KEY",
      "DEEPSEEK_API_KEY",
      "OPENROUTER_API_KEY",
    ]) {
      expect(payload.keys[slot]).toEqual(
        action === "liveClear" || action === "liveEmpty"
          ? { intent: "clear" }
          : {
              intent: "replace",
              value: `T0257-synthetic-${slot}-${action === "liveCatalog" ? "one" : "two"}`,
            },
      );
    }
    if (action === "liveClear")
      expect(payload.chatCatalog.entries).toHaveLength(3);
    if (action === "liveEmpty")
      expect(payload.chatCatalog.entries).toHaveLength(0);
    expect(
      JSON.stringify(controller.__trainerSetupSmoke("observe")),
    ).not.toMatch(/synthetic|API_KEY|sqlite|Live:one/);
    expect(controller.__trainerSetupSmoke("captureLive").ok).toBe(true);
    expect(
      getComputedStyle(document.getElementById("status")!).visibility,
    ).toBe("visible");
    expect(
      getComputedStyle(document.getElementById("OPENAI_API_KEY")!).visibility,
    ).toBe("hidden");
    controller.__trainerSetupSmokeRestore();
    document.getElementById("status")!.textContent += " private-sentinel";
    expect(controller.__trainerSetupSmoke("captureLive").ok).toBe(false);
  },
);

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
  ).not.toBe("fixed");
  controller.__trainerSetupSmokeRestore();
  expect(
    (document.getElementById("DATABASE_PATH") as HTMLElement).style.cssText,
  ).toBe("");
});
it.each(["capture", "captureWide", "captureNarrow"])(
  "refuses %s and restores styles when the privacy mask is not effective",
  (action) => {
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
    expect(controller.__trainerSetupSmoke(action).ok).toBe(false);
    expect(
      (document.getElementById("garmin-fields") as HTMLElement).style.cssText,
    ).toBe("");
  },
);
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
async function configuredProviders() {
  const original = invoke.getMockImplementation()!;
  invoke.mockImplementation(async (command, args) => {
    const result = await original(command, args);
    return command === "read_settings"
      ? {
          ...result,
          keys: {
            OPENAI_API_KEY: "configured",
            DEEPSEEK_API_KEY: "configured",
            OPENROUTER_API_KEY: "not configured",
          },
        }
      : result;
  });
  controller.__trainerSetupSmoke("cancel");
  await waitFor(() =>
    expect(controller.__trainerSetupSmoke("observe").keysReady).toBe(true),
  );
}
it("exercises finite configured/replacement/removal/absent fields and copies only genuine intent payloads", async () => {
  await configuredProviders();
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
    new DOMRect(24, 24, 300, 45),
  );
  expect(controller.__trainerSetupSmoke("catalogExercise").ok).toBe(true);
  expect(controller.__trainerSetupSmoke("captureOpenai").ok).toBe(true);
  controller.__trainerSetupSmokeRestore();
  expect(controller.__trainerSetupSmoke("keysExercise")).toMatchObject({
    ok: true,
    keysEdited: true,
  });
  expect(controller.__trainerSetupSmoke("keysExercise").ok).toBe(false);
  expect(controller.__trainerSetupSmoke("captureOpenai").ok).toBe(true);
  expect(
    getComputedStyle(document.getElementById("DATABASE_PATH")!).visibility,
  ).toBe("hidden");
  controller.__trainerSetupSmokeRestore();
  let sent: unknown;
  const original = invoke.getMockImplementation()!;
  invoke.mockImplementation(async (command, args) => {
    if (command === "save_settings") sent = structuredClone(args.input.keys);
    return original(command, args);
  });
  controller.__trainerSetupSmoke("save");
  await waitFor(() =>
    expect(sent).toEqual({
      OPENAI_API_KEY: {
        intent: "replace",
        value: "synthetic-openai-replacement",
      },
      DEEPSEEK_API_KEY: { intent: "clear" },
      OPENROUTER_API_KEY: { intent: "unchanged" },
    }),
  );
  expect(JSON.stringify(controller.__trainerSetupSmoke("observe"))).not.toMatch(
    /synthetic-openai|••|sqlite/,
  );
});
it("refuses field exercise without exact presence and extra/private action input", async () => {
  expect(controller.__trainerSetupSmoke("keysExercise").ok).toBe(false);
  await configuredProviders();
  invoke.mockClear();
  for (const action of [
    "keysInput",
    { action: "keysExercise", value: "private" },
    { type: "keysExercise" },
  ])
    expect(controller.__trainerSetupSmoke(action).ok).toBe(false);
  expect(invoke).not.toHaveBeenCalled();
  (document.getElementById("OPENAI_API_KEY") as HTMLInputElement).value =
    "private-sentinel";
  expect(controller.__trainerSetupSmoke("keysExercise").ok).toBe(false);
  expect(
    JSON.stringify(controller.__trainerSetupSmoke("observe")),
  ).not.toContain("private-sentinel");
});
it("exercises real grouped controls and masks only canonical synthetic provider sections at unchanged geometry", () => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
    new DOMRect(24, 24, 300, 45),
  );
  expect(controller.__trainerSetupSmoke("catalogExercise")).toMatchObject({
    ok: true,
    catalogReady: true,
    catalogExercised: true,
  });
  expect(document.querySelectorAll(".catalog-row")).toHaveLength(8);
  expect(
    document.querySelectorAll('.catalog-row [aria-pressed="true"]'),
  ).toHaveLength(1);
  expect(
    invoke.mock.calls.some(([command]) => command === "save_settings"),
  ).toBe(false);
  const values = Array.from(
    document.querySelectorAll<HTMLInputElement>(".catalog-row input"),
  ).map((el) => [el.id, el.value]);
  for (const provider of ["Openai", "Deepseek", "Ollama", "Openrouter"]) {
    expect(controller.__trainerSetupSmoke(`capture${provider}`).ok).toBe(true);
    expect(
      getComputedStyle(document.getElementById("DATABASE_PATH")!).visibility,
    ).toBe("hidden");
    expect(
      getComputedStyle(document.getElementById("status")!).visibility,
    ).toBe("hidden");
    expect(
      getComputedStyle(
        document.getElementById(`catalog-${provider.toLowerCase()}-add`)!,
      ).position,
    ).not.toBe("fixed");
    controller.__trainerSetupSmokeRestore();
  }
  expect(
    Array.from(
      document.querySelectorAll<HTMLInputElement>(".catalog-row input"),
    ).map((el) => [el.id, el.value]),
  ).toEqual(values);
  for (const el of document.body.querySelectorAll<HTMLElement>("*"))
    expect(el.style.cssText).toBe("");
});
it.each([
  "private-model",
  "private-key",
  "private-label",
  "trailing-text",
  "nested",
  "overflow",
  "mask",
])("refuses provider capture on %s and restores", (scenario) => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
    new DOMRect(24, 24, scenario === "overflow" ? 2000 : 300, 45),
  );
  expect(controller.__trainerSetupSmoke("catalogExercise").ok).toBe(true);
  const model = document.getElementById(
    "entry_legacy_openai-modelId",
  ) as HTMLInputElement;
  if (scenario === "private-model") model.value = "private-sentinel";
  if (scenario === "private-key")
    (document.getElementById("OPENAI_API_KEY") as HTMLInputElement).value =
      "private-sentinel";
  if (scenario === "private-label")
    model.parentElement!.firstChild!.textContent = "private-sentinel";
  if (scenario === "trailing-text")
    model.parentElement!.append(document.createTextNode("private-sentinel"));
  if (scenario === "nested")
    model.parentElement!.append(document.createElement("span"));
  if (scenario === "mask") {
    const original = window.getComputedStyle.bind(window);
    vi.spyOn(window, "getComputedStyle").mockImplementation((el, pseudo) => {
      const computed = original(el, pseudo);
      return el.id === "DATABASE_PATH"
        ? new Proxy(computed, {
            get(target, key) {
              return key === "visibility"
                ? "visible"
                : Reflect.get(target, key);
            },
          })
        : computed;
    });
  }
  expect(controller.__trainerSetupSmoke("captureOpenai").ok).toBe(false);
  for (const el of document.body.querySelectorAll<HTMLElement>("*"))
    expect(el.style.cssText).toBe("");
});
it("expires provider masks and refuses mutation replay or noncanonical starting data", () => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
    new DOMRect(24, 24, 300, 45),
  );
  expect(controller.__trainerSetupSmoke("captureOpenai").ok).toBe(false);
  expect(controller.__trainerSetupSmoke("catalogExercise").ok).toBe(true);
  expect(controller.__trainerSetupSmoke("catalogExercise").ok).toBe(false);
  vi.useFakeTimers();
  try {
    expect(controller.__trainerSetupSmoke("captureOpenai").ok).toBe(true);
    vi.advanceTimersByTime(5000);
    for (const el of document.body.querySelectorAll<HTMLElement>("*"))
      expect(el.style.cssText).toBe("");
  } finally {
    vi.useRealTimers();
  }
});
it.each(["captureWide", "captureNarrow"])(
  "captures %s with unchanged Garmin geometry and a finite static-only mask",
  (action) => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
      new DOMRect(24, 24, 350, 600),
    );
    const root = document.getElementById("garmin-fields")!;
    const before = root.getBoundingClientRect().toJSON();
    expect(controller.__trainerSetupSmoke(action).ok).toBe(true);
    expect(root.getBoundingClientRect().toJSON()).toEqual(before);
    expect(getComputedStyle(root).position).not.toBe("fixed");
    expect(
      getComputedStyle(document.getElementById("auth-status")!).visibility,
    ).toBe("hidden");
    controller.__trainerSetupSmokeRestore();
    expect((root as HTMLElement).style.cssText).toBe("");
  },
);
it.each(["text", "nested", "disclosure", "overflow"])(
  "refuses Garmin capture on %s without leaking values",
  (scenario) => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
      new DOMRect(24, 24, scenario === "overflow" ? 2000 : 350, 600),
    );
    if (scenario === "text")
      document.getElementById("connection-status")!.textContent += " private";
    if (scenario === "nested")
      document
        .getElementById("connect")!
        .append(document.createElement("span"));
    if (scenario === "disclosure")
      (document.getElementById("garmin-privacy") as HTMLDetailsElement).open =
        true;
    expect(controller.__trainerSetupSmoke("captureNarrow").ok).toBe(false);
    for (const element of document.body.querySelectorAll("*"))
      expect((element as HTMLElement).style.cssText).toBe("");
  },
);
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
