import { addDays, validWeek, weeklyCalendar, weekInterval } from "./calendar";
import type {
  WeeklyChange,
  WeeklyDocument,
  WeeklyProposal,
  WeeklyRead,
  WeeklyRecord,
  WeeklyStore,
  WeeklyTurn,
} from "./contracts";
import {
  TRAINING_PLAN_CONTENT_MAX_LENGTH,
  TRAINING_PLAN_TITLE_MAX_LENGTH,
} from "../training-plan/limits";
import { hasSensitivePlanText } from "../training-plan/snapshot";

export function renderWeeklyProposal(proposal: WeeklyProposal): string {
  return `## Weekly draft — not saved\nProposal: ${proposal.id}\nCalendar basis: ${proposal.timeZone}\n\n${proposal.changes.map((change) => `### ${change.kind === "plan" ? "Plan" : "Review"}: ${change.weekStart} – ${addDays(change.weekStart, 6)}\n${change.kind === "review" ? `As of: ${change.asOf}\n` : ""}Title: ${change.title}\n\n${change.contentMarkdown}`).join("\n\n---\n\n")}\n\nConfirm this exact proposal to save ${proposal.changes.length === 2 ? "both documents together" : "this document"}, or ask for changes. Nothing above has been saved as a weekly artifact.`;
}
export function createWeekly(
  store: WeeklyStore,
  clock: () => Date,
  newId: () => string,
) {
  function read(weekStart: string): WeeklyRead {
    if (!validWeek(weekStart)) throw new Error("invalid_week");
    const record = store.read(weekStart);
    for (const doc of [record?.original, record?.latest, record?.review]) {
      if (doc && hasSensitivePlanText({ ...doc, revisedAt: doc.savedAt }))
        throw new Error("private_weekly_content");
    }
    return { weekStart, record };
  }
  function history(before: string, limit = 12) {
    if (
      !validWeek(before) ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 12
    )
      throw new Error("invalid_history_page");
    const items = store.history(before, limit + 1);
    return {
      items: items.slice(0, limit),
      next: items.length > limit ? items[limit - 1].weekStart : null,
    };
  }
  function validateChanges(changes: WeeklyChange[], turn: WeeklyTurn) {
    const now = clock();
    const calendar = weeklyCalendar(now, turn.timeZone);
    if (
      changes.length < 1 ||
      changes.length > 2 ||
      new Set(changes.map((c) => c.kind)).size !== changes.length
    )
      throw new Error("invalid_weekly_bundle");
    for (const change of changes) {
      if (!validWeek(change.weekStart)) throw new Error("invalid_week");
      if (
        !change.title.trim() ||
        change.title.length > TRAINING_PLAN_TITLE_MAX_LENGTH ||
        !change.contentMarkdown.trim() ||
        change.contentMarkdown.length > TRAINING_PLAN_CONTENT_MAX_LENGTH
      )
        throw new Error("invalid_document");
      if (hasSensitivePlanText({ ...change, revisedAt: now.toISOString() }))
        throw new Error("private_weekly_content");
      if (
        change.kind === "plan" &&
        ![calendar.weekStart, calendar.upcoming].includes(change.weekStart)
      )
        throw new Error("historical_or_distant_plan_read_only");
      if (change.kind === "review") {
        const asOf = change.asOf ? Date.parse(change.asOf) : NaN;
        if (
          !Number.isFinite(asOf) ||
          asOf > now.getTime() ||
          asOf < Date.parse(weekInterval(change.weekStart, turn.timeZone).from)
        )
          throw new Error("invalid_review_cutoff");
      }
    }
  }
  function propose(
    changes: WeeklyChange[],
    turn: WeeklyTurn,
    snapshots: WeeklyRead[],
  ): WeeklyProposal {
    validateChanges(changes, turn);
    return store.transaction(() => {
      const expected: WeeklyProposal["expected"] = {};
      for (const change of changes) {
        const snapshot = snapshots.find(
          (s) => s.weekStart === change.weekStart,
        );
        if (!snapshot) throw new Error("prior_complete_week_read_required");
        const current = read(change.weekStart).record;
        if (JSON.stringify(current) !== JSON.stringify(snapshot.record))
          throw new Error("week_changed_read_again");
        expected[change.weekStart] = current?.revision ?? null;
      }
      store.invalidate(turn.conversationId);
      const proposal: WeeklyProposal = {
        id: newId(),
        conversationId: turn.conversationId,
        turnId: turn.turnId,
        assistantId: null,
        createdAt: clock().toISOString(),
        timeZone: turn.timeZone,
        changes,
        expected,
        applied: false,
      };
      store.saveProposal(proposal);
      return proposal;
    });
  }
  function bindDisplayed(
    turnId: string,
    conversationId: string,
    assistantId: string,
    text: string,
  ) {
    const proposal = store.pending(conversationId);
    if (
      proposal &&
      proposal.turnId === turnId &&
      text.includes(renderWeeklyProposal(proposal))
    ) {
      store.saveProposal({ ...proposal, assistantId });
    }
  }
  function pending(turn: WeeklyTurn): WeeklyProposal | null {
    const proposal = store.pending(turn.conversationId);
    if (
      !proposal ||
      proposal.applied ||
      !proposal.assistantId ||
      proposal.assistantId !== turn.previousAssistantId ||
      !store.messageExists(proposal.assistantId, turn.conversationId) ||
      !store.isCurrentTurn(turn) ||
      clock().getTime() - Date.parse(proposal.createdAt) > 86400000
    )
      return null;
    return proposal;
  }
  // Shared transaction body: direct writes never manufacture proposal authority.
  function saveChanges(changes: WeeklyChange[], timeZone: string) {
    const reviewedRevisions = new Map(
      changes.map((change) => [
        change.weekStart,
        store.read(change.weekStart)?.latest?.revision ?? null,
      ]),
    );
    const saved: string[] = [];
    for (const change of changes) {
      const current = store.read(change.weekStart);
      const document: WeeklyDocument = {
        title: change.title,
        contentMarkdown: change.contentMarkdown,
        revision: newId(),
        savedAt: clock().toISOString(),
      };
      const record: WeeklyRecord = current ?? {
        weekStart: change.weekStart,
        timeZone,
        revision: newId(),
        original: null,
        latest: null,
        review: null,
      };
      if (change.kind === "plan") {
        record.original ??= document;
        record.latest = document;
      } else
        record.review = {
          ...document,
          asOf: change.asOf!,
          planRevision: reviewedRevisions.get(change.weekStart) ?? null,
        };
      record.revision = newId();
      store.save(record);
      saved.push(record.weekStart);
    }
    return {
      saved,
      targets: changes.map(({ weekStart, kind }) => ({ weekStart, kind })),
      status: "saved" as const,
    };
  }
  function save(
    changes: WeeklyChange[],
    turn: WeeklyTurn,
    snapshots: WeeklyRead[],
  ) {
    validateChanges(changes, turn);
    return store.transaction(() => {
      if (!store.isCurrentTurn(turn)) throw new Error("weekly_turn_superseded");
      for (const change of changes) {
        const snapshot = snapshots.find(
          (s) => s.weekStart === change.weekStart,
        );
        if (!snapshot) throw new Error("prior_complete_week_read_required");
        if (
          JSON.stringify(read(change.weekStart).record) !==
          JSON.stringify(snapshot.record)
        )
          throw new Error("week_changed_read_again");
      }
      return saveChanges(changes, turn.timeZone);
    });
  }
  function apply(id: string, turn: WeeklyTurn) {
    return store.transaction(() => {
      const proposal = pending(turn);
      if (!proposal || proposal.id !== id)
        throw new Error("proposal_unavailable_or_already_applied");
      if (proposal.timeZone !== turn.timeZone)
        throw new Error("calendar_changed_reconfirm");
      validateChanges(proposal.changes, turn);
      for (const [week, revision] of Object.entries(proposal.expected)) {
        if ((store.read(week)?.revision ?? null) !== revision)
          throw new Error("week_changed_reconfirm");
      }
      const result = saveChanges(proposal.changes, proposal.timeZone);
      store.saveProposal({ ...proposal, applied: true });
      return result;
    });
  }
  function context(turn: WeeklyTurn) {
    const calendar = weeklyCalendar(clock(), turn.timeZone);
    const current = store.read(calendar.weekStart);
    const upcoming = store.read(calendar.upcoming);
    return {
      calendar,
      currentPlan: Boolean(current?.latest),
      currentReview: Boolean(current?.review),
      upcomingPlan: Boolean(upcoming?.latest),
    };
  }
  return {
    read,
    history,
    save,
    propose,
    bindDisplayed,
    pending,
    apply,
    context,
  };
}
