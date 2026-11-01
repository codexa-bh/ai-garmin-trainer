import { useRef, useState } from "react";
import {
  type HealthDashboardLoadState,
  type HealthDashboardPayload,
} from "./contracts";
import { dailyHealthBounds, resolveHealthRange } from "./health-daily-range";
import { readJsonResponse } from "./transport";

export function useHealthFeature() {
  const [healthDashboardData, setHealthDashboardData] =
    useState<HealthDashboardPayload | null>(null);
  const [healthDashboardState, setHealthDashboardState] =
    useState<HealthDashboardLoadState>("idle");
  const [healthDashboardError, setHealthDashboardError] = useState("");
  const [healthRangeEnd, setRangeEnd] = useState<string | null>(null);
  const [healthRangeNotice, setHealthRangeNotice] = useState("");
  const selectedRange = useRef<string | null>(null);
  const readGeneration = useRef(0);

  function setHealthRangeEnd(end: string) {
    selectedRange.current = end;
    setRangeEnd(end);
    setHealthRangeNotice("");
  }

  async function loadHealthDashboard() {
    const generation = ++readGeneration.current;
    setHealthDashboardState("loading");
    try {
      const payload = await readJsonResponse<HealthDashboardPayload>(
        await fetch("/api/health-dashboard", { method: "GET" }),
      );
      if (generation !== readGeneration.current) return;
      const today = new Date().toISOString().slice(0, 10);
      const previous = selectedRange.current;
      const end = resolveHealthRange(
        previous,
        dailyHealthBounds(payload.days, today),
        today,
      );
      selectedRange.current = end;
      setRangeEnd(end);
      setHealthRangeNotice(
        previous && previous !== end
          ? "Daily range changed because the previous range is no longer available in loaded history."
          : "",
      );
      setHealthDashboardData(payload);
      setHealthDashboardError("");
      setHealthDashboardState("loaded");
    } catch (error) {
      if (generation !== readGeneration.current) return;
      setHealthDashboardError(
        error instanceof Error
          ? `Health dashboard failed: ${error.message}`
          : "Health dashboard failed: unknown error",
      );
      setHealthDashboardState("error");
    }
  }
  return {
    healthDashboardData,
    healthDashboardState,
    loadHealthDashboard,
    healthDashboardError,
    healthRangeEnd,
    healthRangeNotice,
    setHealthRangeEnd,
  };
}
