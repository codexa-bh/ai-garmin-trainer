/** @vitest-environment jsdom */
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  finiteNumberLabel,
  numberLabel,
} from "../src/app/dashboard/formatting";
import { useHealthFeature } from "../src/app/dashboard/use-health";
import { useProfileFeature } from "../src/app/dashboard/use-profile";
import { useSyncFeature } from "../src/app/dashboard/use-sync";
import { syncFailureRecovery } from "../src/app/dashboard/sync-presentation";
import { useTrainingPlanFeature } from "../src/app/dashboard/use-training-plan";

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("independent dashboard feature ownership", () => {
  it("does not fetch merely because a feature owner mounts or rerenders", () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const { rerender } = renderHook(() => {
      useHealthFeature();
      useProfileFeature({ setStatus: vi.fn() });
      useTrainingPlanFeature({ setStatus: vi.fn() });
    });
    rerender();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("preserves the selected Health date when refreshed rows shift", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        response({ days: [{ date: "2026-09-18" }, { date: "2026-09-17" }] }),
      )
      .mockResolvedValueOnce(
        response({
          days: [
            { date: "2026-09-19" },
            { date: "2026-09-18" },
            { date: "2026-09-17" },
          ],
        }),
      );
    vi.stubGlobal("fetch", fetch);
    const { result } = renderHook(useHealthFeature);
    await act(() => result.current.loadHealthDashboard());
    act(() => result.current.setSelectedHealthDayIndex(1));
    await act(() =>
      result.current.loadHealthDashboard({ preserveSelectedDate: true }),
    );
    expect(result.current.selectedHealthDayIndex).toBe(2);
    expect(result.current.healthDashboardState).toBe("loaded");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("keeps Profile edits made while a reload is in flight", async () => {
    let resolve!: (response: Response) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((done) => {
            resolve = done;
          }),
      ),
    );
    const { result } = renderHook(() =>
      useProfileFeature({ setStatus: vi.fn() }),
    );
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.loadProfile("manual");
    });
    act(() => result.current.updateProfileField("goals", "Keep this draft"));
    await act(async () => {
      resolve(
        response({ goals: ["Saved value"], sports: [], constraints: [] }),
      );
      await pending;
    });
    expect(result.current.profileFields.goals).toBe("Keep this draft");
    expect(result.current.isProfileDirty).toBe(true);
    expect(result.current.profileMessage).toContain("edits were preserved");
  });

  it("keeps Training Plan drafts on failed saves and restores saved text on cancel", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          response({
            plan: {
              title: "Saved plan",
              contentMarkdown: "Saved text",
              revisedAt: null,
            },
            stale: false,
            staleAfterDays: 14,
          }),
        )
        .mockResolvedValueOnce(response({ error: "Unavailable" }, 503)),
    );
    const { result } = renderHook(() =>
      useTrainingPlanFeature({ setStatus: vi.fn() }),
    );
    await act(() => result.current.loadTrainingPlan("startup", false));
    act(() => result.current.startTrainingPlanEdit());
    act(() => result.current.setTrainingPlanMarkdownDraft("Draft text"));
    await act(() => result.current.saveTrainingPlan());
    expect(result.current.trainingPlanMarkdownDraft).toBe("Draft text");
    expect(result.current.trainingPlanEditing).toBe(true);
    act(() => result.current.cancelTrainingPlanEdit());
    expect(result.current.trainingPlanMarkdownDraft).toBe("Saved text");
    expect(result.current.trainingPlanEditing).toBe(false);
  });

  it("deduplicates sync starts and refreshes summary before the Health callback", async () => {
    const order: string[] = [];
    let finish!: (response: Response) => void;
    const fetch = vi.fn((url: string) => {
      order.push(url);
      if (url === "/api/sync")
        return new Promise<Response>((resolve) => {
          finish = resolve;
        });
      return Promise.resolve(response({ activities: 0, healthDays: 0 }));
    });
    vi.stubGlobal("fetch", fetch);
    const refreshHealthAfterSync = vi.fn(() => {
      order.push("health");
      return Promise.resolve();
    });
    const { result } = renderHook(() =>
      useSyncFeature({
        setStatus: vi.fn(),
        refreshHealthAfterSync,
        runAction: vi.fn(),
      }),
    );
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.syncNow();
    });
    await act(() => result.current.syncNow());
    expect(fetch).toHaveBeenCalledTimes(1);
    await act(async () => {
      finish(new Response('{"type":"result","status":"completed"}\n'));
      await pending;
    });
    expect(order).toEqual(["/api/sync", "/api/summary", "health"]);
    expect(result.current.syncRun.kind).toBe("completed");
    expect(result.current.isSyncing).toBe(false);
  });

  it.each([
    [
      "Garmin connector request failed; upstream details are withheld to protect credentials and local paths.",
      "connector",
    ],
    [
      "Garmin MCP exited with code 1. Garmin connector request failed; upstream details are withheld to protect credentials and local paths.",
      "connector",
    ],
    [
      "Garmin MCP exited with code null. Garmin service rate-limited the request; retry later, not reauthentication.",
      "rate-limit",
    ],
    [
      "Garmin connection or service is unavailable; authentication validity is inconclusive.",
      "network",
    ],
    [
      "Garmin authentication could not be verified; check the configured store and perform a separate live verification before requesting reauthentication.",
      "auth",
    ],
    [
      "Set a literal GARMIN_MCP_TOKEN_DIR in .env.local; no alternate location is searched.",
      "auth",
    ],
    ["Configured token location must be a directory, not a symlink.", "auth"],
    [
      "Expected Garmin token file must be a regular file, not a symlink.",
      "auth",
    ],
    [
      "Expected Garmin token file is empty; repair the selected store before live verification.",
      "auth",
    ],
    [
      "Configured Garmin token directory or expected file is missing; repair this location, then perform a separate live verification.",
      "auth",
    ],
    [
      "Configured Garmin auth state is inaccessible; check file types and private permissions. No token contents were read.",
      "auth",
    ],
    ["Application token counter failed", null],
    ["Garmin MCP exited with code 1. Unknown failure", null],
    [undefined, null],
  ] as const)(
    "classifies only recognized sanitized failure vocabulary: %s",
    (detail, expected) => {
      expect(syncFailureRecovery(detail)).toBe(expected);
    },
  );

  it.each([
    {
      name: "failed result without progress",
      body: '{"type":"result","status":"failed","detail":"Garmin connector request failed; upstream details are withheld to protect credentials and local paths."}\n',
      recovery: "connector",
    },
    {
      name: "failed progress with detail-less result",
      body: '{"stage":"failed","message":"Garmin connector request failed; upstream details are withheld to protect credentials and local paths."}\n{"type":"result","status":"failed"}\n',
      recovery: "connector",
    },
    {
      name: "failed progress without result",
      body: '{"stage":"failed"}\n',
      recovery: null,
    },
    {
      name: "missing detail",
      body: '{"type":"result","status":"failed"}\n',
      recovery: null,
    },
    {
      name: "unrelated error",
      body: '{"type":"result","status":"failed","detail":"Application token counter failed"}\n',
      recovery: null,
    },
    {
      name: "malformed response",
      body: "not JSON token auth\n",
      recovery: null,
    },
    {
      name: "unrelated HTTP",
      body: '{"status":"blocked","detail":"Expected Garmin token file is empty; repair the selected store before live verification."}',
      http: 500,
      recovery: null,
    },
    {
      name: "unrelated 409",
      body: '{"status":"blocked","detail":"Application token counter failed"}',
      http: 409,
      recovery: null,
    },
    { name: "thrown fetch", body: "", throws: true, recovery: null },
  ])(
    "keeps failure severity separate from login eligibility: $name",
    async ({ body, http, throws, recovery }) => {
      const fetch = vi.fn((url: string) => {
        if (url === "/api/sync") {
          if (throws)
            return Promise.reject(new Error("Private diagnostic token auth"));
          return Promise.resolve(new Response(body, { status: http ?? 200 }));
        }
        return Promise.resolve(response({ activities: 0, healthDays: 0 }));
      });
      vi.stubGlobal("fetch", fetch);
      const refreshHealthAfterSync = vi.fn();
      const { result } = renderHook(() =>
        useSyncFeature({
          setStatus: vi.fn(),
          refreshHealthAfterSync,
          runAction: vi.fn(),
        }),
      );
      await act(() => result.current.syncNow());
      expect(result.current.syncRun.kind).toBe("failed");
      expect(
        result.current.syncRun.lines.some((line) => line.severity === "error"),
      ).toBe(true);
      expect(result.current.syncRun.lines[0].severity).toBe("info");
      expect(result.current.syncRun.recovery).toBe(recovery);
      expect(result.current.syncRun.failureSummary).toBeTruthy();
      expect(refreshHealthAfterSync).not.toHaveBeenCalled();
      expect(JSON.stringify(result.current.syncRun)).not.toContain(
        "Private diagnostic",
      );
    },
  );

  it("preserves distinct null and finite-number presentation contracts", () => {
    expect(numberLabel(null)).toBe("Unavailable");
    expect(numberLabel(0)).toBe("0");
    expect(finiteNumberLabel(Number.NaN)).toBe("Unavailable");
    expect(finiteNumberLabel(0, 1)).toBe("0.0");
  });
});
