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
});
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
    expect(screen.getByText(/Latest revision 3/)).toBeTruthy();
    expect(screen.getByText(/No active cross-chat pin/)).toBeTruthy();
    expect(screen.getByText(/Preserved legacy preference/)).toBeTruthy();
    expect(screen.queryByPlaceholderText(/Search memory/)).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Refresh selected chat memory" }),
    );
    expect(change).toHaveBeenCalledWith({
      action: "refresh",
      conversationId: "A",
      segmentRevision: 0,
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Open legacy source conversation" }),
    );
    expect(open).toHaveBeenCalledWith("A");
    expect(
      screen
        .getByRole("button", { name: "Process reviewed selection (0)" })
        .hasAttribute("disabled"),
    ).toBe(true);
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
