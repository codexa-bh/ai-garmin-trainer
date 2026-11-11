import type { ReactNode, RefObject } from "react";
import type { useWeeklyFeature } from "./use-weekly";
import { addDays } from "@/lib/weekly/calendar";
import { AssistantContent } from "./markdown";
import { WeeklyKpiScorecard, kpiCutoff } from "./weekly-kpi-scorecard";
import { WeeklyKpiProgress } from "./weekly-kpi-progress";

export function WeeklyPlanView({
  weekly,
  openGeneral,
  children,
  close,
  closeRef,
  run,
}: {
  weekly: ReturnType<typeof useWeeklyFeature>;
  openGeneral: () => Promise<void>;
  children: ReactNode;
  close: () => void;
  closeRef: RefObject<HTMLButtonElement | null>;
  run: (work: Promise<unknown>) => void;
}) {
  const { record, week, state, mode } = weekly;
  const structured = Boolean(
    weekly.kpis?.latestPlanSetId ?? weekly.kpis?.latestId,
  );
  return (
    <section className="weekly-plan-panel" aria-label="Weekly training plans">
      <nav
        className="training-plan-actions weekly-tabs"
        aria-label="Training plan views"
      >
        {(
          [
            ["current", "This Week"],
            ["upcoming", "Upcoming"],
            ["general", "General Plan"],
            ["progress", "Progress"],
            ["history", "History"],
          ] as const
        ).map(([key, label]) => (
          <button
            type="button"
            className="chrome-button"
            key={key}
            aria-pressed={mode === key}
            onClick={() => {
              run(weekly.load(key));
              if (key === "general") run(openGeneral());
            }}
          >
            {label}
          </button>
        ))}
      </nav>
      {mode === "general" ? (
        children
      ) : (
        <div className="training-plan-panel">
          <div className="activity-dashboard-header">
            <div>
              <p className="section-kicker">Training Plan</p>
              <h1>
                {mode === "progress"
                  ? "Progress"
                  : mode === "history"
                    ? "History"
                    : mode === "upcoming"
                      ? "Upcoming"
                      : "This Week"}
              </h1>
            </div>
            <button
              className="chrome-button"
              type="button"
              ref={closeRef}
              onClick={close}
            >
              Back to chat
            </button>
          </div>
          <div className="training-plan-content">
            <button
              type="button"
              className="chrome-button"
              disabled={state === "loading"}
              onClick={() => run(weekly.refresh())}
            >
              Reload weekly plans
            </button>
            {state === "loading" || state === "idle" ? (
              <p role="status">Loading weekly plans…</p>
            ) : state === "error" ? (
              <p role="alert">Weekly plans could not be loaded. Try Reload.</p>
            ) : mode === "progress" ? (
              <WeeklyKpiProgress
                weekly={weekly}
                run={run}
                openWeek={(selected) => run(weekly.load("history", selected))}
              />
            ) : week ? (
              <>
                <h2>
                  {week} – {addDays(week, 6)}
                </h2>
                <p className="training-plan-meta">
                  {record?.timeZone ?? weekly.kpis?.timeZone ?? weekly.basis}
                  {record && record.timeZone !== weekly.basis
                    ? ` (device now ${weekly.basis}; saved dates unchanged)`
                    : ""}
                </p>
                <WeeklyKpiScorecard
                  kpis={weekly.kpis}
                  loadSet={(id) => run(weekly.loadSet(id))}
                />
                {record?.latest ? (
                  structured ? (
                    <details className="training-plan-report">
                      <summary>Plan notes · {record.latest.title}</summary>
                      <p>
                        Preserved narrative; the KPI grid shows saved targets
                        and values.
                      </p>
                      <AssistantContent
                        content={record.latest.contentMarkdown}
                      />
                    </details>
                  ) : (
                    <article className="training-plan-report">
                      <h3>{record.latest.title}</h3>
                      <AssistantContent
                        content={record.latest.contentMarkdown}
                      />
                    </article>
                  )
                ) : (
                  <p>
                    No narrative weekly plan saved for this week. Create or
                    update it in chat.
                  </p>
                )}
                {record?.review ? (
                  <details className="training-plan-report">
                    <summary>
                      Review notes · {kpiCutoff(record.review.asOf)}
                    </summary>
                    <AssistantContent content={record.review.contentMarkdown} />
                  </details>
                ) : (
                  <p className="training-plan-meta">No review saved.</p>
                )}
              </>
            ) : (
              <>
                <p>Past plans and reviews. Changes are managed in chat.</p>
                {weekly.items.length ? (
                  <ul>
                    {weekly.items.map((item) => (
                      <li key={item.weekStart}>
                        <button
                          type="button"
                          className="chrome-button"
                          onClick={() =>
                            run(weekly.load("history", item.weekStart))
                          }
                        >
                          {item.weekStart} – {addDays(item.weekStart, 6)} ·{" "}
                          {item.hasPlan ? "Plan" : "No plan"} ·{" "}
                          {item.hasReview ? "Review" : "No review"}
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>No historical weekly artifacts.</p>
                )}
                {weekly.next ? (
                  <button
                    type="button"
                    onClick={() =>
                      run(weekly.load("history", undefined, weekly.next!))
                    }
                  >
                    Older weeks
                  </button>
                ) : null}
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
