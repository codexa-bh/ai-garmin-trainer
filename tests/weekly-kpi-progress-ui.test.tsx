// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { WeeklyKpiProgress } from "../src/app/dashboard/weekly-kpi-progress";
import { useWeeklyFeature } from "../src/app/dashboard/use-weekly";
import { projectKpis } from "../src/lib/weekly/kpis";
import { authoredWeeklyKpis } from "./kpi-fixture";
import type { KpiProgress } from "../src/lib/weekly/kpi-contracts";
import { addDays } from "../src/lib/weekly/calendar";
import { WeeklyPlanView } from "../src/app/dashboard/weekly-plan-view";

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
  vi.useRealTimers();
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
        <button onClick={() => run(weekly.loadProgress("2m"))}>
          Read progress
        </button>
        <WeeklyKpiProgress weekly={weekly} run={run} />
      </>
    );
  }
  render(<View />);
  fireEvent.click(screen.getByRole("button", { name: "Read progress" }));
}
function runRefresh(work: Promise<unknown>) {
  work.catch(() => {
    throw new Error("Unexpected refresh failure");
  });
}
const series = (chart: HTMLElement) =>
  JSON.parse(chart.getAttribute("data-values")!);
it("opens all latest-plan numeric charts, independently of range, with achievement gaps and chart-local exact keyboard values", async () => {
  setup(progress);
  await screen.findByRole("figure", {
    name: /T0319 authored sessions · sessions/,
  });
  const charts = screen.getAllByTestId("saved-chart");
  expect(charts).toHaveLength(3);
  expect(
    series(charts[0]).map(
      (value: { percentage: number | null }) => value.percentage,
    ),
  ).toEqual([112.5, null, null]);
  const achievement = screen.getByRole("figure", {
    name: "Weekly KPI achievement (%)",
  });
  expect(achievement.tabIndex).toBe(0);
  expect(
    document.getElementById(achievement.getAttribute("aria-describedby")!)
      ?.textContent,
  ).toContain("112.5 / 100 points, 112.5%");
  expect(screen.getByText("Individual KPIs").closest("details")?.open).toBe(
    true,
  );
  expect(screen.getByRole("combobox", { name: "Period" })).toHaveProperty(
    "value",
    "2m",
  );
  expect(
    screen.getAllByRole("option").map((option) => option.textContent),
  ).toEqual([
    "Last 1 month",
    "Last 2 months",
    "Last 3 months",
    "Last 6 months",
    "Last 12 months",
  ]);
  expect(document.querySelector("input[type='date']")).toBeNull();
  expect(screen.queryByRole("button", { name: /Load range|Apply/ })).toBeNull();
  expect(
    screen.queryByText(
      /Week details|Choose a saved week|Saved measurement values|Historical-only option/,
    ),
  ).toBeNull();
  expect(
    screen.queryByRole("button", { name: "Open weekly report" }),
  ).toBeNull();
  expect(screen.queryByRole("table")).toBeNull();
});
it("keeps distinct same-unit meanings and condition-only exclusion; refresh changes membership without stale selector state or mutation", async () => {
  let data = progress();
  const set = data.latestPlan!.sets[1];
  const qualifier = {
    key: "eligibility",
    kind: "qualifying" as const,
    unit: "qualification",
    meaning: "Recorded eligibility",
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
  set.items.push({
    ...set.items[0],
    id: "different",
    conceptId: "different",
    label: "Separate counts",
    tracks: [
      {
        ...set.items[0].tracks[0],
        key: "first",
        meaning: "One independent selection",
      },
      {
        ...set.items[0].tracks[0],
        key: "second",
        meaning: "Another independent selection",
      },
    ],
  });
  const original = JSON.stringify(data);
  setup(() => data);
  await screen.findByRole("figure", { name: /Separate counts · first/ });
  expect(screen.getAllByTestId("saved-chart")).toHaveLength(5);
  expect(
    screen.getByRole("figure", { name: /Separate counts · second/ }),
  ).toBeTruthy();
  expect(
    screen.queryByRole("figure", { name: /Condition only|qualification/ }),
  ).toBeNull();
  expect(JSON.stringify(data)).toBe(original);
  data = { ...data, latestPlan: projectKpis("2026-11-16", null) };
  fireEvent.click(screen.getByRole("button", { name: "Read progress" }));
  await screen.findByText(/No KPIs in the latest established plan/);
  expect(screen.getAllByTestId("saved-chart")).toHaveLength(1);
});
it("plots only target and actual from zero; preserves exact range bounds, unknown/zero and qualification in each accessible figure", async () => {
  const data = progress();
  data.weeks[0].kpis.sets[0].items[0].tracks[0].target = {
    comparator: "range",
    value: 2,
    upper: 6,
  };
  setup(() => data);
  const figure = await screen.findByRole("figure", {
    name: /T0319 authored sessions · sessions/,
  });
  expect(
    within(figure)
      .getAllByTestId("chart-line")
      .map((line) => line.getAttribute("data-key")),
  ).toEqual(["target", "actual"]);
  expect(
    within(figure).getByTestId("chart-axis").getAttribute("data-domain"),
  ).toBe('[0,"auto"]');
  const values = series(within(figure).getByTestId("saved-chart"));
  expect(values[0].target).toBe(2);
  expect(values[0].upper).toBeUndefined();
  expect(figure.textContent).toContain("target 2 sessions – 6 sessions");
  expect(figure.textContent).toContain("Unknown");
});
it("keeps achievement for KPI-free latest plan and offers failure-only incomplete read recovery", async () => {
  const data = progress();
  data.latestPlan = { ...projectKpis("2026-11-16", null), complete: false };
  setup(() => data);
  await screen.findByRole("button", { name: "Retry latest KPIs" });
  expect(screen.getAllByTestId("saved-chart")).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "Retry latest KPIs" }));
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
});

