/** @vitest-environment jsdom */
import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
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

it.each([4, 1, 0])(
  "shows %s entries across providers with exact/disambiguated labels and no large card",
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
      for (const entry of entries.slice(0, count)) {
        const option = screen.getByRole("option", {
          name: `${entry.label}${entry.available ? "" : " — key not configured"}`,
        }) as HTMLOptionElement;
        expect(option.disabled).toBe(!entry.available);
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
  expect(
    (
      screen.getByRole("option", {
        name: /openrouter.*key not configured/,
      }) as HTMLOptionElement
    ).disabled,
  ).toBe(true);
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
