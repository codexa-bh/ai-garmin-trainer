/** @vitest-environment jsdom */
import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { TrainerDashboard } from "@/app/trainer-dashboard";
import { ModelSettingsCard } from "@/app/dashboard/model-settings-card";
import { useModelSettings } from "@/app/dashboard/use-model-settings";
import type {
  ModelOption,
  ModelSettingsSnapshot,
} from "@/lib/model-settings/contracts";

const entries: ModelOption[] = [
  {
    id: "entry_one",
    provider: "openai",
    modelId: "Custom/First:Tag",
    displayName: "Fast",
    label: "Fast — openai / Custom/First:Tag",
    available: true,
  },
  {
    id: "entry_two",
    provider: "openai",
    modelId: "Custom/Second:Tag",
    displayName: "Fast",
    label: "Fast — openai / Custom/Second:Tag",
    available: true,
  },
  {
    id: "entry_local",
    provider: "ollama",
    modelId: "Local:Tag",
    label: "ollama / Local:Tag",
    available: true,
  },
  {
    id: "entry_router",
    provider: "openrouter",
    modelId: "Vendor/Exact:free",
    label: "openrouter / Vendor/Exact:free",
    available: false,
    unavailableReason: "Provider key not configured",
  },
];
function snapshot(count = 4): ModelSettingsSnapshot {
  return {
    version: 2,
    options: entries.slice(0, count),
    selected: null,
    defaultEntryId: count ? "entry_one" : null,
    effective: {
      entryId: count ? "entry_one" : null,
      provider: count ? "openai" : null,
      modelName: count ? "Custom/First:Tag" : null,
      source: "env",
      available: Boolean(count),
    },
    ...(!count
      ? {
          unavailableReason:
            "No default chat model. Configure entries in Settings.",
        }
      : {}),
  };
}
function saved(id = "entry_two"): ModelSettingsSnapshot {
  const entry = entries.find((value) => value.id === id)!;
  return {
    ...snapshot(),
    selected: id,
    effective: {
      entryId: id,
      provider: entry.provider,
      modelName: entry.modelId,
      source: "saved",
      available: entry.available,
    },
  };
}
function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}
function Harness({ open = true }: { open?: boolean }) {
  const modelSettings = useModelSettings(open);
  return open ? <ModelSettingsCard modelSettings={modelSettings} /> : null;
}
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("refreshes safe active metadata after native activation without preference writes or focus loss", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(response(snapshot()))
    .mockResolvedValueOnce(response(snapshot(0)));
  vi.stubGlobal("fetch", fetcher);
  render(<Harness />);
  await waitFor(() =>
    expect(screen.queryByText("Loading model settings…")).toBeNull(),
  );
  const select = screen.getByRole("combobox", { name: "Trainer model" });
  select.focus();
  await act(() =>
    window.dispatchEvent(new Event("trainer-live-settings-applied")),
  );
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  await waitFor(() =>
    expect(screen.getByText(/No configured entries/)).toBeTruthy(),
  );
  expect(document.activeElement).toBe(select);
  expect(fetcher.mock.calls.every((call) => !call[1]?.method)).toBe(true);
});

