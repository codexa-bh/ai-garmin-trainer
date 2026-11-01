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
  it.each(["existing installation", "first run"])(
    "keeps concise notices visible in introductory reading order for %s",
    async (context) => {
      if (context === "first run") await firstRun();
      const main = within(document.body).getByRole("main");
      const heading = within(main).getByRole("heading", {
        level: 1,
        name: "Settings",
      });
      const notices = Array.from(main.querySelectorAll(":scope > p")).slice(
        0,
        2,
      );
      expect(
        notices.map((notice) =>
          notice.textContent?.replace(/\s+/g, " ").trim(),
        ),
      ).toEqual([
        "Settings and API keys are saved locally without encryption. Saved keys are hidden.",
        "The app can update the selected database. Close other apps using it first. Existing databases won’t be upgraded automatically.",
      ]);
      expect(heading.nextElementSibling).toBe(notices[0]);
      expect(notices[0].nextElementSibling).toBe(notices[1]);
      expect(notices[1].nextElementSibling).toBe(
        document.getElementById("status"),
      );
      for (const notice of notices) {
        expect(
          notice.closest("[hidden], [aria-hidden='true'], details"),
        ).toBeNull();
      }
      const status = document.getElementById("status")!;
      expect(within(main).getAllByRole("status")).toContain(status);
      expect(status.closest("[hidden], [aria-hidden='true']")).toBeNull();
      const normalCopy = [
        ...notices,
        status,
        document.getElementById("storage-status")!,
      ]
        .map((element) => element.textContent)
        .join(" ");
      expect(normalCopy).not.toMatch(
        /0700|0600|owner-private|plaintext file|same user|privileged|backups|env|exclusive|evaluation|disposable|unused destination/i,
      );
      expect(document.getElementById("storage-status")?.textContent).toBe("");
      expect(document.getElementById("wizard")?.hidden).toBe(
        context !== "first run",
      );
      expect(document.getElementById("next-launch-guidance")?.hidden).toBe(
        context === "first run",
      );
    },
  );
  it("does not reintroduce duplicate storage narration after Save and reload", async () => {
    fireEvent.submit(document.getElementById("settings")!);
    await waitFor(() =>
      expect(document.getElementById("status")?.textContent).toContain(
        "backend unchanged",
      ),
    );
    expect(document.getElementById("storage-status")?.textContent).toBe("");
    fireEvent.click(document.getElementById("cancel")!);
    await waitFor(() =>
      expect(document.getElementById("status")?.textContent).toContain(
        "Changes require explicit quit/reopen",
      ),
    );
    expect(document.getElementById("storage-status")?.textContent).toBe("");
  });
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
    expect(document.body.textContent).toContain("without encryption");
    expect(document.getElementById("storage-status")?.textContent).toBe(
      "Storage: legacy settings preserved. Explicit adoption or private re-entry required.",
    );
    const recovery = within(document.getElementById("migration")!);
    expect(
      recovery.getByRole("heading", {
        name: "Legacy settings need one-time adoption",
      }),
    ).toBeTruthy();
    expect(
      recovery.getByRole("button", {
        name: "Adopt referenced Keychain keys once",
      }),
    ).toBeTruthy();
    expect(
      recovery.getByRole("button", {
        name: "Save private re-entry without Keychain",
      }),
    ).toBeTruthy();
    expect(document.getElementById("migration")?.textContent).toContain(
      "Refusal never retries automatically",
    );
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
      "Pending Save",
    );
    expect(
      invoke.mock.calls.filter(([name]) => name === "start_auth"),
    ).toHaveLength(1);
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
