// @vitest-environment jsdom
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fireEvent, waitFor } from "@testing-library/dom";
import fields from "../src-tauri/ui/settings-fields.json";
const invoke = vi.fn();
const id = "registration_11111111-1111-4111-8111-111111111111";
const otherId = "registration_22222222-2222-4222-8222-222222222222";
const connection = {
  id,
  epoch: 1,
  label: "synthetic@example.invalid · 1",
  state: "connected",
  planEnabled: true,
  disclosed: true,
  models: [
    { slug: "exact-model", displayName: "Account model" },
    { slug: "second-model", displayName: "Second model" },
  ],
};
let connections: (typeof connection)[];
let savedEntries: {
  id: string;
  provider: string;
  modelId: string;
  registrationId?: string;
}[];
let listeners: Record<string, () => void>;
const byId = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const choices = () => [
  ...document.querySelectorAll<HTMLInputElement>("#chatgpt-model input"),
];
const rows = () => [
  ...document.querySelectorAll<HTMLInputElement>("#catalog-chatgpt-rows input"),
];
const choose = (value: string) =>
  fireEvent.click(choices().find((input) => input.value === value)!);
const add = () => fireEvent.click(byId("catalog-chatgpt-add"));
const selectAccount = (value = id) =>
  fireEvent.change(byId("chatgpt-account"), { target: { value } });
