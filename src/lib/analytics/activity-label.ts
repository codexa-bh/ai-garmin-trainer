import type { NormalizedActivity } from "../garmin/types";

export type ActivityLabelSource = "garmin" | "fallback";

export type ActivityDisplayLabel = {
  label: string;
  labelSource: ActivityLabelSource;
};

export function activityDate(
  activity: Pick<NormalizedActivity, "startedAt">,
): string {
  return activity.startedAt.toISOString().slice(0, 10);
}

export function displayActivityLabel(
  activity: Pick<
    NormalizedActivity,
    "garminId" | "name" | "sport" | "startedAt"
  >,
): ActivityDisplayLabel {
  const sourceName = activity.name?.trim();
  if (sourceName) return { label: sourceName, labelSource: "garmin" };
  const date = activityDate(activity);
  return {
    label: `Imported ${activity.sport} on ${date} (Garmin ID ${activity.garminId})`,
    labelSource: "fallback",
  };
}
