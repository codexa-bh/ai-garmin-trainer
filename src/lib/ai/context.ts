import { displayActivityLabel } from "../analytics/activity-label";
import type {
  GarminAthleteBaselineDto,
  GarminBodyMetricsDto,
  NormalizedActivity,
  NormalizedDailyHealth,
} from "../garmin/types";
import type { RetrievedMemory } from "../memory/types";
export { TRAINER_SYSTEM_PROMPT } from "./trainer-instructions";

export type RecentConversationMessage = {
  role: "user" | "assistant";
  content: string;
  grounding?: {
    tool?: string;
    activityId?: string;
    activityName?: string | null;
    activityDate?: string | null;
    summary?: string;
  } | null;
};

function compactText(value: string, maxLength: number): string {
  const compacted = value.replace(/\s+/g, " ").trim();
  return compacted.length > maxLength
    ? `${compacted.slice(0, maxLength - 1)}…`
    : compacted;
}

export const DEFAULT_ACTIVE_CHAT_CONTEXT_CHAR_BUDGET = 6000;

function renderConversationMessage(message: RecentConversationMessage): string {
  const grounding = message.grounding?.tool
    ? ` [tool evidence: ${message.grounding.tool}${message.grounding.activityId ? ` activity ${message.grounding.activityId}` : ""}${message.grounding.activityName ? ` (${message.grounding.activityName})` : ""}${message.grounding.summary ? ` — ${compactText(message.grounding.summary, 180)}` : ""}]`
    : "";
  if (message.role === "assistant") {
    return message.grounding?.tool
      ? `assistant: [prior assistant prose omitted as non-authoritative continuity]${grounding}`
      : "assistant: [ungrounded prior assistant prose omitted as non-authoritative continuity]";
  }
  return `user: ${compactText(message.content, 900)}${grounding}`;
}

export function formatActiveChatTranscript(
  messages: RecentConversationMessage[],
  maxChars = DEFAULT_ACTIVE_CHAT_CONTEXT_CHAR_BUDGET,
): string[] {
  const budget = Math.max(Math.trunc(maxChars), 600);
  const selected: string[] = [];
  let used = 0;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const rendered = renderConversationMessage(messages[index]!);
    const nextUsed = used + rendered.length + 1;
    if (selected.length > 0 && nextUsed > budget) break;
    selected.push(
      selected.length === 0 && nextUsed > budget
        ? compactText(rendered, budget)
        : rendered,
    );
    used = Math.min(nextUsed, budget);
  }
  return selected.reverse();
}

export function formatRecentChatHistory(
  messages: RecentConversationMessage[],
  limit = 10,
): string[] {
  return formatActiveChatTranscript(
    messages.slice(-limit),
    DEFAULT_ACTIVE_CHAT_CONTEXT_CHAR_BUDGET,
  );
}

export type TrainerProfile = {
  goals: string[];
  sports: string[];
  preferences: Record<string, string>;
  constraints: string[];
};

export type TrainerMemory = {
  id: string;
  category: "learned_preference" | "temporary_constraint" | "commitment";
  value: string;
  provenanceText: string;
  expiresAt: Date | null;
  reconfirmAfter: Date | null;
};

function formatBodyMetrics(
  bodyMetrics: GarminBodyMetricsDto | null | undefined,
): string {
  if (!bodyMetrics || bodyMetrics.availability === "unavailable") {
    return "No Garmin body metrics have been imported yet. Do not estimate weight or height; ask only if needed and unavailable.";
  }
  const facts = [
    bodyMetrics.values.weightKg !== null
      ? `current weight ${bodyMetrics.values.weightKg} kg`
      : null,
    bodyMetrics.values.heightCm !== null
      ? `height ${bodyMetrics.values.heightCm} cm`
      : null,
    bodyMetrics.history.availability === "available"
      ? `weight history ${bodyMetrics.history.count} rows from ${bodyMetrics.history.rangeStart ?? "unknown"} to ${bodyMetrics.history.rangeEnd ?? "unknown"}`
      : `weight history ${bodyMetrics.history.availability}`,
  ].filter(Boolean);
  const freshness = bodyMetrics.fetchedAt
    ? `fetched ${bodyMetrics.fetchedAt.slice(0, 10)}`
    : "freshness unavailable";
  const preserved = bodyMetrics.preservedPrevious
    ? " Latest refresh failed; previous normalized Garmin body metrics were preserved."
    : "";
  return `Garmin body metrics (${bodyMetrics.availability}, ${freshness}): ${facts.join("; ") || "no supported body metrics available"}.${preserved} These are separate from editable Profile and learned memory; do not ask for imported weight when current weight is available.`;
}

