/** @vitest-environment jsdom */
import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
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
    stored: { version: 1, text: "", items: [] },
    manualIds: [],
    sources: [],
    legacy: [],
    historical: {
      candidates: [],
      manifests: [],
      exclusions: "Unlinked sources are excluded.",
    },
    rebuild: {
      version: 1,
      snapshot: "a".repeat(64),
      ready: true,
      complete: true,
      limitExceeded: false,
      configuredProvider: "openai",
      model: "gpt-6-luna",
      enabled: true,
      capability: "configured-not-probed",
      counts: {
        chats: 3,
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
        conservativeMaximum: 0.4,
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
  await screen.findByRole("button", { name: "Add memory" });
  return fetcher;
}
function populated() {
  const value = snapshot();
  value.stored.items = [
    {
      id: "one",
      text: "I have not chosen poles. Could they help?",
      category: "question",
      stance: "discussed-not-endorsed",
      sourceIds: ["turn:1"],
      priority: 3,
      expiresAt: null,
      reviewAt: 1,
    },
    {
      id: "two",
      text: "Last winter only: short weekdays, not long sessions. ".repeat(14),
      category: "temporary",
      stance: "user-stated",
      sourceIds: ["manual:1"],
      priority: 2,
      expiresAt: 1893456000000,
      reviewAt: 1,
    },
  ];
  value.stored.text = value.stored.items.map((i) => i.text).join("\n");
  value.manualIds = ["two"];
  value.sources = [
    {
      sourceId: "manual:1",
      manual: true,
      conversationId: null,
      messageId: null,
    },
  ];
  return value;
}

describe("integrated Memory visible controls and stale-response safety", () => {
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
      version: 1,
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
  it("renders current/pinned distinction, no-service legacy review and explicit controls without old semantic search", () => {
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
        memoryMessage="Summary fresh"
        isMemoryLoading={false}
        pendingMemoryAction={null}
        beginMemoryEdit={vi.fn()}
        canDiscardMemoryEdit={() => true}
        loadMemories={vi.fn()}
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
      screen.getByText(/This chat has no usable saved memory/),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Update this chat" }));
    fireEvent.click(screen.getByRole("button", { name: "Update this chat" }));
    expect(change).toHaveBeenCalledWith(
      { action: "refresh", conversationId: "A", segmentRevision: 0 },
      value,
    );
    fireEvent.click(screen.getByRole("button", { name: "Manage memory" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Older saved records" }),
    );
    expect(screen.getByText(/Preserved legacy preference/)).toBeTruthy();
    expect(screen.queryByPlaceholderText(/Search memory/)).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Open legacy source conversation" }),
    );
    expect(open).toHaveBeenCalledWith("A");
    fireEvent.click(screen.getByRole("button", { name: "Back to memory" }));
    fireEvent.click(screen.getByRole("button", { name: "Manage memory" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Review earlier sources" }),
    );
    expect(
      screen
        .getByRole("button", { name: "Process reviewed selection (0)" })
        .hasAttribute("disabled"),
    ).toBe(true);
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
      version: 1,
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
  it("puts faithful complete content first and rehomes sources, legacy and accounting", async () => {
    const value = populated();
    value.enabled = false;
    value.state = "disabled";
    await mountMemory(value);
    expect(
      screen.getByText(value.stored.items[1].text.trim()).textContent,
    ).toBe(value.stored.items[1].text);
    expect(
      screen.getByText("Open question · Discussed · not decided"),
    ).toBeTruthy();
    expect(screen.getByText(/Saved items retained/)).toBeTruthy();
    expect(screen.queryByText(/Price basis/)).toBeNull();
    fireEvent.click(
      screen.getAllByRole("button", { name: "Source & details" })[1],
    );
    expect(screen.getByRole("heading", { name: "Memory details" })).toBe(
      document.activeElement,
    );
    expect(screen.getByText("Standalone manual source")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Back to memory" }));
    fireEvent.click(
      screen.getByRole("button", { name: "How memory works & costs" }),
    );
    expect(screen.getByText(/no daily cap/)).toBeTruthy();
    expect(
      screen.getByText("Outstanding unknown / legacy reservations, all days"),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Technical details" }));
    expect(screen.getByText("synthetic-review-basis")).toBeTruthy();
  });
  it("guards dirty cancel, adds with exact authority, and gives action-specific feedback", async () => {
    const value = snapshot();
    const fetcher = await mountMemory(value);
    fireEvent.click(screen.getByRole("button", { name: "Add memory" }));
    const editor = screen.getByRole("textbox", { name: "Memory" });
    expect(document.activeElement).toBe(editor);
    expect(
      (screen.getByRole("button", { name: "Save memory" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    fireEvent.change(editor, {
      target: { value: "Weekends are optional, not mandatory." },
    });
    vi.spyOn(window, "confirm").mockReturnValue(false);
    fireEvent.click(screen.getByRole("button", { name: "Cancel edit" }));
    expect(screen.getByRole("textbox", { name: "Memory" })).toBeTruthy();
    expect(
      fetcher.mock.calls.filter((c) => c[1]?.method === "POST"),
    ).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Save memory" }));
    await screen.findByText("Memory added.");
    expect(
      JSON.parse(
        String(
          fetcher.mock.calls.find((c) => c[1]?.method === "POST")?.[1]?.body,
        ),
      ),
    ).toEqual({
      version: 1,
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
    fireEvent.click(screen.getAllByRole("button", { name: "Forget" })[0]);
    expect(
      screen.getByText(
        /Remove this item and suppress its exact source versions/,
      ).textContent,
    ).toContain(value.stored.items[0].text);
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Cancel" }),
    );
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(screen.queryByRole("button", { name: "Forget memory" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Manage memory" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear saved memory" }));
    expect(
      screen.getByText(/Backups, exports and provider logs are not erased/),
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
    expect(screen.getByText("184 user messages excluded")).toBeTruthy();
    expect(screen.getByText(/cannot prove they are safe/)).toBeTruthy();
    expect(
      screen.getByText(/Some messages cannot be included by this version/),
    ).toBeTruthy();
    expect(
      screen.getByText(/conservative maximum, not an invoice or spending cap/),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Review and update" }));
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
      version: 1,
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
      screen.getByText(/Processed 20 of 41 eligible messages/),
    ).toBeTruthy();
    if (state === "active")
      expect(
        screen.getByRole("button", { name: "Cancel history update" }),
      ).toBeTruthy();
    else if (state === "complete")
      expect(
        screen.getByText(/This chat has not automatically adopted/),
      ).toBeTruthy();
    else
      expect(
        screen.getByText(/No successful staged replacement is reported/),
      ).toBeTruthy();
    expect(fetcher.mock.calls.every((c) => c[1]?.method !== "POST")).toBe(true);
  });
  it.each(["unmeasured", "older", "unsupported"])(
    "keeps %s chat text distinct and never silently adopts latest",
    async (state) => {
      const value = populated();
      value.selectedChat!.pin = {
        version: 1,
        value: {
          version: 1,
          items: [],
          text: "Only earlier chat memory, not latest saved content.",
        },
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
      fireEvent.click(screen.getByRole("button", { name: "View chat memory" }));
      expect(
        screen.getByText("Only earlier chat memory, not latest saved content."),
      ).toBeTruthy();
      expect(screen.queryByText(value.stored.items[0].text)).toBeNull();
      if (state === "unsupported")
        expect(
          (
            screen.getByRole("button", {
              name: "Update this chat",
            }) as HTMLButtonElement
          ).disabled,
        ).toBe(true);
      if (state === "unmeasured")
        expect(
          screen.getByText("Saved for this chat; use not yet verified"),
        ).toBeTruthy();
      expect(fetcher.mock.calls.every((c) => c[1]?.method !== "POST")).toBe(
        true,
      );
    },
  );
  it("keeps retained import a deliberate reviewed selection and exposes actual pause/resume/review controls", async () => {
    const value = snapshot();
    value.historical.candidates = [
      {
        id: "turn:1",
        conversationId: "A",
        text: "Short weekdays preferred.",
        referent: null,
      },
    ];
    value.historical.manifests = [
      { id: "old", state: "review-required", position: 2, total: 3 },
    ];
    const fetcher = await mountMemory(value);
    fireEvent.click(screen.getByRole("button", { name: "Manage memory" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Review earlier sources" }),
    );
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(
      false,
    );
    expect(screen.getByText(/This manifest cannot resume/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cancel import" })).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(
      screen.getByRole("button", { name: "Process reviewed selection (1)" }),
    );
    expect(screen.getByText(/1 explicitly selected records/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(fetcher.mock.calls.every((c) => c[1]?.method !== "POST")).toBe(true);
    fireEvent.click(
      screen.getByRole("button", { name: "Process reviewed selection (1)" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Process selection" }));
    await screen.findByText("Reviewed source import created.");
    expect(
      JSON.parse(
        String(
          fetcher.mock.calls.find((c) => c[1]?.method === "POST")?.[1]?.body,
        ),
      ),
    ).toMatchObject({
      action: "import-create",
      sourceIds: ["turn:1"],
      expected: value.expected,
    });
  });
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
    fireEvent.click(
      screen.getByRole("button", { name: "Cancel history update" }),
    );
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
    fireEvent.click(screen.getByRole("button", { name: "Check saved memory" }));
    await screen.findByRole("button", { name: "Add memory" });
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
  it("refuses old/unsupported inspection instead of displaying invented readiness", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ ok: true })));
    const { result } = renderHook(() =>
      useMemoryFeature({ setStatus: vi.fn() }),
    );
    await act(() => result.current.loadMemories(false));
    expect(result.current.memory).toBeNull();
    expect(result.current.memoryMessage).toContain("unavailable");
  });
});
