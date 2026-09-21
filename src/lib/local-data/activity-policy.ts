import type { NormalizedActivity } from "../garmin/types";
import type {
  ActivityReferenceInput,
  ActivityVerificationEvidence,
} from "./contracts";
export function boundedInteger(
  value: number,
  fallback: number,
  min: number,
  max: number,
) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function normalizeActivityReference(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase();
}

export function interpretActivityReference(
  activities: NormalizedActivity[],
  reference: ActivityReferenceInput,
  matchLimit = 5,
): ActivityVerificationEvidence {
  const suppliedName = reference.suppliedName?.trim() || null;
  const normalizedName = suppliedName
    ? normalizeActivityReference(suppliedName)
    : null;
  const candidates = activities.filter((activity) => {
    const date = activity.startedAt.toISOString().slice(0, 10);
    if (reference.garminId && activity.garminId !== reference.garminId)
      return false;
    if (reference.date && date !== reference.date) return false;
    if (normalizedName) {
      const storedName = activity.name
        ? normalizeActivityReference(activity.name)
        : null;
      if (storedName !== normalizedName) return false;
    }
    return true;
  });
  const boundedMatches = candidates.slice(0, matchLimit).map((activity) => {
    const date = activity.startedAt.toISOString().slice(0, 10);
    const sourceName = activity.name?.trim();
    return {
      garminId: activity.garminId,
      label:
        sourceName ||
        `Imported ${activity.sport} on ${date} (Garmin ID ${activity.garminId})`,
      labelSource: sourceName ? ("garmin" as const) : ("fallback" as const),
      date,
      sport: activity.sport,
      distanceMeters: activity.distanceMeters,
      durationSec: activity.durationSec,
      elevationGainMeters: activity.elevationGainMeters,
      avgHeartRate: activity.avgHeartRate,
    };
  });
  const times = activities.map((activity) => activity.startedAt.getTime());
  return {
    tool: "activityVerification",
    reference: {
      garminId: reference.garminId ?? null,
      suppliedName,
      date: reference.date ?? null,
    },
    outcome:
      candidates.length === 0
        ? "not_found"
        : candidates.length === 1
          ? "found"
          : "ambiguous",
    matches: boundedMatches,
    importedCoverage: {
      activityCount: activities.length,
      earliestDate: times.length
        ? new Date(Math.min(...times)).toISOString().slice(0, 10)
        : null,
      latestDate: times.length
        ? new Date(Math.max(...times)).toISOString().slice(0, 10)
        : null,
    },
    privacy:
      "Verified against local normalized SQLite activity summaries only; raw FIT, GPS streams, connector payloads, and credentials were not sent to the model.",
  };
}