it.each([4, 1, 0])(
  "projects a %s-entry catalog to eligible exact/disambiguated choices without a large card",
  async (count) => {
    const fetcher = vi.fn().mockResolvedValue(response(snapshot(count)));
    vi.stubGlobal("fetch", fetcher);
    render(<Harness />);
    expect((screen.getByRole("combobox") as HTMLSelectElement).disabled).toBe(
      true,
    );
    await waitFor(() =>
      expect(screen.queryByText("Loading model settings…")).toBeNull(),
    );
    const control = screen.getByRole("combobox", {
      name: "Trainer model",
    }) as HTMLSelectElement;
    expect(control.disabled).toBe(count === 0);
    expect(control.closest("details, .settings-card")).toBeNull();
    expect(screen.getByText("Model", { selector: "label" })).toBeTruthy();
    if (count) {
      expect(
        screen.getByRole("option", { name: `Default · ${entries[0].label}` }),
      ).toBeTruthy();
      expect(
        Array.from(control.options)
          .slice(1)
          .map((option) => option.value),
      ).toEqual(
        entries
          .slice(0, count)
          .filter((entry) => entry.available)
          .map((entry) => entry.id),
      );
      for (const entry of entries.slice(0, count)) {
        if (entry.available) {
          expect(
            (
              screen.getByRole("option", {
                name: entry.label,
              }) as HTMLOptionElement
            ).disabled,
          ).toBe(false);
        } else {
          expect(
            screen.queryByRole("option", { name: new RegExp(entry.modelId) }),
          ).toBeNull();
        }
      }
      expect(control.title).toContain("openai / Custom/First:Tag");
    } else {
      expect(
        screen.getByRole("option", { name: "Selection required — no default" }),
      ).toBeTruthy();
      expect(screen.getByText(/No configured entries/)).toBeTruthy();
    }
    expect(fetcher).toHaveBeenCalledTimes(1);
  },
);
it.each(["saved", "default"] as const)(
  "preserves a hidden %s identity without browser fallback or writes, and allows explicit replacement/reset",
  async (source) => {
    const unavailable: ModelSettingsSnapshot = {
      ...saved("entry_router"),
      selected: source === "saved" ? "entry_router" : null,
      defaultEntryId: "entry_router",
      effective: {
        ...saved("entry_router").effective,
        source: source === "saved" ? "saved" : "env",
      },
      unavailableReason:
        "Provider key is not configured. Update native Settings, quit and reopen.",
    };
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response(unavailable))
      .mockResolvedValueOnce(
        response({ ...saved("entry_local"), defaultEntryId: "entry_router" }),
      )
      .mockResolvedValueOnce(
        response({
          ...unavailable,
          selected: null,
          effective: { ...unavailable.effective, source: "env" },
        }),
      );
    vi.stubGlobal("fetch", fetcher);
    render(<Harness />);
    await screen.findByText(unavailable.unavailableReason!);
    const control = screen.getByRole("combobox") as HTMLSelectElement;
    expect(control.value).toBe("");
    expect(control.selectedOptions[0].textContent).toBe(
      source === "saved"
        ? "Unavailable saved entry"
        : "Unavailable configured default",
    );
    expect(control.selectedOptions[0].disabled).toBe(true);
    expect(control.disabled).toBe(false);
    expect(screen.queryByRole("option", { name: /Vendor\/Exact/ })).toBeNull();
    expect(
      screen.queryByRole("option", { name: /Default ·.*openrouter/ }),
    ).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(1);
    fireEvent.change(control, { target: { value: "entry_local" } });
    await screen.findByText(/Saved preference: ollama/);
    expect(control.value).toBe("entry_local");
    fireEvent.click(
      screen.getByRole("button", { name: "Reset to configured default" }),
    );
    await screen.findByRole("option", {
      name: "Unavailable configured default",
    });
    expect(control.value).toBe("");
    expect(screen.getByText(unavailable.unavailableReason!)).toBeTruthy();
    expect(fetcher.mock.calls.slice(1).map(([, init]) => init.body)).toEqual([
      '{"modelId":"entry_local"}',
      '{"modelId":null}',
    ]);
  },
);

