import { weekly } from "../weekly/composition";
import { notifySummaryActivity } from "../memory/summary-lifetime";
import { noteSummaryActivity } from "../db/summary-storage";
import { getOptionalEnv, withConfiguration, type AppEnv } from "../env";
import type { PreparedChatTurn } from "./turn";
import { fallbackLlmDebugTrace } from "@/lib/ai/debug-trace";
import { orchestrateTrainerChat } from "@/lib/ai/composition";
import { conversationHistory } from "@/lib/db/conversation-history";
import { createConversationCompactionGeneration } from "@/lib/ai/provider-generation";
import type { ChatGenerator } from "./ports";
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
import { trainerProfile } from "@/lib/profile/composition";
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
  // Preserved legacy vectors are inspection-only, never a second active source.
  searchMemories: async () => [],
});

const turns = createChatTurns({
  history: conversationHistory,
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
  selectGeneration: (assertCurrent) => {
    const {
      model,
      provider,
      modelName,
      conversationCount,
      conversationReplay,
      assertCurrent: providerCurrent,
    } = selectedTrainerModel(assertCurrent);
    const generate: ChatGenerator = ({
      executionLimit,
      conversation,
      assertCurrent,
      system,
      userRequest,
      weeklyTurn,
      turnContext,
      onStatus,
      debugTraceEnabled,
    }) =>
      orchestrateTrainerChat({
        model,
        ...(executionLimit ? { executionLimit } : {}),
        ...(conversation ? { conversation } : {}),
        ...(assertCurrent ? { assertCurrent } : {}),
        system,
        userRequest,
        weeklyTurn,
        turnContext,
        ...(onStatus ? { onStatus } : {}),
        debug: { enabled: debugTraceEnabled, provider, model: modelName },
      });
    generate.assertCurrent = providerCurrent;
    if (provider === "chatgpt") generate.replayReason = "subscription-replay";
    if (conversationCount || conversationReplay)
      generate.compaction = createConversationCompactionGeneration(
        model,
        conversationCount,
      );
    return generate;
  },
});

// Prepared work owns credentials through retrieval, answer ingestion and deferred
// title completion even when delivery invokes those phases after a newer Save.
// The WeakMap retains no transcript/configuration after the prepared turn dies.
// Delivery may spread PreparedChatTurn for streaming; its userRecord identity
// survives that copy, unlike the outer object. Keep the admitted config bound.
const admitted = new WeakMap<PreparedChatTurn["userRecord"], AppEnv>();
const admittedChecks = new WeakMap<
  PreparedChatTurn["userRecord"],
  () => void
>();
export const prepareChatTurn: typeof turns.prepareChatTurn = (...args) => {
  const env = getOptionalEnv();
  const prepared = withConfiguration(env, () => turns.prepareChatTurn(...args));
  admitted.set(prepared.userRecord, env);
  return prepared;
};
export const generateChatTurn: typeof turns.generateChatTurn = (...args) =>
  withConfiguration(admitted.get(args[0].userRecord) ?? getOptionalEnv(), () =>
    turns.generateChatTurn(...args).then((answer) => {
      if (args[0].assertCurrent)
        admittedChecks.set(args[0].userRecord, args[0].assertCurrent);
      return answer;
    }),
  );
export const completeChatTurn: typeof turns.completeChatTurn = (...args) => {
  args[0].assertCurrent =
    admittedChecks.get(args[0].userRecord) ?? args[0].assertCurrent;
  return withConfiguration(
    admitted.get(args[0].userRecord) ?? getOptionalEnv(),
    () =>
      turns.completeChatTurn(...args).then((result) => {
        try {
          noteSummaryActivity(Date.now());
          notifySummaryActivity();
        } catch {
          // A summary notification cannot undo a committed answer. The existing
          // native discovery tick recovers durable journal backlog without replay.
        }
        return result;
      }),
  );
};
export const completeConversationTitle: typeof turns.completeConversationTitle =
  (...args) =>
    withConfiguration(
      admitted.get(args[0].userRecord) ?? getOptionalEnv(),
      () => turns.completeConversationTitle(...args),
    );