function ProgressView() {
  const weekly = useWeeklyFeature();
  return (
    <WeeklyPlanView
      weekly={weekly}
      close={() => {}}
      closeRef={{ current: null }}
      openGeneral={async () => {}}
      run={(work) => {
        work.catch(() => {
          throw new Error("Unexpected Progress test action failure");
        });
      }}
    >
      {null}
    </WeeklyPlanView>
  );
}
function rangedProgress(from: string, through: string): KpiProgress {
  const data = progress();
  const weeks: KpiProgress["weeks"] = [];
  for (let week = from; week <= through; week = addDays(week, 7))
    weeks.push({ weekStart: week, kpis: data.weeks[0].kpis });
  return { ...data, from, through, weeks };
}

it("immediately reloads all charts, keeps the select while loading and ignores superseded responses", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
  const pending: {
    from: string;
    through: string;
    resolve: (value: Response) => void;
  }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      expect(init?.method ?? "GET").toBe("GET");
      const query = new URL(url, "http://localhost").searchParams;
      if (query.get("view") !== "progress")
        return Promise.resolve(Response.json({ record: null }));
      const from = query.get("from")!;
      const through = query.get("through")!;
      return new Promise<Response>((resolve) =>
        pending.push({ from, through, resolve }),
      );
    }),
  );
  render(<ProgressView />);
  fireEvent.click(screen.getByRole("button", { name: "Progress" }));
  expect(pending[0]).toMatchObject({
    from: "2026-09-07",
    through: "2026-11-09",
  });
  await act(async () =>
    pending[0].resolve(
      Response.json(rangedProgress(pending[0].from, pending[0].through)),
    ),
  );
  expect(screen.getAllByTestId("saved-chart")).toHaveLength(3);
  fireEvent.change(screen.getByRole("combobox", { name: "Period" }), {
    target: { value: "1m" },
  });
  expect(screen.getByRole("status").textContent).toContain(
    "Loading saved progress",
  );
  expect(screen.getByRole("combobox", { name: "Period" })).toHaveProperty(
    "value",
    "1m",
  );
  expect(pending[1]).toMatchObject({
    from: "2026-10-05",
    through: "2026-11-09",
  });
  fireEvent.change(screen.getByRole("combobox", { name: "Period" }), {
    target: { value: "3m" },
  });
  expect(pending[2]).toMatchObject({
    from: "2026-08-03",
    through: "2026-11-09",
  });
  fireEvent.change(screen.getByRole("combobox", { name: "Period" }), {
    target: { value: "12m" },
  });
  expect(pending[3]).toMatchObject({
    from: "2025-11-03",
    through: "2026-11-09",
  });
  await act(async () =>
    pending[3].resolve(
      Response.json(rangedProgress(pending[3].from, pending[3].through)),
    ),
  );
  expect(
    screen.getAllByTestId("saved-chart").map((chart) => series(chart).length),
  ).toEqual([54, 54, 54]);
  await act(async () =>
    pending[1].resolve(
      Response.json(rangedProgress(pending[1].from, pending[1].through)),
    ),
  );
  expect(screen.getByRole("combobox", { name: "Period" })).toHaveProperty(
    "value",
    "12m",
  );
  expect(
    screen.getAllByTestId("saved-chart").map((chart) => series(chart).length),
  ).toEqual([54, 54, 54]);
  fireEvent.click(screen.getByRole("button", { name: "Current week" }));
  await screen.findByText(/No KPIs saved for this plan/);
  vi.setSystemTime(new Date("2026-11-18T12:00:00Z"));
  fireEvent.click(screen.getByRole("button", { name: "Progress" }));
  expect(pending[4]).toMatchObject({
    from: "2025-11-10",
    through: "2026-11-16",
  });
  expect(screen.getByRole("combobox", { name: "Period" })).toHaveProperty(
    "value",
    "12m",
  );
  await act(async () =>
    pending[4].resolve(
      Response.json(rangedProgress(pending[4].from, pending[4].through)),
    ),
  );
});

