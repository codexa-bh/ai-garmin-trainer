// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import {
  WeeklyKpiScorecard,
  kpiValue,
} from "../src/app/dashboard/weekly-kpi-scorecard";
import { WeeklyPlanView } from "../src/app/dashboard/weekly-plan-view";
import { useWeeklyFeature } from "../src/app/dashboard/use-weekly";
import type { KpiRead } from "../src/lib/weekly/kpi-contracts";

const sample: KpiRead = {
  weekStart: "2026-11-09",
  revision: "state",
  timeZone: "UTC",
  originalId: "original",
  latestId: "original",
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
          scoring: "Per-measurement allocations, no automatic attainment",
          tracks: [
            {
              key: "count",
              kind: "numeric",
              unit: "sessions",
              meaning: "Selected session count",
              target: { comparator: "at-least", value: 2 },
              availablePoints: 60,
            },
            {
              key: "time",
              kind: "numeric",
              unit: "minutes",
              meaning: "Selected session duration",
              target: null,
              availablePoints: 40,
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
            { trackKey: "count", value: 0, awardedPoints: 0 },
            { trackKey: "time", value: null, awardedPoints: 0 },
          ],
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
it("formats duration fractions and finite display values without changing stored precision", () => {
  expect(kpiValue(74.125, "min")).toBe("1 h 14 min 7.5 s");
  expect(kpiValue(15.25, "sec")).toBe("15.25 s");
  expect(kpiValue(0, "minutes")).toBe("0 min");
  expect(kpiValue(7.333333333333, "m")).toBe("7.33 m");
  expect(kpiValue(Number.POSITIVE_INFINITY, "m")).toBe("Unknown");
});

it("renders one numeric measurement per row with its own points, zero/unknown and the unchanged saved total", () => {
  render(<WeeklyKpiScorecard kpis={sample} loadSet={vi.fn()} />);
  const table = screen.getByRole("table") as HTMLTableElement;
  expect(table.tBodies[0].rows).toHaveLength(2);
  expect(
    within(table)
      .getAllByRole("rowheader")
      .map((row) => row.textContent),
  ).toEqual([
    "Qualifying sessions · sessions",
    "Qualifying sessions · minutes",
    "Total",
  ]);
  expect(
    [...table.tBodies[0].rows].map((row) => row.cells[3].textContent),
  ).toEqual(["0 / 60", "0 / 40"]);
  expect(table.querySelector("[rowspan]")).toBeNull();
  expect(screen.queryByText("Shared")).toBeNull();
  expect(
    screen.getAllByRole("columnheader").map((value) => value.textContent),
  ).toEqual(["KPI", "Target", "Actual", "Points"]);
  expect(screen.getByText("112.5 / 100 points · 112.5%")).toBeTruthy();
  expect(screen.queryByText("Original commitment")).toBeNull();
  expect(screen.queryByRole("combobox")).toBeNull();
  expect(screen.getByText(/0 sessions/)).toBeTruthy();
  expect(screen.getByText("Unknown")).toBeTruthy();
  expect(screen.queryByText("Scoring and evidence")).toBeNull();
  expect(screen.getByText(/Missing duration, not zero/)).toBeTruthy();
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(
    screen.queryByRole("button", { name: /Discuss|assess.*chat/ }),
  ).toBeNull();
});
it("keeps boolean conditions out of normal target/actual rows without modifying saved evidence or points", () => {
  const data = structuredClone(sample);
  data.sets[0].items[0].tracks.push({
    key: "condition",
    kind: "qualifying",
    unit: "qualification",
    meaning: "Authored saved condition, not a numeric measurement.",
    target: { comparator: "equal", value: true },
  });
  data.assessments[0].items[0].actuals.push({
    trackKey: "condition",
    value: true,
  });
  const original = JSON.stringify(data);
  render(<WeeklyKpiScorecard kpis={data} loadSet={vi.fn()} />);
  const table = screen.getByRole("table") as HTMLTableElement;
  expect(table.tBodies[0].rows).toHaveLength(2);
  expect(within(table).queryByText(/^(Yes|No)$/)).toBeNull();
  expect(
    within(table).queryByRole("rowheader", { name: /qualification/i }),
  ).toBeNull();
  expect(screen.getByText("0 / 60")).toBeTruthy();
  expect(screen.queryByText("Scoring and evidence")).toBeNull();
  expect(data.sets[0].items[0].tracks.at(-1)?.meaning).toBe(
    "Authored saved condition, not a numeric measurement.",
  );
  expect(JSON.stringify(data)).toBe(original);
});
it("retains condition-only legacy allocations in a concise summary and total, not as boolean KPI rows", () => {
  const data = structuredClone(sample);
  const item = data.sets[0].items[0];
  item.label = "Recorded condition";
  item.availablePoints = 100;
  item.tracks = [
    {
      key: "condition",
      kind: "qualifying",
      unit: "qualification",
      meaning: "Preserved recorded condition.",
      target: { comparator: "equal", value: true },
    },
  ];
  const assessment = data.assessments[0];
  assessment.items[0].actuals = [{ trackKey: "condition", value: true }];
  assessment.items[0].awardedPoints = 100;
  assessment.totalPoints = 100;
  // Legacy condition-only pool, read-only.
  const original = JSON.stringify(data);
  render(<WeeklyKpiScorecard kpis={data} loadSet={vi.fn()} />);
  const table = screen.getByRole("table") as HTMLTableElement;
  expect(table.tBodies[0].rows).toHaveLength(0);
  expect(within(table).queryByText(/^(Yes|No)$/)).toBeNull();
  expect(within(table).getByText("100 / 100 points · 100%")).toBeTruthy();
  expect(
    screen.getByText("Recorded condition: 100 / 100 conditional points.", {
      exact: false,
    }),
  ).toBeTruthy();
  expect(screen.queryByText("Scoring and evidence")).toBeNull();
  expect(JSON.stringify(data)).toBe(original);
});
it("keeps scored rows including zero allocation before monitoring, preserving each group's stored order", () => {
  const data = structuredClone(sample);
  const compound = data.sets[0].items[0];
  const item = (id: string, availablePoints: number | null) => ({
    ...structuredClone(compound),
    id,
    conceptId: id,
    label: id,
    tracks: [{ ...structuredClone(compound.tracks[0]), availablePoints }],
  });
  data.sets[0].items = [
    item("Monitor first", null),
    item("Zero allocation", 0),
    compound,
    item("Monitor last", null),
  ];
  data.assessments = [];
  const original = JSON.stringify(data);
  render(<WeeklyKpiScorecard kpis={data} loadSet={vi.fn()} />);
  expect(
    within(screen.getByRole("table"))
      .getAllByRole("rowheader")
      .map((row) => row.textContent),
  ).toEqual([
    "Zero allocation",
    "Qualifying sessions · sessions",
    "Qualifying sessions · minutes",
    "Monitor firstMonitoring",
    "Monitor lastMonitoring",
    "Total",
  ]);
  expect(JSON.stringify(data)).toBe(original);
});
it("orders a monitoring measurement of a scored KPI after scored rows and shows no points for it", () => {
  const data = structuredClone(sample);
  delete data.sets[0].items[0].tracks[1].availablePoints;
  delete data.assessments[0].items[0].actuals[1].awardedPoints;
  data.assessments[0].extras = [
    {
      label: "Authored extra",
      points: 5,
      explanation: "Relevant extra",
      evidence: data.assessments[0].items[0].evidence,
    },
  ];
  render(<WeeklyKpiScorecard kpis={data} loadSet={vi.fn()} />);
  const table = screen.getByRole("table") as HTMLTableElement;
  expect(
    [...table.tBodies[0].rows].map((row) => [
      row.cells[0].textContent,
      row.cells.length === 4
        ? row.cells[3].textContent
        : row.cells[2].textContent,
    ]),
  ).toEqual([
    ["Qualifying sessions · sessions", "0 / 60"],
    ["Authored extra", "+5"],
    ["Qualifying sessions · minutesMonitoring", "—"],
  ]);
  expect(screen.getByText("112.5 / 60 points · 187.5%")).toBeTruthy();
});
it("shows an unmapped legacy multi-measurement pool once as combined points, not split or Shared", () => {
  const data = structuredClone(sample);
  const item = data.sets[0].items[0];
  for (const track of item.tracks) delete track.availablePoints;
  item.availablePoints = 100;
  const result = data.assessments[0].items[0];
  for (const actual of result.actuals) delete actual.awardedPoints;
  result.awardedPoints = 0;
  render(<WeeklyKpiScorecard kpis={data} loadSet={vi.fn()} />);
  const table = screen.getByRole("table") as HTMLTableElement;
  expect(
    [...table.tBodies[0].rows].map((row) => row.cells[0].textContent),
  ).toEqual([
    "Qualifying sessions · sessions",
    "Qualifying sessions · minutes",
    "Qualifying sessions · combined points",
  ]);
  expect(screen.getAllByText("0 / 100")).toHaveLength(1);
  expect(screen.getAllByText("—")).toHaveLength(3);
  expect(screen.getByText("Saved before per-measurement points")).toBeTruthy();
  expect(screen.queryByText("Shared")).toBeNull();
  expect(table.querySelector("[rowspan]")).toBeNull();
  expect(screen.getByText("112.5 / 100 points · 112.5%")).toBeTruthy();
});
it("distinguishes empty, unassessed and incomplete latest-plan reads without obsolete fallback", () => {
  const { rerender } = render(
    <WeeklyKpiScorecard kpis={null} loadSet={vi.fn()} />,
  );
  expect(screen.getByText(/No KPIs saved for this plan/)).toBeTruthy();
  rerender(
    <WeeklyKpiScorecard
      kpis={{ ...sample, assessments: [] }}
      loadSet={vi.fn()}
    />,
  );
  expect(screen.getByText(/Not assessed — not a zero/)).toBeTruthy();
  rerender(
    <WeeklyKpiScorecard
      kpis={{ ...sample, complete: false, sets: [], assessments: [] }}
      loadSet={vi.fn()}
    />,
  );
  expect(screen.getByRole("status").textContent).toContain("complete read");
  rerender(
    <WeeklyKpiScorecard
      kpis={{ ...sample, latestId: "missing-new-targets" }}
      loadSet={vi.fn()}
    />,
  );
  expect(screen.queryByText(/112.5/)).toBeNull();
  expect(screen.getByText(/No KPIs saved for this plan/)).toBeTruthy();
});
it("automatically narrows incomplete latest reads and refreshes new targets rather than pinning an obsolete selection", async () => {
  let latest = "first-latest";
  const requests: URLSearchParams[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const query = new URL(url, "http://localhost").searchParams;
      requests.push(query);
      return Response.json({
        record: null,
        kpis: query.get("setId")
          ? {
              ...sample,
              latestId: latest,
              latestPlanSetId: latest,
              sets: [{ ...sample.sets[0], id: latest }],
              assessments: [],
            }
          : {
              ...sample,
              latestId: latest,
              latestPlanSetId: latest,
              complete: false,
              sets: [],
              assessments: [],
            },
      });
    }),
  );
  const { result } = renderHook(useWeeklyFeature);
  await act(() => result.current.load("current"));
  expect(result.current.kpis).toMatchObject({
    complete: true,
    latestPlanSetId: latest,
  });
  latest = "newer-latest";
  await act(() => result.current.refresh());
  expect(result.current.kpis?.sets[0].id).toBe(latest);
  expect(requests.map((query) => query.get("setId"))).toEqual([
    null,
    "first-latest",
    null,
    "newer-latest",
  ]);
});

