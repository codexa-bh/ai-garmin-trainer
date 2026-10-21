import type { Dispatch, SetStateAction } from "react";
import { type RefObject } from "react";
import { type TrainingPlan, type TrainingPlanState } from "./contracts";
import { dateLabel } from "./formatting";
import { AssistantContent } from "./markdown";
import { trainingPlanReviewTiming } from "../../lib/training-plan/policy";

export function TrainingPlanView({
  trainingPlan,
  closeTrainingPlan,
  trainingPlanCloseRef,
  trainingPlanMessage,
  trainingPlanStale,
  trainingPlanStaleAfterDays,
  runInBackground,
  loadTrainingPlan,
  trainingPlanState,
  trainingPlanSaving,
  trainingPlanEditing,
  startTrainingPlanEdit,
  saveTrainingPlan,
  trainingPlanTitleDraft,
  setTrainingPlanTitleDraft,
  trainingPlanMarkdownDraft,
  setTrainingPlanMarkdownDraft,
  cancelTrainingPlanEdit,
}: {
  trainingPlan: TrainingPlan | null;
  closeTrainingPlan: () => void;
  trainingPlanCloseRef: RefObject<HTMLButtonElement | null>;
  trainingPlanMessage: string;
  trainingPlanStale: boolean;
  trainingPlanStaleAfterDays: number;
  runInBackground: (work: Promise<unknown>) => void;
  loadTrainingPlan: (
    trigger: "startup" | "manual" | "chat-save",
    showStatus?: boolean,
  ) => Promise<void>;
  trainingPlanState: TrainingPlanState;
  trainingPlanSaving: boolean;
  trainingPlanEditing: boolean;
  startTrainingPlanEdit: () => void;
  saveTrainingPlan: () => Promise<void>;
  trainingPlanTitleDraft: string;
  setTrainingPlanTitleDraft: Dispatch<SetStateAction<string>>;
  trainingPlanMarkdownDraft: string;
  setTrainingPlanMarkdownDraft: Dispatch<SetStateAction<string>>;
  cancelTrainingPlanEdit: () => void;
}) {
  return (
    <section className="training-plan-panel" aria-label="Training Plan section">
      <div className="activity-dashboard-header">
        <div>
          <p className="section-kicker">Training Plan</p>
          <h1>{trainingPlan?.title ?? "Training Plan"}</h1>
        </div>
        <button
          type="button"
          className="chrome-button"
          onClick={closeTrainingPlan}
          ref={trainingPlanCloseRef}
          aria-label="Back to chat"
        >
          Back to chat
        </button>
      </div>
      <div className="training-plan-content">
        <div className="training-plan-toolbar">
          <div>
            <p className="activity-dashboard-status">{trainingPlanMessage}</p>
            {trainingPlan ? (
              <p className="training-plan-meta">
                Last revised {dateLabel(trainingPlan.revisedAt)} ·{" "}
                {trainingPlanStale
                  ? Number.isFinite(Date.parse(trainingPlan.revisedAt))
                    ? "Optional review"
                    : "Review timing unavailable"
                  : "Within review window"}
              </p>
            ) : null}
          </div>
          <div className="training-plan-actions">
            <button
              type="button"
              className="chrome-button"
              onClick={() => runInBackground(loadTrainingPlan("manual"))}
              disabled={trainingPlanState === "loading" || trainingPlanSaving}
            >
              Reload
            </button>
            {!trainingPlanEditing ? (
              <button
                type="button"
                className="primary-action compact"
                onClick={startTrainingPlanEdit}
                disabled={trainingPlanState === "loading"}
              >
                {trainingPlan ? "Edit" : "Create"}
              </button>
            ) : null}
          </div>
        </div>
        {trainingPlanState === "loading" && !trainingPlanEditing ? (
          <p className="empty-chat">Loading Training Plan…</p>
        ) : trainingPlanEditing ? (
          <form
            className="training-plan-editor"
            onSubmit={(event) => {
              event.preventDefault();
              runInBackground(saveTrainingPlan());
            }}
          >
            <label>
              <span>Title</span>
              <input
                type="text"
                value={trainingPlanTitleDraft}
                onChange={(event) =>
                  setTrainingPlanTitleDraft(event.currentTarget.value)
                }
                maxLength={120}
                disabled={trainingPlanSaving}
              />
            </label>
            <label>
              <span>Markdown plan</span>
              <textarea
                value={trainingPlanMarkdownDraft}
                onChange={(event) =>
                  setTrainingPlanMarkdownDraft(event.currentTarget.value)
                }
                placeholder="Write a freeform Markdown training plan…"
                disabled={trainingPlanSaving}
              />
            </label>
            <div className="training-plan-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={cancelTrainingPlanEdit}
                disabled={trainingPlanSaving}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="primary-action compact"
                disabled={
                  trainingPlanSaving || !trainingPlanMarkdownDraft.trim()
                }
              >
                {trainingPlanSaving ? "Saving…" : "Save"}
              </button>
            </div>
          </form>
        ) : trainingPlan ? (
          <article className="training-plan-report">
            {trainingPlanStale ? (
              <p className="training-plan-stale">
                {trainingPlanReviewTiming({
                  plan: trainingPlan,
                  stale: trainingPlanStale,
                  staleAfterDays: trainingPlanStaleAfterDays,
                })}{" "}
                The saved plan remains usable; changes are optional.
              </p>
            ) : null}
            <AssistantContent content={trainingPlan.contentMarkdown} />
          </article>
        ) : trainingPlanState === "error" ? (
          <p className="empty-chat">
            Training Plan could not be loaded. Try Reload.
          </p>
        ) : (
          <div className="empty-chat empty-chat-hero">
            <p>
              No Training Plan is saved yet. Create one manually here, or ask
              chat: “Create my Training Plan.”
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