it("keeps the chosen period and failure-only retry after a failed reload", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
  let failed = true;
  const urls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      urls.push(url);
      if (failed)
        return Response.json({ error: "Unavailable" }, { status: 500 });
      const q = new URL(url, "http://localhost").searchParams;
      return Response.json(rangedProgress(q.get("from")!, q.get("through")!));
    }),
  );
  render(<ProgressView />);
  fireEvent.click(screen.getByRole("button", { name: "Progress" }));
  await screen.findByRole("alert");
  fireEvent.change(screen.getByRole("combobox", { name: "Period" }), {
    target: { value: "6m" },
  });
  await screen.findByRole("alert");
  expect(screen.getByRole("combobox", { name: "Period" })).toHaveProperty(
    "value",
    "6m",
  );
  failed = false;
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await screen.findAllByTestId("saved-chart");
  expect(urls[1]).toBe(urls[2]);
  expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
});
it("requests the default Refresh, keeps the period, shows measured actuals and leaves reviewed points unchanged", async () => {
  const measured = progress();
  measured.recipes = [
    {
      conceptId: "authored-sessions",
      version: 1,
      sql: "select 1",
      tracks: [],
      savedAt: now.toISOString(),
    },
  ];
  let refreshed = false;
  const after = () => {
    const data = structuredClone(measured);
    if (refreshed)
      data.weeks[2].kpis.measured = {
        weekStart: "2026-11-09",
        timeZone: "UTC",
        revision: "r",
        concepts: {
          "authored-sessions": {
            success: {
              recipeVersion: 1,
              status: "measured",
              values: { count: 7 },
              signatures: {
                count: JSON.stringify([
                  "numeric",
                  "sessions",
                  "Selected session count",
                ]),
              },
              measuredAt: now.toISOString(),
              asOf: now.toISOString(),
              basis: "b",
            },
          },
        },
      };
    return data;
  };
  const posts: unknown[] = [];
  let release: () => void = () => undefined;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        posts.push(JSON.parse(String(init.body)));
        await new Promise<void>((resolve) => (release = resolve));
        refreshed = true;
        return Response.json({
          weekStart: "2026-11-09",
          status: "refreshed",
          previous: { status: "refreshed" },
          failed: 0,
        });
      }
      return Response.json(after());
    }),
  );
  function View() {
    const weekly = useWeeklyFeature();
    const run = runRefresh;
    return (
      <>
        <button onClick={() => run(weekly.loadProgress("6m"))}>
          Read progress
        </button>
        <WeeklyKpiProgress weekly={weekly} run={run} />
      </>
    );
  }
  render(<View />);
  fireEvent.click(screen.getByRole("button", { name: "Read progress" }));
  const refresh = await screen.findByRole("button", {
    name: "Refresh this and last week",
  });
  expect(refresh.textContent).toBe("Refresh");
  expect(refresh.getAttribute("title")).toBe("Refresh this and last week");
  const achievementBefore = series(screen.getAllByTestId("saved-chart")[0]);
  fireEvent.click(refresh);
  await waitFor(() => expect(refresh).toHaveProperty("disabled", true));
  expect(refresh.getAttribute("aria-busy")).toBe("true");
  await act(async () => release());
  const figure = await screen.findByRole("figure", {
    name: /T0319 authored sessions · sessions/,
  });
  await waitFor(() =>
    expect(
      series(within(figure).getByTestId("saved-chart")).at(-1).actual,
    ).toBe(7),
  );
  expect(posts).toEqual([
    {
      action: "refresh-current-week",
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
  ]);
  expect(figure.textContent).toContain("Measured");
  expect(screen.getByRole("combobox", { name: "Period" })).toHaveProperty(
    "value",
    "6m",
  );
  // Reviewed achievement points are independent of the refreshed actual.
  expect(series(screen.getAllByTestId("saved-chart")[0])).toEqual(
    achievementBefore,
  );
  expect(refresh).toHaveProperty("disabled", false);
});
it.each([
  ["no_plan", "no_plan", 0, "No plan for this week"],
  ["no_plan", "no_recipes", 0, "No plan for this week"],
  ["no_plan", "superseded", 0, "No plan for this week"],
  ["no_plan", "refreshed", 0, null],
  ["no_recipes", "no_plan", 0, null],
  ["refreshed", "no_plan", 0, null],
  ["no_plan", "failed", 1, "Some measurements failed; last values kept."],
])(
  "shows only the applicable compact status for %s / %s, and clears it on refresh",
  async (status, previous, failed, expected) => {
    const data = progress();
    data.recipes = [
      {
        conceptId: "authored-sessions",
        version: 1,
        sql: "select 1",
        tracks: [],
        savedAt: now.toISOString(),
      },
    ];
    let resolve!: (response: Response) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) =>
        init?.method === "POST"
          ? new Promise<Response>((done) => {
              resolve = done;
            })
          : Response.json(data),
      ),
    );
    function View() {
      const weekly = useWeeklyFeature();
      const run = runRefresh;
      return (
        <>
          <button onClick={() => run(weekly.loadProgress("2m"))}>
            Read progress
          </button>
          <WeeklyKpiProgress weekly={weekly} run={run} />
        </>
      );
    }
    render(<View />);
    fireEvent.click(screen.getByRole("button", { name: "Read progress" }));
    const button = await screen.findByRole("button", {
      name: "Refresh this and last week",
    });
    fireEvent.click(button);
    await act(async () =>
      resolve(
        Response.json({ status, previous: { status: previous }, failed }),
      ),
    );
    await waitFor(() => expect(button).toHaveProperty("disabled", false));
    const messages = screen.queryAllByRole("status");
    expect(messages.map((message) => message.textContent)).toEqual(
      expected ? [expected] : [],
    );
    fireEvent.click(button);
    expect(screen.queryByText("No plan for this week")).toBeNull();
    expect(
      screen.queryByText("Some measurements failed; last values kept."),
    ).toBeNull();
    await act(async () =>
      resolve(
        Response.json({
          status: "refreshed",
          previous: { status: "refreshed" },
          failed: 0,
        }),
      ),
    );
  },
);

