import {
  buildTrainerContext,
  formatActiveChatTranscript,
  formatTrainingPlanProposalContext,
  TRAINER_SYSTEM_PROMPT,
} from "@/lib/ai/context";
import type { StoredChatMessage } from "./contracts";
import type { ChatContextPorts } from "./context-ports";
import type { RetrievedMemory } from "@/lib/memory/types";
import type { TrainerSystemPrompt } from "@/lib/ai/trainer-instructions";

const GROUNDING_POLICY =
  "Active conversation context is selected from the current chat up to a safe transcript budget; New chat is the reset boundary for this short-term context. Use only selected recent facts and explicit tool/local analytics results for detailed claims. Deleted, expired, disabled, unavailable, or unrelated memories are not included and must not affect the answer. Never describe summary-only analytics as FIT/stream analysis; only claim detailed FIT/stream evidence when an activity has available or partial detail with records/laps. Never request or expose Garmin credentials, raw FIT bytes, raw connector payloads, or unbounded full-history/stream dumps.";

const ACTIVE_TRANSCRIPT_CHAR_BUDGET = 6000;

export function activeTranscriptContext(
  messages: StoredChatMessage[],
): string[] {
  return formatActiveChatTranscript(messages, ACTIVE_TRANSCRIPT_CHAR_BUDGET);
}

export function createChatContext(ports: ChatContextPorts) {
  const {
    dataCounts,
    getGarminAthleteBaseline,
    getGarminBodyMetrics,
    getTrainerProfile,
    listActivityDetailAvailability,
    listRecentActivities,
    listRecentDailyHealth,
    trainingPlanStatus,
  } = ports;
  return async function buildSystemContext(
    latestMessage: string,
    recentMessages: StoredChatMessage[],
    conversationId: string,
  ): Promise<TrainerSystemPrompt> {
    const counts = dataCounts();
    const detailAvailability = listActivityDetailAvailability(12)
      .map(
        (item) =>
          `${item.garminId}: status ${item.status}, records ${item.recordCount}, laps ${item.lapCount}, streams ${item.hasStreams}, GPS ${item.hasGps}, HR ${item.hasHeartRate}, elevation ${item.hasElevation}`,
      )
      .join("\n");
    const coverage = counts.detailCoverage;
    let retrievedMemories: RetrievedMemory[] = [];
    try {
      retrievedMemories = await ports.searchMemories(
        latestMessage,
        conversationId,
        8,
      );
    } catch {
      retrievedMemories = [];
    }
    const context = `${buildTrainerContext({
      activities: listRecentActivities(),
      health: listRecentDailyHealth(),
      profile: getTrainerProfile(),
      athleteBaseline: getGarminAthleteBaseline(),
      bodyMetrics: getGarminBodyMetrics(),
      retrievedMemories,
      trainingPlan: trainingPlanStatus(),
      currentDate: ports.now(),
      recentMessages: activeTranscriptContext(recentMessages),
    })}\n\nDetailed activity availability (local SQLite):\n${detailAvailability || "No detailed activities backfilled yet"}\n\nImported data counts: ${counts.activities} activities, ${counts.healthDays} daily health records, and detail coverage ${coverage.terminal}/${coverage.total} terminal (${coverage.available} available, ${coverage.partial} partial, ${coverage.unsupported} unsupported, ${coverage.pending} pending, ${coverage.retryableFailures} retryable failures).`;
    return {
      policy: `${TRAINER_SYSTEM_PROMPT}\n\n${GROUNDING_POLICY}`,
      context: `Grounding context:\n${context}\n\n${formatTrainingPlanProposalContext(recentMessages)}`,
    };
  };
}
