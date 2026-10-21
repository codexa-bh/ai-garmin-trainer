/** @vitest-environment jsdom */
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { createRef } from "react";
import { useChatFeature } from "../src/app/dashboard/use-chat";
import { useWeeklyFeature } from "../src/app/dashboard/use-weekly";
import { WeeklyPlanView } from "../src/app/dashboard/weekly-plan-view";
import type { WeeklyRecord } from "../src/lib/weekly/contracts";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });
it.each([false, true])(
  "refreshes weekly state after confirmed save for stream=%s, not just the last tool",
  async (stream) => {
    const grounding = {
      tool: "getSyncStatus",
      toolSteps: [{ tool: "applyWeeklyProposal", status: "succeeded" }],
    };
    const assistantMessage = {
      id: "a",
      role: "assistant",
      content: "Saved",
      createdAt: "2026-09-26T12:00:00Z",
      grounding,
    };
    const fetch = vi.fn((url: RequestInfo | URL) =>
      Promise.resolve(
        String(url) === "/api/chat"
          ? stream
            ? new Response(
                JSON.stringify({
                  type: "done",
                  assistantMessage,
                  conversationId: "default",
                  memoryProposal: { status: "none" },
                }) + "\n",
                { headers: { "content-type": "application/x-ndjson" } },
              )
            : new Response(
                JSON.stringify({
                  messages: [assistantMessage],
                  toolEvidence: grounding,
                }),
                { headers: { "content-type": "application/json" } },
              )
          : response({ conversations: [] }),
      ),
    );
    vi.stubGlobal("fetch", fetch);
    const loadWeekly = vi.fn(async () => {});
    const { result } = renderHook(() =>
      useChatFeature({
        setStatus: vi.fn(),
        setIsConversationDrawerOpen: vi.fn(),
        conversationButtonRef: createRef(),
        rememberTranscriptFollowIntent: vi.fn(),
        forceNextScrollRef: { current: false },
        transcriptRef: createRef(),
        closeConversationMenu: vi.fn(),
        runInBackground: (work) => {
          work.catch(() => {
            throw new Error("unexpected async failure");
          });
        },
        loadMemories: vi.fn(async () => {}),
        loadTrainingPlan: vi.fn(async () => {}),
        loadWeekly,
        messageInputRef: createRef(),
      }),
    );
    await act(() => result.current.submitChat("Confirm that exact draft"));
    expect(loadWeekly).toHaveBeenCalledOnce();
    const request = fetch.mock.calls.find(
      ([url]) => String(url) === "/api/chat",
    );
    expect(request).toBeTruthy();
  },
);
it("keeps its request owner mounted, transports timezone, defaults to This Week and rejects stale response overwrite", async () => {
  let resolve!: (value: Response) => void;
  const fetch = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<Response>((done) => {
          resolve = done;
        }),
    )
    .mockResolvedValueOnce(response({ items: [], next: null }));
  vi.stubGlobal("fetch", fetch);
  const { result, rerender } = renderHook(useWeeklyFeature);
  expect(result.current.mode).toBe("current");
  expect(fetch).not.toHaveBeenCalled();
  let pending!: Promise<void>;
  act(() => {
    pending = result.current.load();
  });
  await act(() => result.current.load("history"));
  await act(async () => {
    resolve(response({ record: null }));
    await pending;
  });
  rerender();
  expect(result.current.mode).toBe("history");
  expect(result.current.week).toBe("");
  expect(fetch.mock.calls[0][0]).toContain("timeZone=");
  expect(fetch).toHaveBeenCalledTimes(2);
});
it("shows explicit error then persisted reload content", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce(response({ error: "failed" }, 500))
      .mockResolvedValueOnce(response({ record: { revision: "saved" } })),
  );
  const { result } = renderHook(useWeeklyFeature);
  await act(() => result.current.load());
  expect(result.current.state).toBe("error");
  await act(() => result.current.load());
  expect(result.current.record?.revision).toBe("saved");
});
it("renders latest/original/as-of metadata safely and starts only a correction conversation", () => {
  const doc = {
    title: "Plan",
    contentMarkdown:
      "**Walk** <script>alert(1)</script> [unsafe](javascript:alert(1))",
    revision: "r",
    savedAt: "2026-09-27T10:00:00Z",
  };
  const record: WeeklyRecord = {
    weekStart: "2026-09-21",
    timeZone: "Europe/Zagreb",
    revision: "a",
    original: doc,
    latest: doc,
    review: {
      ...doc,
      title: "Review",
      asOf: "2026-09-27T10:00:00Z",
      planRevision: "old",
      contentMarkdown:
        "Scored commitment: original revision r. Provisional score: 80/100.",
    },
  };
  const load = vi.fn(async () => {});
  const startChat = vi.fn();
  const weekly = {
    mode: "history" as const,
    record,
    week: record.weekStart,
    basis: "UTC",
    items: [],
    next: null,
    state: "loaded" as const,
    load,
    refresh: load,
  };
  const { container } = render(
    <WeeklyPlanView
      weekly={weekly}
      close={vi.fn()}
      closeRef={createRef()}
      startChat={startChat}
      openGeneral={vi.fn(async () => {})}
      run={(work) => {
        work.catch(() => {
          throw new Error("test action failed");
        });
      }}
    >
      <p>General editor</p>
    </WeeklyPlanView>,
  );
  expect(screen.getByText(/saved dates unchanged/)).toBeTruthy();
  expect(screen.getByText(/latest-plan snapshot at save old/)).toBeTruthy();
  expect(screen.getByText(/earlier revision/)).toBeTruthy();
  expect(
    screen.getByText(/snapshot is context, not the scoring baseline/),
  ).toBeTruthy();
  expect(
    screen.getByText(/Scored commitment: original revision r/),
  ).toBeTruthy();
  expect(screen.queryByText(/evaluated plan/)).toBeNull();
  expect(screen.getByText(/Original commitment/)).toBeTruthy();
  expect(container.querySelector("details")).toBeNull();
  expect(screen.getByText(/latest plan is identical/)).toBeTruthy();
  expect(container.querySelector("script")).toBeNull();
  expect(container.querySelector('a[href^="javascript:"]')).toBeNull();
  expect(container.querySelector("textarea")).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: "Review / correct via chat" }),
  );
  expect(startChat).toHaveBeenCalledWith(
    expect.stringContaining("do not save without my confirmation"),
  );
  expect(load).not.toHaveBeenCalled();
});
it("keeps general editor separately accessible and history secondary", () => {
  const load = vi.fn(async () => {});
  const weekly = {
    mode: "general" as const,
    record: null,
    week: "",
    basis: "UTC",
    items: [],
    next: null,
    state: "idle" as const,
    load,
    refresh: load,
  };
  render(
    <WeeklyPlanView
      weekly={weekly}
      close={vi.fn()}
      closeRef={createRef()}
      startChat={vi.fn()}
      openGeneral={vi.fn(async () => {})}
      run={(work) => {
        work.catch(() => {
          throw new Error("test failed");
        });
      }}
    >
      <p>Existing general editor</p>
    </WeeklyPlanView>,
  );
  expect(screen.getByText("Existing general editor")).toBeTruthy();
  expect(
    screen
      .getByRole("button", { name: "General Plan" })
      .getAttribute("aria-pressed"),
  ).toBe("true");
  fireEvent.click(screen.getByRole("button", { name: "History" }));
  expect(load).toHaveBeenCalledWith("history");
});