function formatAthleteBaseline(
  athleteBaseline: GarminAthleteBaselineDto | null | undefined,
): string {
  if (!athleteBaseline || athleteBaseline.availability === "unavailable") {
    return "No Garmin athlete baseline snapshot has been imported yet. Do not estimate configured max HR. Treat derived HR zones as estimates derived from Garmin-provided max HR, not Garmin-configured zone boundaries.";
  }
  const values = athleteBaseline.values;
  const zoneFacts = athleteBaseline.values.heartRateZones.boundaries.length
    ? `HR zones ${athleteBaseline.values.heartRateZones.status}: ${athleteBaseline.values.heartRateZones.boundaries.map((zone) => `Z${zone.zone} ${zone.lowerBpm}-${zone.upperBpm ?? "max"} bpm`).join(", ")}`
    : athleteBaseline.values.configuredMaxHeartRateBpm
      ? "HR zones unavailable despite Garmin max HR"
      : null;
  const facts = [
    values.configuredMaxHeartRateBpm
      ? `configured max HR ${values.configuredMaxHeartRateBpm} bpm (Garmin FIT zones target)`
      : null,
    zoneFacts,
    values.cyclingFtpWatts
      ? `cycling FTP ${values.cyclingFtpWatts} W${values.cyclingFtpMeasuredOn ? ` measured ${values.cyclingFtpMeasuredOn}` : ""}${values.cyclingFtpSourceStale ? " (source marked stale by connector)" : ""}`
      : null,
    values.availableTrainingDays.length
      ? `available training days ${values.availableTrainingDays.join(", ")}`
      : null,
    values.preferredLongTrainingDays.length
      ? `preferred long-training days ${values.preferredLongTrainingDays.join(", ")}`
      : null,
  ].filter(Boolean);
  const freshness = athleteBaseline.fetchedAt
    ? `fetched ${athleteBaseline.fetchedAt.slice(0, 10)}`
    : "freshness unavailable";
  const preserved = athleteBaseline.preservedPrevious
    ? " Latest refresh failed; previous normalized Garmin athlete facts were preserved."
    : "";
  return `Garmin athlete baselines (${athleteBaseline.availability}, ${freshness}): ${facts.join("; ") || "no supported athlete facts available"}.${preserved} Do not estimate configured max HR. Treat derived HR zones as estimates derived from Garmin-provided max HR, not Garmin-configured zone boundaries.`;
}

export function buildTrainerContext(input: {
  activities: NormalizedActivity[];
  health: NormalizedDailyHealth[];
  profile: TrainerProfile;
  athleteBaseline?: GarminAthleteBaselineDto | null;
  bodyMetrics?: GarminBodyMetricsDto | null;
  learnedMemories?: TrainerMemory[];
  retrievedMemories?: RetrievedMemory[];
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
    const display = displayActivityLabel(a);
    const labelTag =
      display.labelSource === "garmin" ? "Garmin name" : "fallback label";
    return `${a.startedAt.toISOString().slice(0, 10)} ${display.label} [${labelTag}] ${a.sport}: ${distance}, ${duration}, ${pace}, avg HR ${a.avgHeartRate ?? "n/a"}, max HR ${a.maxHeartRate ?? "n/a"}, steps ${a.steps ?? "n/a"}, ${climb}, calories ${a.calories ?? "n/a"}`;
  });
  const health = input.health
    .slice(0, 10)
    .map(
      (h) =>
        `${h.date}: sleep ${h.sleepMinutes ?? "n/a"}m, RHR ${h.restingHeartRate ?? "n/a"}, HRV ${h.hrvMs ?? h.hrvStatus ?? "n/a"}, stress ${h.stressAvg ?? "n/a"}, steps ${h.steps ?? "n/a"}, calories ${h.calories ?? "n/a"}, body battery ${h.bodyBatteryAvg ?? "n/a"}, availability ${h.availability}`,
    );
  const retrievedMemories = (input.retrievedMemories ?? [])
    .slice(0, 8)
    .map((item) => {
      const source = item.conversationId
        ? `conversation ${item.conversationId}`
        : "cross-conversation";
      const score =
        typeof item.score === "number" ? ` score ${item.score.toFixed(2)}` : "";
      return `${item.kind} from ${source}${score}: ${compactText(item.text, 260)}`;
    });
  const legacyMemories = (input.learnedMemories ?? [])
    .slice(0, 8)
    .map((item) => {
      const expiry = item.expiresAt
        ? ` expires ${item.expiresAt.toISOString().slice(0, 10)}`
        : item.reconfirmAfter
          ? ` reconfirm after ${item.reconfirmAfter.toISOString().slice(0, 10)}`
          : " durable until changed";
      return `${item.category}: ${compactText(item.value, 220)} (${item.provenanceText};${expiry})`;
    });
  return [
    `Explicit Profile goals: ${input.profile.goals.join(", ") || "not set"}`,
    `Explicit Profile sports: ${input.profile.sports.join(", ") || "not set"}`,
    `Explicit Profile constraints: ${input.profile.constraints.join(", ") || "not set"}`,
    `Retrieved semantic memories (concise user-derived cross-session context; lower authority than current user correction, active chat transcript, Profile, and Garmin/tool evidence):\n${retrievedMemories.join("\n") || "No relevant semantic memories retrieved"}`,
    `Legacy confirmed memories pending semantic migration:\n${legacyMemories.join("\n") || "None"}`,
    formatAthleteBaseline(input.athleteBaseline),
    formatBodyMetrics(input.bodyMetrics),
    `Recent activities:\n${recentActivities.join("\n") || "No activities imported"}`,
    `Recovery:\n${health.join("\n") || "No recovery data imported"}`,
    `Recent conversation:\n${input.recentMessages.join("\n")}`,
  ].join("\n\n");
}
