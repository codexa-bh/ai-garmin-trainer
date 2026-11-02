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
  },
];
function snapshot(count = 4): ModelSettingsSnapshot {
  return {
    version: 3,
    options: entries.slice(0, count),
    selected: null,
    status: "unselected",
    available: false,
    unavailableReason: "Choose a model explicitly to use Trainer chat.",
  };
}
function saved(id = "entry_two"): ModelSettingsSnapshot {
  return {
    version: 3,
    options: entries,
    selected: id,
    status: "selected",
    available: entries.some((entry) => entry.id === id && entry.available),
  };
}
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });
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
  "keeps a %s-row catalog unselected without first-row choice or writes",
  async (count) => {
    const fetcher = vi.fn().mockResolvedValue(response(snapshot(count)));
    vi.stubGlobal("fetch", fetcher);
    render(<Harness />);
    await screen.findByRole("option", { name: "Choose a model" });
    const control = screen.getByRole("combobox", {
      name: "Trainer model",
    }) as HTMLSelectElement;
    expect(control.value).toBe("");
    expect(control.disabled).toBe(count === 0);
    expect(control.closest("details, .settings-card")).toBeNull();
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
    expect(screen.queryByRole("button", { name: /Default|Reset/ })).toBeNull();
    expect(control.title).not.toContain("Default");
    expect(fetcher).toHaveBeenCalledOnce();
  },
);
it.each(["entry_router", "entry_deleted"])(
  "retains unavailable %s with explicit replacement only",
  async (id) => {
    const unavailable = {
      ...saved(id),
      unavailableReason: "Selected model unavailable",
    };
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response(unavailable))
      .mockResolvedValueOnce(response(saved("entry_local")));
    vi.stubGlobal("fetch", fetcher);
    render(<Harness />);
    await screen.findByText("Selected model unavailable");
    const control = screen.getByRole("combobox") as HTMLSelectElement;
    expect(control.value).toBe("");
    expect(control.selectedOptions[0].textContent).toBe(
      "Unavailable selected model",
    );
    expect(control.selectedOptions[0].disabled).toBe(true);
    expect(control.disabled).toBe(false);
    expect(screen.queryByRole("option", { name: /Vendor\/Exact/ })).toBeNull();
    expect(fetcher).toHaveBeenCalledOnce();
    fireEvent.change(control, { target: { value: "entry_local" } });
    await screen.findByText("ollama / Local:Tag", { selector: "span" });
    expect(control.value).toBe("entry_local");
    expect(fetcher.mock.calls[1][1].body).toBe('{"modelId":"entry_local"}');
    expect(screen.queryByRole("button", { name: /Default|Reset/ })).toBeNull();
  },
);
it.each([true, false])(
  "keeps all-ineligible catalogs disabled without reset (%s)",
  async (selected) => {
    const value = {
      ...snapshot(),
      options: entries.map((entry) => ({ ...entry, available: false })),
      selected: selected ? "entry_two" : null,
      status: selected ? "selected" : "unselected",
      unavailableReason: "Provider key not configured",
    };
    const fetcher = vi.fn().mockResolvedValue(response(value));
    vi.stubGlobal("fetch", fetcher);
    const view = render(<Harness />);
    await screen.findByText(/No available entries/);
    const control = screen.getByRole("combobox") as HTMLSelectElement;
    expect(control.disabled).toBe(true);
    expect(control.options).toHaveLength(1);
    expect(screen.queryByRole("button", { name: /Reset/ })).toBeNull();
    view.rerender(<Harness open={false} />);
    view.rerender(<Harness />);
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    expect(fetcher.mock.calls.every(([, init]) => !init?.method)).toBe(true);
  },
);
it.each(["openai", "deepseek", "openrouter"] as const)(
  "hides missing-key %s, retaining keyless local without choosing it",
  async (provider) => {
    const options = entries.map((entry) =>
      entry.provider === "ollama"
        ? entry
        : { ...entry, provider, available: false },
    );
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(response({ ...snapshot(), options })),
    );
    render(<Harness />);
    await screen.findByRole("option", { name: "Choose a model" });
    const control = screen.getByRole("combobox") as HTMLSelectElement;
    expect(Array.from(control.options).map((option) => option.value)).toEqual([
      "",
      "entry_local",
    ]);
    expect(control.value).toBe("");
  },
);
it("waits for authoritative save through hide/reopen/reload without remapping", async () => {
  let finish!: (value: Response) => void;
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(response(snapshot()))
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    )
    .mockImplementation(() => Promise.resolve(response(saved())));
  vi.stubGlobal("fetch", fetcher);
  const view = render(<Harness />);
  await screen.findByRole("option", { name: "Choose a model" });
  fireEvent.change(screen.getByRole("combobox"), {
    target: { value: "entry_two" },
  });
  expect(screen.getByText("Saving model setting…")).toBeTruthy();
  expect((screen.getByRole("combobox") as HTMLSelectElement).disabled).toBe(
    true,
  );
  view.rerender(<Harness open={false} />);
  await act(async () => finish(response(saved())));
  view.rerender(<Harness />);
  await screen.findByText("openai / Custom/Second:Tag", { selector: "span" });
  await waitFor(() =>
    expect((screen.getByRole("combobox") as HTMLSelectElement).disabled).toBe(
      false,
    ),
  );
  expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe(
    "entry_two",
  );
  view.unmount();
  render(<Harness />);
  await screen.findByText("openai / Custom/Second:Tag", { selector: "span" });
});
it("preserves last confirmed choice on uncertain write and direct Retry reconciles actual state safely", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(response(saved("entry_one")))
    .mockResolvedValueOnce(response({ error: "secret-upstream" }, 503))
    .mockResolvedValueOnce(response(saved()))
    .mockRejectedValueOnce(Error("secret-network"));
  vi.stubGlobal("fetch", fetcher);
  const view = render(<Harness />);
  await screen.findByText("openai / Custom/First:Tag", { selector: "span" });
  fireEvent.change(screen.getByRole("combobox"), {
    target: { value: "entry_two" },
  });
  await screen.findByText(/could not be confirmed/);
  expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe(
    "entry_one",
  );
  expect(screen.queryByText(/secret-upstream/)).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: "Retry model availability" }),
  );
  await screen.findByText("openai / Custom/Second:Tag", { selector: "span" });
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
  { ...snapshot(), version: 99 },
  { ...snapshot(), selected: "invalid" },
  { ...snapshot(), options: [...entries, entries[0]] },
  { ...snapshot(), available: true },
  { ...snapshot(), status: "selected" },
])("contains malformed successful response %j", async (body) => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(body)));
  render(<Harness />);
  await screen.findByText(/could not be loaded/);
  expect((screen.getByRole("combobox") as HTMLSelectElement).disabled).toBe(
    true,
  );
});
it("ignores superseded loads", async () => {
  let finish!: (value: Response) => void;
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
  await waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
  view.rerender(<Harness open={false} />);
  view.rerender(<Harness />);
  await screen.findByRole("option", { name: "Choose a model" });
  await act(async () => finish(response(snapshot())));
  expect(screen.queryByRole("option", { name: entries[1].label })).toBeNull();
});
it("keeps one persistent footer control, draft and Send order; selection/keys never send", async () => {
  const chatPosts: unknown[] = [];
  const fetcher = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input) === "/api/model-settings")
      return Promise.resolve(
        response(init?.method === "PATCH" ? saved() : snapshot()),
      );
    if (String(input) === "/api/chat" && init?.method === "POST")
      chatPosts.push(init.body);
    return Promise.resolve(
      response({ messages: [], memories: [], conversations: [] }),
    );
  });
  vi.stubGlobal("fetch", fetcher);
  render(<TrainerDashboard />);
  const message = screen.getByRole("textbox", {
    name: "Message",
  }) as HTMLTextAreaElement;
  const composer = message.closest(".composer-dock")! as HTMLElement;
  const selector = within(composer).getByRole("combobox", {
    name: "Trainer model",
  });
  const send = within(composer).getByRole("button", { name: "Send" });
  expect(
    screen.getAllByRole("combobox", { name: "Trainer model" }),
  ).toHaveLength(1);
  expect(selector.closest(".chat-model-control")?.nextElementSibling).toBe(
    send,
  );
  expect(
    message.compareDocumentPosition(selector) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  await screen.findByRole("option", { name: "Choose a model" });
  fireEvent.change(message, { target: { value: "Keep draft" } });
  selector.focus();
  for (const key of ["Enter", " "]) {
    fireEvent.keyDown(selector, { key });
    fireEvent.keyUp(selector, { key });
  }
  fireEvent.change(selector, { target: { value: "entry_two" } });
  await screen.findByText("openai / Custom/Second:Tag", { selector: "span" });
  expect(document.activeElement).toBe(selector);
  expect(message.value).toBe("Keep draft");
  expect(screen.getByRole("textbox", { name: "Message" })).toBe(message);
  expect(chatPosts).toHaveLength(0);
  expect(screen.queryByRole("button", { name: /Default|Reset/ })).toBeNull();
  expect(
    fetcher.mock.calls
      .filter(
        ([url, init]) =>
          String(url) === "/api/model-settings" && init?.method === "PATCH",
      )
      .map(([, init]) => init?.body),
  ).toEqual(['{"modelId":"entry_two"}']);
});
it("recovers availability failure in footer without losing draft or disabling Send", async () => {
  let failing = true;
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      if (String(input) === "/api/model-settings")
        return failing
          ? Promise.reject(Error("private-detail"))
          : Promise.resolve(response(snapshot()));
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
  const retry = await screen.findByRole("button", {
    name: "Retry model availability",
  });
  expect(
    (screen.getByRole("button", { name: "Send" }) as HTMLButtonElement)
      .disabled,
  ).toBe(false);
  failing = false;
  fireEvent.click(retry);
  await screen.findByRole("option", { name: "Choose a model" });
  expect(message.value).toBe("Draft through recovery");
  expect(screen.queryByText(/private-detail/)).toBeNull();
});
