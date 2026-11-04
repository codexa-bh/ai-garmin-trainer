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
import { useSyncFeature } from "../src/app/dashboard/use-sync";
import { SyncView } from "../src/app/dashboard/sync-view";
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
      screen.getByText(
        "A sync is active. Wait for settlement, then refresh summary.",
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/Summary truth is not confirmed/)).toBeNull();
  });
});
