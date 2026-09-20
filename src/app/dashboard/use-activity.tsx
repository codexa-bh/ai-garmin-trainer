import type { Dispatch, SetStateAction } from "react";
import { useRef, useState, type UIEvent } from "react";
import {
  ACTIVITY_LIST_PAGE_SIZE,
  ACTIVITY_LIST_SCROLL_THRESHOLD_PX,
  type ActivityDashboardPayload,
  type ActivityListItem,
  type ActivityListPayload,
  type Status,
} from "./contracts";
import { readJsonResponse } from "./transport";

export function useActivityFeature({
  runInBackground,
  setStatus,
}: {
  runInBackground: (work: Promise<unknown>) => void;
  setStatus: Dispatch<SetStateAction<Status>>;
}) {
  const [activitySelectorCollapsed, setActivitySelectorCollapsed] =
    useState(false);

  const [activitySearchQuery, setActivitySearchQuery] = useState("");

  const [activities, setActivities] = useState<ActivityListItem[]>([]);

  const [activityListState, setActivityListState] = useState<
    "idle" | "loading" | "loaded" | "error"
  >("idle");

  const [activityListNextOffset, setActivityListNextOffset] = useState<
    number | null
  >(null);

  const [activityListTotalApprox, setActivityListTotalApprox] = useState<
    number | undefined
  >(undefined);

  const [isActivityListLoadingMore, setIsActivityListLoadingMore] =
    useState(false);

  const [activityListMessage, setActivityListMessage] = useState(
    "Open Activity charts to load synced activities.",
  );

  const [selectedActivityId, setSelectedActivityId] = useState<string | null>(
    null,
  );

  const [activityDashboard, setActivityDashboard] =
    useState<ActivityDashboardPayload | null>(null);

  const [activityDashboardState, setActivityDashboardState] = useState<
    "idle" | "loading" | "loaded" | "error"
  >("idle");

  const activityListRequestRef = useRef(0);

  const activityListQueryRef = useRef("");

  const activityListLoadedCountRef = useRef(0);

  const activityListLoadingMoreRef = useRef(false);

  async function loadActivities(query: string, offset = 0, append = false) {
    const trimmed = query.trim();
    if (append) {
      if (activityListLoadingMoreRef.current || activityListNextOffset === null)
        return;
      activityListLoadingMoreRef.current = true;
      setIsActivityListLoadingMore(true);
    } else {
      activityListRequestRef.current += 1;
      activityListQueryRef.current = trimmed;
      activityListLoadedCountRef.current = 0;
      setActivities([]);
      setActivityListNextOffset(null);
      setActivityListTotalApprox(undefined);
      setActivityListState("loading");
      setActivityListMessage("Loading synced activities…");
    }

    const requestGeneration = activityListRequestRef.current;
    try {
      const params = new URLSearchParams({
        limit: String(ACTIVITY_LIST_PAGE_SIZE),
        offset: String(offset),
      });
      if (trimmed) params.set("q", trimmed);
      const payload = await readJsonResponse<ActivityListPayload>(
        await fetch(`/api/activities?${params.toString()}`),
      );
      if (
        requestGeneration !== activityListRequestRef.current ||
        trimmed !== activityListQueryRef.current
      ) {
        return;
      }

      const loadedCount = append
        ? activityListLoadedCountRef.current + payload.activities.length
        : payload.activities.length;
      activityListLoadedCountRef.current = loadedCount;
      setActivities((current) =>
        append ? [...current, ...payload.activities] : payload.activities,
      );
      setActivityListNextOffset(payload.nextOffset ?? null);
      setActivityListTotalApprox(payload.totalApprox);
      setActivityListState("loaded");
      if (!loadedCount) {
        setActivityListMessage(
          trimmed
            ? "No synced activities match that search."
            : "No synced Garmin activities are imported yet.",
        );
        return;
      }
      setActivityListMessage(
        `${loadedCount} of ${payload.totalApprox ?? loadedCount} synced activities loaded.`,
      );
    } catch (error) {
      if (
        requestGeneration !== activityListRequestRef.current ||
        trimmed !== activityListQueryRef.current
      ) {
        return;
      }
      setActivityListState("error");
      setActivityListMessage(
        append
          ? `More activities could not be loaded: ${error instanceof Error ? error.message : "unknown error"}`
          : `Activity search failed: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    } finally {
      if (append) {
        activityListLoadingMoreRef.current = false;
        setIsActivityListLoadingMore(false);
      }
    }
  }

  function handleActivityListScroll(event: UIEvent<HTMLDivElement>) {
    const target = event.currentTarget;
    const remaining =
      target.scrollHeight - target.scrollTop - target.clientHeight;
    if (remaining > ACTIVITY_LIST_SCROLL_THRESHOLD_PX) return;
    if (activityListState === "loading" || isActivityListLoadingMore) return;
    if (activityListNextOffset === null) return;
    runInBackground(
      loadActivities(activitySearchQuery, activityListNextOffset, true),
    );
  }

  async function selectActivityDashboard(garminId: string) {
    setSelectedActivityId(garminId);
    setActivityDashboardState("loading");
    try {
      const payload = await readJsonResponse<ActivityDashboardPayload>(
        await fetch(
          `/api/activities/${encodeURIComponent(garminId)}/dashboard`,
        ),
      );
      setActivityDashboard(payload);
      setActivityDashboardState("loaded");
    } catch (error) {
      setActivityDashboard(null);
      setActivityDashboardState("error");
      setStatus({
        kind: "error",
        message: `Activity dashboard failed: ${error instanceof Error ? error.message : "unknown error"}`,
      });
    }
  }
  return {
    loadActivities,
    activitySearchQuery,
    activitySelectorCollapsed,
    setActivitySelectorCollapsed,
    setActivitySearchQuery,
    activityListMessage,
    handleActivityListScroll,
    activityListState,
    activities,
    selectedActivityId,
    selectActivityDashboard,
    isActivityListLoadingMore,
    activityListNextOffset,
    activityListTotalApprox,
    activityDashboardState,
    activityDashboard,
  };
}
