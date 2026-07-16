import type {
  NormalizedActivity,
  NormalizedDailyHealth,
} from "../garmin/types";

export type TrainerProfile = {
  goals: string[];
  sports: string[];
  preferences: Record<string, string>;
  constraints: string[];
};

export function buildTrainerContext(input: {
  activities: NormalizedActivity[];
  health: NormalizedDailyHealth[];
  profile: TrainerProfile;
  recentMessages: string[];
}): string {
  const recentActivities = input.activities.slice(0, 8).map((a) => {
    const duration = a.durationSec
      ? `${Math.round(a.durationSec / 60)}min`
      : "duration n/a";
    const distance = a.distanceMeters
      ? `${Math.round(a.distanceMeters)}m`
      : "distance n/a";
    const pace =
      a.distanceMeters && a.durationSec
        ? `${(a.durationSec / 60 / (a.distanceMeters / 1000)).toFixed(1)} min/km`
        : "pace n/a";
    const climb =
      a.elevationGainMeters || a.elevationLossMeters
        ? `elevation +${a.elevationGainMeters ?? "n/a"}m/-${a.elevationLossMeters ?? "n/a"}m`
        : "elevation n/a";
    return `${a.startedAt.toISOString().slice(0, 10)} ${a.name ? `${a.name} ` : ""}${a.sport}: ${distance}, ${duration}, ${pace}, avg HR ${a.avgHeartRate ?? "n/a"}, max HR ${a.maxHeartRate ?? "n/a"}, steps ${a.steps ?? "n/a"}, ${climb}, calories ${a.calories ?? "n/a"}`;
  });
  const health = input.health
    .slice(0, 10)
    .map(
      (h) =>
        `${h.date}: sleep ${h.sleepMinutes ?? "n/a"}m, RHR ${h.restingHeartRate ?? "n/a"}, HRV ${h.hrvMs ?? h.hrvStatus ?? "n/a"}, stress ${h.stressAvg ?? "n/a"}, steps ${h.steps ?? "n/a"}, calories ${h.calories ?? "n/a"}, body battery ${h.bodyBatteryAvg ?? "n/a"}, availability ${h.availability}`,
    );
  return [
    `Goals: ${input.profile.goals.join(", ") || "not set"}`,
    `Preferred sports: ${input.profile.sports.join(", ") || "not set"}`,
    `Constraints: ${input.profile.constraints.join(", ") || "not set"}`,
    `Recent activities:\n${recentActivities.join("\n") || "No activities imported"}`,
    `Recovery:\n${health.join("\n") || "No recovery data imported"}`,
    `Recent conversation:\n${input.recentMessages.slice(-6).join("\n")}`,
  ].join("\n\n");
}

export const TRAINER_SYSTEM_PROMPT = `You are a private fitness trainer for a single user. Give grounded, non-medical training guidance only. Cite the activity date, metric, or trend you used in ordinary language. If data is missing, say it is missing and do not infer measurements. Do not diagnose, treat, prescribe medication, or claim emergency guidance. Minimize sensitive detail and never ask for Garmin credentials.`;
