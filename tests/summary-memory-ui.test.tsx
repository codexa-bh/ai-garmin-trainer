/** @vitest-environment jsdom */
import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  useMemoryFeature,
  type SummaryInspection,
} from "@/app/dashboard/use-memory";
import { MemoryContent } from "@/app/dashboard/memory-content";
import type { Status } from "@/app/dashboard/contracts";
function snapshot(conversationId = "A"): SummaryInspection {
  return {
    version: 1,
    state: "fresh",
    reason: null,
    revision: 3,
    frontier: 4,
    pending: 0,
    items: 0,
    characters: 0,
    cap: 6000,
    publishedAt: 1,
    enabled: true,
    model: "gpt-6-luna",
    usedByChat: false,
    attemptsToday: 0,
    reservedUsdToday: 0,
    estimatedUsdToday: 0,
    unknownReservedUsd: 0,
    priceBasis: "synthetic-review-basis",
    expected: { revision: 3, privacy: 0, control: 1, manual: 0 },
    stored: { version: 2, text: "" },
    preferences: [],
    legacy: [],
    historical: {
      candidates: [],
      manifests: [],
      exclusions: "Unlinked sources are excluded.",
    },
    rebuild: {
      version: 1,
      snapshot: "a".repeat(64),
      selection: { version: 1, conversationIds: null, includeLegacy: false },
      conversations: [
        { id: "A", title: "Authored caregiving" },
        { id: "B", title: "Authored equipment" },
        { id: "C", title: "Authored hiking" },
      ],
      ready: true,
      complete: true,
      limitExceeded: false,
      configuredProvider: "openai",
      model: "gpt-6-luna",
      enabled: true,
      capability: "configured-not-probed",
      counts: {
        chats: 3,
        selectedChats: 3,
        legacyUserMessages: 0,
        messages: 12,
        userMessages: 6,
        assistantMessages: 6,
        includedChats: 2,
        excludedChats: 1,
        includedUserMessages: 4,
        assistantContext: 1,
        excludedUserMessages: 2,
        excludedMessages: 7,
      },
      reasons: { suppressed: 2 },
      estimatedUsd: {
        low: 0,
        conservativeMaximum: null,
        priceBasis: "authored-basis",
        uncertainty: "Not an invoice.",
      },
      semantics: "Manual overlays and originals remain.",
      operation: null,
    },
    selectedChat: {
      conversationId,
      segmentRevision: 0,
      pin: null,
      reason: null,
    },
    authority: "User-derived continuity, not authority.",
  };
}
function response(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status });
}
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
function MemoryHarness() {
  const [, setStatus] = React.useState<Status>({ kind: "ok", message: "" });
  const feature = useMemoryFeature({ setStatus });
  const { loadMemories } = feature;
  React.useEffect(() => {
    loadMemories(false, "A").catch(() => {
      throw new Error("Test load failed");
    });
  }, [loadMemories]);
  return (
    <MemoryContent
      {...feature}
      onOpenSource={vi.fn()}
      runInBackground={(work) => {
        work.catch(() => {
          throw new Error("Test action failed");
        });
      }}
    />
  );
}
async function mountMemory(
  value: SummaryInspection,
  post?: (body: Record<string, unknown>) => Response | Promise<Response>,
) {
  const fetcher = vi.fn((_url: string, init?: RequestInit) =>
    init?.method === "POST"
      ? Promise.resolve(
          post?.(JSON.parse(String(init.body)) as Record<string, unknown>) ??
            response({ ok: true }),
        )
      : Promise.resolve(response(value)),
  );
  vi.stubGlobal("fetch", fetcher);
  render(<MemoryHarness />);
  await screen.findByRole("button", { name: "Add preference" });
  return fetcher;
}
function populated() {
  const value = snapshot();
  value.stored.text =
    "I have not chosen poles. Could they help? Last winter only: short weekdays, not long sessions.";
  value.preferences = [
    {
      id: "two",
      text: "Separately authored preference, not a generated record. ".repeat(
        14,
      ),
    },
  ];
  value.characters = [...value.stored.text].length;
  return value;
}

