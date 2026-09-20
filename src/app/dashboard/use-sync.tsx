import type { Dispatch, SetStateAction } from "react";
import { useRef, useState } from "react";
import {
  emptyAthleteBaseline,
  emptyBodyMetrics,
  emptySyncRun,
  type AthleteBaselinePayload,
  type BodyMetricsPayload,
  type ImportSummaryPayload,
  type Status,
  type SyncProgressEvent,
  type SyncRunState,
} from "./contracts";
import {
  formatAthleteBaselineSummary,
  formatBodyMetricsSummary,
  formatDetailCoverageSummary,
  formatHealthCoverageSummary,
  formatSyncFinalMessage,
  formatSyncProgressLine,
  formatSyncResultLine,
} from "./sync-presentation";
import { readJsonResponse, readResponse } from "./transport";

export function useSyncFeature({
  setStatus,
  refreshHealthAfterSync,
  runAction,
}: {
  setStatus: Dispatch<SetStateAction<Status>>;
  refreshHealthAfterSync: () => Promise<void>;
  runAction: (label: string, request: () => Promise<Response>) => Promise<void>;
}) {
  const [isSyncing, setIsSyncing] = useState(false);

  const [syncRun, setSyncRun] = useState<SyncRunState>(emptySyncRun);

  const [importSummary, setImportSummary] =
    useState<ImportSummaryPayload | null>(null);

  const [athleteBaseline, setAthleteBaseline] =
    useState<AthleteBaselinePayload | null>(null);

  const [athleteBaselineMessage, setAthleteBaselineMessage] = useState(
    "Garmin athlete baselines will load from the local import summary.",
  );

  const [bodyMetrics, setBodyMetrics] = useState<BodyMetricsPayload | null>(
    null,
  );

  const [bodyMetricsMessage, setBodyMetricsMessage] = useState(
    "Garmin body metrics will load from the local import summary.",
  );

  const [detailGarminId, setDetailGarminId] = useState("");

  const isSyncingRef = useRef(false);

  async function syncNow() {
    if (isSyncingRef.current) return;
    isSyncingRef.current = true;
    setIsSyncing(true);
    let logLines = ["Sync now: starting…"];
    setSyncRun({
      kind: "running",
      lines: logLines,
      finalMessage: "Sync in progress…",
    });
    setStatus({ kind: "busy", message: "Sync now: starting…" });
    try {
      const response = await fetch("/api/sync", { method: "POST" });
      if (!response.ok || !response.body) {
        const body = await readResponse(response);
        const message = `Sync now: failed (${response.status})\n${body}`;
        logLines = [...logLines, message].slice(-20);
        setSyncRun({ kind: "failed", lines: logLines, finalMessage: message });
        setStatus({ kind: "error", message });
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finalKind: Status["kind"] = "ok";
      let finalMessage = "Sync in progress…";

      const appendLine = (line: string, nextFinalMessage?: string) => {
        logLines = [...logLines, line].slice(-20);
        finalMessage = nextFinalMessage ?? "Sync in progress…";
        const message = logLines.join("\n");
        setSyncRun({
          kind: "running",
          lines: logLines,
          finalMessage,
        });
        setStatus({
          kind: finalKind === "error" ? "error" : "busy",
          message,
        });
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line) as SyncProgressEvent;
          if (event.type === "result") {
            finalKind = event.status === "completed" ? "ok" : "error";
            appendLine(
              formatSyncResultLine(event),
              formatSyncFinalMessage(event),
            );
          } else {
            appendLine(formatSyncProgressLine(event));
          }
        }
      }
      await loadImportSummary("sync", false);
      if (finalKind === "ok") await refreshHealthAfterSync();
      setSyncRun({
        kind: finalKind === "ok" ? "completed" : "failed",
        lines: logLines.length ? logLines : ["Sync complete."],
        finalMessage,
      });
      setStatus({ kind: finalKind, message: finalMessage });
    } catch (error) {
      const message = `Sync now failed: ${error instanceof Error ? error.message : "unknown error"}`;
      const nextLines = [...logLines, message].slice(-20);
      setSyncRun({ kind: "failed", lines: nextLines, finalMessage: message });
      setStatus({ kind: "error", message });
    } finally {
      isSyncingRef.current = false;
      setIsSyncing(false);
    }
  }

  async function loadImportSummary(
    trigger: "startup" | "manual" | "sync",
    showStatus = true,
  ) {
    if (showStatus)
      setStatus({ kind: "busy", message: "Import summary: loading…" });
    try {
      const payload = await readJsonResponse<ImportSummaryPayload>(
        await fetch("/api/summary"),
      );
      const nextBaseline = payload.athleteBaseline ?? emptyAthleteBaseline;
      const nextBodyMetrics = payload.bodyMetrics ?? emptyBodyMetrics;
      const nextSummary = {
        ...payload,
        athleteBaseline: nextBaseline,
        bodyMetrics: nextBodyMetrics,
      };
      setImportSummary(nextSummary);
      setAthleteBaseline(nextBaseline);
      setBodyMetrics(nextBodyMetrics);
      setAthleteBaselineMessage(formatAthleteBaselineSummary(nextBaseline));
      setBodyMetricsMessage(formatBodyMetricsSummary(nextBodyMetrics));
      if (showStatus)
        setStatus({
          kind: "ok",
          message: `Import summary: ${payload.activities} stored activities, ${formatHealthCoverageSummary(payload.healthCoverage, payload.healthDays)}, detail coverage ${formatDetailCoverageSummary(payload.detailCoverage, payload.detailedActivities)}, athlete baseline ${nextBaseline.availability}, body metrics ${nextBodyMetrics.availability}.`,
        });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "unknown error";
      setAthleteBaselineMessage(
        `Athlete baseline summary failed: ${errorMessage}`,
      );
      setBodyMetricsMessage(`Body metrics summary failed: ${errorMessage}`);
      if (showStatus || trigger === "manual")
        setStatus({
          kind: "error",
          message: `Import summary failed: ${errorMessage}`,
        });
    }
  }

  async function refreshSummary() {
    await loadImportSummary("manual");
  }

  async function refreshDetailCoverage() {
    await runAction("Activity detail coverage", () =>
      fetch("/api/activity-detail"),
    );
  }

  async function backfillDetail() {
    const garminId = detailGarminId.trim();
    if (!garminId) {
      setStatus({
        kind: "error",
        message: "Enter an imported Garmin activity ID first.",
      });
      return;
    }
    await runAction("Detailed activity backfill", () =>
      fetch("/api/activity-detail", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ garminId, force: true }),
      }),
    );
  }

  const syncPillKind: Status["kind"] = isSyncing
    ? "busy"
    : syncRun.kind === "completed"
      ? "ok"
      : syncRun.kind === "failed"
        ? "error"
        : "idle";

  const syncPillLabel = isSyncing
    ? "Syncing"
    : syncRun.kind === "completed"
      ? "Complete"
      : syncRun.kind === "failed"
        ? "Failed"
        : "Ready";
  return {
    loadImportSummary,
    syncRun,
    isSyncing,
    syncPillKind,
    syncPillLabel,
    syncNow,
    importSummary,
    refreshSummary,
    athleteBaselineMessage,
    athleteBaseline,
    bodyMetricsMessage,
    bodyMetrics,
    detailGarminId,
    setDetailGarminId,
    backfillDetail,
    refreshDetailCoverage,
  };
}
