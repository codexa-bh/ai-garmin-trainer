import type { Dispatch, SetStateAction } from "react";
import { useState } from "react";
import { type Status } from "./contracts";
import { readResponse } from "./transport";

export function useDataControlsFeature({
  setStatus,
}: {
  setStatus: Dispatch<SetStateAction<Status>>;
}) {
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);

  async function runAction(label: string, request: () => Promise<Response>) {
    setStatus({ kind: "busy", message: `${label}…` });
    try {
      const response = await request();
      const body = await readResponse(response);
      setStatus({
        kind: response.ok ? "ok" : "error",
        message: `${label}: ${response.ok ? "success" : `failed (${response.status})`}\n${body}`,
      });
    } catch (error) {
      setStatus({
        kind: "error",
        message: `${label}: ${error instanceof Error ? error.message : "failed"}`,
      });
    }
  }
  return { runAction, diagnosticsOpen, setDiagnosticsOpen };
}