it.each([true, false])(
  "disables an all-ineligible catalog, keeps explicit reset (%s), and never writes on refresh",
  async (hasSaved) => {
    const unavailable: ModelSettingsSnapshot = {
      ...snapshot(),
      options: entries.map((entry) => ({ ...entry, available: false })),
      selected: hasSaved ? "entry_two" : null,
      effective: {
        ...snapshot().effective,
        entryId: hasSaved ? "entry_two" : "entry_one",
        modelName: hasSaved ? "Custom/Second:Tag" : "Custom/First:Tag",
        source: hasSaved ? "saved" : "env",
        available: false,
      },
      unavailableReason: "Provider key not configured",
    };
    const fetcher = vi.fn().mockResolvedValue(response(unavailable));
    vi.stubGlobal("fetch", fetcher);
    const view = render(<Harness />);
    await screen.findByText(/No available entries/);
    const control = screen.getByRole("combobox") as HTMLSelectElement;
    expect(control.disabled).toBe(true);
    expect(control.options).toHaveLength(1);
    expect(control.value).toBe("");
    expect(control.selectedOptions[0].disabled).toBe(true);
    expect(
      screen.getByText(
        /Configure provider keys or eligible local models.*quit\/reopen/,
      ),
    ).toBeTruthy();
    if (hasSaved)
      expect(
        (
          screen.getByRole("button", {
            name: "Reset to configured default",
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(false);
    view.rerender(<Harness open={false} />);
    view.rerender(<Harness />);
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    expect(fetcher.mock.calls.every(([, init]) => !init?.method)).toBe(true);
  },
);

it.each(["openai", "deepseek", "openrouter"] as const)(
  "hides every missing-key %s entry while keeping keyless local eligibility",
  async (provider) => {
    const options = entries.map((entry) =>
      entry.provider === "ollama"
        ? entry
        : { ...entry, provider, available: false },
    );
    const body: ModelSettingsSnapshot = {
      ...snapshot(),
      options,
      defaultEntryId: "entry_local",
      effective: {
        entryId: "entry_local",
        provider: "ollama",
        modelName: "Local:Tag",
        source: "env",
        available: true,
      },
    };
    const fetcher = vi.fn().mockResolvedValue(response(body));
    vi.stubGlobal("fetch", fetcher);
    render(<Harness />);
    await screen.findByRole("option", { name: "Default · ollama / Local:Tag" });
    const control = screen.getByRole("combobox") as HTMLSelectElement;
    expect(control.disabled).toBe(false);
    expect(Array.from(control.options).map((option) => option.value)).toEqual([
      "",
      "entry_local",
    ]);
    expect(control.value).toBe("");
    expect(fetcher).toHaveBeenCalledTimes(1);
  },
);

it("waits for authoritative save, survives hide/reopen/reload, and resets separately from catalog", async () => {
  let finish!: (response: Response) => void;
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(response(snapshot()))
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValueOnce(response(saved()))
    .mockResolvedValueOnce(response(snapshot()));
  vi.stubGlobal("fetch", fetcher);
  const view = render(<Harness />);
  await screen.findByRole("option", { name: `Default · ${entries[0].label}` });
  fireEvent.change(screen.getByRole("combobox"), {
    target: { value: "entry_two" },
  });
  expect(screen.getByText("Saving model setting…")).toBeTruthy();
  expect((screen.getByRole("combobox") as HTMLSelectElement).disabled).toBe(
    true,
  );
  view.rerender(<Harness open={false} />);
  await act(async () => {
    finish(response(saved()));
  });
  view.rerender(<Harness />);
  await screen.findByText(/Saved preference: openai \/ Custom\/Second:Tag/);
  await waitFor(() =>
    expect((screen.getByRole("combobox") as HTMLSelectElement).disabled).toBe(
      false,
    ),
  );
  expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe(
    "entry_two",
  );
  expect(fetcher.mock.calls[1][1].body).toBe('{"modelId":"entry_two"}');
  fireEvent.click(
    screen.getByRole("button", { name: "Reset to configured default" }),
  );
  await screen.findByRole("option", { name: `Default · ${entries[0].label}` });
  expect(fetcher.mock.calls[3][1].body).toBe('{"modelId":null}');
  view.unmount();
  fetcher.mockResolvedValueOnce(response(saved()));
  render(<Harness />);
  await screen.findByText(/Saved preference: openai \/ Custom\/Second:Tag/);
});
it("keeps missing/deleted selections explicit, never substitutes default, and allows exact reselection/reset", async () => {
  const unavailable = {
    ...saved(),
    selected: "entry_deleted",
    effective: {
      entryId: "entry_deleted",
      provider: null,
      modelName: null,
      source: "saved",
      available: false,
    },
    unavailableReason: "Saved entry no longer in activated catalog",
  };
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(unavailable)));
  render(<Harness />);
  await screen.findByText("Saved entry no longer in activated catalog");
  expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("");
  expect(
    screen.getByRole("option", { name: "Unavailable saved entry" }),
  ).toBeTruthy();
  expect(
    screen.getByRole("button", { name: "Reset to configured default" }),
  ).toBeTruthy();
});
it("does not claim failed saves; direct retry safely reconciles lost keys and load failures", async () => {
  const stale = {
    ...saved("entry_router"),
    unavailableReason: "Saved provider unavailable",
  };
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(response(snapshot()))
    .mockResolvedValueOnce(response({ error: "secret-upstream" }, 400))
    .mockResolvedValueOnce(response(stale))
    .mockRejectedValueOnce(new Error("secret-network"));
  vi.stubGlobal("fetch", fetcher);
  const view = render(<Harness />);
  await screen.findByRole("option", { name: `Default · ${entries[0].label}` });
  fireEvent.change(screen.getByRole("combobox"), {
    target: { value: "entry_two" },
  });
  await screen.findByText(/could not be confirmed/);
  expect(screen.queryByText(/Saved preference:/)).toBeNull();
  expect(screen.queryByText(/secret-upstream/)).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: "Retry model availability" }),
  );
  await screen.findByText("Saved provider unavailable");
  expect(screen.queryByRole("option", { name: /openrouter/ })).toBeNull();
  expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("");
  expect(
    screen.getByRole("option", { name: "Unavailable saved entry" }),
  ).toBeTruthy();
  expect(
    fetcher.mock.calls.filter(([, init]) => init?.method === "PATCH"),
  ).toHaveLength(1);
  view.rerender(<Harness open={false} />);
  view.rerender(<Harness />);
  await screen.findByText(/could not be loaded/);
  expect(screen.queryByText(/secret-network/)).toBeNull();
});
it.each([
  null,
  { ok: true },
  { options: [], selected: null, effective: {} },
  { ...snapshot(), version: 99 },
  { ...snapshot(), selected: "unbounded-corrupt-id" },
  { ...snapshot(), options: [...entries, entries[0]] },
  { ...snapshot(), effective: { ...snapshot().effective, modelName: "wrong" } },
])("contains malformed successful responses: %j", async (body) => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(body)));
  render(<Harness />);
  await screen.findByText(/could not be loaded/);
  expect((screen.getByRole("combobox") as HTMLSelectElement).disabled).toBe(
    true,
  );
});
it("recovers initial failure directly without reopening another view", async () => {
  const fetcher = vi
    .fn()
    .mockRejectedValueOnce(new Error("private-network-detail"))
    .mockResolvedValueOnce(response(snapshot()));
  vi.stubGlobal("fetch", fetcher);
  render(<Harness />);
  await screen.findByText(/could not be loaded/);
  expect(screen.queryByText(/private-network-detail/)).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: "Retry model availability" }),
  );
  await screen.findByRole("option", { name: `Default · ${entries[0].label}` });
  expect(fetcher).toHaveBeenCalledTimes(2);
});
it("keeps one model control below Message immediately before Send without remounting or sending on selection/reset/keys", async () => {
  const chatPosts: unknown[] = [];
  const fetcher = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === "/api/model-settings") {
      return Promise.resolve(
        response(
          init?.method === "PATCH" && init.body === '{"modelId":"entry_two"}'
            ? saved()
            : snapshot(),
        ),
      );
    }
    if (url === "/api/chat" && init?.method === "POST") {
      chatPosts.push(JSON.parse(String(init.body)));
    }
    return Promise.resolve(
      response({ messages: [], memories: [], conversations: [] }),
    );
  });
  vi.stubGlobal("fetch", fetcher);
  render(<TrainerDashboard />);

  const message = screen.getByRole("textbox", { name: "Message" });
  const composer = message.closest(".composer-dock")! as HTMLElement;
  const selector = within(composer).getByRole("combobox", {
    name: "Trainer model",
  }) as HTMLSelectElement;
  const send = within(composer).getByRole("button", { name: "Send" });
  expect(
    screen.getAllByRole("combobox", { name: "Trainer model" }),
  ).toHaveLength(1);
  expect(document.querySelector(".trainer-heading-row select")).toBeNull();
  expect(
    screen.getByRole("heading", { name: "Chat with your private coach" }),
  ).toBeTruthy();
  expect(
    message.compareDocumentPosition(selector) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(selector.closest(".chat-model-control")?.nextElementSibling).toBe(
    send,
  );
  expect(selector.labels?.[0].textContent).toBe("Model");
  expect(
    document.getElementById(selector.getAttribute("aria-describedby")!),
  ).toBeTruthy();
  await screen.findByRole("option", { name: `Default · ${entries[0].label}` });
  fireEvent.change(message, { target: { value: "Keep this draft" } });
  selector.focus();
  for (const key of ["Enter", " "]) {
    expect(fireEvent.keyDown(selector, { key })).toBe(true);
    fireEvent.keyUp(selector, { key });
  }
  fireEvent.change(selector, { target: { value: "entry_two" } });
  await screen.findByText(/Saved preference: openai \/ Custom\/Second:Tag/);
  expect(document.activeElement).toBe(selector);
  expect(screen.getByRole("textbox", { name: "Message" })).toBe(message);
  expect((message as HTMLTextAreaElement).value).toBe("Keep this draft");
  fireEvent.click(
    screen.getByRole("button", { name: "Reset to configured default" }),
  );
  await screen.findByRole("option", { name: `Default · ${entries[0].label}` });
  expect((message as HTMLTextAreaElement).value).toBe("Keep this draft");
  expect(screen.getByRole("textbox", { name: "Message" })).toBe(message);
  expect(chatPosts).toHaveLength(0);
  expect(
    fetcher.mock.calls.filter(
      ([url, init]) => String(url) === "/api/model-settings" && !init?.method,
    ),
  ).toHaveLength(1);
  expect(
    fetcher.mock.calls
      .filter(
        ([url, init]) =>
          String(url) === "/api/model-settings" && init?.method === "PATCH",
      )
      .map(([, init]) => init?.body),
  ).toEqual(['{"modelId":"entry_two"}', '{"modelId":null}']);
});

