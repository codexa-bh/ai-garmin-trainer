import { useState } from "react";
import {
  type HealthDashboardLoadState,
  type HealthDashboardPayload,
} from "./contracts";
import { readJsonResponse } from "./transport";

export function useHealthFeature() {
  const [healthDashboardData, setHealthDashboardData] =
    useState<HealthDashboardPayload | null>(null);

  const [healthDashboardState, setHealthDashboardState] =
    useState<HealthDashboardLoadState>("idle");

  const [healthDashboardError, setHealthDashboardError] = useState("");

  const [selectedHealthDayIndex, setSelectedHealthDayIndex] = useState(0);

  async function loadHealthDashboard(
    options: { preserveSelectedDate?: boolean } = {},
  ) {
    setHealthDashboardState("loading");
    const selectedDate = options.preserveSelectedDate
      ? healthDashboardData?.days[selectedHealthDayIndex]?.date
      : null;
    try {
      const payload = await readJsonResponse<HealthDashboardPayload>(
        await fetch("/api/health-dashboard", { method: "GET" }),
      );
      setHealthDashboardData(payload);
      const preservedIndex = selectedDate
        ? payload.days.findIndex((day) => day.date === selectedDate)
        : -1;
      setSelectedHealthDayIndex(preservedIndex >= 0 ? preservedIndex : 0);
      setHealthDashboardError("");
      setHealthDashboardState("loaded");
    } catch (error) {
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
    selectedHealthDayIndex,
    setSelectedHealthDayIndex,
  };
}
