/** @vitest-environment jsdom */
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { createRef } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { TrainerDashboard } from "../src/app/trainer-dashboard";
import { WeeklyPlanView } from "../src/app/dashboard/weekly-plan-view";
import { useWeeklyFeature } from "../src/app/dashboard/use-weekly";
import { useTrainingPlanFeature } from "../src/app/dashboard/use-training-plan";
import type { WeeklyDocument, WeeklyRecord } from "../src/lib/weekly/contracts";

const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });
const doc: WeeklyDocument = {
  title: "Commitment",
  contentMarkdown: "First saved work",
  revision: "first",
  savedAt: "2026-10-01T00:00:00Z",
};
const general = (title: string) => ({
  plan: {
    title,
    contentMarkdown: `${title} content`,
    revisedAt: "2026-10-20T00:00:00Z",
  },
  stale: false,
  staleAfterDays: 60,
});
function deferred() {
  let resolve!: (value: Response) => void;
  const promise = new Promise<Response>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it.each([
  [
    "identical document, different metadata",
    { ...doc, revision: "later", savedAt: "2026-10-02T00:00:00Z" },
    doc,
    false,
  ],
  ["different title", { ...doc, title: "Adapted" }, doc, true],
  ["different Markdown", { ...doc, contentMarkdown: "Adaptation" }, doc, true],
  [
    "whitespace is not normalized",
    { ...doc, contentMarkdown: `${doc.contentMarkdown}\n` },
    doc,
    true,
  ],
  ["original without latest", null, doc, true],
  ["review without original", null, null, false],
] as const)(
  "explains baseline truthfully for %s",
  (_label, latest, original, disclosure) => {
    const record: WeeklyRecord = {
      weekStart: "2026-09-28",
      timeZone: "UTC",
      revision: "r",
      latest,
      original,
      review: {
        ...doc,
        title: "Review",
        asOf: doc.savedAt,
        planRevision: null,
      },
    };
    const load = vi.fn(async () => {});
    const { container } = render(
      <WeeklyPlanView
        weekly={{
          mode: "current",
          record,
          week: record.weekStart,
          basis: "UTC",
          items: [],
          next: null,
          state: "loaded",
          load,
          refresh: load,
        }}
        close={vi.fn()}
        closeRef={createRef()}
        startChat={vi.fn()}
        openGeneral={load}
        run={(work) => {
          work.catch(() => {
            throw new Error("Unexpected test action failure");
          });
        }}
      >
        General
      </WeeklyPlanView>,
    );
    expect(Boolean(container.querySelector("details > summary"))).toBe(
      disclosure,
    );
    expect(Boolean(screen.queryByText(/first saved plan, retained/))).toBe(
      Boolean(original),
    );
    expect(Boolean(screen.queryByText(/latest plan is identical/))).toBe(
      Boolean(original && !disclosure),
    );
    expect(
      container.querySelector("details")?.hasAttribute("open") ?? false,
    ).toBe(false);
  },
);

it("refreshes loaded history range using new cursors, deduplicates and retains selected detail", async () => {
  const summary = (weekStart: string, hasReview = false) => ({
    weekStart,
    timeZone: "UTC",
    hasPlan: true,
    hasReview,
  });
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(
      response({
        items: [summary("2026-09-28"), summary("2026-09-21")],
        next: "2026-09-21",
      }),
    )
    .mockResolvedValueOnce(
      response({ items: [summary("2026-09-14")], next: "2026-09-14" }),
    )
    .mockResolvedValueOnce(
      response({
        items: [summary("2026-10-05"), summary("2026-09-28", true)],
        next: "2026-09-28",
      }),
    )
    .mockResolvedValueOnce(
      response({
        items: [summary("2026-09-21"), summary("2026-09-14", true)],
        next: "2026-09-14",
      }),
    )
    .mockResolvedValueOnce(
      response({
        items: [summary("2026-09-14", true), summary("2026-09-07")],
        next: null,
      }),
    )
    .mockResolvedValueOnce(response({ record: { revision: "old" } }))
    .mockResolvedValueOnce(response({ record: { revision: "new" } }));
  vi.stubGlobal("fetch", fetch);
  const { result } = renderHook(useWeeklyFeature);
  await act(() => result.current.load("history"));
  await act(() =>
    result.current.load("history", undefined, result.current.next!),
  );
  await act(() => result.current.refresh());
  expect(result.current.items.map((item) => item.weekStart)).toEqual([
    "2026-10-05",
    "2026-09-28",
    "2026-09-21",
    "2026-09-14",
  ]);
  expect(result.current.items.at(-1)?.hasReview).toBe(true);
  expect(result.current.next).toBe("2026-09-14");
  expect(String(fetch.mock.calls[3][0])).toContain("before=2026-09-28");
  await act(() =>
    result.current.load("history", undefined, result.current.next!),
  );
  expect(result.current.items.map((item) => item.weekStart)).toEqual([
    "2026-10-05",
    "2026-09-28",
    "2026-09-21",
    "2026-09-14",
    "2026-09-07",
  ]);
  await act(() => result.current.load("history", "2026-09-21"));
  await act(() => result.current.refresh());
  expect(result.current.week).toBe("2026-09-21");
  expect(result.current.record?.revision).toBe("new");
  expect(result.current.items).toHaveLength(5);
  expect(String(fetch.mock.calls[6][0])).toContain("weekStart=2026-09-21");
});

it("keeps the pending history destination and ignores late list results after a newer detail", async () => {
  const first = deferred();
  const fetch = vi
    .fn()
    .mockReturnValueOnce(first.promise)
    .mockResolvedValueOnce(response({ record: { revision: "detail" } }));
  vi.stubGlobal("fetch", fetch);
  const { result } = renderHook(useWeeklyFeature);
  let pending!: Promise<void>;
  act(() => {
    pending = result.current.load("history");
  });
  await act(() => result.current.load("history", "2026-09-21"));
  await act(async () => {
    first.resolve(response({ items: [], next: null }));
    await pending;
  });
  expect(result.current.week).toBe("2026-09-21");
  expect(result.current.record?.revision).toBe("detail");
});

it.each(["title", "Markdown"])(
  "protects %s drafts begun after dispatch, refreshes snapshot for cancel and rejects older responses",
  async (field) => {
    const first = deferred();
    const second = deferred();
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response(general("Initial")))
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    vi.stubGlobal("fetch", fetch);
    const { result } = renderHook(() =>
      useTrainingPlanFeature({ setStatus: vi.fn() }),
    );
    await act(() => result.current.loadTrainingPlan("startup", false));
    let old!: Promise<void>;
    act(() => {
      old = result.current.loadTrainingPlan("manual", false);
    });
    act(() => {
      result.current.startTrainingPlanEdit();
      if (field === "title")
        result.current.setTrainingPlanTitleDraft("Keep title");
      else result.current.setTrainingPlanMarkdownDraft("Keep Markdown");
    });
    let fresh!: Promise<void>;
    act(() => {
      fresh = result.current.loadTrainingPlan("chat-save", false);
    });
    await act(async () => {
      second.resolve(response(general("New saved")));
      await fresh;
    });
    await act(async () => {
      first.resolve(response(general("Old response")));
      await old;
    });
    expect(result.current.trainingPlan?.title).toBe("New saved");
    expect(result.current.trainingPlanTitleDraft).toBe(
      field === "title" ? "Keep title" : "Initial",
    );
    expect(result.current.trainingPlanMarkdownDraft).toBe(
      field === "Markdown" ? "Keep Markdown" : "Initial content",
    );
    expect(result.current.trainingPlanMessage).toContain(
      "unsaved edits were preserved",
    );
    act(() => result.current.cancelTrainingPlanEdit());
    expect(result.current.trainingPlanTitleDraft).toBe("New saved");
    expect(result.current.trainingPlanMarkdownDraft).toBe("New saved content");
    expect(fetch.mock.calls.every((call) => call[1].method === "GET")).toBe(
      true,
    );
  },
);

