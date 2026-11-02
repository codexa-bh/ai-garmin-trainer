import { weekly } from "../weekly/composition";
import { getOptionalEnv, withConfiguration, type AppEnv } from "../env";
import type { PreparedChatTurn } from "./turn";
import { fallbackLlmDebugTrace } from "@/lib/ai/debug-trace";
import { orchestrateTrainerChat } from "@/lib/ai/composition";
import { selectedTrainerModel } from "@/lib/model-settings/composition";
import {
  appendChatMessage,
  claimConversationTitle,
  finishConversationTitle,
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
import { generateConversationTitle } from "./title-adapter";

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

const turns = createChatTurns({
  claimConversationTitle,
  finishConversationTitle,
  generateConversationTitle,
  currentDate: () => new Date().toISOString().slice(0, 10),
  weeklyContext: weekly.context,
  appendChatMessage,
  ensureConversation,
  listRecentChatMessages,
  buildSystemContext,
  fallbackDebugTrace: fallbackLlmDebugTrace,
  addCompletedTurn: (input) => trainerMemoryStore().addCompletedTurn(input),
  selectGeneration: () => {
    const { model, provider, modelName } = selectedTrainerModel();
    return ({
      system,
      userRequest,
      weeklyTurn,
      turnContext,
      onStatus,
      debugTraceEnabled,
    }) =>
      orchestrateTrainerChat({
        model,
        system,
        userRequest,
        weeklyTurn,
        turnContext,
        ...(onStatus ? { onStatus } : {}),
        debug: { enabled: debugTraceEnabled, provider, model: modelName },
      });
  },
});

// Prepared work owns credentials through retrieval, answer ingestion and deferred
// title completion even when delivery invokes those phases after a newer Save.
// The WeakMap retains no transcript/configuration after the prepared turn dies.
const admitted = new WeakMap<PreparedChatTurn, AppEnv>();
export const prepareChatTurn: typeof turns.prepareChatTurn = (...args) => {
  const env = getOptionalEnv();
  const prepared = withConfiguration(env, () => turns.prepareChatTurn(...args));
  admitted.set(prepared, env);
  return prepared;
};
export const generateChatTurn: typeof turns.generateChatTurn = (...args) =>
  withConfiguration(admitted.get(args[0]) ?? getOptionalEnv(), () =>
    turns.generateChatTurn(...args),
  );
export const completeChatTurn: typeof turns.completeChatTurn = (...args) =>
  withConfiguration(admitted.get(args[0]) ?? getOptionalEnv(), () =>
    turns.completeChatTurn(...args),
  );
export const completeConversationTitle: typeof turns.completeConversationTitle =
  (...args) =>
    withConfiguration(admitted.get(args[0]) ?? getOptionalEnv(), () =>
      turns.completeConversationTitle(...args),
    );
