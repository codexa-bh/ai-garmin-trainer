import {
  buildTrainerContext,
  formatActiveChatTranscript,
  formatTrainingPlanProposalContext,
  TRAINER_SYSTEM_PROMPT,
} from "@/lib/ai/context";
import type { StoredChatMessage } from "@/lib/db/conversation-repository";
import {
  dataCounts,
  getGarminAthleteBaseline,
  getGarminBodyMetrics,
  getTrainerProfile,
  listActivityDetailAvailability,
  listRecentActivities,
  listRecentDailyHealth,
} from "@/lib/db/repository";
import { trainingPlanStatus } from "@/lib/db/training-plan-repository";
import { trainerMemoryStore } from "@/lib/memory/sqlite-adapter";
import { LOCAL_MEMORY_USER_ID, type RetrievedMemory } from "@/lib/memory/types";

const ACTIVE_TRANSCRIPT_CHAR_BUDGET = 6000;

export function activeTranscriptContext(
  messages: StoredChatMessage[],
): string[] {
  return formatActiveChatTranscript(messages, ACTIVE_TRANSCRIPT_CHAR_BUDGET);
}

export async function buildSystemContext(
  latestMessage: string,
  recentMessages: StoredChatMessage[],
  conversationId: string,
): Promise<string> {
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
    retrievedMemories = await trainerMemoryStore().search(
      latestMessage,
      { userId: LOCAL_MEMORY_USER_ID, conversationId },
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
    currentDate: new Date(),
    recentMessages: activeTranscriptContext(recentMessages),
  })}\n\nDetailed activity availability (local SQLite):\n${detailAvailability || "No detailed activities backfilled yet"}\n\nImported data counts: ${counts.activities} activities, ${counts.healthDays} daily health records, and detail coverage ${coverage.terminal}/${coverage.total} terminal (${coverage.available} available, ${coverage.partial} partial, ${coverage.unsupported} unsupported, ${coverage.pending} pending, ${coverage.retryableFailures} retryable failures). Active conversation context is selected from the current chat up to a safe transcript budget; New chat is the reset boundary for this short-term context. Use only selected recent facts and explicit tool/local analytics results for detailed claims. Deleted, expired, disabled, unavailable, or unrelated memories are not included and must not affect the answer. Never describe summary-only analytics as FIT/stream analysis; only claim detailed FIT/stream evidence when an activity has available or partial detail with records/laps. Never request or expose Garmin credentials, raw FIT bytes, raw connector payloads, or unbounded full-history/stream dumps.`;
  return `${TRAINER_SYSTEM_PROMPT}\n\nGrounding context:\n${context}\n\n${formatTrainingPlanProposalContext(recentMessages)}`;
}