describe("generated summary disclosure", () => {
  it("starts collapsed and toggles the complete text without a request", async () => {
    const value = populated();
    value.stored.text = "Long Unicode summary 🚴\n".repeat(100);
    value.characters = [...value.stored.text].length;
    const fetcher = await mountMemory(value);
    const toggle = screen.getByRole("button", { name: "Show summary" });
    const summary = document.getElementById(
      toggle.getAttribute("aria-controls")!,
    );
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(summary?.hidden).toBe(true);
    expect(summary?.textContent).toBe(value.stored.text);
    expect(screen.getByRole("button", { name: "Edit summary" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Densify summary" }),
    ).toBeTruthy();
    const requests = fetcher.mock.calls.length;
    toggle.focus();
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(summary?.hidden).toBe(false);
    expect(document.activeElement).toBe(toggle);
    fireEvent.click(toggle);
    expect(summary?.hidden).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(requests);
  });

  it("retains both choices through passive refresh", async () => {
    const fetcher = await mountMemory(populated());
    fireEvent.click(screen.getByRole("button", { name: "Show summary" }));
    let count = fetcher.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() =>
      expect(fetcher.mock.calls.length).toBeGreaterThan(count),
    );
    expect(screen.getByRole("button", { name: "Hide summary" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Hide summary" }));
    count = fetcher.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() =>
      expect(fetcher.mock.calls.length).toBeGreaterThan(count),
    );
    expect(screen.getByRole("button", { name: "Show summary" })).toBeTruthy();
  });

  it("resets the choice for a fresh feature owner", async () => {
    await mountMemory(populated());
    fireEvent.click(screen.getByRole("button", { name: "Show summary" }));
    expect(screen.getByRole("button", { name: "Hide summary" })).toBeTruthy();
    cleanup();
    render(<MemoryHarness />);
    expect(
      await screen.findByRole("button", { name: "Show summary" }),
    ).toBeTruthy();
  });

  it("does not expose saved text when memory is Off or unavailable", async () => {
    const value = populated();
    value.enabled = false;
    await mountMemory(value);
    expect(screen.queryByRole("button", { name: "Show summary" })).toBeNull();
    expect(screen.queryByText(value.stored.text)).toBeNull();
    cleanup();
    value.enabled = true;
    value.state = "unavailable";
    await mountMemory(value);
    expect(screen.queryByRole("button", { name: "Show summary" })).toBeNull();
    expect(screen.queryByText(value.stored.text)).toBeNull();
  });
});

describe("ordinary Memory observation", () => {
  function pending(first = false): SummaryInspection {
    return {
      ...(first ? snapshot() : populated()),
      state: first ? "never-produced" : "stale",
      pending: 41,
    };
  }
  function settled(): SummaryInspection {
    return {
      ...populated(),
      revision: 6,
      frontier: 45,
      expected: { ...snapshot().expected, revision: 6 },
      stored: { version: 2, text: "Complete newly saved ordinary memory." },
    };
  }
  it.each([false, true])(
    "observes slow ordinary work through unchanged and partial batches to settlement (first=%s)",
    async (first) => {
      vi.useFakeTimers();
      const value = pending(first);
      const fetcher = vi
        .fn()
        .mockResolvedValueOnce(response(value))
        .mockResolvedValueOnce(response(value))
        .mockResolvedValueOnce(response(value))
        .mockResolvedValueOnce(
          response({ ...value, revision: 4, frontier: 24, pending: 21 }),
        )
        // A new arrival means that even another published revision is not done.
        .mockResolvedValueOnce(
          response({ ...value, revision: 5, frontier: 44, pending: 2 }),
        )
        .mockResolvedValueOnce(response(settled()));
      vi.stubGlobal("fetch", fetcher);
      const setStatus = vi.fn();
      const { result } = renderHook(() => useMemoryFeature({ setStatus }));
      await act(() => result.current.loadMemories(false, "A"));
      for (const count of [41, 41, 21, 2, 0]) {
        await act(() => vi.advanceTimersByTimeAsync(2000));
        expect(result.current.memory?.pending).toBe(count);
      }
      expect(result.current.memory?.stored.text).toBe(settled().stored.text);
      expect(result.current.memory?.revision).toBe(6);
      expect(result.current.memory?.frontier).toBe(45);
      await act(() => vi.advanceTimersByTimeAsync(10000));
      expect(fetcher).toHaveBeenCalledTimes(6);
      expect(setStatus).not.toHaveBeenCalled();
      for (const [url, init] of fetcher.mock.calls) {
        expect(url).toBe(
          "/api/cross-chat-summary?view=content&conversationId=A",
        );
        expect(init).toEqual({ cache: "no-store" });
      }
    },
  );
  it.each([
    null,
    "summary_provider_failure",
    "summary_interrupted",
    "summary_invalid_output",
  ])(
    "dispatches explicit Retry once, then passively reconciles its delayed outcome %s",
    async (reason) => {
      vi.useFakeTimers();
      const failed = { ...pending(), reason: "summary_provider_failure" };
      const terminal = reason ? { ...pending(), reason } : settled();
      const fetcher = vi
        .fn()
        .mockResolvedValueOnce(response(failed))
        .mockResolvedValueOnce(response({ ok: true }))
        .mockResolvedValueOnce(response(pending()))
        .mockResolvedValueOnce(response(pending()))
        .mockResolvedValueOnce(response(terminal));
      vi.stubGlobal("fetch", fetcher);
      const setStatus = vi.fn();
      const committed = vi.fn().mockResolvedValue(undefined);
      const { result } = renderHook(() =>
        useMemoryFeature({ setStatus, onChangeCommitted: committed }),
      );
      await act(() => result.current.loadMemories(false));
      await act(() => result.current.changeMemory({ action: "retry" }));
      await act(() => vi.advanceTimersByTimeAsync(2000));
      expect(result.current.memory?.pending).toBe(41);
      await act(() => vi.advanceTimersByTimeAsync(2000));
      expect(result.current.memory?.reason).toBe(reason);
      if (!reason) expect(result.current.memory?.pending).toBe(0);
      await act(() => vi.advanceTimersByTimeAsync(10000));
      expect(fetcher).toHaveBeenCalledTimes(5);
      const posts = fetcher.mock.calls.filter(
        (call) => call[1]?.method === "POST",
      );
      expect(posts).toHaveLength(1);
      expect(JSON.parse(String(posts[0][1].body))).toEqual({
        version: 2,
        expected: failed.expected,
        action: "retry",
      });
      expect(committed).toHaveBeenCalledTimes(1);
    },
  );
  it.each([
    { enabled: false, state: "disabled" as const },
    { state: "unselected" as const },
    { state: "unavailable" as const },
    { reason: "summary_missing_key" },
    { reason: "summary_provider_failure" },
    { reason: "summary_interrupted" },
    { reason: "summary_invalid_output" },
    { reason: "summary_configuration_changed" },
    { reason: "unknown_future_reason" },
    { pending: 0 },
  ])("does not poll blocked or idle ordinary state %j", async (overrides) => {
    vi.useFakeTimers();
    const fetcher = vi
      .fn()
      .mockResolvedValue(response({ ...pending(), ...overrides }));
    vi.stubGlobal("fetch", fetcher);
    const setStatus = vi.fn();
    const { result } = renderHook(() => useMemoryFeature({ setStatus }));
    await act(() => result.current.loadMemories(false));
    await act(() => vi.advanceTimersByTimeAsync(10000));
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("retains independent historical observation despite an ordinary failure", async () => {
    vi.useFakeTimers();
    const value = {
      ...pending(),
      reason: "summary_provider_failure",
      historical: {
        ...snapshot().historical,
        manifests: [{ id: "import", state: "active", position: 0, total: 20 }],
      },
    };
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response(value))
      .mockResolvedValueOnce(
        response({ ...value, historical: snapshot().historical }),
      );
    vi.stubGlobal("fetch", fetcher);
    const setStatus = vi.fn();
    const { result } = renderHook(() => useMemoryFeature({ setStatus }));
    await act(() => result.current.loadMemories(false));
    await act(() => vi.advanceTimersByTimeAsync(2000));
    await act(() => vi.advanceTimersByTimeAsync(6000));
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(result.current.memory?.reason).toBe("summary_provider_failure");
  });
  it("keeps the editor, draft, focus and scroll during slow reads and connection recovery without writes", async () => {
    vi.useFakeTimers();
    let finish!: (value: Response) => void;
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response(pending()))
      .mockImplementation(
        () =>
          new Promise<Response>((resolve) => {
            finish = resolve;
          }),
      );
    vi.stubGlobal("fetch", fetcher);
    await act(async () => {
      render(<MemoryHarness />);
    });
    fireEvent.click(screen.getByRole("button", { name: "Edit summary" }));
    const editor = screen.getByRole("textbox", {
      name: "Complete generated summary",
    });
    fireEvent.change(editor, { target: { value: "Unsaved ordinary draft" } });
    editor.focus();
    editor.scrollTop = 73;
    await act(() => vi.advanceTimersByTimeAsync(6000));
    expect(fetcher).toHaveBeenCalledTimes(2);
    await act(async () => {
      finish(response(pending()));
    });
    expect(
      screen.getByRole("textbox", { name: "Complete generated summary" }),
    ).toBe(editor);
    expect((editor as HTMLTextAreaElement).value).toBe(
      "Unsaved ordinary draft",
    );
    expect(document.activeElement).toBe(editor);
    expect(editor.scrollTop).toBe(73);
    await act(() => vi.advanceTimersByTimeAsync(2000));
    await act(async () => {
      finish(response({ error: "private vendor text" }, 503));
    });
    expect(screen.getByText(/Connection lost/)).toBeTruthy();
    expect(screen.queryByText(/private vendor/)).toBeNull();
    expect(
      screen
        .getByRole("button", { name: "Save summary" })
        .hasAttribute("disabled"),
    ).toBe(true);
    await act(() => vi.advanceTimersByTimeAsync(2000));
    await act(async () => {
      finish(response(settled()));
    });
    expect(screen.queryByText(/Connection lost/)).toBeNull();
    expect(
      screen.getByRole("textbox", { name: "Complete generated summary" }),
    ).toBe(editor);
    expect((editor as HTMLTextAreaElement).value).toBe(
      "Unsaved ordinary draft",
    );
    expect(document.activeElement).toBe(editor);
    expect(editor.scrollTop).toBe(73);
    const reads = fetcher.mock.calls.length;
    await act(() => vi.advanceTimersByTimeAsync(10000));
    expect(fetcher).toHaveBeenCalledTimes(reads);
    expect(fetcher.mock.calls.every((call) => call[1]?.method !== "POST")).toBe(
      true,
    );
  });
  it("rejects an old poll after selection or privacy mutation and cleans up on true unmount", async () => {
    vi.useFakeTimers();
    let finish!: (value: Response) => void;
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response(pending()))
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValueOnce(
        response({ ...pending(), selectedChat: snapshot("B").selectedChat }),
      )
      .mockResolvedValueOnce(response({ ok: true }))
      .mockResolvedValueOnce(
        response({ ...snapshot("B"), enabled: false, state: "disabled" }),
      );
    vi.stubGlobal("fetch", fetcher);
    const setStatus = vi.fn();
    const { result, unmount } = renderHook(() =>
      useMemoryFeature({ setStatus }),
    );
    await act(() => result.current.loadMemories(false, "A"));
    await act(() => vi.advanceTimersByTimeAsync(2000));
    await act(() => result.current.loadMemories(false, "B"));
    await act(() => result.current.changeMemory({ action: "disable" }));
    await act(async () => {
      finish(response(settled()));
    });
    expect(result.current.memory?.enabled).toBe(false);
    expect(result.current.memory?.selectedChat?.conversationId).toBe("B");
    await act(() => vi.advanceTimersByTimeAsync(6000));
    expect(fetcher).toHaveBeenCalledTimes(5);
    unmount();
    await act(() => vi.advanceTimersByTimeAsync(6000));
    expect(fetcher).toHaveBeenCalledTimes(5);
  });
  it("does not accept a deferred ordinary observation after unmount or issue more reads", async () => {
    vi.useFakeTimers();
    let finish!: (value: Response) => void;
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response(pending()))
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            finish = resolve;
          }),
      );
    vi.stubGlobal("fetch", fetcher);
    const setStatus = vi.fn();
    const { result, unmount } = renderHook(() =>
      useMemoryFeature({ setStatus }),
    );
    await act(() => result.current.loadMemories(false));
    await act(() => vi.advanceTimersByTimeAsync(2000));
    unmount();
    await act(async () => {
      finish(response(settled()));
    });
    await act(() => vi.advanceTimersByTimeAsync(10000));
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(result.current.memory?.pending).toBe(41);
    expect(setStatus).not.toHaveBeenCalled();
  });
});

