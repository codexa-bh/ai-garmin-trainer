import type { ReactNode, RefObject } from "react";
import type { useWeeklyFeature } from "./use-weekly";
import { addDays } from "@/lib/weekly/calendar";
import { AssistantContent } from "./markdown";

export function WeeklyPlanView({
  weekly,
  openGeneral,
  children,
  close,
  closeRef,
  startChat,
  run,
}: {
  weekly: ReturnType<typeof useWeeklyFeature>;
  openGeneral: () => Promise<void>;
  children: ReactNode;
  close: () => void;
  closeRef: RefObject<HTMLButtonElement | null>;
  startChat: (text: string) => void;
  run: (work: Promise<unknown>) => void;
}) {
  const { record, week, state, mode } = weekly;
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
                {mode === "history"
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
            ) : (
              <>
                {week ? (
                  <>
                    <h2>
                      {week} – {addDays(week, 6)}
                    </h2>
                    <p className="training-plan-meta">
                      Calendar basis: {record?.timeZone ?? weekly.basis}
                      {record && record.timeZone !== weekly.basis
                        ? ` (device now ${weekly.basis}; saved dates unchanged)`
                        : ""}
                    </p>
                    {record?.latest ? (
                      <article className="training-plan-report">
                        <h3>{record.latest.title}</h3>
                        <p>Latest saved {record.latest.savedAt}</p>
                        <AssistantContent
                          content={record.latest.contentMarkdown}
                        />
                      </article>
                    ) : (
                      <p>
                        No weekly commitment saved for this week. Create or
                        update it directly in chat.
                      </p>
                    )}
                    {record?.original ? (
                      <>
                        <p>
                          Original commitment is the first saved plan, retained
                          as the baseline for reviews and scoring. Latest shows
                          later adaptations; these do not replace that baseline.
                        </p>
                        {record.latest?.title === record.original.title &&
                        record.latest.contentMarkdown ===
                          record.original.contentMarkdown ? (
                          <p>
                            The latest plan is identical to the original
                            commitment.
                          </p>
                        ) : (
                          <details>
                            <summary>
                              Original commitment · {record.original.savedAt}
                            </summary>
                            <h3>{record.original.title}</h3>
                            <AssistantContent
                              content={record.original.contentMarkdown}
                            />
                          </details>
                        )}
                      </>
                    ) : null}
                    {record?.review ? (
                      <article className="training-plan-report">
                        <h3>{record.review.title}</h3>
                        <p>
                          Review as of {record.review.asOf} · saved{" "}
                          {record.review.savedAt} · latest-plan snapshot at save{" "}
                          {record.review.planRevision ?? "unavailable"}
                          {record.latest &&
                          record.review.planRevision !== record.latest.revision
                            ? " (earlier revision; not silently refreshed)"
                            : ""}
                        </p>
                        <p>
                          This snapshot is context, not the scoring baseline.
                          See the review document for its scored commitment and
                          any provisional assumptions.
                        </p>
                        <AssistantContent
                          content={record.review.contentMarkdown}
                        />
                      </article>
                    ) : (
                      <p>
                        No review saved. An unfinished week can be reviewed
                        as-of now.
                      </p>
                    )}
                    <button
                      type="button"
                      className="primary-action compact"
                      onClick={() =>
                        startChat(
                          mode === "history"
                            ? `Review ${record?.review ? "and correct" : "the evidence for"} the week starting ${week}; save the review directly.`
                            : `Discuss a plan or review for the week starting ${week}.`,
                        )
                      }
                    >
                      {mode === "history"
                        ? "Review / correct via chat"
                        : "Discuss in chat"}
                    </button>
                  </>
                ) : (
                  <>
                    <p>
                      Past plans and reviews are read-only here. Review
                      corrections can be saved directly through chat.
                    </p>
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
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