it("shows no Refresh without recipes and a compact status when a measurement fails", async () => {
  setup(progress);
  await screen.findByRole("figure", {
    name: /T0319 authored sessions · sessions/,
  });
  expect(
    screen.queryByRole("button", { name: "Refresh this and last week" }),
  ).toBeNull();
  cleanup();
  const data = progress();
  data.recipes = [
    {
      conceptId: "authored-sessions",
      version: 1,
      sql: "select 1",
      tracks: [],
      savedAt: now.toISOString(),
    },
  ];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === "POST"
        ? Response.json({ weekStart: "2026-11-09", failed: 1 })
        : Response.json(data),
    ),
  );
  function View() {
    const weekly = useWeeklyFeature();
    const run = (work: Promise<unknown>) => {
      work.catch(() => undefined);
    };
    return (
      <>
        <button onClick={() => run(weekly.loadProgress("2m"))}>
          Read progress
        </button>
        <WeeklyKpiProgress weekly={weekly} run={run} />
      </>
    );
  }
  render(<View />);
  fireEvent.click(screen.getByRole("button", { name: "Read progress" }));
  fireEvent.click(
    await screen.findByRole("button", { name: "Refresh this and last week" }),
  );
  expect(
    await screen.findByText("Some measurements failed; last values kept."),
  ).toBeTruthy();
});