it("keeps failed availability and its direct recovery inside the footer without disabling Send or losing the draft", async () => {
  let failing = true;
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      if (String(input) === "/api/model-settings") {
        if (failing) return Promise.reject(new Error("private-network-detail"));
        return Promise.resolve(response(snapshot()));
      }
      if (String(input) === "/api/conversations/selection")
        return Promise.resolve(response({ conversationId: "default" }));
      return Promise.resolve(
        response({ messages: [], memories: [], conversations: [] }),
      );
    }),
  );
  render(<TrainerDashboard />);
  const message = screen.getByRole("textbox", {
    name: "Message",
  }) as HTMLTextAreaElement;
  fireEvent.change(message, { target: { value: "Draft through recovery" } });
  const composer = message.closest(".composer-dock")! as HTMLElement;
  const retry = await within(composer).findByRole("button", {
    name: "Retry model availability",
  });
  const selector = within(composer).getByRole("combobox") as HTMLSelectElement;
  expect(selector.disabled).toBe(true);
  expect(within(composer).getByRole("alert").textContent).toContain(
    "could not be loaded",
  );
  expect(
    (
      within(composer).getByRole("button", {
        name: "Send",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(false);
  failing = false;
  fireEvent.click(retry);
  await within(composer).findByRole("option", {
    name: `Default · ${entries[0].label}`,
  });
  expect(selector.disabled).toBe(false);
  expect(message.value).toBe("Draft through recovery");
  expect(within(composer).queryByRole("alert")).toBeNull();
});

it("ignores superseded loads while preserving shell-owned state", async () => {
  let finish!: (response: Response) => void;
  const fetcher = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValueOnce(response(snapshot(1)));
  vi.stubGlobal("fetch", fetcher);
  const view = render(<Harness />);
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
  view.rerender(<Harness open={false} />);
  view.rerender(<Harness />);
  await screen.findByRole("option", { name: `Default · ${entries[0].label}` });
  await act(async () => {
    finish(response(snapshot()));
  });
  expect(screen.queryByRole("option", { name: entries[1].label })).toBeNull();
});
