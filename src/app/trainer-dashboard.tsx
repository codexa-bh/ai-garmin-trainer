"use client";
import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { ActivityView } from "./dashboard/activity-view";
import { MobileNavigationSheet } from "./mobile-navigation-sheet";
import { ChatView } from "./dashboard/chat-view";
import {
  type Status,
  type TranscriptScrollSnapshot,
} from "./dashboard/contracts";
import { HealthView } from "./dashboard/health-view";
import { MemoryContent } from "./dashboard/memory-content";
import { SettingsView } from "./dashboard/settings-view";
import { SyncView } from "./dashboard/sync-view";
import { WeeklyPlanView } from "./dashboard/weekly-plan-view";
import { useWeeklyFeature } from "./dashboard/use-weekly";
import { TrainingPlanView } from "./dashboard/training-plan-view";
import { useActivityFeature } from "./dashboard/use-activity";
import { useChatFeature } from "./dashboard/use-chat";
import { useDataControlsFeature } from "./dashboard/use-data-controls";
import { useHealthFeature } from "./dashboard/use-health";
import { useMemoryFeature } from "./dashboard/use-memory";
import { useProfileFeature } from "./dashboard/use-profile";
import { useSyncFeature } from "./dashboard/use-sync";
import { useTrainingPlanFeature } from "./dashboard/use-training-plan";