async function reload() {
  const before = invoke.mock.calls.filter(
    ([command]) => command === "chatgpt_connections",
  ).length;
  fireEvent.click(byId("cancel"));
  await waitFor(() =>
    expect(
      invoke.mock.calls.filter(([command]) => command === "chatgpt_connections")
        .length,
    ).toBeGreaterThan(before),
  );
  await waitFor(() =>
    expect(byId<HTMLButtonElement>("cancel").disabled).toBe(false),
  );
}
beforeEach(async () => {
  document.documentElement.innerHTML = readFileSync(
    "src-tauri/ui/index.html",
    "utf8",
  ).replace(/<script[^>]*>.*?<\/script>/gs, "");
  for (const dialog of document.querySelectorAll("dialog")) {
    dialog.showModal = () => {
      dialog.open = true;
    };
    dialog.close = () => {
      dialog.open = false;
      dialog.dispatchEvent(new Event("close"));
    };
  }
  connections = [structuredClone(connection)];
  savedEntries = [];
  listeners = {};
  invoke.mockReset();
  invoke.mockImplementation(async (command, args) => {
    if (command === "read_settings")
      return {
        chatCatalog: {
          version: 1,
          entries: structuredClone(savedEntries),
          defaultEntryId: null,
        },
        revision: "1",
        fields: {
          DATABASE_PATH: "/private/authored.sqlite",
          SUMMARY_MODEL: "unselected",
        },
        keys: {
          OPENAI_API_KEY: "not configured",
          DEEPSEEK_API_KEY: "not configured",
          OPENROUTER_API_KEY: "not configured",
        },
        saved: true,
        running: true,
      };
    if (command === "chatgpt_context") return 0;
    if (command === "chatgpt_connections") return structuredClone(connections);
    if (command === "save_settings") {
      savedEntries = structuredClone(args.input.chatCatalog.entries);
      return { message: "Saved and applied", restartRequired: false };
    }
    if (command === "chatgpt_connect") {
      connections = [{ ...connection, epoch: 2, disclosed: false }];
      return {
        registrationId: id,
        message: "Connected; catalog requires Save",
      };
    }
    if (command === "chatgpt_action" && args.action === "disclose") {
      connections = [{ ...connection, epoch: 2, disclosed: true }];
      return "Acknowledged";
    }
    return null;
  });
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
  window.eval(readFileSync("src-tauri/ui/setup.js", "utf8"));
  await waitFor(() =>
    expect(byId("status").textContent).toContain("Saved settings loaded"),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("reuses a sole saved account without signing in or auto-selecting models; providers stay distinct", () => {
  expect(byId("catalog-chatgpt-heading").textContent).toBe(
    "ChatGPT subscription",
  );
  expect(byId("catalog-openai-heading").textContent).toBe("OpenAI API key");
  expect(byId<HTMLSelectElement>("chatgpt-account").value).toBe(id);
  expect(byId("chatgpt-connect").hidden).toBe(true);
  expect(choices().map((input) => input.checked)).toEqual([false, false]);
  expect(choices()[0].closest("label")?.textContent).toBe("Account model");
  expect(byId<HTMLButtonElement>("catalog-chatgpt-add").disabled).toBe(true);
  expect(
    invoke.mock.calls.some(
      ([command]) =>
        command === "chatgpt_action" || command === "chatgpt_connect",
    ),
  ).toBe(false);
});
it("requires explicit choice among multiple saved registrations and preserves same-email labels", async () => {
  connections.push({
    ...connection,
    id: otherId,
    label: "synthetic@example.invalid · 2",
  });
  await reload();
  expect(byId<HTMLSelectElement>("chatgpt-account").value).toBe("");
  expect(
    [...byId<HTMLSelectElement>("chatgpt-account").options]
      .slice(1)
      .map((option) => option.textContent),
  ).toEqual(["synthetic@example.invalid · 1", "synthetic@example.invalid · 2"]);
  expect(choices()).toHaveLength(0);
  selectAccount();
  expect(choices()).toHaveLength(2);
});
it("adds several explicit models once in provider order, preserving registration and independent summary choice until Save", async () => {
  choose("second-model");
  choose("exact-model");
  expect(byId("catalog-chatgpt-add").textContent).toBe("Add selected (2)");
  add();
  expect(rows().map((input) => input.value)).toEqual([
    "exact-model",
    "second-model",
  ]);
  expect(rows().every((input) => input.readOnly)).toBe(true);
  expect(choices().every((input) => input.disabled && !input.checked)).toBe(
    true,
  );
  expect(byId<HTMLButtonElement>("catalog-chatgpt-add").disabled).toBe(true);
  expect(
    invoke.mock.calls.some(([command]) => command === "save_settings"),
  ).toBe(false);
  const memory = byId<HTMLSelectElement>("SUMMARY_MODEL");
  const options = [...memory.options].filter((option) =>
    option.textContent?.includes("ChatGPT plan"),
  );
  expect(options).toHaveLength(2);
  expect(JSON.parse(options[0].value)).toMatchObject({
    version: 2,
    registrationId: id,
    provider: "chatgpt",
    modelId: "exact-model",
  });
  expect(memory.value).toBe("unselected");
  fireEvent.submit(byId("settings"));
  await waitFor(() =>
    expect(
      invoke.mock.calls.some(([command]) => command === "save_settings"),
    ).toBe(true),
  );
  const payload = invoke.mock.calls.find(
    ([command]) => command === "save_settings",
  )![1];
  expect(payload.input.chatCatalog.entries).toEqual([
    expect.objectContaining({
      registrationId: id,
      provider: "chatgpt",
      modelId: "exact-model",
    }),
    expect.objectContaining({
      registrationId: id,
      provider: "chatgpt",
      modelId: "second-model",
    }),
  ]);
  expect(payload.input.fields.SUMMARY_MODEL).toBe("unselected");
  expect(JSON.stringify(payload)).not.toMatch(
    /accessToken|refreshToken|clientId/,
  );
});
it("select-all and clear use actual checkboxes and cannot add the same pair twice", () => {
  fireEvent.click(byId("chatgpt-select-all"));
  expect(choices().every((input) => input.checked)).toBe(true);
  expect(byId("chatgpt-select-all").textContent).toBe("Clear selection");
  fireEvent.click(byId("chatgpt-select-all"));
  expect(choices().every((input) => !input.checked)).toBe(true);
  choose("exact-model");
  add();
  fireEvent.click(byId("chatgpt-select-all"));
  add();
  add();
  expect(rows()).toHaveLength(2);
  expect(rows().map((input) => input.value)).toEqual([
    "exact-model",
    "second-model",
  ]);
  expect(choices().every((input) => input.disabled)).toBe(true);
});
it("account changes clear selections, never leak models and keep equal model IDs separately account-bound", async () => {
  connections.push({
    ...connection,
    id: otherId,
    models: [{ slug: "exact-model", displayName: "Other account model" }],
  });
  await reload();
  selectAccount();
  choose("second-model");
  selectAccount(otherId);
  expect(choices().map((input) => input.value)).toEqual(["exact-model"]);
  expect(choices().every((input) => !input.checked)).toBe(true);
  choose("exact-model");
  add();
  selectAccount();
  expect(choices().every((input) => !input.checked && !input.disabled)).toBe(
    true,
  );
  choose("exact-model");
  add();
  fireEvent.submit(byId("settings"));
  await waitFor(() => expect(savedEntries).toHaveLength(2));
  expect(
    savedEntries.map((entry) => [entry.registrationId, entry.modelId]),
  ).toEqual([
    [otherId, "exact-model"],
    [id, "exact-model"],
  ]);
});
it("over-capacity selection adds nothing rather than partially filling the catalog", async () => {
  savedEntries = Array.from({ length: 31 }, (_, n) => ({
    id: `entry_${n}`,
    provider: "ollama",
    modelId: `authored-${n}`,
  }));
  await reload();
  fireEvent.click(byId("chatgpt-select-all"));
  expect(byId<HTMLButtonElement>("catalog-chatgpt-add").disabled).toBe(true);
  expect(byId("chatgpt-model-selection").textContent).toContain(
    "only 1 catalog slots",
  );
  add();
  expect(rows()).toHaveLength(0);
  choose("second-model");
  add();
  expect(rows()).toHaveLength(1);
  expect(byId("catalog-limit").textContent).toContain("32/32");
  add();
  expect(rows()).toHaveLength(1);
});
it("removal enables an already-added choice again without retaining a hidden selection", () => {
  choose("exact-model");
  add();
  expect(choices()[0].disabled).toBe(true);
  fireEvent.click(document.querySelector("#catalog-chatgpt-rows button")!);
  expect(choices()[0].disabled).toBe(false);
  expect(choices()[0].checked).toBe(false);
  choose("exact-model");
  add();
  expect(rows()).toHaveLength(1);
});
it("Cancel restores saved rows while the batch remains a draft", async () => {
  fireEvent.click(byId("chatgpt-select-all"));
  add();
  expect(rows()).toHaveLength(2);
  await reload();
  expect(rows()).toHaveLength(0);
  expect(savedEntries).toHaveLength(0);
  expect(choices().every((input) => !input.checked)).toBe(true);
});
it("refresh clears removed models without selecting replacements or losing still-eligible selection", async () => {
  choose("exact-model");
  choose("second-model");
  invoke.mockImplementationOnce(async () => {
    connections = [{ ...connection, models: [connection.models[1]] }];
    return "Refreshed";
  });
  fireEvent.click(byId("chatgpt-models"));
  await waitFor(() => expect(choices()).toHaveLength(1));
  await waitFor(() =>
    expect(byId<HTMLButtonElement>("catalog-chatgpt-add").disabled).toBe(false),
  );
  expect(choices()[0].value).toBe("second-model");
  expect(choices()[0].checked).toBe(true);
});
it("explicit Connect another account stays deliberate while native reused outcome selects an existing unchanged registration", async () => {
  selectAccount("");
  expect(byId("chatgpt-connect").hidden).toBe(false);
  invoke.mockImplementationOnce(async () => ({
    registrationId: id,
    message: "Existing registration reused; credentials unchanged",
  }));
  fireEvent.click(byId("chatgpt-connect"));
  await waitFor(() =>
    expect(byId("chatgpt-status").textContent).toContain(
      "Existing registration reused",
    ),
  );
  expect(invoke).toHaveBeenCalledWith("chatgpt_connect", {
    registrationId: null,
    consent: false,
    context: 0,
  });
  expect(byId<HTMLSelectElement>("chatgpt-account").value).toBe(id);
  expect(choices().every((input) => !input.checked)).toBe(true);
  expect(connections).toHaveLength(1);
});
it("shows first-success plan disclosure once with acknowledgment and focus returned to a visible control", async () => {
  selectAccount("");
  fireEvent.click(byId("chatgpt-connect"));
  await waitFor(() =>
    expect(byId<HTMLDialogElement>("chatgpt-welcome").open).toBe(true),
  );
  expect(document.activeElement).toBe(byId("chatgpt-welcome-dismiss"));
  expect(
    byId("chatgpt-welcome-description").textContent?.replace(/\s+/g, " "),
  ).toContain("plan or credits");
  fireEvent.click(byId("chatgpt-welcome-dismiss"));
  await waitFor(() =>
    expect(byId<HTMLDialogElement>("chatgpt-welcome").open).toBe(false),
  );
  expect(invoke).toHaveBeenCalledWith("chatgpt_action", {
    action: "disclose",
    registrationId: id,
    context: 0,
  });
  await waitFor(() =>
    expect(document.activeElement).toBe(byId("chatgpt-models")),
  );
});
it("identity-only state cannot add models and asks for plan consent only by explicit action", async () => {
  connections = [
    { ...connection, state: "identity-only", planEnabled: false, models: [] },
  ];
  await reload();
  expect(byId("chatgpt-status").textContent).toContain(
    "plan permission required",
  );
  expect(byId("chatgpt-model-picker").hidden).toBe(true);
  expect(byId<HTMLButtonElement>("catalog-chatgpt-add").disabled).toBe(true);
  expect(byId("chatgpt-consent").hidden).toBe(false);
  fireEvent.click(byId("chatgpt-consent"));
  await waitFor(() =>
    expect(invoke).toHaveBeenCalledWith("chatgpt_connect", {
      registrationId: id,
      consent: true,
      context: 0,
    }),
  );
});
it("a closed Settings window cannot show a late sign-in or select a late reused registration", async () => {
  let finish: (value: unknown) => void = () => {};
  invoke.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  selectAccount("");
  fireEvent.click(byId("chatgpt-connect"));
  await waitFor(() => expect(byId("chatgpt-cancel").hidden).toBe(false));
  listeners["desktop-settings-closed"]();
  finish({ registrationId: id, message: "Late result" });
  await Promise.resolve();
  await Promise.resolve();
  expect(byId<HTMLDialogElement>("chatgpt-welcome").open).toBe(false);
  expect(byId("chatgpt-status").textContent).not.toBe("Late result");
});
