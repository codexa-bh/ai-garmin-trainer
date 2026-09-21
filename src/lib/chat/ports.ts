import type { LlmDebugTrace } from "@/lib/ai/debug-types";
import type { TrainerToolStep } from "@/lib/ai/tool-types";
import type { TrainerProgressCounters } from "@/lib/ai/trainer-progress";
import type { CompletedTurn } from "@/lib/memory/types";
import type { ChatGrounding, ChatRole, StoredChatMessage } from "./contracts";

export type ChatGenerationInput = {
  system: string;
  userRequest: string;
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
  ): Promise<string>;
  addCompletedTurn(input: CompletedTurn): Promise<void>;
  fallbackDebugTrace(input: {
    userRequest: string;
    finalAnswer: string;
    toolSteps?: ChatGrounding["toolSteps"];
    reason: string;
  }): LlmDebugTrace;
};
