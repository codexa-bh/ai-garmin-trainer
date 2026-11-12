// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { WeeklyKpiProgress } from "../src/app/dashboard/weekly-kpi-progress";
import { useWeeklyFeature } from "../src/app/dashboard/use-weekly";
import { projectKpis } from "../src/lib/weekly/kpis";
import { authoredWeeklyKpis } from "../scripts/ci/kpi-fixture";
import type { KpiProgress } from "../src/lib/weekly/kpi-contracts";

vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  LineChart: ({
    children,
    data,
  }: {
    children: React.ReactNode;
    data: unknown;
  }) => (
    <div data-testid="saved-chart" data-values={JSON.stringify(data)}>
      {children}
    </div>
  ),
  Line: ({ dataKey, name }: { dataKey: string; name: string }) => (
    <span data-testid="chart-line" data-key={dataKey}>
      {name}
    </span>
  ),
  CartesianGrid: () => null,
  Tooltip: () => null,
  XAxis: () => null,
  YAxis: ({ domain }: { domain: unknown }) => (
    <span data-testid="chart-axis" data-domain={JSON.stringify(domain)} />
  ),
}));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const now = new Date("2026-11-11T12:00:00Z");
function progress(): KpiProgress {
  const old = authoredWeeklyKpis(now);
  old.latestId = old.originalId;
  const latest = authoredWeeklyKpis(now);
  latest.sets[0].items[0].conceptId = "obsolete-only";
  latest.sets[0].items[0].label = "Historical-only option";
  return {
    from: "2026-10-26",
    through: "2026-11-09",
    weeks: [
      { weekStart: "2026-10-26", kpis: projectKpis("2026-10-26", old) },
      { weekStart: "2026-11-02", kpis: projectKpis("2026-11-02", null) },
      { weekStart: "2026-11-09", kpis: projectKpis("2026-11-09", latest) },
    ],
    latestPlan: projectKpis("2026-11-16", latest),
  };
}
function setup(get: () => KpiProgress) {
  const openWeek = vi.fn();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.method ?? "GET").toBe("GET");
      return Response.json(get());
    }),
  );
  function View() {
    const weekly = useWeeklyFeature();
    const run = (work: Promise<unknown>) => {
      work.catch(() => {
        throw new Error("Unexpected read failure");
      });
    };
    return (
      <>
        <button
          onClick={() => run(weekly.loadProgress("2026-10-26", "2026-11-09"))}
        >
          Read progress
        </button>
        <WeeklyKpiProgress weekly={weekly} run={run} openWeek={openWeek} />
      </>
    );
  }
  render(<View />);
  fireEvent.click(screen.getByRole("button", { name: "Read progress" }));
  return { openWeek };
}
it("opens with saved weekly achievement independently of secondary metrics, exact keyboard values and truthful gaps", async () => {
  const { openWeek } = setup(progress);
  await screen.findByRole("option", { name: /2026-10-26.*112.5%/ });
  expect(
    screen.getByRole("heading", { name: "Weekly achievement" }),
  ).toBeTruthy();
  expect(screen.queryByLabelText("Comparison basis")).toBeNull();
  expect(screen.queryAllByRole("button", { name: /open week/ })).toHaveLength(
    0,
  );
  const series = JSON.parse(
    screen.getByTestId("saved-chart").getAttribute("data-values")!,
  );
  expect(
    series.map((value: { percentage: number | null }) => value.percentage),
  ).toEqual([112.5, null, null]);
  fireEvent.change(screen.getByLabelText("Week details"), {
    target: { value: "2026-10-26" },
  });
  expect(screen.getByText(/112.5 \/ 100 points/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Open weekly report" }));
  expect(openWeek).toHaveBeenCalledWith("2026-10-26");
});
it("offers only latest-plan tracks outside the chart range, never unions obsolete entries or chooses a replacement implicitly", async () => {
  let data = progress();
  setup(() => data);
  await screen.findByRole("option", { name: "T0319 authored sessions" });
  const select = screen.getByLabelText("Individual KPI") as HTMLSelectElement;
  expect(select.options.length).toBe(2);
  expect(
    [...select.options].some((value) =>
      /Historical-only|Selected session count/.test(value.text),
    ),
  ).toBe(false);
  expect(select.value).toBe("");
  fireEvent.change(select, { target: { value: "authored-sessions" } });
  expect(screen.getByText("Selected session count")).toBeTruthy();
  const measurement = screen.getByLabelText("Measurement") as HTMLSelectElement;
  expect([...measurement.options].map((option) => option.text)).toEqual([
    "sessions",
    "minutes",
  ]);
  fireEvent.change(measurement, {
    target: { value: "authored-sessions/duration" },
  });
  expect(measurement.value).toBe("authored-sessions/duration");
  data = {
    ...data,
    latestPlan: {
      ...data.latestPlan!,
      sets: [
        {
          ...data.latestPlan!.sets[1],
          items: [
            {
              ...data.latestPlan!.sets[1].items[0],
              conceptId: "replacement",
              label: "Different measurement",
            },
          ],
        },
      ],
    },
  };
  fireEvent.click(screen.getByRole("button", { name: "Read progress" }));
  await screen.findByRole("option", { name: "Different measurement" });
  expect(screen.queryByLabelText("Measurement")).toBeNull();
  expect(
    (screen.getByLabelText("Individual KPI") as HTMLSelectElement).value,
  ).toBe("");
});
it("omits qualifying flags and qualifier-only items without discarding saved conditions or numeric measurements", async () => {
  const data = progress();
  const set = data.latestPlan!.sets[1];
  const qualifier = {
    key: "eligibility",
    kind: "qualifying" as const,
    unit: "qualification",
    meaning: "Recorded eligibility, not an independent numeric measurement.",
    target: { comparator: "equal" as const, value: true },
  };
  set.items[0].tracks.push(qualifier);
  set.items.push({
    ...set.items[0],
    id: "condition",
    conceptId: "condition-only",
    label: "Condition only",
    tracks: [qualifier],
    availablePoints: null,
  });
  const original = JSON.stringify(data);
  setup(() => data);
  await screen.findByRole("option", { name: "T0319 authored sessions" });
  expect(
    screen.queryByRole("option", { name: /qualification|Condition only/ }),
  ).toBeNull();
  fireEvent.change(screen.getByLabelText("Individual KPI"), {
    target: { value: "authored-sessions" },
  });
  expect(
    screen.queryByRole("option", { name: /qualification|eligibility/ }),
  ).toBeNull();
  expect(
    (screen.getByLabelText("Measurement") as HTMLSelectElement).options.length,
  ).toBe(2);
  expect(JSON.stringify(data)).toBe(original);
});
it("plots only target and actual from zero, preserving saved range bounds in accessible text", async () => {
  const data = progress();
  data.weeks[0].kpis.sets[0].items[0].tracks[0].target = {
    comparator: "range",
    value: 2,
    upper: 6,
  };
  setup(() => data);
  await screen.findByRole("option", { name: "T0319 authored sessions" });
  fireEvent.change(screen.getByLabelText("Individual KPI"), {
    target: { value: "authored-sessions" },
  });
  expect(screen.queryByText("Range upper")).toBeNull();
  expect(
    screen
      .getAllByTestId("chart-line")
      .map((line) => line.getAttribute("data-key")),
  ).toEqual(["percentage", "target", "actual"]);
  expect(
    screen.getAllByTestId("chart-axis").at(-1)?.getAttribute("data-domain"),
  ).toBe('[0,"auto"]');
  const values = JSON.parse(
    screen.getAllByTestId("saved-chart").at(-1)!.getAttribute("data-values")!,
  );
  expect(values[0].target).toBe(2);
  expect(values[0].upper).toBeUndefined();
  expect(screen.getByText("2 sessions – 6 sessions")).toBeTruthy();
});
it("keeps main achievement available when the actual latest plan is KPI-free, without resurrecting history or long absent-week rows", async () => {
  const data = progress();
  data.latestPlan = projectKpis("2026-11-16", null);
  setup(() => data);
  await waitFor(() =>
    expect(screen.queryByTestId("saved-chart")).not.toBeNull(),
  );
  expect(screen.queryByLabelText("Individual KPI")).toBeNull();
  expect(
    screen.getByText(/No KPIs in the latest established plan/),
  ).toBeTruthy();
  expect(screen.queryByText(/No saved baseline/)).toBeNull();
});
