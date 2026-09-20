import type { Dispatch, SetStateAction } from "react";
import { useState } from "react";
import {
  type Status,
  type TrainingPlan,
  type TrainingPlanPayload,
  type TrainingPlanResponse,
  type TrainingPlanState,
} from "./contracts";
import { readJsonResponse } from "./transport";

export function useTrainingPlanFeature({
  setStatus,
}: {
  setStatus: Dispatch<SetStateAction<Status>>;
}) {
  const [trainingPlan, setTrainingPlan] = useState<TrainingPlan | null>(null);

  const [trainingPlanStale, setTrainingPlanStale] = useState(true);

  const [trainingPlanStaleAfterDays, setTrainingPlanStaleAfterDays] =
    useState(14);

  const [trainingPlanState, setTrainingPlanState] =
    useState<TrainingPlanState>("idle");

  const [trainingPlanMessage, setTrainingPlanMessage] = useState(
    "Training Plan will load from local SQLite.",
  );

  const [trainingPlanEditing, setTrainingPlanEditing] = useState(false);

  const [trainingPlanTitleDraft, setTrainingPlanTitleDraft] = useState("");

  const [trainingPlanMarkdownDraft, setTrainingPlanMarkdownDraft] =
    useState("");

  const [trainingPlanSaving, setTrainingPlanSaving] = useState(false);

  function applyTrainingPlanPayload(payload: TrainingPlanPayload) {
    setTrainingPlan(payload.plan);
    setTrainingPlanStale(payload.stale);
    setTrainingPlanStaleAfterDays(payload.staleAfterDays);
    setTrainingPlanState("loaded");
    setTrainingPlanTitleDraft(payload.plan?.title ?? "Training Plan");
    setTrainingPlanMarkdownDraft(payload.plan?.contentMarkdown ?? "");
    setTrainingPlanMessage(
      payload.plan
        ? payload.stale
          ? `Training Plan is older than ${payload.staleAfterDays} days. Review or revise when useful.`
          : "Training Plan loaded from local SQLite."
        : "No Training Plan saved yet. Ask chat to create one or write it manually.",
    );
  }

  async function loadTrainingPlan(
    trigger: "startup" | "manual" | "chat-save",
    showStatus = true,
  ) {
    setTrainingPlanState("loading");
    if (showStatus)
      setStatus({ kind: "busy", message: "Training Plan: loading…" });
    try {
      const payload = await readJsonResponse<TrainingPlanPayload>(
        await fetch("/api/training-plan", { method: "GET" }),
      );
      applyTrainingPlanPayload(payload);
      if (showStatus)
        setStatus({
          kind: "ok",
          message: payload.plan
            ? `Training Plan: loaded ${payload.plan.title}.`
            : "Training Plan: no saved plan yet.",
        });
    } catch (error) {
      setTrainingPlanState("error");
      setTrainingPlanMessage(
        `Training Plan load failed: ${error instanceof Error ? error.message : "unknown error"}`,
      );
      if (showStatus || trigger === "manual")
        setStatus({
          kind: "error",
          message: `Training Plan load failed: ${error instanceof Error ? error.message : "unknown error"}`,
        });
    }
  }

  function startTrainingPlanEdit() {
    setTrainingPlanTitleDraft(trainingPlan?.title ?? "Training Plan");
    setTrainingPlanMarkdownDraft(trainingPlan?.contentMarkdown ?? "");
    setTrainingPlanEditing(true);
  }

  function cancelTrainingPlanEdit() {
    setTrainingPlanTitleDraft(trainingPlan?.title ?? "Training Plan");
    setTrainingPlanMarkdownDraft(trainingPlan?.contentMarkdown ?? "");
    setTrainingPlanEditing(false);
    setTrainingPlanMessage(
      "Training Plan edit cancelled; saved content is unchanged.",
    );
  }

  async function saveTrainingPlan() {
    if (trainingPlanSaving) return;
    const contentMarkdown = trainingPlanMarkdownDraft.trim();
    if (!contentMarkdown) {
      setTrainingPlanMessage(
        "Training Plan save failed: Markdown content is required.",
      );
      return;
    }
    setTrainingPlanSaving(true);
    setTrainingPlanMessage("Saving Training Plan to local SQLite…");
    setStatus({ kind: "busy", message: "Training Plan: saving…" });
    try {
      const payload = await readJsonResponse<TrainingPlanResponse>(
        await fetch("/api/training-plan", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            title: trainingPlanTitleDraft,
            contentMarkdown,
          }),
        }),
      );
      setTrainingPlan(payload.plan);
      setTrainingPlanStale(false);
      setTrainingPlanTitleDraft(payload.plan.title);
      setTrainingPlanMarkdownDraft(payload.plan.contentMarkdown);
      setTrainingPlanEditing(false);
      setTrainingPlanState("loaded");
      setTrainingPlanMessage(
        "Training Plan saved and rendered from local SQLite.",
      );
      setStatus({ kind: "ok", message: "Training Plan: saved." });
    } catch (error) {
      setTrainingPlanMessage(
        `Training Plan save failed; edits are still in the form: ${error instanceof Error ? error.message : "unknown error"}`,
      );
      setStatus({
        kind: "error",
        message: `Training Plan save failed: ${error instanceof Error ? error.message : "unknown error"}`,
      });
    } finally {
      setTrainingPlanSaving(false);
    }
  }
  return {
    loadTrainingPlan,
    setTrainingPlanEditing,
    trainingPlan,
    trainingPlanMessage,
    trainingPlanStale,
    trainingPlanStaleAfterDays,
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
  };
}
