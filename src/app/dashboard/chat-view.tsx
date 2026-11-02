import { type TrainerProgress } from "@/lib/ai/trainer-progress";
import type { Dispatch, SetStateAction } from "react";
import { type RefObject } from "react";
import { hasVisibleGrounding } from "./chat-presentation";
import {
  type ChatMessage,
  type ConversationSummary,
  type TrainingPlan,
  type TrainingPlanState,
} from "./contracts";
import { dateLabel } from "./formatting";
import { AssistantContent } from "./markdown";
import { ModelSettingsCard } from "./model-settings-card";
import type { useModelSettings } from "./use-model-settings";

export function ChatView({
  modelSettings,
  conversationDrawerCloseRef,
  isConversationDrawerOpen,
  closeConversationDrawer,
  runInBackground,
  startNewChat,
  conversationRows,
  conversationId,
  selectionError,
  retryConversationSelection,
  closeConversationMenu,
  selectConversation,
  openConversationMenuId,
  toggleConversationMenu,
  openConversationMenuItem,
  conversationMenuPosition,
  conversationMenuRef,
  loadChatHistory,
  isChatLoading,
  startConversationRename,
  deleteConversationById,
  renameTarget,
  cancelConversationRename,
  saveConversationRename,
  renameInputRef,
  renameTitle,
  renameError,
  setRenameTitle,
  isRenamingConversation,
  transcriptRef,
  handleTranscriptScroll,
  historyCursor,
  loadOlderMessages,
  isHistoryLoading,
  chatMessages,
  trainingPlanState,
  trainingPlan,
  trainingPlanStale,
  chatPendingStatus,
  messageInputRef,
  message,
  setMessage,
  sendChat,
  lastFailedMessage,
  submitChat,
  cancelChat,
}: {
  modelSettings: ReturnType<typeof useModelSettings>;
  conversationDrawerCloseRef: RefObject<HTMLButtonElement | null>;
  isConversationDrawerOpen: boolean;
  closeConversationDrawer: () => void;
  runInBackground: (work: Promise<unknown>) => void;
  startNewChat: () => Promise<void>;
  conversationRows: (
    ConversationSummary | { id: string; title: string; updatedAt: null }
  )[];
  conversationId: string | null | undefined;
  selectionError: string;
  retryConversationSelection: () => Promise<void>;
  closeConversationMenu: () => void;
  selectConversation: (id: string) => Promise<void>;
  openConversationMenuId: string | null;
  toggleConversationMenu: (itemId: string, trigger: HTMLButtonElement) => void;
  openConversationMenuItem:
    | ConversationSummary
    | { id: string; title: string; updatedAt: null }
    | undefined;
  conversationMenuPosition: { top: number; left: number } | null;
  conversationMenuRef: RefObject<HTMLDivElement | null>;
  loadChatHistory: (showStatus?: boolean, id?: string | null) => Promise<void>;
  isChatLoading: boolean;
  startConversationRename: (
    target: Pick<ConversationSummary, "id" | "title">,
    trigger?: HTMLElement,
  ) => void;
  deleteConversationById: (targetId: string, title: string) => Promise<void>;
  renameTarget: Pick<ConversationSummary, "title" | "id"> | null;
  cancelConversationRename: () => void;
  saveConversationRename: () => Promise<void>;
  renameInputRef: RefObject<HTMLInputElement | null>;
  renameTitle: string;
  renameError: string;
  setRenameTitle: Dispatch<SetStateAction<string>>;
  isRenamingConversation: boolean;
  transcriptRef: RefObject<HTMLDivElement | null>;
  handleTranscriptScroll: () => void;
  historyCursor: string | null;
  loadOlderMessages: () => Promise<void>;
  isHistoryLoading: boolean;
  chatMessages: ChatMessage[];
  trainingPlanState: TrainingPlanState;
  trainingPlan: TrainingPlan | null;
  trainingPlanStale: boolean;
  chatPendingStatus: TrainerProgress | null;
  messageInputRef: RefObject<HTMLTextAreaElement | null>;
  message: string;
  setMessage: Dispatch<SetStateAction<string>>;
  sendChat: () => Promise<void>;
  lastFailedMessage: string;
  submitChat: (text: string) => Promise<void>;
  cancelChat: () => void;
}) {
  return (
    <div className="chat-workspace">
      <aside
        className={`conversation-sidebar ${isConversationDrawerOpen ? "open" : ""}`}
        aria-label="Conversation history"
      >
        <div className="sidebar-header">
          <div>
            <p className="section-kicker">History</p>
            <strong>Conversations</strong>
          </div>
          <button
            type="button"
            className="chrome-button drawer-close"
            ref={conversationDrawerCloseRef}
            onClick={closeConversationDrawer}
          >
            Close
          </button>
        </div>
        <button
          type="button"
          className="primary-action"
          onClick={() => runInBackground(startNewChat())}
        >
          New chat
        </button>
        <div
          className="conversation-list"
          role="list"
          aria-label="Saved conversations"
        >
          {conversationRows.length ? (
            conversationRows.map((item) => (
              <div
                role="listitem"
                className={`conversation-item ${item.id === conversationId ? "active" : ""}`}
                key={item.id}
              >
                <button
                  type="button"
                  className="conversation-select"
                  onClick={() => {
                    closeConversationMenu();
                    runInBackground(selectConversation(item.id));
                  }}
                  aria-current={item.id === conversationId ? "true" : undefined}
                >
                  <span>{item.title}</span>
                  <small>{dateLabel(item.updatedAt)}</small>
                </button>
                <div className="conversation-menu-wrap">
                  <button
                    type="button"
                    className="conversation-menu-trigger"
                    data-conversation-menu-id={item.id}
                    aria-label={`Conversation options for "${item.title}"`}
                    aria-haspopup="menu"
                    aria-expanded={openConversationMenuId === item.id}
                    aria-controls={
                      openConversationMenuId === item.id
                        ? "conversation-row-menu"
                        : undefined
                    }
                    onClick={(event) => {
                      event.stopPropagation();
                      toggleConversationMenu(item.id, event.currentTarget);
                    }}
                  >
                    ⋯
                  </button>
                </div>
              </div>
            ))
          ) : (
            <p className="empty-chat">No saved conversations yet.</p>
          )}
        </div>
      </aside>
      {isConversationDrawerOpen ? (
        <button
          type="button"
          className="drawer-backdrop"
          aria-label="Close conversation drawer"
          onClick={closeConversationDrawer}
        />
      ) : null}
      {openConversationMenuItem && conversationMenuPosition ? (
        <div
          id="conversation-row-menu"
          className="conversation-menu conversation-menu-floating"
          ref={conversationMenuRef}
          role="menu"
          style={{
            top: conversationMenuPosition.top,
            left: conversationMenuPosition.left,
          }}
        >
          {openConversationMenuItem.id === conversationId ? (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                closeConversationMenu();
                runInBackground(loadChatHistory());
              }}
              disabled={isChatLoading}
            >
              Reload history
            </button>
          ) : null}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              startConversationRename(openConversationMenuItem);
            }}
            disabled={isRenamingConversation}
          >
            Rename
          </button>
          <button
            type="button"
            role="menuitem"
            className="danger-menu-item"
            onClick={() => {
              closeConversationMenu();
              runInBackground(
                deleteConversationById(
                  openConversationMenuItem.id,
                  openConversationMenuItem.title,
                ),
              );
            }}
            disabled={isChatLoading}
          >
            Delete
          </button>
        </div>
      ) : null}
      {renameTarget ? (
        <div className="modal-layer rename-dialog-layer">
          <button
            type="button"
            className="settings-backdrop"
            aria-label="Cancel rename"
            onClick={cancelConversationRename}
          />
          <form
            className="rename-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="rename-dialog-title"
            onSubmit={(event) => {
              event.preventDefault();
              runInBackground(saveConversationRename());
            }}
          >
            <div>
              <p className="section-kicker">Saved chat</p>
              <h2 id="rename-dialog-title">Rename conversation</h2>
            </div>
            <label htmlFor="conversation-rename-title">
              Conversation title
            </label>
            <input
              id="conversation-rename-title"
              ref={renameInputRef}
              value={renameTitle}
              onChange={(event) => setRenameTitle(event.target.value)}
              disabled={isRenamingConversation}
              maxLength={160}
            />
            <p className="helper-text">
              Saves a local title only; messages, Garmin data, Profile, and
              saved memories stay unchanged.
            </p>
            {renameError ? <p role="alert">{renameError}</p> : null}
            <div className="button-row rename-dialog-actions">
              <button
                type="button"
                className="chrome-button"
                onClick={cancelConversationRename}
                disabled={isRenamingConversation}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="primary-action"
                disabled={
                  isRenamingConversation || renameTitle.trim().length === 0
                }
              >
                {isRenamingConversation ? "Saving…" : "Save"}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      <section className="trainer-card" aria-labelledby="trainer-heading">
        <div className="trainer-heading-row">
          <p className="section-kicker">Daily trainer</p>
          <h2 id="trainer-heading">Chat with your private coach</h2>
        </div>

        {selectionError ? (
          <div role="alert">
            <p>{selectionError}</p>
            <button
              type="button"
              onClick={() => runInBackground(retryConversationSelection())}
            >
              Retry selection
            </button>
          </div>
        ) : conversationId === undefined ? (
          <p role="status">Loading conversation selection…</p>
        ) : conversationId === null ? (
          <p>No saved conversation. Choose New chat to begin.</p>
        ) : null}
        <div
          className="transcript"
          ref={transcriptRef}
          role="log"
          aria-label="Chat transcript"
          aria-live="polite"
          onScroll={handleTranscriptScroll}
        >
          {historyCursor ? (
            <button
              type="button"
              className="secondary-button load-older"
              onClick={() => runInBackground(loadOlderMessages())}
              disabled={isHistoryLoading}
            >
              {isHistoryLoading ? "Loading older…" : "Load older messages"}
            </button>
          ) : null}
          {chatMessages.length === 0 && !isChatLoading ? (
            <div className="empty-chat empty-chat-hero">
              <p>
                Start with the latest training question. Profile, Garmin data,
                diagnostics, and privacy controls are in Profile &amp; data;
                learned memory has its own Memory sheet.
              </p>
              {trainingPlanState === "loaded" &&
              (!trainingPlan || trainingPlanStale) ? (
                <div className="training-plan-suggestion">
                  <strong>
                    {trainingPlan
                      ? "Your Training Plan may be stale."
                      : "No Training Plan saved yet."}
                  </strong>
                  <span>
                    Ask chat to {trainingPlan ? "revise" : "create"} it, or open
                    the Training Plan section to edit Markdown manually.
                  </span>
                </div>
              ) : null}
            </div>
          ) : null}
          {chatMessages.map((item) => (
            <div key={item.id} className={`chat-message ${item.role}`}>
              <div className="chat-meta">
                <strong>{item.role === "user" ? "You" : "Trainer"}</strong>
                <time dateTime={item.createdAt}>
                  {new Date(item.createdAt).toLocaleString()}
                </time>
              </div>
              {item.role === "assistant" ? (
                <AssistantContent content={item.content} />
              ) : (
                <p>{item.content}</p>
              )}
              {hasVisibleGrounding(item.grounding) ? (
                <div
                  className="tool-evidence"
                  aria-label="Hidden grounding metadata available"
                >
                  <span>Used local Garmin data.</span>
                </div>
              ) : null}
            </div>
          ))}
          {isChatLoading && chatPendingStatus !== null ? (
            <div className="chat-message assistant pending">
              <div className="chat-meta">
                <strong>Trainer</strong>
                <span>pending</span>
              </div>
              <div className="pending-progress" aria-atomic="true">
                <p className="pending-thinking-text">
                  <span data-testid="pending-step-status">
                    {chatPendingStatus.message}
                  </span>
                  <span
                    className="pending-thinking-dots"
                    aria-hidden="true"
                    data-testid="pending-thinking-indicator"
                  >
                    <span />
                    <span />
                    <span />
                  </span>
                </p>
                {chatPendingStatus.counters ? (
                  <p
                    className="pending-counters"
                    data-testid="pending-counters"
                  >
                    Model calls: {chatPendingStatus.counters.modelCalls}
                    {" · "}Tools: {chatPendingStatus.counters.toolsSucceeded}{" "}
                    succeeded
                    {" · "}
                    {chatPendingStatus.counters.toolsUnsuccessful} unsuccessful
                  </p>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>

        <div className="composer-dock" aria-label="Message composer">
          <label className="message-composer">
            <span className="visually-hidden">Message</span>
            <textarea
              aria-label="Message"
              ref={messageInputRef}
              placeholder="Ask about my latest hike, then try: what should I do tomorrow based on that?"
              value={message}
              disabled={isChatLoading}
              onChange={(event) => setMessage(event.currentTarget.value)}
              onInput={(event) => setMessage(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  runInBackground(sendChat());
                }
              }}
            />
          </label>
          <div className="composer-actions">
            {lastFailedMessage && !isChatLoading ? (
              <button
                type="button"
                className="secondary-button"
                onClick={() => runInBackground(submitChat(lastFailedMessage))}
              >
                Retry
              </button>
            ) : null}
            {isChatLoading ? (
              <button
                type="button"
                className="secondary-button"
                onClick={cancelChat}
              >
                Cancel
              </button>
            ) : null}
            <div className="composer-submit-group">
              <ModelSettingsCard modelSettings={modelSettings} />
              <button
                type="button"
                className="primary-action"
                onClick={() => runInBackground(sendChat())}
                disabled={isChatLoading || !conversationId || !message.trim()}
              >
                {isChatLoading ? "Streaming…" : "Send"}
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
