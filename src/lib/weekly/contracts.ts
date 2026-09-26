export type WeeklyDocument = {
  title: string;
  contentMarkdown: string;
  revision: string;
  savedAt: string;
};
export type WeeklyRecord = {
  weekStart: string;
  timeZone: string;
  revision: string;
  original: WeeklyDocument | null;
  latest: WeeklyDocument | null;
  review:
    (WeeklyDocument & { asOf: string; planRevision: string | null }) | null;
};
export type WeeklySummary = Omit<
  WeeklyRecord,
  "original" | "latest" | "review"
> & {
  hasPlan: boolean;
  hasReview: boolean;
  reviewAsOf: string | null;
};
export type WeeklyChange = {
  weekStart: string;
  kind: "plan" | "review";
  title: string;
  contentMarkdown: string;
  asOf?: string;
};
export type WeeklyProposal = {
  id: string;
  conversationId: string;
  turnId: string;
  assistantId: string | null;
  createdAt: string;
  timeZone: string;
  changes: WeeklyChange[];
  expected: Record<string, string | null>;
  applied: boolean;
};
export type WeeklyTurn = {
  conversationId: string;
  turnId: string;
  previousAssistantId: string | null;
  timeZone: string;
};
export type WeeklyRead = { weekStart: string; record: WeeklyRecord | null };
export type WeeklyStore = {
  transaction<T>(action: () => T): T;
  read(weekStart: string): WeeklyRecord | null;
  history(before: string, limit: number): WeeklySummary[];
  save(record: WeeklyRecord): void;
  proposal(id: string): WeeklyProposal | null;
  pending(conversationId: string): WeeklyProposal | null;
  saveProposal(proposal: WeeklyProposal): void;
  invalidate(conversationId: string): void;
  messageExists(id: string, conversationId: string): boolean;
  isCurrentTurn(turn: WeeklyTurn): boolean;
};
