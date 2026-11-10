// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { WeeklyKpiScorecard } from "../src/app/dashboard/weekly-kpi-scorecard";
import { WeeklyPlanView } from "../src/app/dashboard/weekly-plan-view";
import { useWeeklyFeature } from "../src/app/dashboard/use-weekly";
import type { KpiRead } from "../src/lib/weekly/kpi-contracts";

const sample: KpiRead = {
  weekStart: "2026-11-09",
  revision: "state",
  timeZone: "UTC",
  originalId: "original",
  latestId: "adapted",
  reviewDefinedId: null,
  complete: true,
  availableSets: [
    { id: "original", origin: "planned", savedAt: "2026-11-08T12:00:00Z" },
  ],
  sets: [
    {
      id: "original",
      origin: "planned",
      savedAt: "2026-11-08T12:00:00Z",
      provenance: "Authored synthetic agreement",
      items: [
        {
          id: "compound",
          conceptId: "sessions",
          label: "Qualifying sessions",
          definition: "Count and duration of the same selected sessions",
          selection: "Exclude repeated references",
          evidenceRequired: "Reported source",
          availablePoints: 100,
          scoring: "One allocation, no automatic attainment",
          tracks: [
            {
              key: "count",
              kind: "numeric",
              unit: "sessions",
              meaning: "Selected session count",
              target: { comparator: "at-least", value: 2 },
            },
            {
              key: "time",
              kind: "numeric",
              unit: "minutes",
              meaning: "Selected session duration",
              target: null,
            },
          ],
        },
      ],
    },
  ],
  assessments: [
    {
      setId: "original",
      revision: "assessment",
      savedAt: "2026-11-10T10:00:00Z",
      asOf: "2026-11-10T09:00:00Z",
      status: "provisional",
      totalPoints: 112.5,
      explanation: "Model-explained extra credit, not automatic bonus",
      extras: [],
      items: [
        {
          itemId: "compound",
          actuals: [
            { trackKey: "count", value: 0 },
            { trackKey: "time", value: null },
          ],
          awardedPoints: 0,
          explanation: "Remaining commitment disclosed",
          status: "provisional",
          evidence: {
            origin: "user-report",
            references: ["Synthetic user report"],
            qualification: "Qualification provisional",
            limitations: "Missing duration, not zero",
          },
        },
      ],
    },
  ],
};
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("exposes original/compound allocation, zero/unknown, above100 and evidence without a manual editor", () => {
  const discuss = vi.fn();
  render(
    <WeeklyKpiScorecard kpis={sample} loadSet={vi.fn()} discuss={discuss} />,
  );
  expect(
    screen.getByRole("heading", { name: "Original commitment" }),
  ).toBeTruthy();
  expect(screen.getByText(/Recorded total: 112.5/)).toBeTruthy();
  expect(
    screen.getByText(/100 available points \(one allocation/),
  ).toBeTruthy();
  expect(screen.getByText(/0 sessions/)).toBeTruthy();
  expect(screen.getByText(/Recorded actual: Unknown/)).toBeTruthy();
  fireEvent.click(screen.getByText(/Definition, scoring and evidence/));
  expect(screen.getByText(/Missing duration, not zero/)).toBeTruthy();
  expect(screen.queryByRole("textbox")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /Discuss \/ assess/ }));
  expect(discuss).toHaveBeenCalledOnce();
});
it("distinguishes empty, unassessed and incomplete baseline reads", () => {
  const { rerender } = render(
    <WeeklyKpiScorecard kpis={null} loadSet={vi.fn()} discuss={vi.fn()} />,
  );
  expect(screen.getByText(/No structured KPIs saved/)).toBeTruthy();
  rerender(
    <WeeklyKpiScorecard
      kpis={{ ...sample, assessments: [] }}
      loadSet={vi.fn()}
      discuss={vi.fn()}
    />,
  );
  expect(screen.getByText(/Not assessed. This is not a zero/)).toBeTruthy();
  rerender(
    <WeeklyKpiScorecard
      kpis={{ ...sample, complete: false, sets: [], assessments: [] }}
      loadSet={vi.fn()}
      discuss={vi.fn()}
    />,
  );
  expect(screen.getByRole("status").textContent).toContain("too large");
});
it("reads progress/weekly selection without writes, retains range and ignores stale selected-week responses", async () => {
  const requests: string[] = [];
  let resolveOld: (response: Response) => void = () => {};
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      expect(init?.method ?? "GET").toBe("GET");
      requests.push(url);
      const query = new URL(url, "http://localhost").searchParams;
      if (query.get("weekStart") === "2026-10-26")
        return new Promise<Response>((resolve) => {
          resolveOld = resolve;
        });
      return Promise.resolve(
        Response.json(
          query.get("view") === "progress"
            ? { from: "2026-11-02", through: "2026-11-09", weeks: [] }
            : { record: null, kpis: sample },
        ),
      );
    }),
  );
  function Test() {
    const weekly = useWeeklyFeature();
    const run = (work: Promise<unknown>) => {
      work.catch(() => {
        throw new Error("Unexpected test action failure");
      });
    };
    return (
      <>
        <button onClick={() => run(weekly.load("history", "2026-10-26"))}>
          Old
        </button>
        <button onClick={() => run(weekly.load("history", "2026-11-09"))}>
          New
        </button>
        <button
          onClick={() => run(weekly.loadProgress("2026-11-02", "2026-11-09"))}
        >
          Range
        </button>
        <WeeklyPlanView
          weekly={weekly}
          openGeneral={async () => {}}
          close={() => {}}
          closeRef={{ current: null }}
          startChat={() => {}}
          run={run}
        >
          {null}
        </WeeklyPlanView>
      </>
    );
  }
  render(<Test />);
  fireEvent.click(screen.getByText("Old"));
  fireEvent.click(screen.getByText("New"));
  await screen.findByText(/2026-11-09 –/);
  resolveOld(Response.json({ record: null, kpis: { ...sample, sets: [] } }));
  await waitFor(() => expect(screen.getByText(/2026-11-09 –/)).toBeTruthy());
  fireEvent.click(screen.getByText("Range"));
  await screen.findByRole("heading", { name: "Saved weekly progress" });
  expect(screen.getByLabelText("From Monday")).toHaveProperty(
    "value",
    "2026-11-02",
  );
  fireEvent.click(screen.getByRole("button", { name: "Reload weekly plans" }));
  await waitFor(() =>
    expect(requests.filter((r) => r.includes("from=2026-11-02"))).toHaveLength(
      2,
    ),
  );
});