export function TrainerDashboard() {
  const [status, setStatus] = useState<Status>({
    kind: "idle",
    message:
      "Ready. Local trainer is available; verify the connector when needed.",
  });
  const [isConversationDrawerOpen, setIsConversationDrawerOpen] =
    useState(false);
  const [desktopSidebarExpanded, setDesktopSidebarExpanded] = useState(false);
  const [openConversationMenuId, setOpenConversationMenuId] = useState<
    string | null
  >(null);
  const [conversationMenuPosition, setConversationMenuPosition] = useState<{
    top: number;
    left: number;
  } | null>(null);
  const [isMainMenuOpen, setIsMainMenuOpen] = useState(false);
  const [activityDashboardOpen, setActivityDashboardOpen] = useState(false);
  const [trainingPlanOpen, setTrainingPlanOpen] = useState(false);
  const [syncOpen, setSyncOpen] = useState(false);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [healthDashboardOpen, setHealthDashboardOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const shouldAutoScrollRef = useRef(true);
  const forceNextScrollRef = useRef(false);
  const transcriptScrollSnapshotRef = useRef<TranscriptScrollSnapshot | null>(
    null,
  );
  const restoreTranscriptOnSectionReturnRef = useRef(false);
  const conversationButtonRef = useRef<HTMLButtonElement>(null);
  const activityDashboardButtonRef = useRef<HTMLButtonElement>(null);
  const activityDashboardCloseRef = useRef<HTMLButtonElement>(null);
  const activityDashboardReturnFocusRef = useRef(false);
  const trainingPlanButtonRef = useRef<HTMLButtonElement>(null);
  const trainingPlanCloseRef = useRef<HTMLButtonElement>(null);
  const trainingPlanReturnFocusRef = useRef(false);
  const syncButtonRef = useRef<HTMLButtonElement>(null);
  const syncCloseRef = useRef<HTMLButtonElement>(null);
  const syncLogRef = useRef<HTMLPreElement>(null);
  const syncReturnFocusRef = useRef(false);
  const memoryButtonRef = useRef<HTMLButtonElement>(null);
  const memoryCloseRef = useRef<HTMLButtonElement>(null);
  const memoryReturnFocusRef = useRef(false);
  const healthDashboardReturnFocusRef = useRef(false);
  const healthDashboardButtonRef = useRef<HTMLButtonElement | null>(null);
  const healthDashboardCloseRef = useRef<HTMLButtonElement | null>(null);
  const settingsButtonRef = useRef<HTMLButtonElement>(null);
  const settingsCloseRef = useRef<HTMLButtonElement>(null);
  const messageInputRef = useRef<HTMLTextAreaElement>(null);
  const conversationMenuRef = useRef<HTMLDivElement>(null);
  const mainMenuToggleRef = useRef<HTMLButtonElement>(null);
  const conversationDrawerCloseRef = useRef<HTMLButtonElement>(null);
  const {
    healthDashboardData,
    healthDashboardState,
    loadHealthDashboard,
    healthDashboardError,
    selectedHealthDayIndex,
    setSelectedHealthDayIndex,
  } = useHealthFeature();
  const {
    loadProfile,
    isProfileDirty,
    profileSaveState,
    profileSummary,
    profileMessage,
    profileFields,
    updateProfileField,
    profileControlsDisabled,
    saveProfile,
  } = useProfileFeature({ setStatus });
  const {
    loadTrainingPlan,
    setTrainingPlanEditing,
    trainingPlan,
    trainingPlanMessage,
    trainingPlanStale,
    trainingPlanStaleAfterDays,
    trainingPlanState,
    trainingPlanSaving,
    trainingPlanEditing,
    startTrainingPlanEdit,
    saveTrainingPlan,
    trainingPlanTitleDraft,
    setTrainingPlanTitleDraft,
    trainingPlanMarkdownDraft,
    setTrainingPlanMarkdownDraft,
    cancelTrainingPlanEdit,
  } = useTrainingPlanFeature({ setStatus });
  const weekly = useWeeklyFeature();
  const {
    loadMemories,
    setEditingMemoryId,
    setEditingMemoryText,
    memoryHealth,
    memoryItems,
    filteredMemories,
    memoryMessage,
    setMemoryEnabled,
    isMemoryLoading,
    actOnMemory,
    memorySearchQuery,
    setMemorySearchQuery,
    memoryKindFilter,
    setMemoryKindFilter,
    memorySort,
    setMemorySort,
    hasMemoryFilters,
    editingMemoryId,
    editingMemoryText,
  } = useMemoryFeature({ setStatus });
  const {
    loadActivities,
    activitySearchQuery,
    activitySelectorCollapsed,
    setActivitySelectorCollapsed,
    setActivitySearchQuery,
    activityListMessage,
    handleActivityListScroll,
    activityListState,
    activities,
    selectedActivityId,
    selectActivityDashboard,
    isActivityListLoadingMore,
    activityListNextOffset,
    activityListTotalApprox,
    activityDashboardState,
    activityDashboard,
  } = useActivityFeature({ runInBackground, setStatus });
  const { runAction, diagnosticsOpen, setDiagnosticsOpen } =
    useDataControlsFeature({ setStatus });
  const {
    loadImportSummary,
    syncRun,
    isSyncing,
    syncPillKind,
    syncPillLabel,
    syncNow,
    importSummary,
    refreshSummary,
    athleteBaselineMessage,
    athleteBaseline,
    bodyMetricsMessage,
    bodyMetrics,
    detailGarminId,
    setDetailGarminId,
    backfillDetail,
    refreshDetailCoverage,
  } = useSyncFeature({ setStatus, refreshHealthAfterSync, runAction });
  const {
    loadConversations,
    loadChatHistory,
    cancelConversationRename,
    conversationId,
    chatMessages,
    isChatLoading,
    chatPendingStatus,
    renameTarget,
    renameInputRef,
    conversationRows,
    startNewChat,
    selectConversation,
    startConversationRename,
    deleteConversationById,
    saveConversationRename,
    renameTitle,
    renameError,
    setRenameTitle,
    isRenamingConversation,
    historyCursor,
    loadOlderMessages,
    isHistoryLoading,
    message,
    setMessage,
    sendChat,
    lastFailedMessage,
    submitChat,
    cancelChat,
    llmDebugTracesEnabled,
    debugTraceMessages,
  } = useChatFeature({
    setStatus,
    setIsConversationDrawerOpen,
    conversationButtonRef,
    rememberTranscriptFollowIntent,
    forceNextScrollRef,
    transcriptRef,
    closeConversationMenu,
    runInBackground,
    loadMemories,
    loadTrainingPlan,
    loadWeekly: () => weekly.load(),
    messageInputRef,
  });

  // Domain handlers retain their own errors/cancellation. This final boundary
  // handles unexpected rejections without leaking response data or credentials.
  function runInBackground(work: Promise<unknown>): void {
    work.catch(() => {
      setStatus({
        kind: "error",
        message: "Unexpected background action failure. Please retry.",
      });
    });
  }

  // These effects react to navigation, not to changing render-local handler
  // identities. Effect Events read current state without restarting requests.
  const initializeLocalSession = useEffectEvent(() => {
    runInBackground(loadConversations(false));
    runInBackground(loadMemories(false));
    runInBackground(loadProfile("startup"));
    runInBackground(loadTrainingPlan("startup", false));
    runInBackground(loadImportSummary("startup", false));
  });
  const loadConversationHistory = useEffectEvent((id: string) => {
    runInBackground(loadChatHistory(false, id));
  });
  const restoreSectionTranscript = useEffectEvent(() =>
    restoreTranscriptScrollSnapshot(),
  );
  const cancelRenameFromKeyboard = useEffectEvent(() =>
    cancelConversationRename(),
  );
  const closeMemoryFromKeyboard = useEffectEvent(() => closeMemoryView());
  const closePlanFromKeyboard = useEffectEvent(() => closeTrainingPlan());
  const reloadOpenedPlan = useEffectEvent(() => {
    runInBackground(weekly.load());
    runInBackground(loadTrainingPlan("manual", false));
  });
  const reloadActivitySearch = useEffectEvent((query: string) => {
    runInBackground(loadActivities(query));
  });
  useEffect(() => {
    initializeLocalSession();
  }, []);
  useEffect(() => {
    loadConversationHistory(conversationId);
  }, [conversationId]);
  useLayoutEffect(() => {
    if (!forceNextScrollRef.current && !shouldAutoScrollRef.current) return;
    scrollTranscriptToBottom();
    forceNextScrollRef.current = false;
  }, [chatMessages, isChatLoading, chatPendingStatus]);
  useLayoutEffect(() => {
    if (activityDashboardOpen || trainingPlanOpen || syncOpen) return;
    if (!restoreTranscriptOnSectionReturnRef.current) return;
    restoreTranscriptOnSectionReturnRef.current = false;
    restoreSectionTranscript();
  }, [activityDashboardOpen, trainingPlanOpen, syncOpen]);
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (renameTarget) {
        cancelRenameFromKeyboard();
        return;
      }
      if (openConversationMenuId) {
        closeConversationMenu();
        return;
      }
      // The native mobile dialog owns Escape; never cascade to a destination.
      if (isMainMenuOpen) return;
      if (settingsOpen) {
        setSettingsOpen(false);
        focusMainNavigationControl(settingsButtonRef);
        return;
      }
      if (syncOpen) {
        closeSyncView();
        return;
      }
      if (memoryOpen) {
        closeMemoryFromKeyboard();
        return;
      }
      if (trainingPlanOpen) {
        closePlanFromKeyboard();
        return;
      }
      if (activityDashboardOpen) {
        closeActivityDashboard();
        return;
      }
      if (isConversationDrawerOpen) {
        setIsConversationDrawerOpen(false);
        focusMainNavigationControl(conversationButtonRef);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    isConversationDrawerOpen,
    openConversationMenuId,
    renameTarget,
    activityDashboardOpen,
    trainingPlanOpen,
    syncOpen,
    memoryOpen,
    settingsOpen,
    isMainMenuOpen,
  ]);
  useEffect(() => {
    if (settingsOpen) settingsCloseRef.current?.focus();
  }, [settingsOpen]);
  useEffect(() => {
    if (isConversationDrawerOpen) conversationDrawerCloseRef.current?.focus();
  }, [isConversationDrawerOpen]);
  useEffect(() => {
    if (activityDashboardOpen) {
      activityDashboardCloseRef.current?.focus();
      return;
    }
    if (activityDashboardReturnFocusRef.current) {
      activityDashboardReturnFocusRef.current = false;
      focusMainNavigationControl(activityDashboardButtonRef);
    }
  }, [activityDashboardOpen]);
  useEffect(() => {
    if (trainingPlanOpen) {
      trainingPlanCloseRef.current?.focus();
      reloadOpenedPlan();
      return;
    }
    if (trainingPlanReturnFocusRef.current) {
      trainingPlanReturnFocusRef.current = false;
      focusMainNavigationControl(trainingPlanButtonRef);
    }
  }, [trainingPlanOpen]);
  useEffect(() => {
    if (syncOpen) {
      syncCloseRef.current?.focus();
      return;
    }
    if (syncReturnFocusRef.current) {
      syncReturnFocusRef.current = false;
      focusMainNavigationControl(syncButtonRef);
    }
  }, [syncOpen]);
  useEffect(() => {
    if (memoryOpen) {
      memoryCloseRef.current?.focus();
      return;
    }
    if (memoryReturnFocusRef.current) {
      memoryReturnFocusRef.current = false;
      focusMainNavigationControl(memoryButtonRef);
    }
  }, [memoryOpen]);
  useEffect(() => {
    if (healthDashboardOpen) {
      healthDashboardCloseRef.current?.focus();
      return;
    }
    if (healthDashboardReturnFocusRef.current) {
      healthDashboardReturnFocusRef.current = false;
      focusMainNavigationControl(healthDashboardButtonRef);
    }
  }, [healthDashboardOpen]);
  useLayoutEffect(() => {
    const syncLog = syncLogRef.current;
    if (!syncLog || !syncOpen) return;
    syncLog.scrollTop = syncLog.scrollHeight;
  }, [syncOpen, syncRun.lines]);
  useEffect(() => {
    if (!activityDashboardOpen) return;
    reloadActivitySearch(activitySearchQuery);
  }, [activityDashboardOpen, activitySearchQuery]);
  useEffect(() => {
    if (renameTarget) renameInputRef.current?.focus();
  }, [renameTarget, renameInputRef]);

  useEffect(() => {
    if (!openConversationMenuId) return;
    function closeOnViewportChange() {
      closeConversationMenu();
    }
    window.addEventListener("resize", closeOnViewportChange);
    return () => {
      window.removeEventListener("resize", closeOnViewportChange);
    };
  }, [openConversationMenuId]);

  useEffect(() => {
    if (!openConversationMenuId) return;
    function closeOnOutsidePointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (conversationMenuRef.current?.contains(target)) return;
      if (target instanceof Element) {
        const trigger = target.closest(".conversation-menu-trigger");
        if (
          trigger instanceof HTMLElement &&
          trigger.dataset.conversationMenuId === openConversationMenuId
        ) {
          return;
        }
      }
      closeConversationMenu();
    }
    document.addEventListener("pointerdown", closeOnOutsidePointerDown);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointerDown);
    };
  }, [openConversationMenuId]);

  function closeConversationMenu() {
    setOpenConversationMenuId(null);
    setConversationMenuPosition(null);
  }

  function focusMainNavigationControl(
    ref: RefObject<HTMLButtonElement | null>,
  ) {
    const isNarrowViewport =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(max-width: 640px)").matches;
    if (isNarrowViewport) {
      mainMenuToggleRef.current?.focus();
      return;
    }
    ref.current?.focus();
  }

  function toggleConversationHistory() {
    setIsMainMenuOpen(false);
    const isMobileViewport =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(max-width: 960px)").matches;
    if (isMobileViewport) {
      setIsConversationDrawerOpen(true);
    } else {
      setDesktopSidebarExpanded((expanded) => !expanded);
    }
  }

  function openSyncFromNavigation() {
    setIsMainMenuOpen(false);
    openSyncView();
  }

  function openMemoryFromNavigation() {
    setIsMainMenuOpen(false);
    openMemoryView();
  }

  function openHealthDashboardFromNavigation() {
    setIsMainMenuOpen(false);
    openHealthDashboard();
  }

  function openActivityDashboardFromNavigation() {
    setIsMainMenuOpen(false);
    openActivityDashboard();
  }

  function openTrainingPlanFromNavigation() {
    setIsMainMenuOpen(false);
    openTrainingPlan();
  }

  function openSettingsFromNavigation() {
    setIsMainMenuOpen(false);
    setSettingsOpen(true);
  }

  function toggleConversationMenu(itemId: string, trigger: HTMLButtonElement) {
    if (openConversationMenuId === itemId) {
      closeConversationMenu();
      return;
    }

    const rect = trigger.getBoundingClientRect();
    const menuWidth = 184;
    const menuHeight = itemId === conversationId ? 150 : 104;
    const viewportWidth = window.innerWidth || 1024;
    const viewportHeight = window.innerHeight || 768;
    const left = Math.min(
      viewportWidth - menuWidth - 8,
      Math.max(8, rect.right - menuWidth),
    );
    const belowTop = rect.bottom + 6;
    const top =
      belowTop + menuHeight > viewportHeight - 8
        ? Math.max(8, rect.top - menuHeight - 6)
        : belowTop;

    setOpenConversationMenuId(itemId);
    setConversationMenuPosition({ top, left });
  }

  function closeSettingsSheet() {
    setSettingsOpen(false);
    focusMainNavigationControl(settingsButtonRef);
  }

  function closeConversationDrawer() {
    closeConversationMenu();
    setIsConversationDrawerOpen(false);
    focusMainNavigationControl(conversationButtonRef);
  }

  function transcriptIsNearBottom(): boolean {
    const transcript = transcriptRef.current;
    if (!transcript) return true;
    const remaining =
      transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight;
    return remaining <= 96;
  }

  function rememberTranscriptFollowIntent() {
    const wasNearBottom = transcriptIsNearBottom();
    shouldAutoScrollRef.current = wasNearBottom;
    const transcript = transcriptRef.current;
    if (!transcript) return;
    transcriptScrollSnapshotRef.current = {
      scrollTop: transcript.scrollTop,
      wasNearBottom,
    };
  }

  function handleTranscriptScroll() {
    rememberTranscriptFollowIntent();
  }

  function captureTranscriptScrollSnapshot() {
    rememberTranscriptFollowIntent();
  }

  function restoreTranscriptScrollSnapshot(retryIfLayoutMissing = true) {
    const transcript = transcriptRef.current;
    const snapshot = transcriptScrollSnapshotRef.current;
    if (!transcript || !snapshot) return;
    if (snapshot.wasNearBottom) {
      if (transcript.scrollHeight === 0 && retryIfLayoutMissing) {
        scheduleTranscriptScrollRestoreRetry();
        return;
      }
      scrollTranscriptToBottom();
      return;
    }

    const maxScrollTop = Math.max(
      0,
      transcript.scrollHeight - transcript.clientHeight,
    );
    if (maxScrollTop === 0 && snapshot.scrollTop > 0 && retryIfLayoutMissing) {
      scheduleTranscriptScrollRestoreRetry();
      return;
    }

    transcript.scrollTop = Math.min(
      Math.max(snapshot.scrollTop, 0),
      maxScrollTop,
    );
    shouldAutoScrollRef.current = transcriptIsNearBottom();
    transcriptScrollSnapshotRef.current = {
      scrollTop: transcript.scrollTop,
      wasNearBottom: shouldAutoScrollRef.current,
    };
  }

  function scheduleTranscriptScrollRestoreRetry() {
    if (typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(() =>
        restoreTranscriptScrollSnapshot(false),
      );
      return;
    }
    restoreTranscriptScrollSnapshot(false);
  }

  function openActivityDashboard() {
    captureTranscriptScrollSnapshot();
    setActivityDashboardOpen(true);
  }

  function openTrainingPlan() {
    captureTranscriptScrollSnapshot();
    setTrainingPlanOpen(true);
  }

  function openSyncView() {
    captureTranscriptScrollSnapshot();
    setSyncOpen(true);
  }

  function openMemoryView() {
    setMemoryOpen(true);
  }

  function openHealthDashboard() {
    captureTranscriptScrollSnapshot();
    setHealthDashboardOpen(true);
    if (healthDashboardData === null && healthDashboardState === "idle") {
      runInBackground(loadHealthDashboard());
    }
  }

  function scrollTranscriptToBottom() {
    const transcript = transcriptRef.current;
    if (!transcript) return;
    // Follow committed layout immediately. Smooth scrolling emits intermediate
    // scroll events that look like reader opt-out, and a sentinel omits padding.
    transcript.scrollTop = transcript.scrollHeight;
    shouldAutoScrollRef.current = true;
  }

  async function refreshHealthAfterSync() {
    if (healthDashboardOpen || healthDashboardData) {
      await loadHealthDashboard({ preserveSelectedDate: true });
    }
  }

  function closeActivityDashboard() {
    activityDashboardReturnFocusRef.current = true;
    restoreTranscriptOnSectionReturnRef.current = true;
    setActivityDashboardOpen(false);
  }

  function closeTrainingPlan() {
    trainingPlanReturnFocusRef.current = true;
    restoreTranscriptOnSectionReturnRef.current = true;
    setTrainingPlanOpen(false);
    setTrainingPlanEditing(false);
  }

  function closeSyncView() {
    syncReturnFocusRef.current = true;
    restoreTranscriptOnSectionReturnRef.current = true;
    setSyncOpen(false);
  }

  function closeMemoryView() {
    memoryReturnFocusRef.current = true;
    setMemoryOpen(false);
    setEditingMemoryId(null);
    setEditingMemoryText("");
  }

  function closeHealthDashboard() {
    healthDashboardReturnFocusRef.current = true;
    restoreTranscriptOnSectionReturnRef.current = true;
    setHealthDashboardOpen(false);
  }
  const openConversationMenuItem = conversationRows.find(
    (item) => item.id === openConversationMenuId,
  );

  const memoryManagementContent = (
    <MemoryContent
      memoryHealth={memoryHealth}
      memoryItems={memoryItems}
      filteredMemories={filteredMemories}
      memoryMessage={memoryMessage}
      runInBackground={runInBackground}
      setMemoryEnabled={setMemoryEnabled}
      isMemoryLoading={isMemoryLoading}
      loadMemories={loadMemories}
      actOnMemory={actOnMemory}
      memorySearchQuery={memorySearchQuery}
      setMemorySearchQuery={setMemorySearchQuery}
      memoryKindFilter={memoryKindFilter}
      setMemoryKindFilter={setMemoryKindFilter}
      memorySort={memorySort}
      setMemorySort={setMemorySort}
      hasMemoryFilters={hasMemoryFilters}
      editingMemoryId={editingMemoryId}
      editingMemoryText={editingMemoryText}
      setEditingMemoryText={setEditingMemoryText}
      setEditingMemoryId={setEditingMemoryId}
    />
  );

  return (
    <section
      className={`dashboard-shell ${desktopSidebarExpanded ? "" : "sidebar-collapsed"} ${activityDashboardOpen ? "activity-dashboard-active" : ""} ${trainingPlanOpen ? "training-plan-active" : ""} ${syncOpen ? "sync-view-active" : ""} ${healthDashboardOpen ? "health-dashboard-active" : ""}`}
      aria-label="AI trainer dashboard"
    >
      {!activityDashboardOpen &&
      !trainingPlanOpen &&
      !syncOpen &&
      !healthDashboardOpen ? (
        <header className="app-topbar">
          <div className="app-brand">
            <h1 className="app-title" title="Garmin AI Trainer">
              Garmin AI Trainer
            </h1>
          </div>
          <nav className="app-nav" aria-label="Main navigation">
            <button
              type="button"
              className="chrome-button sidebar-toggle"
              onClick={toggleConversationHistory}
              ref={conversationButtonRef}
              aria-label="Toggle conversation history"
              aria-expanded={desktopSidebarExpanded || isConversationDrawerOpen}
            >
              Conversations
            </button>
            <button
              type="button"
              className="chrome-button"
              onClick={openActivityDashboardFromNavigation}
              ref={activityDashboardButtonRef}
              aria-label="Activities"
              aria-expanded={activityDashboardOpen}
            >
              Activities
            </button>
            <button
              type="button"
              className="chrome-button"
              onClick={openHealthDashboardFromNavigation}
              ref={healthDashboardButtonRef}
              aria-label="Health"
              aria-expanded={healthDashboardOpen}
            >
              Health
            </button>
            <button
              type="button"
              className="chrome-button"
              onClick={openTrainingPlanFromNavigation}
              ref={trainingPlanButtonRef}
              aria-label="Training Plan"
              aria-expanded={trainingPlanOpen}
            >
              Training Plan
            </button>
            <button
              type="button"
              className="chrome-button sync-now-button"
              onClick={openSyncFromNavigation}
              ref={syncButtonRef}
              aria-label="Sync"
              aria-expanded={syncOpen}
            >
              {isSyncing ? "Sync · syncing" : "Sync"}
            </button>
            <button
              type="button"
              className="chrome-button"
              onClick={openMemoryFromNavigation}
              ref={memoryButtonRef}
              aria-label="Memory"
              aria-expanded={memoryOpen}
            >
              Memory
            </button>
            <button
              type="button"
              className="chrome-button"
              onClick={openSettingsFromNavigation}
              ref={settingsButtonRef}
              aria-label="Data & settings"
            >
              Settings
            </button>
          </nav>
          <div className="app-mobile-menu">
            <button
              type="button"
              className="chrome-button app-menu-toggle"
              onClick={() => setIsMainMenuOpen((open) => !open)}
              ref={mainMenuToggleRef}
              aria-haspopup="dialog"
              aria-expanded={isMainMenuOpen}
              aria-controls="app-main-menu"
            >
              Menu
            </button>
            <MobileNavigationSheet
              open={isMainMenuOpen}
              onDismiss={() => {
                setIsMainMenuOpen(false);
                focusMainNavigationControl(conversationButtonRef);
              }}
            >
              <button
                type="button"
                className="app-menu-item"
                onClick={toggleConversationHistory}
                aria-label="Toggle conversation history"
                aria-expanded={
                  desktopSidebarExpanded || isConversationDrawerOpen
                }
              >
                Conversations
              </button>
              <button
                type="button"
                className="app-menu-item"
                onClick={openActivityDashboardFromNavigation}
                aria-label="Activities"
              >
                Activities
              </button>
              <button
                type="button"
                className="app-menu-item"
                onClick={openHealthDashboardFromNavigation}
                aria-label="Health"
              >
                Health
              </button>
              <button
                type="button"
                className="app-menu-item"
                onClick={openTrainingPlanFromNavigation}
                aria-label="Training Plan"
              >
                Training Plan
              </button>
              <button
                type="button"
                className="app-menu-item"
                onClick={openSyncFromNavigation}
                aria-label="Sync"
              >
                {isSyncing ? "Sync · syncing" : "Sync"}
              </button>
              <button
                type="button"
                className="app-menu-item"
                onClick={openMemoryFromNavigation}
                aria-label="Memory"
              >
                Memory
              </button>
              <button
                type="button"
                className="app-menu-item"
                onClick={openSettingsFromNavigation}
                aria-label="Data & settings"
              >
                Settings
              </button>
            </MobileNavigationSheet>
          </div>
        </header>
      ) : null}

      {syncOpen ? (
        <SyncView
          closeSyncView={closeSyncView}
          syncCloseRef={syncCloseRef}
          syncPillKind={syncPillKind}
          syncPillLabel={syncPillLabel}
          runInBackground={runInBackground}
          syncNow={syncNow}
          isSyncing={isSyncing}
          syncRun={syncRun}
          syncLogRef={syncLogRef}
          importSummary={importSummary}
        />
      ) : null}

      {activityDashboardOpen ? (
        <ActivityView
          activitySelectorCollapsed={activitySelectorCollapsed}
          closeActivityDashboard={closeActivityDashboard}
          activityDashboardCloseRef={activityDashboardCloseRef}
          setActivitySelectorCollapsed={setActivitySelectorCollapsed}
          activitySearchQuery={activitySearchQuery}
          setActivitySearchQuery={setActivitySearchQuery}
          activityListMessage={activityListMessage}
          handleActivityListScroll={handleActivityListScroll}
          activityListState={activityListState}
          activities={activities}
          selectedActivityId={selectedActivityId}
          runInBackground={runInBackground}
          selectActivityDashboard={selectActivityDashboard}
          isActivityListLoadingMore={isActivityListLoadingMore}
          activityListNextOffset={activityListNextOffset}
          activityListTotalApprox={activityListTotalApprox}
          activityDashboardState={activityDashboardState}
          activityDashboard={activityDashboard}
        />
      ) : null}

      {trainingPlanOpen ? (
        <WeeklyPlanView
          weekly={weekly}
          close={closeTrainingPlan}
          closeRef={trainingPlanCloseRef}
          run={runInBackground}
          startChat={(text) => {
            setMessage(text);
            closeTrainingPlan();
          }}
        >
          <TrainingPlanView
            trainingPlan={trainingPlan}
            closeTrainingPlan={closeTrainingPlan}
            trainingPlanCloseRef={trainingPlanCloseRef}
            trainingPlanMessage={trainingPlanMessage}
            trainingPlanStale={trainingPlanStale}
            trainingPlanStaleAfterDays={trainingPlanStaleAfterDays}
            runInBackground={runInBackground}
            loadTrainingPlan={loadTrainingPlan}
            trainingPlanState={trainingPlanState}
            trainingPlanSaving={trainingPlanSaving}
            trainingPlanEditing={trainingPlanEditing}
            startTrainingPlanEdit={startTrainingPlanEdit}
            saveTrainingPlan={saveTrainingPlan}
            trainingPlanTitleDraft={trainingPlanTitleDraft}
            setTrainingPlanTitleDraft={setTrainingPlanTitleDraft}
            trainingPlanMarkdownDraft={trainingPlanMarkdownDraft}
            setTrainingPlanMarkdownDraft={setTrainingPlanMarkdownDraft}
            cancelTrainingPlanEdit={cancelTrainingPlanEdit}
          />
        </WeeklyPlanView>
      ) : null}

      {healthDashboardOpen ? (
        <HealthView
          closeHealthDashboard={closeHealthDashboard}
          healthDashboardCloseRef={healthDashboardCloseRef}
          healthDashboardState={healthDashboardState}
          healthDashboardError={healthDashboardError}
          healthDashboardData={healthDashboardData}
          selectedHealthDayIndex={selectedHealthDayIndex}
          setSelectedHealthDayIndex={setSelectedHealthDayIndex}
        />
      ) : null}

      {memoryOpen ? (
        <div className="modal-layer memory-sheet-layer" role="presentation">
          <button
            type="button"
            className="settings-backdrop"
            aria-label="Close memory"
            onClick={closeMemoryView}
          />
          <aside
            className="settings-sheet memory-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="memory-sheet-heading"
          >
            <header className="sheet-header">
              <div>
                <p className="section-kicker">Memory</p>
                <h2 id="memory-sheet-heading">Memory</h2>
              </div>
              <button
                type="button"
                className="chrome-button"
                onClick={closeMemoryView}
                ref={memoryCloseRef}
              >
                Close
              </button>
            </header>
            <div className="settings-groups memory-sheet-groups">
              {memoryManagementContent}
            </div>
          </aside>
        </div>
      ) : null}

      {!activityDashboardOpen &&
      !trainingPlanOpen &&
      !syncOpen &&
      !healthDashboardOpen ? (
        <ChatView
          conversationDrawerCloseRef={conversationDrawerCloseRef}
          isConversationDrawerOpen={isConversationDrawerOpen}
          closeConversationDrawer={closeConversationDrawer}
          runInBackground={runInBackground}
          startNewChat={startNewChat}
          conversationRows={conversationRows}
          conversationId={conversationId}
          closeConversationMenu={closeConversationMenu}
          selectConversation={selectConversation}
          openConversationMenuId={openConversationMenuId}
          toggleConversationMenu={toggleConversationMenu}
          openConversationMenuItem={openConversationMenuItem}
          conversationMenuPosition={conversationMenuPosition}
          conversationMenuRef={conversationMenuRef}
          loadChatHistory={loadChatHistory}
          isChatLoading={isChatLoading}
          startConversationRename={startConversationRename}
          deleteConversationById={deleteConversationById}
          renameTarget={renameTarget}
          cancelConversationRename={cancelConversationRename}
          saveConversationRename={saveConversationRename}
          renameInputRef={renameInputRef}
          renameTitle={renameTitle}
          renameError={renameError}
          setRenameTitle={setRenameTitle}
          isRenamingConversation={isRenamingConversation}
          transcriptRef={transcriptRef}
          handleTranscriptScroll={handleTranscriptScroll}
          historyCursor={historyCursor}
          loadOlderMessages={loadOlderMessages}
          isHistoryLoading={isHistoryLoading}
          chatMessages={chatMessages}
          trainingPlanState={trainingPlanState}
          trainingPlan={trainingPlan}
          trainingPlanStale={trainingPlanStale}
          chatPendingStatus={chatPendingStatus}
          messageInputRef={messageInputRef}
          message={message}
          setMessage={setMessage}
          sendChat={sendChat}
          lastFailedMessage={lastFailedMessage}
          submitChat={submitChat}
          cancelChat={cancelChat}
        />
      ) : null}

      {!activityDashboardOpen &&
      !trainingPlanOpen &&
      !syncOpen &&
      !healthDashboardOpen &&
      settingsOpen ? (
        <SettingsView
          closeSettingsSheet={closeSettingsSheet}
          settingsCloseRef={settingsCloseRef}
          isProfileDirty={isProfileDirty}
          profileSaveState={profileSaveState}
          profileSummary={profileSummary}
          profileMessage={profileMessage}
          profileFields={profileFields}
          updateProfileField={updateProfileField}
          profileControlsDisabled={profileControlsDisabled}
          runInBackground={runInBackground}
          saveProfile={saveProfile}
          loadProfile={loadProfile}
          runAction={runAction}
          refreshSummary={refreshSummary}
          athleteBaselineMessage={athleteBaselineMessage}
          athleteBaseline={athleteBaseline}
          bodyMetricsMessage={bodyMetricsMessage}
          bodyMetrics={bodyMetrics}
          detailGarminId={detailGarminId}
          setDetailGarminId={setDetailGarminId}
          backfillDetail={backfillDetail}
          refreshDetailCoverage={refreshDetailCoverage}
          llmDebugTracesEnabled={llmDebugTracesEnabled}
          debugTraceMessages={debugTraceMessages}
          diagnosticsOpen={diagnosticsOpen}
          setDiagnosticsOpen={setDiagnosticsOpen}
          status={status}
        />
      ) : null}
    </section>
  );
}
