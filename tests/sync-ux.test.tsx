/** @vitest-environment jsdom */
import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  within,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useSyncFeature } from "../src/app/dashboard/use-sync";
import { SyncView } from "../src/app/dashboard/sync-view";
import {
  formatSyncFinalMessage,
  formatSyncCounts,
  formatSyncResultLine,
} from "../src/app/dashboard/sync-presentation";
import {
  emptyAthleteBaseline,
  emptyBodyMetrics,
  emptySyncRun,
  type ImportSummaryPayload,
} from "../src/app/dashboard/contracts";

const summary = (
  state: "available" | "complete" = "available",
): ImportSummaryPayload => ({
  activities: 8,
  healthDays: 20,
  detailedActivities: 0,
  athleteBaseline: emptyAthleteBaseline,
  bodyMetrics: emptyBodyMetrics,
  syncActive: false,
  sync: {
    latest: null,
    historical: {
      state,
      action: state === "available" ? "continue" : null,
      next:
        state === "available" ? { family: "health", date: "2026-09-01" } : null,
      limit: "2026-09-01",
      remoteLowerBound: null,
      interrupted: false,
      reason:
        state === "available"
          ? "Older work is available within the selected exploration scope."
          : "Selected exploration range checked. Remote earliest history remains unknown.",
    },
  },
});
const response = (value: unknown) => new Response(JSON.stringify(value));
const ports = () => ({
  setStatus: vi.fn(),
  refreshHealthAfterSync: vi.fn(async () => {}),
  runAction: vi.fn(async () => {}),
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const recoveryReason =
  "Saved history or its selected limit needs recovery. Preserve checkpoints; do not reset or replay.";
function mixedSummary(): ImportSummaryPayload {
  const value = summary();
  value.sync!.latest = {
    version: 1,
    outcome: "settled",
    updatedAt: "2026-11-06T20:00:00Z",
    activitiesProcessed: 6,
    healthDaysRefreshed: 14,
  };
  value.sync!.historical = {
    ...value.sync!.historical,
    state: "blocked",
    action: null,
    next: null,
    reason: recoveryReason,
  };
  return value;
}
function SyncHarness({ visible = true }: { visible?: boolean }) {
  const sync = useSyncFeature(ports());
  const load = React.useEffectEvent(() =>
    sync.loadImportSummary("startup", false),
  );
  const background = (work: Promise<unknown>) => {
    work.catch((error: unknown) => {
      throw error;
    });
  };
  React.useEffect(() => {
    background(load());
  }, []);
  return (
    <>
      <button onClick={() => background(sync.refreshSummary())}>
        Test refresh
      </button>
      {visible ? (
        <SyncView
          {...sync}
          closeSyncView={vi.fn()}
          syncCloseRef={{ current: null }}
          syncLogRef={{ current: null }}
          runInBackground={background}
          runAction={vi.fn()}
          status={{ kind: "idle", message: "Ready" }}
        />
      ) : null}
    </>
  );
}

describe("concise Sync presentation", () => {
  it("separates fresh and reloaded 6/14 latest success from one visible recovery warning without passive effects", async () => {
    const fetch = vi.fn((url: string) =>
      Promise.resolve(
        url === "/api/sync"
          ? new Response(
              `${JSON.stringify({ type: "result", status: "completed", intent: "latest", activitiesProcessed: 6, healthDaysRefreshed: 14, sync: mixedSummary().sync })}\n`,
            )
          : response(mixedSummary()),
      ),
    );
    vi.stubGlobal("fetch", fetch);
    const view = render(<SyncHarness />);
    await screen.findByText("Latest refresh finished.");
    const card = screen.getByRole("region", { name: "Run Garmin sync" });
    const details = within(card).getByText("Technical details")
      .parentElement as HTMLDetailsElement;
    const disclosure = within(card).getByText("Technical details");
    disclosure.focus();
    expect(document.activeElement).toBe(disclosure);
    expect(details.open).toBe(false);
    expect(
      within(card)
        .getByText("Older history needs attention. See Technical details.")
        .closest("details"),
    ).toBeNull();
    expect(within(card).getAllByText(recoveryReason)).toHaveLength(1);
    expect(within(card).getByText(recoveryReason).closest("details")).toBe(
      details,
    );
    expect(
      within(card).getByText(
        "6 activity records processed · 14 health dates refreshed",
      ),
    ).toBeTruthy();
    expect(
      within(card).queryByRole("button", {
        name: /Continue|Import older|Reset|Replay/,
      }),
    ).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
    fireEvent.click(
      within(card).getByRole("button", {
        name: "Sync now — import latest Garmin data",
      }),
    );
    await waitFor(() =>
      expect(
        within(card).getByLabelText("Current sync progress log").textContent,
      ).toContain("Result: completed"),
    );
    expect(
      within(card).getAllByText(
        "Older history needs attention. See Technical details.",
      ),
    ).toHaveLength(1);
    expect(within(card).getByRole("status").textContent).toBe(
      "Latest refresh finished.",
    );
    expect(
      within(card).getByLabelText("Current sync progress log").textContent,
    ).toContain(recoveryReason);
    expect(details.open).toBe(false);
    // Native details semantics stay intact; hook state survives updates and view remounts.
    details.open = true;
    fireEvent(details, new Event("toggle"));
    fireEvent.click(screen.getByText("Test refresh"));
    await act(async () => {});
    expect(details.open).toBe(true);
    view.rerender(<SyncHarness visible={false} />);
    view.rerender(<SyncHarness />);
    const restored = screen.getByText("Technical details")
      .parentElement as HTMLDetailsElement;
    expect(restored.open).toBe(true);
    restored.open = false;
    fireEvent(restored, new Event("toggle"));
    view.rerender(<SyncHarness visible={false} />);
    view.rerender(<SyncHarness />);
    expect(
      (
        screen.getByText("Technical details")
          .parentElement as HTMLDetailsElement
      ).open,
    ).toBe(false);
    expect(
      fetch.mock.calls.filter(([url]) => url === "/api/sync"),
    ).toHaveLength(1);
  });
  it.each([
    ["completed", "finished"],
    ["failed", "failed"],
    ["cancelled", "cancelled"],
    ["budget-limited", "safety limit"],
    ["running", "interrupted"],
    ["partial", "unknown"],
    [undefined, "unknown"],
  ])(
    "keeps %s distinct without borrowing history diagnostics",
    (status, expected) => {
      const event = {
        intent: "latest" as const,
        status,
        sync: mixedSummary().sync,
      };
      expect(formatSyncFinalMessage(event)).toContain(expected);
      expect(formatSyncFinalMessage(event)).not.toContain(recoveryReason);
      expect(formatSyncResultLine(event)).toContain(recoveryReason);
      expect(formatSyncCounts(event)).toBeUndefined();
    },
  );
  it.each(["failed", "cancelled", "budget-limited", "running"] as const)(
    "renders durable %s honestly after reload",
    async (outcome) => {
      const value = mixedSummary();
      value.sync!.latest!.outcome = outcome;
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => response(value)),
      );
      render(<SyncHarness />);
      await screen.findByText(
        new RegExp(
          `Latest refresh ${outcome === "budget-limited" ? "paused" : outcome === "running" ? "interrupted" : outcome}`,
        ),
      );
      expect(
        screen.getByText(
          "Older history needs attention. See Technical details.",
        ),
      ).toBeTruthy();
      expect(screen.queryByText("Latest refresh finished.")).toBeNull();
    },
  );
  it.each(["partial", "unexpected", undefined])(
    "does not promote an unrecognized %s result into completed or refresh Health",
    async (status) => {
      const fetch = vi.fn((url: string) =>
        Promise.resolve(
          url === "/api/sync"
            ? new Response(`${JSON.stringify({ type: "result", status })}\n`)
            : response(mixedSummary()),
        ),
      );
      vi.stubGlobal("fetch", fetch);
      const dependencies = ports();
      const { result } = renderHook(() => useSyncFeature(dependencies));
      await act(() => result.current.loadImportSummary("startup", false));
      await act(() => result.current.syncNow("latest"));
      expect(result.current.syncRun.kind).toBe("failed");
      expect(result.current.syncRun.failureSummary).toContain(
        "outcome unknown",
      );
      expect(result.current.syncPillLabel).not.toBe("Complete");
      expect(result.current.syncRun.lines.at(-1)?.text).not.toContain(
        "Result: completed",
      );
      expect(dependencies.refreshHealthAfterSync).not.toHaveBeenCalled();
    },
  );
  it("keeps stale summary unconfirmed and disables latest without inviting recovery", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("unavailable")));
    render(<SyncHarness />);
    await act(async () => {});
    expect(
      screen
        .getByRole("button", { name: "Sync now — import latest Garmin data" })
        .hasAttribute("disabled"),
    ).toBe(true);
    expect(
      screen.getByText(
        "Status unavailable. Refresh import summary before syncing.",
      ),
    ).toBeTruthy();
  });
});