it.each([200, 500])(
  "does not let a late read (HTTP %s) undo successful save or admit reads during save",
  async (status) => {
    const oldRead = deferred();
    const save = deferred();
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response(general("Initial")))
      .mockReturnValueOnce(oldRead.promise)
      .mockReturnValueOnce(save.promise);
    vi.stubGlobal("fetch", fetch);
    const { result } = renderHook(() =>
      useTrainingPlanFeature({ setStatus: vi.fn() }),
    );
    await act(() => result.current.loadTrainingPlan("startup", false));
    act(() => {
      result.current.startTrainingPlanEdit();
      result.current.setTrainingPlanTitleDraft("Explicit save");
    });
    let read!: Promise<void>;
    let saving!: Promise<void>;
    act(() => {
      read = result.current.loadTrainingPlan("manual", false);
      saving = result.current.saveTrainingPlan();
    });
    await act(() => result.current.loadTrainingPlan("chat-save", false));
    await act(async () => {
      save.resolve(response(general("Explicit save")));
      await saving;
    });
    await act(async () => {
      oldRead.resolve(
        response(
          status === 200 ? general("Old saved") : { error: "Late error" },
          status,
        ),
      );
      await read;
    });
    expect(result.current.trainingPlan?.title).toBe("Explicit save");
    expect(result.current.trainingPlanState).toBe("loaded");
    expect(result.current.trainingPlanEditing).toBe(false);
    expect(result.current.trainingPlanMessage).toContain("saved and rendered");
    expect(fetch).toHaveBeenCalledTimes(3);
  },
);