it("rejects a late automatic narrowing response after a newer selected week", async () => {
  let finish!: (value: Response) => void;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const query = new URL(url, "http://localhost").searchParams;
      if (query.has("setId"))
        return new Promise<Response>((resolve) => {
          finish = resolve;
        });
      if (query.get("weekStart") === "2026-10-26")
        return Response.json({
          record: { revision: "selected" },
          kpis: sample,
        });
      return Response.json({
        record: null,
        kpis: {
          ...sample,
          latestPlanSetId: "narrow",
          complete: false,
          sets: [],
        },
      });
    }),
  );
  const { result } = renderHook(useWeeklyFeature);
  let pending!: Promise<void>;
  act(() => {
    pending = result.current.load("current");
  });
  await waitFor(() => expect(finish).toBeTypeOf("function"));
  await act(() => result.current.load("history", "2026-10-26"));
  await act(async () => {
    finish(Response.json({ record: { revision: "obsolete" }, kpis: sample }));
    await pending;
  });
  expect(result.current.week).toBe("2026-10-26");
  expect(result.current.record?.revision).toBe("selected");
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
        <button onClick={() => run(weekly.loadProgress("1m"))}>Range</button>
        <WeeklyPlanView
          weekly={weekly}
          openGeneral={async () => {}}
          close={() => {}}
          closeRef={{ current: null }}
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
  await screen.findByRole("heading", { name: "Weekly achievement" });
  expect(screen.getByRole("combobox", { name: "Period" })).toHaveProperty(
    "value",
    "1m",
  );
  expect(
    screen.queryByRole("button", { name: /Reload|Load range/ }),
  ).toBeNull();
  fireEvent.change(screen.getByRole("combobox", { name: "Period" }), {
    target: { value: "12m" },
  });
  await waitFor(() =>
    expect(requests.filter((r) => r.includes("view=progress"))).toHaveLength(2),
  );
  expect(screen.getByRole("combobox", { name: "Period" })).toHaveProperty(
    "value",
    "12m",
  );
});
