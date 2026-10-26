import type { TrainerSystemPrompt } from "@/lib/ai/trainer-instructions";
import type { WeeklyTurn } from "../weekly/contracts";
import type { LlmDebugTrace } from "@/lib/ai/debug-types";
import type { TrainerToolStep } from "@/lib/ai/tool-types";
import type { TrainerProgressCounters } from "@/lib/ai/trainer-progress";
import type { CompletedTurn } from "@/lib/memory/types";
import type {
  ChatGrounding,
  ChatRole,
  StoredChatMessage,
  ChatTurnContext,
} from "./contracts";

export type ChatGenerationInput = {
  system: TrainerSystemPrompt;
  userRequest: string;
  weeklyTurn?: WeeklyTurn;
  turnContext?: ChatTurnContext;
  debugTraceEnabled: boolean;
  onStatus?: (message: string, counters?: TrainerProgressCounters) => void;
};

export type ChatGenerationResult = {
  text: string;
  grounding: ChatGrounding | null;
  toolSteps: TrainerToolStep[];
  progressCounters: TrainerProgressCounters;
  debugTrace?: LlmDebugTrace;
};

export type ChatTurnPorts = {
  claimConversationTitle?(message: StoredChatMessage): boolean;
  generateConversationTitle?(firstPrompt: string): Promise<string | null>;
  finishConversationTitle?(
    message: StoredChatMessage,
    title: string | null,
  ): void;
  currentDate?(): string;
  weeklyContext?(turn: WeeklyTurn): unknown;
  ensureConversation(id: string, title: string): unknown;
  listRecentChatMessages(id: string, limit: number): StoredChatMessage[];
  appendChatMessage(input: {
    conversationId: string;
    role: ChatRole;
    content: string;
    grounding?: ChatGrounding | null;
  }): StoredChatMessage;
  // Selection is request-time and precedes context reads; no SDK model crosses this port.
  selectGeneration(): (
    input: ChatGenerationInput,
  ) => Promise<ChatGenerationResult>;
  buildSystemContext(
    message: string,
    history: StoredChatMessage[],
    conversationId: string,
  ): Promise<TrainerSystemPrompt>;
  addCompletedTurn(input: CompletedTurn): Promise<void>;
  fallbackDebugTrace(input: {
    userRequest: string;
    finalAnswer: string;
    toolSteps?: ChatGrounding["toolSteps"];
    reason: string;
  }): LlmDebugTrace;
};
