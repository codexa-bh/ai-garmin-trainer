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
  it("puts faithful complete content first and removes technical and snapshot dashboards rather than relocating them", async () => {
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
    expect(screen.getByText("Includes your own saved text.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Back to memory" }));
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
    expect(screen.getByText(/Nothing saved here yet/)).toBeTruthy();
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
        /Remove this memory and keep its sources from recreating it/,
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
  it.each(["unmeasured", "older", "unused"])(
    "keeps %s internal chat snapshots out of routine Memory without read-time adoption",
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
      expect(screen.getByText(value.stored.items[0].text)).toBeTruthy();
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
    expect(result.current.memory?.stored.items[0].id).toBe("one");
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