it("revalidates actual shell destinations on repeated navigation and retains hidden drafts without request loops", async () => {
  let version = 1;
  const fetch = vi.fn((input: RequestInfo | URL, _init?: RequestInit) => {
    const url = String(input);
    if (url === "/api/training-plan")
      return Promise.resolve(response(general(`General ${version}`)));
    if (url.startsWith("/api/weekly?")) {
      const query = new URL(url, "http://localhost").searchParams;
      if (query.has("before"))
        return Promise.resolve(
          response({
            items: [
              {
                weekStart: "2026-09-21",
                hasPlan: true,
                hasReview: version % 2 === 0,
              },
            ],
            next: null,
          }),
        );
      return Promise.resolve(
        response({
          record: {
            weekStart: query.get("weekStart"),
            timeZone: "UTC",
            revision: `r${version}`,
            original: doc,
            latest: {
              ...doc,
              title: `Weekly ${version}`,
              contentMarkdown: `Version ${version}`,
            },
            review: null,
          },
        }),
      );
    }
    if (url.startsWith("/api/chat"))
      return Promise.resolve(
        response({
          conversationId: "default",
          messages: [],
          contextWindow: 0,
          historyLimit: 12,
        }),
      );
    return Promise.resolve(response({ conversations: [], memories: [] }));
  });
  vi.stubGlobal("fetch", fetch);
  const { rerender } = render(<TrainerDashboard />);
  const open = () =>
    fireEvent.click(screen.getByRole("button", { name: "Training Plan" }));
  const close = () =>
    fireEvent.click(screen.getByRole("button", { name: "Back to chat" }));
  open();
  await screen.findByText("Version 1");
  expect(document.activeElement).toBe(
    screen.getByRole("button", { name: "Back to chat" }),
  );
  for (const tab of ["This Week", "Upcoming", "History"]) {
    fireEvent.click(screen.getByRole("button", { name: tab }));
    if (tab === "History") {
      await screen.findByRole("button", { name: /2026-09-21.*No review/ });
      close();
      version++;
      open();
      fireEvent.click(
        await screen.findByRole("button", { name: /2026-09-21.*Review/ }),
      );
    }
    await screen.findByText(`Version ${version}`);
    close();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Training Plan" }),
    );
    version++;
    open();
    await screen.findByText(`Version ${version}`);
    expect(
      screen.getByRole("button", { name: tab }).getAttribute("aria-pressed"),
    ).toBe("true");
    if (tab === "History")
      expect(screen.getByText("2026-09-21 – 2026-09-27")).toBeTruthy();
  }
  version++;
  fireEvent.click(screen.getByRole("button", { name: "General Plan" }));
  await screen.findByText(`General ${version} content`);
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  fireEvent.change(screen.getByLabelText("Title"), {
    target: { value: "Retained title" },
  });
  fireEvent.change(screen.getByLabelText("Markdown plan"), {
    target: { value: "Retained Markdown" },
  });
  close();
  version++;
  open();
  await screen.findByText(/unsaved edits were preserved/);
  expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe(
    "Retained title",
  );
  expect(
    (screen.getByLabelText("Markdown plan") as HTMLTextAreaElement).value,
  ).toBe("Retained Markdown");
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  await screen.findByText(`General ${version} content`);
  const count = fetch.mock.calls.length;
  rerender(<TrainerDashboard />);
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(count));
  expect(fetch.mock.calls.some(([, init]) => init?.method === "PUT")).toBe(
    false,
  );
});

it("retains historical civil selection on calendar rollover and advances Upcoming to the new current week", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-21T12:00:00Z"));
  const fetch = vi
    .fn()
    .mockImplementation(() => Promise.resolve(response({ record: null })));
  vi.stubGlobal("fetch", fetch);
  const { result } = renderHook(useWeeklyFeature);
  await act(() => result.current.load("history", "2026-09-21"));
  vi.setSystemTime(new Date("2026-10-28T12:00:00Z"));
  await act(async () => {
    window.dispatchEvent(new Event("focus"));
  });
  expect(result.current.mode).toBe("history");
  expect(result.current.week).toBe("2026-09-21");
  expect(String(fetch.mock.calls.at(-1)?.[0])).toContain(
    "weekStart=2026-09-21",
  );
  await act(() => result.current.load("upcoming"));
  vi.setSystemTime(new Date("2026-11-04T12:00:00Z"));
  await act(async () => {
    window.dispatchEvent(new Event("focus"));
  });
  expect(result.current.mode).toBe("current");
  expect(result.current.week).toBe("2026-11-02");
});