describe("manual Densify review", () => {
  const manualChoice = JSON.stringify({
    version: 1,
    entryId: "entry_manual",
    provider: "openrouter",
    modelId: "Vendor/Exact:Manual",
  });
  it("defaults honestly, sends one exact ephemeral alternative and resets only after review settlement", async () => {
    const value = populated();
    value.densify = {
      available: true,
      sourceAvailable: true,
      models: {
        default: { label: "openai / gpt-6-luna", available: true },
        options: [
          { value: manualChoice, label: "openrouter / Vendor/Exact:Manual" },
        ],
      },
      review: null,
    };
    const bodies: Record<string, unknown>[] = [];
    const fetcher = await mountMemory(value, (body) => {
      bodies.push(body);
      return response({
        densify: {
          id: body.id,
          state: body.action === "densify-discard" ? "discarded" : "review",
          text: "Short.",
          before: value.characters,
          after: 6,
          target: 6000,
          shorter: true,
          modelLabel: body.model
            ? "openrouter / Vendor/Exact:Manual"
            : "openai / gpt-6-luna",
        },
      });
    });
    const picker = screen.getByRole<HTMLSelectElement>("combobox", {
      name: "Model for this run",
    });
    expect(picker.value).toBe("");
    expect(picker.selectedOptions[0].textContent).toBe(
      "Default — openai / gpt-6-luna",
    );
    fireEvent.change(picker, { target: { value: manualChoice } });
    expect(bodies).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Densify summary" }));
    await screen.findByRole("heading", { name: "Review densified summary" });
    expect(bodies[0]).toMatchObject({
      action: "densify-request",
      model: manualChoice,
    });
    expect(picker.disabled).toBe(true);
    expect(picker.value).toBe(manualChoice);
    expect(
      screen.getByText("Request model: openrouter / Vendor/Exact:Manual"),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    await screen.findByText(/Candidate discarded/);
    expect(picker.value).toBe("");
    expect(bodies[1]).not.toHaveProperty("model");
    fireEvent.click(screen.getByRole("button", { name: "Densify summary" }));
    await screen.findByRole("heading", { name: "Review densified summary" });
    expect(bodies[2]).not.toHaveProperty("model");
    expect(
      fetcher.mock.calls.every(([url]) =>
        String(url).startsWith("/api/cross-chat-summary"),
      ),
    ).toBe(true);
  });
  it("resets ephemeral intent when passive inspection discovers an expired review", async () => {
    const value = populated();
    const review = {
      id: "expired",
      state: "review" as const,
      text: "Short.",
      before: value.characters,
      after: 6,
      target: 6000,
      shorter: true,
    };
    value.densify = {
      available: true,
      sourceAvailable: true,
      models: {
        default: { label: "openai / gpt-6-luna", available: true },
        options: [
          { value: manualChoice, label: "openrouter / Vendor/Exact:Manual" },
        ],
      },
      review: null,
    };
    await mountMemory(value, () => response({ densify: review }));
    const picker = screen.getByRole<HTMLSelectElement>("combobox", {
      name: "Model for this run",
    });
    fireEvent.change(picker, { target: { value: manualChoice } });
    fireEvent.click(screen.getByRole("button", { name: "Densify summary" }));
    await screen.findByRole("heading", { name: "Review densified summary" });
    value.densify.review = {
      ...review,
      state: "expired",
      text: null,
      shorter: false,
    };
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await screen.findByText(/Densify unavailable or expired/);
    expect(picker.value).toBe("");
    expect(picker.disabled).toBe(false);
  });
  it("never replaces an unavailable default with the first alternative, but permits explicit eligible intent", async () => {
    const value = populated();
    value.densify = {
      available: false,
      sourceAvailable: true,
      models: {
        default: { label: "Unselected memory model", available: false },
        options: [
          { value: manualChoice, label: "openrouter / Vendor/Exact:Manual" },
        ],
      },
      review: null,
    };
    let calls = 0;
    await mountMemory(value, () => {
      calls++;
      return response({});
    });
    const picker = screen.getByRole<HTMLSelectElement>("combobox", {
      name: "Model for this run",
    });
    const button = screen.getByRole<HTMLButtonElement>("button", {
      name: "Densify summary",
    });
    expect(picker.value).toBe("");
    expect(picker.selectedOptions[0].textContent).toContain("unavailable");
    expect(button.disabled).toBe(true);
    fireEvent.change(picker, { target: { value: manualChoice } });
    expect(button.disabled).toBe(false);
    expect(calls).toBe(0);
  });
  function expectNoActivity() {
    expect(screen.queryByText("Densifying…")).toBeNull();
    expect(document.querySelector(".memory-busy-cue")).toBeNull();
  }

  it.each([
    "review",
    "accepted",
    "discarded",
    "cancelled",
    "failed",
    "expired",
  ])(
    "shows action-adjacent activity only while running, then removes it for %s",
    async (state) => {
      const value = populated();
      value.densify = { available: true, review: null };
      let finish!: (result: Response) => void;
      await mountMemory(
        value,
        () =>
          new Promise<Response>((resolve) => {
            finish = resolve;
          }),
      );
      expectNoActivity();
      fireEvent.click(screen.getByRole("button", { name: "Densify summary" }));
      const label = screen.getByText("Densifying…");
      expect(label.getAttribute("role")).toBe("status");
      expect(label.getAttribute("aria-live")).toBe("polite");
      expect(label.getAttribute("aria-atomic")).toBe("true");
      expect(
        label.querySelector(".memory-busy-cue")?.getAttribute("aria-hidden"),
      ).toBe("true");
      const cancel = screen.getByRole<HTMLButtonElement>("button", {
        name: "Cancel densify",
      });
      expect(cancel.disabled).toBe(false);
      expect(label.parentElement).toBe(cancel.parentElement);
      expect(
        screen.getByRole<HTMLButtonElement>("button", {
          name: "Densify summary",
        }).disabled,
      ).toBe(true);
      expect(
        screen.getByRole<HTMLButtonElement>("button", { name: "Edit summary" })
          .disabled,
      ).toBe(true);
      expect(
        screen.getByText(/Your saved summary stays in use/).textContent,
      ).toContain("Cancellation cannot recall sent text or costs.");
      expect(screen.getByText(value.stored.text).hasAttribute("hidden")).toBe(
        true,
      );
      fireEvent.click(screen.getByRole("button", { name: "Show summary" }));
      expect(screen.getByText(value.stored.text).hasAttribute("hidden")).toBe(
        false,
      );
      expect(screen.getAllByText("Densifying…")).toHaveLength(1);
      await act(async () =>
        finish(
          response({
            densify: {
              id: "authored",
              state,
              text: state === "review" ? "Short candidate" : null,
              before: value.characters,
              after: 15,
              target: 6000,
              shorter: true,
            },
          }),
        ),
      );
      expectNoActivity();
      if (state === "review") {
        expect(document.activeElement?.textContent).toBe(
          "Review densified summary",
        );
      } else {
        expect(document.activeElement).toBe(
          screen.getByRole("button", { name: "Densify summary" }),
        );
      }
      expect(value.expected.revision).toBe(3);
    },
  );

  it.each(["failed response", "lost response"])(
    "clears activity on %s without automatic replay",
    async (outcome) => {
      const value = populated();
      value.densify = { available: true, review: null };
      let fail!: () => void;
      const fetcher = await mountMemory(
        value,
        () =>
          new Promise<Response>((resolve, reject) => {
            fail = () =>
              outcome === "lost response"
                ? reject(new TypeError("Authored connection loss"))
                : resolve(response({ error: "Authored refusal" }, 500));
          }),
      );
      fireEvent.click(screen.getByRole("button", { name: "Densify summary" }));
      expect(screen.getByText("Densifying…")).toBeTruthy();
      await act(async () => fail());
      await screen.findByText(/Densify failed or its outcome is unknown/);
      expectNoActivity();
      expect(
        fetcher.mock.calls.filter((call) => call[1]?.method === "POST"),
      ).toHaveLength(1);
      expect(value.stored.text).toContain("I have not chosen poles");
    },
  );
  it("keeps saved memory readable, previews all candidate text/counts, and saves only on explicit acceptance", async () => {
    const value = populated();
    value.densify = { available: true, review: null };
    let calls = 0;
    const candidate = "Short weekdays; poles remain unchosen.";
    const fetcher = await mountMemory(value, (body) => {
      calls++;
      expect(body).not.toHaveProperty("text");
      expect(body.expected).toEqual(value.expected);
      const review = {
        id: body.id,
        state: "review",
        text: candidate,
        before: value.characters,
        after: [...candidate].length,
        target: 6000,
        shorter: true,
      };
      if (body.action === "densify-accept") {
        value.stored.text = candidate;
        value.characters = [...candidate].length;
        value.expected = { ...value.expected, revision: 4 };
        return response({
          densify: { ...review, state: "accepted", text: null },
        });
      }
      return response({ densify: review });
    });
    expect(calls).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: "Densify summary" }));
    await screen.findByRole("heading", { name: "Review densified summary" });
    expect(
      screen.getByRole("region", { name: "Complete candidate summary" })
        .textContent,
    ).toBe(candidate);
    expect(screen.getByText(value.stored.text).hasAttribute("hidden")).toBe(
      true,
    );
    fireEvent.click(screen.getByRole("button", { name: "Show summary" }));
    expect(screen.getByText(value.stored.text).hasAttribute("hidden")).toBe(
      false,
    );
    expect(value.expected.revision).toBe(3);
    expect(document.activeElement?.textContent).toBe(
      "Review densified summary",
    );
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Edit summary" })
        .disabled,
    ).toBe(true);
    fireEvent.click(
      screen.getByRole("button", { name: "Use shorter summary" }),
    );
    await screen.findByText(/Shorter generated summary saved/);
    expectNoActivity();
    expect(calls).toBe(2);
    expect(value.stored.text).toBe(candidate);
    expect(
      fetcher.mock.calls.filter((call) => call[1]?.method === "POST"),
    ).toHaveLength(2);
  });
  it("blocks dirty-editor dispatch and cancels one busy request without replay or hiding the original", async () => {
    const value = populated();
    value.densify = { available: true, review: null };
    let finish!: (result: Response) => void;
    const fetcher = await mountMemory(value, (body) =>
      body.action === "densify-request"
        ? new Promise<Response>((resolve) => {
            finish = resolve;
          })
        : response({
            densify: {
              id: body.id,
              state: "cancelled",
              text: null,
              before: value.characters,
              after: null,
              target: 6000,
              shorter: false,
            },
          }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit summary" }));
    // Summary-only editing removes unrelated overview actions from the tab order.
    expect(
      screen.queryByRole("button", { name: "Densify summary" }),
    ).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Cancel edit" }));
    const button = screen.getByRole("button", { name: "Densify summary" });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(screen.getByText(value.stored.text).hasAttribute("hidden")).toBe(
      true,
    );
    expect(screen.getByText("Densifying…")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel densify" }));
    await screen.findByText(/Densify cancelled/);
    expectNoActivity();
    await act(async () =>
      finish(
        response({
          densify: {
            id: "late",
            state: "review",
            text: "Late unsafe preview",
            before: 100,
            after: 19,
            target: 6000,
            shorter: true,
          },
        }),
      ),
    );
    expect(screen.queryByText("Late unsafe preview")).toBeNull();
    expectNoActivity();
    expect(
      fetcher.mock.calls.filter((call) => call[1]?.method === "POST"),
    ).toHaveLength(2);
  });
  it("shows a non-reducing result with acceptance disabled and discards without publication", async () => {
    const value = populated();
    value.densify = { available: true, review: null };
    const fetcher = await mountMemory(value, (body) =>
      response({
        densify: {
          id: body.id,
          state: body.action === "densify-discard" ? "discarded" : "review",
          text: body.action === "densify-discard" ? null : value.stored.text,
          before: value.characters,
          after: value.characters,
          target: 6000,
          shorter: false,
        },
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Densify summary" }));
    await screen.findByText(/No reduction/);
    expectNoActivity();
    expect(
      screen.getByRole<HTMLButtonElement>("button", {
        name: "Use shorter summary",
      }).disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    await screen.findByText(/Candidate discarded/);
    expectNoActivity();
    expect(
      fetcher.mock.calls.filter((call) => call[1]?.method === "POST"),
    ).toHaveLength(2);
    expect(value.expected.revision).toBe(3);
  });
});

const purposeHint =
  "When enabled, memory helps your trainer carry important details from previous conversations into new chats.";

describe("integrated Memory visible controls and stale-response safety", () => {
  it.each(["populated", "empty", "off", "unavailable"])(
    "explains conditional cross-chat purpose once before the %s overview details without mutations",
    async (state) => {
      const value = state === "empty" ? snapshot() : populated();
      if (state === "off") value.enabled = false;
      if (state === "unavailable") value.state = "unavailable";
      const fetcher = await mountMemory(value);
      const hint = screen.getByText(purposeHint);
      const heading = screen.getByRole("heading", {
        name: "What your trainer remembers",
      });
      expect(screen.getAllByText(purposeHint)).toHaveLength(1);
      expect(heading.nextElementSibling).toBe(hint);
      expect(hint.tagName).toBe("P");
      expect(hint.hasAttribute("role")).toBe(false);
      expect(hint.hasAttribute("tabindex")).toBe(false);
      expect(hint.hasAttribute("aria-live")).toBe(false);
      const summary = screen.getByRole("region", { name: "Generated summary" });
      expect(
        hint.compareDocumentPosition(summary) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(screen.getByRole("button", { name: "Edit summary" })).toBeTruthy();
      expect(
        screen.getByRole("button", { name: "Add preference" }),
      ).toBeTruthy();
      expect(
        screen.getByText(
          `${value.characters} characters · target 6000 · generated text only`,
        ),
      ).toBeTruthy();
      expect(
        screen.getByRole("button", {
          name: state === "off" ? "Turn On" : "Turn Off",
        }),
      ).toBeTruthy();
      if (state === "off" || state === "unavailable") {
        expect(screen.getByText(/Saved summary is not in use/)).toBeTruthy();
        expect(screen.queryByText(value.stored.text)).toBeNull();
      }
      expect(fetcher.mock.calls.every((call) => !call[1]?.method)).toBe(true);
    },
  );
  it("keeps general purpose visible while loading or after a failed inspection", async () => {
    let resolveRead!: (value: Response) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>((resolve) => (resolveRead = resolve))),
    );
    render(<MemoryHarness />);
    expect(screen.getByText(purposeHint)).toBeTruthy();
    expect(screen.getByText("Checking saved memory…")).toBeTruthy();
    await act(async () => resolveRead(response({ error: "unavailable" }, 503)));
    expect(screen.getByText(purposeHint)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry loading" })).toBeTruthy();
  });
  it("omits the overview hint in secondary views and restores it with navigation focus", async () => {
    await mountMemory(populated());
    const history = screen.getByRole("button", {
      name: "Update from chat history",
    });
    history.focus();
    fireEvent.click(history);
    expect(screen.queryByText(purposeHint)).toBeNull();
    expect(document.activeElement).toBe(
      screen.getByRole("heading", { name: "Update memory from chat history" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Back to memory" }));
    await act(async () => {});
    expect(screen.getByText(purposeHint)).toBeTruthy();
    // Overview actions unmount in secondary views; Back uses the existing
    // heading fallback when the original invoker is no longer connected.
    expect(history.isConnected).toBe(false);
    expect(document.activeElement).toBe(
      screen.getByRole("heading", { name: "What your trainer remembers" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Manage memory" }));
    expect(screen.queryByText(purposeHint)).toBeNull();
    expect(document.activeElement).toBe(
      screen.getByRole("heading", { name: "Manage memory" }),
    );
  });
  it("edits the complete generated text with exact CAS while preferences stay separate and unchanged", async () => {
    const value = populated();
    const preferences = structuredClone(value.preferences);
    const text = "😀".repeat(6577) + ".";
    const fetcher = await mountMemory(value, (body) => {
      expect(body).toEqual({
        version: 2,
        expected: value.expected,
        action: "edit-summary",
        text,
      });
      value.stored.text = String(body.text);
      value.characters = [...value.stored.text].length;
      return response({ ok: true });
    });
    expect(
      screen.queryByRole("button", { name: "Source & details" }),
    ).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Edit summary" }));
    const editor = screen.getByRole("textbox", {
      name: "Complete generated summary",
    });
    expect(editor).toBe(document.activeElement);
    expect((editor as HTMLTextAreaElement).value).toBe(value.stored.text);
    expect(editor.hasAttribute("maxlength")).toBe(false);
    expect(screen.queryByRole("button", { name: "Add preference" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit summary" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Manage memory" })).toBeNull();
    expect(screen.queryByText(purposeHint)).toBeNull();
    expect(editor.closest(".memory-summary-editing")).toBeTruthy();
    expect((editor as HTMLTextAreaElement).selectionStart).toBe(
      (editor as HTMLTextAreaElement).selectionEnd,
    );
    expect(
      screen.getByText(/Regeneration replaces direct summary edits too/),
    ).toBeTruthy();
    expect(screen.getByText(/target is guidance, not a maximum/)).toBeTruthy();
    fireEvent.change(editor, { target: { value: text } });
    expect(
      (
        screen.getByRole("button", {
          name: "Save summary",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Save summary" }));
    await screen.findByText(/Complete generated summary saved/);
    expect(value.preferences).toEqual(preferences);
    expect(
      fetcher.mock.calls.filter((call) => call[1]?.method === "POST"),
    ).toHaveLength(1);
    expect(screen.getByText(value.stored.text)).toBeTruthy();
    expect(
      screen.getByText("6578 characters · target 6000 · generated text only"),
    ).toBeTruthy();
  });
  it("keeps summary draft, selection and scroll when dirty Escape is rejected, then returns focus safely", async () => {
    const value = populated();
    const fetcher = await mountMemory(value);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const editButton = screen.getByRole("button", { name: "Edit summary" });
    editButton.focus();
    fireEvent.click(editButton);
    const editor = screen.getByRole("textbox", {
      name: "Complete generated summary",
    }) as HTMLTextAreaElement;
    const draft = "Authored draft\n" + "😀 café ".repeat(1000);
    fireEvent.change(editor, { target: { value: draft } });
    editor.setSelectionRange(4, 25);
    editor.scrollTop = 180;
    fireEvent.keyDown(editor, { key: "a", metaKey: true });
    fireEvent.keyDown(editor, { key: "c", metaKey: true });
    // jsdom proves no interception/mutation, NOT native shortcut behavior.
    expect(
      fetcher.mock.calls.filter((call) => call[1]?.method === "POST"),
    ).toHaveLength(0);
    fireEvent.keyDown(editor, { key: "Escape" });
    expect(confirm).toHaveBeenCalledOnce();
    expect(editor.value).toBe(draft);
    expect(document.activeElement).toBe(editor);
    expect(editor.selectionStart).toBe(4);
    expect(editor.selectionEnd).toBe(25);
    expect(editor.scrollTop).toBe(180);
    confirm.mockReturnValue(true);
    fireEvent.keyDown(editor, { key: "Escape" });
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(document.activeElement).toBe(
      screen.getByRole("heading", { name: "What your trainer remembers" }),
    );
  });
  it("preserves the mounted summary editor, selection, focus and scroll across passive changed observations", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(populated())));
    const { result } = renderHook(() =>
      useMemoryFeature({ setStatus: vi.fn() }),
    );
    await act(() => result.current.loadMemories(false, "A"));
    act(() =>
      result.current.beginMemoryEdit("summary", "Authored multiline\n😀 café"),
    );
    const content = () => (
      <MemoryContent
        {...result.current}
        onOpenSource={vi.fn()}
        runInBackground={vi.fn()}
      />
    );
    const view = render(content());
    const editor = screen.getByRole("textbox") as HTMLTextAreaElement;
    editor.setSelectionRange(3, 9);
    editor.scrollTop = 160;
    await act(() => result.current.loadMemories(false, "B"));
    view.rerender(content());
    expect(screen.getByRole("textbox")).toBe(editor);
    expect(editor.value).toBe("Authored multiline\n😀 café");
    expect(document.activeElement).toBe(editor);
    expect([
      editor.selectionStart,
      editor.selectionEnd,
      editor.scrollTop,
    ]).toEqual([3, 9, 160]);
  });
  it("returns focus to the summary row after delayed successful save reinspection", async () => {
    const value = populated();
    let finish!: (value: Response) => void;
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response(value))
      .mockResolvedValueOnce(response({ ok: true }))
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            finish = resolve;
          }),
      );
    vi.stubGlobal("fetch", fetcher);
    render(<MemoryHarness />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Edit summary" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Save summary" }));
    await act(async () => {});
    expect(screen.queryByRole("textbox")).toBeNull();
    await act(async () => {
      finish(response(value));
    });
    expect(document.activeElement).toBe(
      document.querySelector('[data-memory-id="summary"]'),
    );
  });
  it("retains a failed summary draft for reinspection without replaying the uncertain save", async () => {
    const value = populated();
    const fetcher = await mountMemory(value, () =>
      response({ error: "stale" }, 409),
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit summary" }));
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Recoverable authored draft" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save summary" }));
    await screen.findByText(/Memory change failed or outcome unknown/);
    expect(screen.queryByRole("textbox")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry loading" }));
    const editor = await screen.findByRole("textbox", {
      name: "Complete generated summary",
    });
    expect((editor as HTMLTextAreaElement).value).toBe(
      "Recoverable authored draft",
    );
    expect(
      fetcher.mock.calls.filter((call) => call[1]?.method === "POST"),
    ).toHaveLength(1);
  });
  it("never lets an old selected-chat response replace the current projection", async () => {
    const waiting: ((response: Response) => void)[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>((resolve) => waiting.push(resolve))),
    );
    const { result } = renderHook(() =>
      useMemoryFeature({ setStatus: vi.fn() }),
    );
    let old!: Promise<void>, fresh!: Promise<void>;
    act(() => {
      old = result.current.loadMemories(false, "A");
      fresh = result.current.loadMemories(false, "B");
    });
    await act(async () => {
      waiting[1](response(snapshot("B")));
      await fresh;
    });
    expect(result.current.memory?.selectedChat?.conversationId).toBe("B");
    await act(async () => {
      waiting[0](response(snapshot("A")));
      await old;
    });
    expect(result.current.memory?.selectedChat?.conversationId).toBe("B");
  });
  it("posts exact expected authority and clears uncertain state without retrying mutation", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response(snapshot()))
      .mockResolvedValueOnce(response({ error: "stale" }, 409));
    vi.stubGlobal("fetch", fetcher);
    const { result } = renderHook(() =>
      useMemoryFeature({ setStatus: vi.fn() }),
    );
    await act(() => result.current.loadMemories(false, "A"));
    await act(() =>
      result.current.changeMemory({
        action: "refresh",
        conversationId: "A",
        segmentRevision: 0,
      }),
    );
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({
      version: 2,
      expected: snapshot().expected,
      action: "refresh",
      conversationId: "A",
      segmentRevision: 0,
    });
    expect(result.current.memory).toBeNull();
    expect(result.current.memoryMessage).toContain("outcome unknown");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it.each(["pending", "failed"])(
    "never restores a pre-mutation read while the change is %s",
    async (state) => {
      let resolveRead!: (value: Response) => void;
      let resolveChange!: (value: Response) => void;
      const fetcher = vi
        .fn()
        .mockResolvedValueOnce(response(snapshot()))
        .mockImplementationOnce(
          () => new Promise<Response>((resolve) => (resolveRead = resolve)),
        )
        .mockImplementationOnce(
          () => new Promise<Response>((resolve) => (resolveChange = resolve)),
        );
      vi.stubGlobal("fetch", fetcher);
      vi.spyOn(window, "confirm").mockReturnValue(true);
      const { result } = renderHook(() =>
        useMemoryFeature({ setStatus: vi.fn() }),
      );
      await act(() => result.current.loadMemories(false, "A"));
      let read!: Promise<void>, change!: Promise<void>;
      act(() => {
        read = result.current.loadMemories(false);
        change = result.current.changeMemory({ action: "clear" });
      });
      if (state === "failed")
        await act(async () => {
          resolveChange(response({ error: "unknown" }, 503));
          await change;
        });
      await act(async () => {
        resolveRead(response(snapshot()));
        await read;
      });
      expect(result.current.memory).toBeNull();
      expect(result.current.isMemoryLoading).toBe(state === "pending");
      if (state === "pending")
        await act(async () => {
          resolveChange(response({ error: "unknown" }, 503));
          await change;
        });
      expect(fetcher).toHaveBeenCalledTimes(3);
    },
  );
  it("blocks reads during mutation and reinspects the selected chat after global revocation", async () => {
    let resolveChange!: (value: Response) => void;
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response(snapshot()))
      .mockImplementationOnce(
        () => new Promise<Response>((resolve) => (resolveChange = resolve)),
      )
      .mockResolvedValueOnce(response(snapshot("B")));
    vi.stubGlobal("fetch", fetcher);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const committed = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useMemoryFeature({ setStatus: vi.fn(), onChangeCommitted: committed }),
    );
    await act(() => result.current.loadMemories(false, "A"));
    let change!: Promise<void>;
    act(() => {
      change = result.current.changeMemory({ action: "clear" });
    });
    await act(() => result.current.loadMemories(false, "B"));
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(result.current.memory).toBeNull();
    await act(async () => {
      resolveChange(response({ ok: true }));
      await change;
    });
    expect(committed).toHaveBeenCalledExactlyOnceWith("B");
    expect(result.current.memory?.selectedChat?.conversationId).toBe("B");
    expect(fetcher.mock.calls[2][0]).toContain("conversationId=B");
    expect(result.current.isMemoryLoading).toBe(false);
  });
  it("keeps a global unknown outcome actionable after chat selection changes mid-mutation", async () => {
    let finish!: (value: Response) => void;
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response(snapshot()))
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            finish = resolve;
          }),
      );
    vi.stubGlobal("fetch", fetcher);
    const { result } = renderHook(() =>
      useMemoryFeature({ setStatus: vi.fn() }),
    );
    await act(() => result.current.loadMemories(false, "A"));
    let change!: Promise<void>;
    act(() => {
      change = result.current.changeMemory({ action: "disable" });
    });
    await act(() => result.current.loadMemories(false, "B"));
    await act(async () => {
      finish(response({ error: "unknown" }, 503));
      await change;
    });
    expect(result.current.memory).toBeNull();
    expect(result.current.memoryMessage).toContain("outcome unknown");
    expect(result.current.isMemoryLoading).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("requires deliberate consent for cloud import, never auto-selects history on read", async () => {
    const value = snapshot();
    value.historical.candidates = [
      {
        id: "turn:1",
        conversationId: "A",
        text: "Short weekday sessions preferred.",
        referent: null,
      },
    ];
    const fetcher = vi.fn().mockResolvedValue(response(value));
    vi.stubGlobal("fetch", fetcher);
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const { result } = renderHook(() =>
      useMemoryFeature({ setStatus: vi.fn() }),
    );
    await act(() => result.current.loadMemories(false, "A"));
    await act(() =>
      result.current.changeMemory({
        action: "import-create",
        sourceIds: ["turn:1"],
      }),
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(window.confirm).toHaveBeenCalledOnce();
  });
  it("retains source/history controls without exposing preserved archive or obsolete import routes", () => {
    const value = snapshot();
    value.legacy = [
      {
        id: "legacy:1",
        kind: "preference",
        text: "Preserved legacy preference",
        status: "active",
        expiresAt: null,
        conversationId: "A",
      },
    ];
    const change = vi.fn().mockResolvedValue(undefined),
      open = vi.fn();
    render(
      <MemoryContent
        memory={value}
        summaryExpanded={false}
        setSummaryExpanded={vi.fn()}
        densifyReview={null}
        densifyModel={undefined}
        setDensifyModel={vi.fn()}
        densifyMemory={vi.fn()}
        memoryMessage="Summary fresh"
        isMemoryLoading={false}
        isMemoryReadUnavailable={false}
        pendingMemoryAction={null}
        beginMemoryEdit={vi.fn()}
        canDiscardMemoryEdit={() => true}
        loadMemories={vi.fn()}
        reviewHistory={vi.fn()}
        changeMemory={change}
        editingMemoryId={null}
        editingMemoryText=""
        setEditingMemoryId={vi.fn()}
        setEditingMemoryText={vi.fn()}
        cancelMemoryEdit={vi.fn()}
        onOpenSource={open}
        runInBackground={() => {}}
      />,
    );
    expect(
      screen.getByRole("heading", { name: "What your trainer remembers" }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("heading", {
        name: "Update memory from chat history",
      }),
    ).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Update from chat history" }),
    );
    expect(
      screen.getByRole("heading", { name: "Update memory from chat history" }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Review and update" }));
    expect(change).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Start update" }));
    expect(change).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "rebuild-start",
        snapshot: "a".repeat(64),
      }),
      value,
    );
    fireEvent.click(screen.getByRole("button", { name: "Back to memory" }));
    expect(
      screen.queryByText(/This chat has no usable saved memory/),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Update this chat" }),
    ).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Manage memory" }));
    for (const name of [
      "Older saved records",
      "Open legacy source conversation",
      "Review earlier sources",
      "Process reviewed selection (0)",
    ])
      expect(screen.queryByRole("button", { name })).toBeNull();
    expect(screen.queryByText(/Preserved legacy preference/)).toBeNull();
    expect(screen.queryByPlaceholderText(/Search memory/)).toBeNull();
    expect(
      screen.getByRole("button", { name: "Clear saved memory" }),
    ).toBeTruthy();
  });
  it("reviews selected conversations locally and requires separate explicit legacy confirmation before Start", async () => {
    const value = snapshot();
    const expectedSelection = {
      version: 1,
      conversationIds: ["A"],
      includeLegacy: true,
    };
    const fetcher = await mountMemory(value, (body) => {
      if (body.action === "rebuild-review") {
        expect(body.selection).toEqual(expectedSelection);
        return response({
          rebuild: {
            ...value.rebuild,
            snapshot: "b".repeat(64),
            selection: expectedSelection,
          },
        });
      }
      return response({ ok: true });
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Update from chat history" }),
    );
    fireEvent.click(
      screen.getByRole("radio", { name: "Choose conversations" }),
    );
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Authored caregiving" }),
    );
    fireEvent.click(
      screen.getByRole("checkbox", { name: /Include older conversations/ }),
    );
    expect(
      screen.queryByRole("button", { name: "Review and update" }),
    ).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Review selected history" }),
    );
    await screen.findByRole("button", { name: "Review and update" });
    expect(
      fetcher.mock.calls.filter((call) => call[1]?.method === "POST"),
    ).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Review and update" }));
    expect(
      screen.getByText(/Older conversations may include things once cleared/),
    ).toBeTruthy();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Cancel" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Start update" }));
    await screen.findByText(/History update started/);
    const posts = fetcher.mock.calls
      .filter((call) => call[1]?.method === "POST")
      .map((call) => JSON.parse(String(call[1]?.body)));
    expect(posts.map((post) => post.action)).toEqual([
      "rebuild-review",
      "rebuild-start",
    ]);
    expect(posts[1]).toMatchObject({
      selection: expectedSelection,
      snapshot: "b".repeat(64),
    });
  });
  it("refuses malformed selected-history review metadata without inventing readiness or replaying", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response(snapshot()))
      .mockResolvedValueOnce(
        response({
          rebuild: { version: 1, snapshot: "b".repeat(64), ready: true },
        }),
      );
    vi.stubGlobal("fetch", fetcher);
    const { result } = renderHook(() =>
      useMemoryFeature({ setStatus: vi.fn() }),
    );
    await act(() => result.current.loadMemories(false, "A"));
    await act(() =>
      result.current.reviewHistory({
        version: 1,
        conversationIds: ["A"],
        includeLegacy: true,
      }),
    );
    expect(result.current.memory).toBeNull();
    expect(result.current.memoryMessage).toContain("nothing was started");
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(fetcher.mock.calls[1][1].body)).action).toBe(
      "rebuild-review",
    );
  });
  it("confirms one identity-bound rebuild Start and refuses double-click/unknown-effect replay", async () => {
    let finish!: (value: Response) => void;
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response(snapshot()))
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            finish = resolve;
          }),
      );
    vi.stubGlobal("fetch", fetcher);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { result } = renderHook(() =>
      useMemoryFeature({ setStatus: vi.fn() }),
    );
    await act(() => result.current.loadMemories(false));
    const action = {
      action: "rebuild-start" as const,
      id: "one-request",
      snapshot: "a".repeat(64),
    };
    let first!: Promise<void>;
    act(() => {
      first = result.current.changeMemory(action);
    });
    await act(() => result.current.changeMemory(action));
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(window.confirm).toHaveBeenCalledOnce();
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({
      version: 2,
      expected: snapshot().expected,
      ...action,
    });
    await act(async () => {
      finish(response({ error: "unknown" }, 503));
      await first;
    });
    expect(result.current.memory).toBeNull();
    await act(() => result.current.changeMemory(action));
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("polls only local operation status while active and stops at interruption without replaying Start", async () => {
    vi.useFakeTimers();
    const active = snapshot();
    active.rebuild!.operation = {
      id: "one",
      state: "active",
      reason: null,
      processed: 20,
      total: 41,
      dispositions: { "low-value": 20 },
      createdAt: 1,
      deadline: 10000,
    };
    const interrupted = snapshot();
    interrupted.rebuild!.operation = {
      ...active.rebuild!.operation,
      state: "interrupted",
    };
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response(active))
      .mockResolvedValueOnce(response(interrupted));
    vi.stubGlobal("fetch", fetcher);
    const setStatus = vi.fn();
    const { result } = renderHook(() => useMemoryFeature({ setStatus }));
    await act(() => result.current.loadMemories(false));
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(result.current.memory?.rebuild?.operation?.state).toBe(
      "interrupted",
    );
    await act(() => vi.advanceTimersByTimeAsync(10000));
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls.every((call) => call[1]?.method !== "POST")).toBe(
      true,
    );
  });
  it("puts faithful complete content first and removes technical and snapshot dashboards rather than relocating them", async () => {
    const value = populated();
    value.enabled = false;
    value.state = "disabled";
    await mountMemory(value);
    expect(screen.getByText(value.preferences[0].text.trim()).textContent).toBe(
      value.preferences[0].text,
    );
    expect(
      screen.getByText(/Saved summary and preferences retained, not in use/),
    ).toBeTruthy();
    expect(screen.queryByText(value.stored.text)).toBeNull();
    expect(screen.queryByText(/Price basis/)).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Source & details" }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "Forget" })).toBeNull();
    for (const name of [
      "How memory works & costs",
      "Technical details",
      "View chat memory",
      "Update this chat",
    ])
      expect(screen.queryByRole("button", { name })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Manage memory" }));
    expect(document.querySelector(".memory-facts,table,dl")).toBeNull();
    expect(screen.queryByText("synthetic-review-basis")).toBeNull();
  });
  it("does not claim saved memory is available for a valid empty published revision", async () => {
    await mountMemory(snapshot());
    expect(screen.getByText(/No saved memories/)).toBeTruthy();
    expect(screen.queryByText(/Saved memory available|up to date/)).toBeNull();
    expect(screen.getByText(/No generated summary yet/)).toBeTruthy();
  });
  it("guards dirty cancel, adds with exact authority, and gives action-specific feedback", async () => {
    const value = snapshot();
    const fetcher = await mountMemory(value);
    fireEvent.click(screen.getByRole("button", { name: "Add preference" }));
    expect(
      screen.getByText(/This text may be sent to your AI provider/),
    ).toBeTruthy();
    expect(screen.queryByText(/sensitive details cannot be saved/)).toBeNull();
    const editor = screen.getByRole("textbox", { name: "Preference" });
    expect(document.activeElement).toBe(editor);
    expect(
      (
        screen.getByRole("button", {
          name: "Save preference",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    fireEvent.change(editor, {
      target: { value: "Weekends are optional, not mandatory." },
    });
    vi.spyOn(window, "confirm").mockReturnValue(false);
    fireEvent.click(screen.getByRole("button", { name: "Cancel edit" }));
    expect(screen.getByRole("textbox", { name: "Preference" })).toBeTruthy();
    expect(
      fetcher.mock.calls.filter((c) => c[1]?.method === "POST"),
    ).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Save preference" }));
    await screen.findByText("Preference added.");
    expect(
      JSON.parse(
        String(
          fetcher.mock.calls.find((c) => c[1]?.method === "POST")?.[1]?.body,
        ),
      ),
    ).toEqual({
      version: 2,
      expected: value.expected,
      action: "edit",
      id: null,
      text: "Weekends are optional, not mandatory.",
    });
    expect(screen.queryByRole("textbox")).toBeNull();
  });
  it("names the exact forgotten item, defaults to cancel, and clears only after deliberate confirmation", async () => {
    const value = populated();
    const fetcher = await mountMemory(value);
    fireEvent.click(screen.getByRole("button", { name: "Remove preference" }));
    expect(
      screen.getByText(/Remove only this separately authored preference/)
        .textContent,
    ).toContain(value.preferences[0].text);
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Cancel" }),
    );
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(
      screen.queryByRole("button", { name: "Remove preference" }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Manage memory" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear saved memory" }));
    expect(
      screen.getByText(
        /Backups and text already sent to providers are not erased/,
      ),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(
      fetcher.mock.calls.filter((c) => c[1]?.method === "POST"),
    ).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Clear saved memory" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear saved memory" }));
    await screen.findByText(/Saved memory and chat snapshots cleared/);
    expect(
      fetcher.mock.calls.filter((c) => c[1]?.method === "POST"),
    ).toHaveLength(1);
  });
  it("presents substantial exclusions, honest costs and preserves one snapshot-bound final Start", async () => {
    const value = snapshot();
    value.rebuild!.counts.excludedUserMessages = 184;
    value.rebuild!.reasons = {
      "unproven-legacy-or-cleared-original": 184,
      unknown_new_reason: 2,
    };
    const fetcher = await mountMemory(value);
    fireEvent.click(
      screen.getByRole("button", { name: "Update from chat history" }),
    );
    expect(screen.getByText(/184 excluded from retained history/)).toBeTruthy();
    expect(
      screen.getByText(/Older messages need explicit permission/),
    ).toBeTruthy();
    expect(screen.getByText(/Unavailable in this version/)).toBeTruthy();
    expect(
      screen.queryByText(/unproven-legacy-or-cleared-original/),
    ).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Review and update" }));
    expect(screen.getByText(/Cost is not known in advance/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(
      fetcher.mock.calls.filter((c) => c[1]?.method === "POST"),
    ).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Review and update" }));
    fireEvent.click(screen.getByRole("button", { name: "Start update" }));
    await screen.findByText(/History update started/);
    const body = JSON.parse(
      String(
        fetcher.mock.calls.find((c) => c[1]?.method === "POST")?.[1]?.body,
      ),
    ) as Record<string, unknown>;
    expect(body).toMatchObject({
      version: 2,
      expected: value.expected,
      action: "rebuild-start",
      snapshot: value.rebuild!.snapshot,
    });
    expect(typeof body.id).toBe("string");
  });
  it.each([
    "active",
    "complete",
    "cancelled",
    "interrupted",
    "invalidated",
    "unknown",
  ])("renders honest history %s state without replay", async (state) => {
    const value = snapshot();
    value.rebuild!.operation = {
      id: "one",
      state,
      reason: "summary_provider_failure",
      processed: 20,
      total: 41,
      dispositions: {},
      createdAt: 1,
      deadline: 10000,
    };
    const fetcher = await mountMemory(value);
    fireEvent.click(
      screen.getByRole("button", { name: /Update from chat history/ }),
    );
    expect(
      screen.getByText(/20 of 41 included messages processed/),
    ).toBeTruthy();
    if (state === "active")
      expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
    else if (state === "complete")
      expect(
        screen.getByText(/new chat turns use available valid memory/),
      ).toBeTruthy();
    else
      expect(
        screen.getByText(/No completed replacement was saved/),
      ).toBeTruthy();
    expect(fetcher.mock.calls.every((c) => c[1]?.method !== "POST")).toBe(true);
  });
  it("returns from a completed history result without another action or mutation", async () => {
    const value = populated();
    value.rebuild!.operation = {
      id: "complete",
      state: "complete",
      reason: null,
      processed: 41,
      total: 41,
      dispositions: {},
      createdAt: 1,
      deadline: 10000,
    };
    const fetcher = await mountMemory(value);
    const open = screen.getByRole("button", {
      name: /Update from chat history/,
    });
    open.focus();
    fireEvent.click(open);
    expect(screen.getByText("Saved memory updated")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Review a new update" }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "View saved memory" }),
    ).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Review a new update" }),
    );
    expect(
      screen.queryByRole("button", { name: "View saved memory" }),
    ).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Back to memory" }));
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByText("What your trainer remembers"),
      ),
    );
    const reopen = screen.getByRole("button", {
      name: /Update from chat history/,
    });
    reopen.focus();
    fireEvent.click(reopen);
    expect(
      screen.queryByRole("button", { name: "View saved memory" }),
    ).toBeNull();
    fireEvent.keyDown(screen.getByRole("button", { name: "Back to memory" }), {
      key: "Escape",
    });
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByText("What your trainer remembers"),
      ),
    );
    expect(fetcher.mock.calls.every((c) => c[1]?.method !== "POST")).toBe(true);
  });
  it.each(["unmeasured", "older", "unused"])(
    "keeps %s internal chat snapshots out of routine Memory without read-time adoption",
    async (state) => {
      const value = populated();
      value.selectedChat!.pin = {
        version: 2,
        value: {
          version: 2,
          text: "Only earlier chat memory, not latest saved content.",
        },
        preferences: [],
        stamp: {
          version: 1,
          revision: state === "older" ? 2 : 3,
          privacyGeneration: 0,
          controlGeneration: 1,
          manualRevision: 0,
          validUntil: null,
        },
        omitted: 1,
        tokens: state === "unmeasured" ? null : 40,
      };
      value.usedByChat = state === "older";
      const fetcher = await mountMemory(value);
      expect(
        screen.queryByRole("button", { name: "View chat memory" }),
      ).toBeNull();
      expect(
        screen.queryByRole("button", { name: "Update this chat" }),
      ).toBeNull();
      expect(
        screen.queryByText(
          "Only earlier chat memory, not latest saved content.",
        ),
      ).toBeNull();
      expect(screen.getByText(value.stored.text)).toBeTruthy();
      expect(fetcher.mock.calls.every((c) => c[1]?.method !== "POST")).toBe(
        true,
      );
    },
  );
  it.each(["active", "paused", "review-required"])(
    "retains contextual explicit cancellation for a %s compatibility import, without a dead-end import screen",
    async (state) => {
      const value = snapshot();
      value.historical.manifests = [
        { id: "old", state, position: 2, total: 3 },
      ];
      const fetcher = await mountMemory(value, () => {
        value.historical.manifests[0].state = "cancelled";
        return response({ ok: true });
      });
      fireEvent.click(
        screen.getByRole("button", { name: "Update from chat history" }),
      );
      expect(screen.getByText(/2 of 3 messages processed/)).toBeTruthy();
      expect(
        screen.queryByRole("button", { name: /Process reviewed selection/ }),
      ).toBeNull();
      fireEvent.click(
        screen.getByRole("button", { name: "Cancel earlier update" }),
      );
      expect(fetcher.mock.calls.every((c) => c[1]?.method !== "POST")).toBe(
        true,
      );
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      fireEvent.click(
        screen.getByRole("button", { name: "Cancel earlier update" }),
      );
      fireEvent.click(
        screen
          .getAllByRole("button", { name: "Cancel earlier update" })
          .at(-1)!,
      );
      await screen.findByText(/Import cancellation checked/);
      const posts = fetcher.mock.calls.filter((c) => c[1]?.method === "POST");
      expect(posts).toHaveLength(1);
      expect(JSON.parse(String(posts[0][1]?.body))).toMatchObject({
        action: "import-cancel",
        id: "old",
        expected: value.expected,
      });
    },
  );
  it("reconciles cancel versus completion without replaying or falsely claiming rollback", async () => {
    const value = snapshot();
    value.rebuild!.operation = {
      id: "one",
      state: "active",
      reason: null,
      processed: 2,
      total: 3,
      dispositions: {},
      createdAt: 0,
      deadline: 10000,
    };
    const fetcher = await mountMemory(value, () => {
      value.rebuild!.operation!.state = "complete";
      return response({ ok: true });
    });
    fireEvent.click(
      screen.getByRole("button", { name: /Update from chat history/ }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await screen.findByText("Saved memory updated");
    expect(screen.getByText(/Cancellation checked/)).toBeTruthy();
    expect(
      fetcher.mock.calls.filter((c) => c[1]?.method === "POST"),
    ).toHaveLength(1);
  });
  it("retains the unknown action outcome and only permits read reconciliation", async () => {
    const fetcher = await mountMemory(snapshot(), () =>
      response({ error: "private vendor text" }, 503),
    );
    fireEvent.click(screen.getByRole("button", { name: "Turn Off" }));
    await screen.findByText(/outcome unknown/);
    expect(screen.queryByText(/private vendor text/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Turn On" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry loading" }));
    await screen.findByRole("button", { name: "Add preference" });
    expect(
      fetcher.mock.calls.filter((c) => c[1]?.method === "POST"),
    ).toHaveLength(1);
  });
  it("rejects a superseded confirmation object even when expected counters are unchanged", async () => {
    const fetcher = vi
      .fn()
      .mockImplementation(() => Promise.resolve(response(snapshot())));
    vi.stubGlobal("fetch", fetcher);
    const { result } = renderHook(() =>
      useMemoryFeature({ setStatus: vi.fn() }),
    );
    await act(() => result.current.loadMemories(false, "A"));
    const reviewed = result.current.memory!;
    await act(() => result.current.loadMemories(false, "B"));
    await act(() => result.current.changeMemory({ action: "clear" }, reviewed));
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(result.current.memoryMessage).toContain(
      "Review the current information",
    );
  });
  it("keeps mounted DOM, focus and scroll across delayed/unchanged/progress/lost-connection observations and retains the terminal result", async () => {
    vi.useFakeTimers();
    const value = populated();
    value.rebuild!.operation = {
      id: "progressive",
      state: "active",
      reason: null,
      processed: 20,
      total: 184,
      dispositions: {},
      createdAt: 1,
      deadline: 10000,
    };
    let finish: ((r: Response) => void) | undefined;
    let initial = true;
    const fetcher = vi.fn((_url: string, _init?: RequestInit) => {
      if (initial) {
        initial = false;
        return Promise.resolve(response(value));
      }
      return new Promise<Response>((resolve) => {
        finish = resolve;
      });
    });
    vi.stubGlobal("fetch", fetcher);
    await act(async () => {
      render(<MemoryHarness />);
    });
    fireEvent.click(
      screen.getByRole("button", { name: /Update from chat history/ }),
    );
    const cancel = screen.getByRole("button", { name: "Cancel" });
    const progress = screen.getByRole("progressbar");
    const root = document.querySelector<HTMLElement>(".memory-root-card")!;
    cancel.focus();
    root.scrollTop = 73;
    for (const count of [20, 40, 60]) {
      await act(async () => {
        vi.advanceTimersByTime(2000);
      });
      expect(screen.queryByText("Checking saved memory…")).toBeNull();
      expect(screen.getByRole("button", { name: "Cancel" })).toBe(cancel);
      expect(cancel.hasAttribute("disabled")).toBe(false);
      await act(async () => {
        vi.advanceTimersByTime(2000);
      });
      // No overlapping reads while a slow observation is outstanding.
      const reads = fetcher.mock.calls.length;
      await act(async () => {
        finish!(
          response({
            ...value,
            rebuild: {
              ...value.rebuild,
              operation: { ...value.rebuild!.operation, processed: count },
            },
          }),
        );
      });
      expect(fetcher.mock.calls.length).toBe(reads);
      expect(screen.getByRole("progressbar")).toBe(progress);
      expect(progress.getAttribute("value")).toBe(String(count));
      expect(document.activeElement).toBe(cancel);
      expect(root.scrollTop).toBe(73);
      expect(
        screen.queryByRole("button", { name: "Check update status" }),
      ).toBeNull();
    }
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    await act(async () => {
      finish!(response({ error: "private vendor message" }, 503));
    });
    expect(screen.getByText("Update status unavailable")).toBeTruthy();
    expect(screen.getByText(/Last known: 60 of 184/)).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Retry connection" }),
    ).toBeTruthy();
    expect(screen.queryByText(/private vendor/)).toBeNull();
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    await act(async () => {
      finish!(
        response({
          ...value,
          rebuild: {
            ...value.rebuild,
            operation: {
              ...value.rebuild!.operation,
              processed: 184,
              state: "complete",
            },
          },
        }),
      );
    });
    expect(screen.getByText("Saved memory updated")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "View saved memory" }),
    ).toBeNull();
    expect(screen.getByRole("button", { name: "Back to memory" })).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Review and update" }),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "Review a new update" }),
    ).toBeTruthy();
    const reads = fetcher.mock.calls.length;
    await act(async () => {
      vi.advanceTimersByTime(6000);
    });
    expect(fetcher).toHaveBeenCalledTimes(reads);
    expect(fetcher.mock.calls.every((c) => c[1]?.method !== "POST")).toBe(true);
  });
  it("preserves global content and an unsaved manual draft while a newly resolved chat is passively inspected, revoking only old chat metadata", async () => {
    let finish!: (r: Response) => void;
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response(populated()))
      .mockImplementation(
        () =>
          new Promise<Response>((resolve) => {
            finish = resolve;
          }),
      );
    vi.stubGlobal("fetch", fetcher);
    const { result } = renderHook(() =>
      useMemoryFeature({ setStatus: vi.fn() }),
    );
    await act(() => result.current.loadMemories(false, "A"));
    act(() => {
      result.current.beginMemoryEdit("new", "Unsaved global manual note");
    });
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.loadMemories(false, "B");
    });
    expect(result.current.memory?.stored.text).toBe(populated().stored.text);
    expect(result.current.memory?.selectedChat).toBeNull();
    expect(result.current.editingMemoryText).toBe("Unsaved global manual note");
    expect(result.current.isMemoryLoading).toBe(false);
    await act(async () => {
      finish(
        response({
          ...populated(),
          selectedChat: { ...snapshot("B").selectedChat },
        }),
      );
      await pending;
    });
    expect(result.current.editingMemoryText).toBe("Unsaved global manual note");
  });
  it.each([false, true])(
    "settles a superseded local review without a stuck busy state or post-unmount reads (unmount=%s)",
    async (unmount) => {
      let finish!: (r: Response) => void;
      let reads = 0;
      const fetcher = vi.fn((_url: string, init?: RequestInit) =>
        init?.method === "POST"
          ? new Promise<Response>((resolve) => {
              finish = resolve;
            })
          : Promise.resolve(response(snapshot(reads++ ? "B" : "A"))),
      );
      vi.stubGlobal("fetch", fetcher);
      const { result, unmount: remove } = renderHook(() =>
        useMemoryFeature({ setStatus: vi.fn() }),
      );
      await act(() => result.current.loadMemories(false, "A"));
      let review!: Promise<void>;
      act(() => {
        review = result.current.reviewHistory({
          version: 1,
          conversationIds: null,
          includeLegacy: true,
        });
      });
      await act(() => result.current.loadMemories(false, "B"));
      if (unmount) remove();
      await act(async () => {
        finish(response({ rebuild: snapshot().rebuild }));
        await review;
      });
      expect(
        fetcher.mock.calls.filter((c) => c[1]?.method === "POST"),
      ).toHaveLength(1);
      if (unmount) expect(reads).toBe(1);
      else {
        expect(result.current.isMemoryLoading).toBe(false);
        expect(result.current.memory?.selectedChat?.conversationId).toBe("B");
        expect(reads).toBe(2);
      }
    },
  );
  it("does not announce completion or render a full determinate bar before commit", async () => {
    const value = snapshot();
    value.rebuild!.operation = {
      id: "finishing",
      state: "active",
      reason: null,
      processed: 184,
      total: 184,
      dispositions: {},
      createdAt: 1,
      deadline: 10000,
    };
    await mountMemory(value);
    fireEvent.click(
      screen.getByRole("button", { name: /Update from chat history/ }),
    );
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(screen.getByText(/finishing — not yet saved/)).toBeTruthy();
    expect(screen.queryByText("Saved memory updated")).toBeNull();
  });
  it("refuses old/unsupported inspection instead of displaying invented readiness", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ ok: true })));
    const { result } = renderHook(() =>
      useMemoryFeature({ setStatus: vi.fn() }),
    );
    await act(() => result.current.loadMemories(false));
    expect(result.current.memory).toBeNull();
    expect(result.current.memoryMessage).toContain("Connection lost");
  });
});
