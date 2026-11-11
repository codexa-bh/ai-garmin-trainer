// @vitest-environment jsdom
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fireEvent, waitFor } from "@testing-library/dom";
import fields from "../src-tauri/ui/settings-fields.json";
const invoke = vi.fn();
const id = "registration_11111111-1111-4111-8111-111111111111";
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
let connections: unknown[];
let listeners: Record<string, () => void>;
const byId = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
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
  listeners = {};
  invoke.mockReset();
  invoke.mockImplementation(async (command, args) => {
    if (command === "read_settings")
      return {
        chatCatalog: { version: 1, entries: [], defaultEntryId: null },
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
    if (command === "save_settings")
      return { message: "Saved and applied", restartRequired: false };
    if (command === "chatgpt_connect") {
      connections = [{ ...connection, epoch: 2, disclosed: false }];
      return "Connected; catalog requires Save";
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
function selectAccount() {
  fireEvent.change(byId("chatgpt-account"), { target: { value: id } });
}
it("keeps subscription/API-key providers distinct and never chooses the first account/model or discovers automatically", () => {
  expect(byId("catalog-chatgpt-heading").textContent).toBe(
    "ChatGPT subscription",
  );
  expect(byId("catalog-openai-heading").textContent).toBe("OpenAI API key");
  expect(byId<HTMLSelectElement>("chatgpt-account").value).toBe("");
  expect(byId<HTMLButtonElement>("catalog-chatgpt-add").disabled).toBe(true);
  selectAccount();
  expect(byId<HTMLSelectElement>("chatgpt-model").value).toBe("");
  expect(byId<HTMLSelectElement>("chatgpt-model").options[1].textContent).toBe(
    "Account model",
  );
  expect(
    invoke.mock.calls.some(
      ([command]) =>
        command === "chatgpt_action" || command === "chatgpt_connect",
    ),
  ).toBe(false);
});
it("adds an exact selected account/model and independent versioned summary choice only to the draft", async () => {
  selectAccount();
  fireEvent.change(byId("chatgpt-model"), { target: { value: "exact-model" } });
  expect(byId<HTMLButtonElement>("catalog-chatgpt-add").disabled).toBe(false);
  fireEvent.click(byId("catalog-chatgpt-add"));
  const input = document.querySelector(
    "#catalog-chatgpt-rows input",
  ) as HTMLInputElement;
  expect(input.value).toBe("exact-model");
  expect(input.readOnly).toBe(true);
  const memory = byId<HTMLSelectElement>("SUMMARY_MODEL");
  const choice = [...memory.options].find((option) =>
    option.textContent?.includes("ChatGPT plan"),
  )!;
  expect(JSON.parse(choice.value)).toMatchObject({
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
  ]);
  expect(payload.input.fields.SUMMARY_MODEL).toBe("unselected");
  expect(JSON.stringify(payload)).not.toMatch(
    /accessToken|refreshToken|clientId/,
  );
});
it("retains separate same-email registration labels without merging identities", async () => {
  connections.push({
    ...connection,
    id: "registration_22222222-2222-4222-8222-222222222222",
    label: "synthetic@example.invalid · 2",
  });
  fireEvent.click(byId("cancel"));
  await waitFor(() =>
    expect(byId<HTMLSelectElement>("chatgpt-account").options.length).toBe(3),
  );
  expect(
    [...byId<HTMLSelectElement>("chatgpt-account").options]
      .slice(1)
      .map((option) => option.textContent),
  ).toEqual(["synthetic@example.invalid · 1", "synthetic@example.invalid · 2"]);
});
it("shows first-success plan disclosure once, with explicit acknowledgment and focus restoration", async () => {
  selectAccount();
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
    expect(document.activeElement).toBe(byId("chatgpt-connect")),
  );
});
it("identity-only state cannot add a model and requests plan consent only by explicit action", async () => {
  connections = [
    { ...connection, state: "identity-only", planEnabled: false, models: [] },
  ];
  fireEvent.click(byId("cancel"));
  await waitFor(() =>
    expect(
      invoke.mock.calls.filter(([command]) => command === "chatgpt_connections")
        .length,
    ).toBeGreaterThan(1),
  );
  selectAccount();
  expect(byId("chatgpt-status").textContent).toContain(
    "plan permission required",
  );
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
it("a closed Settings window cannot show a late sign-in result or resurrect its draft", async () => {
  let finish: (value: string) => void = () => {};
  invoke.mockImplementationOnce(
    () =>
      new Promise<string>((resolve) => {
        finish = resolve;
      }),
  );
  fireEvent.click(byId("chatgpt-connect"));
  await waitFor(() => expect(byId("chatgpt-cancel").hidden).toBe(false));
  listeners["desktop-settings-closed"]();
  finish("Late result");
  await Promise.resolve();
  await Promise.resolve();
  expect(byId<HTMLDialogElement>("chatgpt-welcome").open).toBe(false);
  expect(byId("chatgpt-status").textContent).not.toBe("Late result");
});