describe("truthful Sync UI admission", () => {
  it("dispatches distinct explicit intents, and never treats an unchecked history object as authority", async () => {
    const fetch = vi.fn((url: string) =>
      Promise.resolve(
        url === "/api/sync"
          ? new Response('{"type":"result","status":"completed"}\n')
          : response(summary()),
      ),
    );
    vi.stubGlobal("fetch", fetch);
    const { result } = renderHook(() => useSyncFeature(ports()));
    await act(() => result.current.syncNow());
    expect(fetch).not.toHaveBeenCalled();
    await act(() => result.current.loadImportSummary("startup", false));
    await act(() => result.current.syncNow("latest"));
    await act(() => result.current.syncNow("history"));
    expect(
      fetch.mock.calls
        .filter(([url]) => url === "/api/sync")
        .map((call) =>
          JSON.parse(
            (call as unknown as [string, RequestInit])[1].body as string,
          ),
        ),
    ).toEqual([{ intent: "latest" }, { intent: "history" }]);
  });
  it("retains facts but invalidates stale summary eligibility until an explicit successful refresh", async () => {
    let fails = false;
    const fetch = vi.fn(() =>
      fails
        ? Promise.reject(new Error("unavailable"))
        : Promise.resolve(response(summary())),
    );
    vi.stubGlobal("fetch", fetch);
    const { result } = renderHook(() => useSyncFeature(ports()));
    await act(() => result.current.loadImportSummary("startup", false));
    fails = true;
    await act(() => result.current.refreshSummary());
    expect(result.current.importSummary?.activities).toBe(8);
    expect(result.current.summaryKnown).toBe(false);
    await act(() => result.current.syncNow("history"));
    await act(() => result.current.syncNow("latest"));
    expect(fetch).toHaveBeenCalledTimes(2);
    fails = false;
    await act(() => result.current.refreshSummary());
    expect(result.current.summaryKnown).toBe(true);
  });
  it("ignores superseded summary reads rather than restoring stale continuation", async () => {
    let finish!: (value: Response) => void;
    const fetch = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValue(response(summary("complete")));
    vi.stubGlobal("fetch", fetch);
    const { result } = renderHook(() => useSyncFeature(ports()));
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.loadImportSummary("startup", false);
    });
    await act(() => result.current.refreshSummary());
    await act(async () => {
      finish(response(summary()));
      await pending;
    });
    expect(result.current.importSummary?.sync?.historical.state).toBe(
      "complete",
    );
  });
  it("keeps technical logs collapsed and non-live while concise state and actual history action stay visible", () => {
    const syncNow = vi.fn(async () => {});
    const element = (
      <SyncView
        closeSyncView={vi.fn()}
        syncCloseRef={{ current: null }}
        syncPillKind="idle"
        syncPillLabel="Ready"
        runInBackground={vi.fn()}
        syncNow={syncNow}
        isSyncing={false}
        syncRun={{
          ...emptySyncRun,
          lines: [{ text: "Sanitized diagnostic", severity: "info" }],
        }}
        syncLogRef={{ current: null }}
        importSummary={summary()}
        summaryKnown
        runAction={vi.fn()}
        refreshSummary={vi.fn()}
        detailGarminId=""
        setDetailGarminId={vi.fn()}
        backfillDetail={vi.fn()}
        refreshDetailCoverage={vi.fn()}
        status={{ kind: "idle", message: "Ready" }}
      />
    );
    const view = render(element);
    const log = screen.getByLabelText("Current sync progress log");
    expect(log.closest("details")?.open).toBe(false);
    expect(log.hasAttribute("aria-live")).toBe(false);
    expect(screen.getByText("Technical details").tagName).toBe("SUMMARY");
    expect(
      screen.getByRole("button", { name: "Continue historical import" }),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Sync now — import latest Garmin data",
      }),
    );
    expect(syncNow).toHaveBeenCalledWith("latest");
    fireEvent.click(
      screen.getByRole("button", { name: "Continue historical import" }),
    );
    expect(syncNow).toHaveBeenCalledWith("history");
    view.rerender(
      React.cloneElement(element, { isSyncing: true, summaryKnown: false }),
    );
    expect(
      screen
        .getAllByRole("status")
        .filter((el) => el.classList.contains("sync-current-status")),
    ).toHaveLength(1);
    expect(screen.queryByText(/Summary truth is not confirmed/)).toBeNull();
  });
});
