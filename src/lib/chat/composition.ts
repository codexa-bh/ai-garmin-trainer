import { fallbackLlmDebugTrace } from "@/lib/ai/debug-trace";
import { orchestrateTrainerChat } from "@/lib/ai/orchestrator";
import { selectedModel } from "@/lib/ai/providers";
import {
  appendChatMessage,
  ensureConversation,
  listRecentChatMessages,
} from "@/lib/db/conversation-repository";
import {
  dataCounts,
  getGarminAthleteBaseline,
  getGarminBodyMetrics,
  listActivityDetailAvailability,
  listRecentActivities,
  listRecentDailyHealth,
} from "@/lib/local-data/composition";
import { trainingPlanStatus } from "@/lib/training-plan/composition";
import { trainerMemoryStore } from "@/lib/memory/composition";
import { trainerProfile } from "@/lib/profile/composition";
import { LOCAL_MEMORY_USER_ID } from "@/lib/memory/types";
import { createChatContext } from "./context";
import { createChatTurns } from "./turn";

// Factories bind capabilities only. DB, memory, environment and provider reads
// stay at their original request-time boundaries, never at composition/import.
const buildSystemContext = createChatContext({
  dataCounts,
  getGarminAthleteBaseline,
  getGarminBodyMetrics,
  getTrainerProfile: trainerProfile.read,
  listActivityDetailAvailability,
  listRecentActivities,
  listRecentDailyHealth,
  trainingPlanStatus,
  now: () => new Date(),
  searchMemories: (query, conversationId, limit) =>
    trainerMemoryStore().search(
      query,
      { userId: LOCAL_MEMORY_USER_ID, conversationId },
      limit,
    ),
});

export const { prepareChatTurn, generateChatTurn, completeChatTurn } =
  createChatTurns({
    appendChatMessage,
    ensureConversation,
    listRecentChatMessages,
    buildSystemContext,
    fallbackDebugTrace: fallbackLlmDebugTrace,
    addCompletedTurn: (input) => trainerMemoryStore().addCompletedTurn(input),
    selectGeneration: () => {
      const { model, provider, modelName } = selectedModel();
      return ({ system, userRequest, onStatus, debugTraceEnabled }) =>
        orchestrateTrainerChat({
          model,
          system,
          userRequest,
          ...(onStatus ? { onStatus } : {}),
          debug: { enabled: debugTraceEnabled, provider, model: modelName },
        });
    },
  });
