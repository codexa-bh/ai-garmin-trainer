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
  formatDetailCoverageSummary,
  formatHealthCoverageSummary,
  formatSyncCounts,
  formatSyncFinalMessage,
  formatSyncPhase,
  formatSyncWork,
  formatSyncProgressLine,
  formatSyncResultLine,
  syncFailureRecovery,
  syncFailureSummary,
  syncHttpFailureRecovery,
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
    "Loading athlete baseline…",
  );

  const [bodyMetrics, setBodyMetrics] = useState<BodyMetricsPayload | null>(
    null,
  );

  const [bodyMetricsMessage, setBodyMetricsMessage] = useState(
    "Loading body metrics…",
  );

  const [detailGarminId, setDetailGarminId] = useState("");

  const [summaryKnown, setSummaryKnown] = useState(false);
  // Once a separate server operation is observed, its current summary owns
  // presentation; a previous local success/failure is only a retained log.
  const [backendObserved, setBackendObserved] = useState(false);
  const [technicalOpen, setTechnicalOpen] = useState(false);
  const summaryKnownRef = useRef(false);
  const summaryGeneration = useRef(0);
  const isSyncingRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  function cancelSync() {
    abortRef.current?.abort();
  }

  async function syncNow(
    intent: import("@/lib/garmin/sync-policy").SyncIntent = "latest",
  ) {
    if (
      isSyncingRef.current ||
      importSummary?.syncActive ||
      importSummary?.sync?.operationInvalid ||
      !summaryKnownRef.current ||
      (intent === "history" &&
        importSummary?.sync?.historical.state !== "available")
    )
      return;
    setBackendObserved(false);
    summaryGeneration.current += 1;
    summaryKnownRef.current = false;
    setSummaryKnown(false);
    isSyncingRef.current = true;
    setIsSyncing(true);
    let logLines: SyncRunState["lines"] = [
      {
        text: `${intent === "latest" ? "Sync latest" : "Historical import"}: starting…`,
        severity: "info",
      },
    ];
    const runningMessage = `${intent === "latest" ? "Latest refresh" : "Historical import"} in progress…`;
    let countSummary: string | undefined;
    let phase: string | undefined;
    let workSummary: string | undefined;
    let recovery: SyncRunState["recovery"] = null;
    let failureSummary: string | null = null;
    setSyncRun({
      kind: "running",
      lines: logLines,
      finalMessage: runningMessage,
      failureSummary,
      recovery,
    });
    setStatus({ kind: "busy", message: "Sync now: starting…" });
    try {
      const abort = new AbortController();
      abortRef.current = abort;
      const response = await fetch("/api/sync", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ intent }),
        signal: abort.signal,
      });
      if (!response.ok || !response.body) {
        const body = await readResponse(response);
        const message = `Sync now: failed (${response.status})\n${body}`;
        recovery = syncHttpFailureRecovery(response.status, body);
        failureSummary = syncFailureSummary(recovery);
        logLines = [
          ...logLines,
          { text: message, severity: "error" as const },
        ].slice(-20);
        setSyncRun({
          kind: "failed",
          lines: logLines,
          finalMessage: message,
          failureSummary,
          recovery,
        });
        setStatus({ kind: "error", message });
        await loadImportSummary("sync", false);
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finalKind: Status["kind"] = "ok";
      let receivedResult = false;
      let paused = false;
      let finalMessage = runningMessage;

      const appendLine = (
        line: string,
        severity: "info" | "error",
        nextFinalMessage?: string,
      ) => {
        logLines = [...logLines, { text: line, severity }].slice(-20);
        finalMessage = nextFinalMessage ?? runningMessage;
        const message = logLines.map((entry) => entry.text).join("\n");
        setSyncRun({
          kind: "running",
          lines: logLines,
          finalMessage,
          countSummary,
          phase,
          workSummary,
          failureSummary,
          recovery,
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
          countSummary = formatSyncCounts(event) ?? countSummary;
          const unknownResult =
            event.type === "result" &&
            !["completed", "failed", "cancelled", "budget-limited"].includes(
              event.status ?? "",
            );
          const failed =
            event.type === "result"
              ? event.status === "failed" || unknownResult
              : event.stage === "failed";
          if (failed) {
            finalKind = "error";
            const detail =
              event.type === "result" ? event.detail : event.message;
            if (event.dependency === "launcher-unavailable")
              recovery = "dependency";
            else if (event.dependency === "startup-unknown")
              recovery = "startup";
            else if (detail) recovery = syncFailureRecovery(detail);
            failureSummary = unknownResult
              ? "Sync outcome unknown. Refresh import summary before continuing."
              : syncFailureSummary(recovery);
          }
          if (event.type === "result") {
            workSummary = formatSyncWork(event);
            receivedResult = true;
            paused =
              event.status === "cancelled" || event.status === "budget-limited";
            finalKind = failed ? "error" : "ok";
            if (!failed) {
              recovery = null;
              failureSummary = null;
            }
            appendLine(
              formatSyncResultLine(event),
              failed ? "error" : "info",
              formatSyncFinalMessage({
                ...event,
                intent: event.intent ?? intent,
              }),
            );
          } else {
            phase = formatSyncPhase(event.stage);
            appendLine(
              formatSyncProgressLine(event),
              failed ? "error" : "info",
              runningMessage,
            );
          }
        }
      }
      if (!receivedResult)
        throw new Error("Sync stream ended without a durable result.");
      await loadImportSummary("sync", false);
      if (finalKind === "ok") await refreshHealthAfterSync();
      setSyncRun({
        kind: finalKind === "ok" ? (paused ? "paused" : "completed") : "failed",
        lines: logLines,
        finalMessage,
        countSummary,
        workSummary,
        failureSummary,
        recovery,
      });
      setStatus({ kind: finalKind, message: finalMessage });
    } catch {
      // A lost response is unknown effect, never authority to replay POST.
      // Reconcile the live claim and durable cursor even on transport failure.
      await loadImportSummary("sync", false);
      if (abortRef.current?.signal.aborted) {
        const message =
          "Cancellation requested. Committed data is retained; refresh import summary to confirm settlement before continuing.";
        setSyncRun({
          kind: "paused",
          lines: logLines,
          finalMessage:
            "Cancellation requested. Refresh import summary to confirm settlement.",
          countSummary,
          failureSummary: null,
          recovery: null,
        });
        setStatus({ kind: "idle", message });
        return;
      }
      const message =
        "Sync response could not be read; effect is unknown. Refresh import summary and confirm no sync is active before explicitly resuming.";
      const nextLines = [
        ...logLines,
        { text: message, severity: "error" as const },
      ].slice(-20);
      setSyncRun({
        kind: "failed",
        lines: nextLines,
        finalMessage: message,
        failureSummary:
          "Sync response lost; effect is unknown. Refresh import summary before continuing.",
        recovery: null,
      });
      setStatus({ kind: "error", message });
    } finally {
      abortRef.current = null;
      isSyncingRef.current = false;
      setIsSyncing(false);
    }
  }

  async function loadImportSummary(
    trigger: "startup" | "manual" | "sync",
    showStatus = true,
  ) {
    const generation = ++summaryGeneration.current;
    summaryKnownRef.current = false;
    setSummaryKnown(false);
    setAthleteBaselineMessage("Loading athlete baseline…");
    setBodyMetricsMessage("Loading body metrics…");
    if (showStatus)
      setStatus({ kind: "busy", message: "Import summary: loading…" });
    try {
      const payload = await readJsonResponse<ImportSummaryPayload>(
        await fetch("/api/summary"),
      );
      if (generation !== summaryGeneration.current) return;
      summaryKnownRef.current = true;
      setSummaryKnown(true);
      const nextBaseline = payload.athleteBaseline ?? emptyAthleteBaseline;
      const nextBodyMetrics = payload.bodyMetrics ?? emptyBodyMetrics;
      const nextSummary = {
        ...payload,
        athleteBaseline: nextBaseline,
        bodyMetrics: nextBodyMetrics,
      };
      if (payload.syncActive && !isSyncingRef.current) setBackendObserved(true);
      setImportSummary(nextSummary);
      setAthleteBaseline(nextBaseline);
      setBodyMetrics(nextBodyMetrics);
      setAthleteBaselineMessage("");
      setBodyMetricsMessage(
        nextBodyMetrics.weighInAvailability === "failed"
          ? "Weigh-in refresh failed. Open Sync to retry the import refresh."
          : "",
      );
      if (showStatus)
        setStatus({
          kind: "ok",
          message: `Import summary: ${payload.activities} stored activities, ${formatHealthCoverageSummary(payload.healthCoverage, payload.healthDays)}, detail coverage ${formatDetailCoverageSummary(payload.detailCoverage, payload.detailedActivities)}, athlete baseline ${nextBaseline.availability}, body metrics ${nextBodyMetrics.availability}.`,
        });
    } catch (error) {
      if (generation !== summaryGeneration.current) return;
      summaryKnownRef.current = false;
      setSummaryKnown(false);
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

  const displayedRun = backendObserved
    ? { ...emptySyncRun, lines: syncRun.lines }
    : syncRun;
  const syncActive =
    isSyncing || (summaryKnown && importSummary?.syncActive === true);
  const syncPillKind: Status["kind"] = syncActive
    ? "busy"
    : displayedRun.kind === "completed"
      ? "ok"
      : displayedRun.kind === "failed"
        ? "error"
        : "idle";

  const syncPillLabel = syncActive
    ? "Syncing"
    : displayedRun.kind === "completed"
      ? "Complete"
      : displayedRun.kind === "failed"
        ? "Failed"
        : displayedRun.kind === "paused"
          ? "Paused"
          : "Ready";
  return {
    loadImportSummary,
    syncRun: displayedRun,
    isSyncing,
    syncPillKind,
    syncPillLabel,
    syncNow,
    summaryKnown,
    technicalOpen,
    setTechnicalOpen,
    cancelSync,
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
