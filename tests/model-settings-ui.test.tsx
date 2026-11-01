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
import type { ModelSettingsSnapshot } from "@/lib/model-settings/contracts";

const both = [
  { id: "deepseek-flash", label: "DeepSeek Flash" },
  { id: "gpt-6-luna", label: "GPT-6 Luna" },
] as const;
function snapshot(count = 2): ModelSettingsSnapshot {
  return {
    options: both.slice(0, count),
    selected: null,
    effective: {
      provider: "ollama",
      modelName: "custom-local",
      source: "env",
      available: true,
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

it.each([2, 1, 0])(
  "shows exactly %s configured catalog choices and honest inherited status",
  async (count) => {
    const fetcher = vi.fn().mockResolvedValue(response(snapshot(count)));
    vi.stubGlobal("fetch", fetcher);
    render(<Harness />);
    expect((screen.getByRole("combobox") as HTMLSelectElement).disabled).toBe(
      true,
    );
    await screen.findByText(
      /Configured default \(environment\): ollama \/ custom-local/,
    );
    expect(
      screen
        .queryAllByRole("option")
        .filter((option) => !(option as HTMLOptionElement).disabled)
        .map((option) => option.textContent),
    ).toEqual(both.slice(0, count).map((option) => option.label));
    expect((screen.getByRole("combobox") as HTMLSelectElement).disabled).toBe(
      count === 0,
    );
    expect(
      screen.getByRole("option", { name: "Default · custom-local" }),
    ).toBeTruthy();
    expect(screen.getByRole("combobox").closest("details")).toBeNull();
    if (!count) expect(screen.getByText(/No selectable models/)).toBeTruthy();
    expect(fetcher).toHaveBeenCalledTimes(1);
  },
);

it("shows the actual custom configured model inline instead of an empty choice prompt", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      response({
        ...snapshot(),
        effective: {
          provider: "openai",
          modelName: "gpt-6.1-sol",
          source: "env",
          available: true,
        },
      }),
    ),
  );
  render(<Harness />);
  expect(
    await screen.findByRole("option", { name: "Default · gpt-6.1-sol" }),
  ).toBeTruthy();
  const control = screen.getByRole("combobox", { name: "Trainer model" });
  expect(control.closest("details, .settings-card")).toBeNull();
  expect(control.getAttribute("title")).toContain("openai / gpt-6.1-sol");
  expect(screen.queryByText("Choose a configured model")).toBeNull();
  expect(screen.getByText("Model", { selector: "label" })).toBeTruthy();
});

it("waits for authoritative save, survives reopen/reload, and resets separately from options", async () => {
  const saved: ModelSettingsSnapshot = {
    ...snapshot(),
    selected: "gpt-6-luna",
    effective: {
      provider: "openai",
      modelName: "gpt-6-luna",
      source: "saved",
      available: true,
    },
  };
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
    .mockResolvedValueOnce(response(saved))
    .mockResolvedValueOnce(response(snapshot()));
  vi.stubGlobal("fetch", fetcher);
  const view = render(<Harness />);
  await screen.findByText(/Configured default \(environment\)/);
  fireEvent.change(screen.getByRole("combobox"), {
    target: { value: "gpt-6-luna" },
  });
  expect(screen.getByText("Saving model setting…")).toBeTruthy();
  expect(screen.getByText(/Configured default \(environment\)/)).toBeTruthy();
  expect((screen.getByRole("combobox") as HTMLSelectElement).disabled).toBe(
    true,
  );
  await act(async () => {
    finish(response(saved));
  });
  await screen.findByText(/Saved preference: openai \/ gpt-6-luna/);
  expect(fetcher.mock.calls[1][1].body).toBe(
    JSON.stringify({ modelId: "gpt-6-luna" }),
  );
  view.rerender(<Harness open={false} />);
  view.rerender(<Harness />);
  await screen.findByText(/Saved preference: openai \/ gpt-6-luna/);
  await waitFor(() =>
    expect((screen.getByRole("combobox") as HTMLSelectElement).disabled).toBe(
      false,
    ),
  );
  expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe(
    "gpt-6-luna",
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Reset to configured default" }),
  );
  await screen.findByText(/Configured default \(environment\)/);
  expect(fetcher.mock.calls[3][1].body).toBe('{"modelId":null}');
  view.unmount();
  fetcher.mockResolvedValueOnce(response(saved));
  render(<Harness />);
  await screen.findByText(/Saved preference: openai \/ gpt-6-luna/);
});

it("does not claim failed saves, exposes load failures safely and refreshes after lost-key rejection", async () => {
  const saved: ModelSettingsSnapshot = {
    ...snapshot(1),
    selected: "gpt-6-luna",
    effective: {
      provider: "openai",
      modelName: "gpt-6-luna",
      source: "saved",
      available: false,
    },
    unavailableReason: "Saved provider unavailable",
  };
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(response(snapshot()))
    .mockResolvedValueOnce(response({ error: "secret-upstream" }, 400))
    .mockResolvedValueOnce(response(saved))
    .mockRejectedValueOnce(new Error("secret-network"));
  vi.stubGlobal("fetch", fetcher);
  const view = render(<Harness />);
  await screen.findByText(/Configured default \(environment\)/);
  fireEvent.change(screen.getByRole("combobox"), {
    target: { value: "gpt-6-luna" },
  });
  await screen.findByText(/could not be confirmed/);
  expect(screen.queryByText(/Saved preference:/)).toBeNull();
  expect(screen.queryByText(/secret-upstream/)).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: "Retry model availability" }),
  );
  await screen.findByText("Saved provider unavailable");
  expect(
    screen.getByText(/Saved preference: openai \/ gpt-6-luna — unavailable/),
  ).toBeTruthy();
  expect(screen.queryByRole("option", { name: "GPT-6 Luna" })).toBeNull();
  view.rerender(<Harness open={false} />);
  view.rerender(<Harness />);
  await screen.findByText(/could not be loaded/);
  expect(screen.queryByText(/Reopen Settings/)).toBeNull();
  expect(screen.queryByText(/secret-network/)).toBeNull();
  expect((screen.getByRole("combobox") as HTMLSelectElement).disabled).toBe(
    true,
  );
});

it.each([null, { ok: true }, { options: [], selected: null, effective: {} }])(
  "contains malformed successful responses without breaking chat: %j",
  async (body) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(body)));
    render(<Harness />);
    await screen.findByText(/could not be loaded/);
    expect((screen.getByRole("combobox") as HTMLSelectElement).disabled).toBe(
      true,
    );
  },
);

it("recovers a failed initial chat load via direct retry without reopening another view", async () => {
  const fetcher = vi
    .fn()
    .mockRejectedValueOnce(new Error("private-network-detail"))
    .mockResolvedValueOnce(response(snapshot(1)));
  vi.stubGlobal("fetch", fetcher);
  render(<Harness />);
  await screen.findByText(/could not be loaded/);
  expect(screen.queryByText(/private-network-detail/)).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: "Retry model availability" }),
  );
  await screen.findByText(/Configured default \(environment\)/);
  expect((screen.getByRole("combobox") as HTMLSelectElement).disabled).toBe(
    false,
  );
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it("ignores a superseded chat model load", async () => {
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
  await screen.findByText(/Configured default \(environment\)/);
  await act(async () => {
    finish(response(snapshot(2)));
  });
  expect(screen.queryByRole("option", { name: "GPT-6 Luna" })).toBeNull();
});
