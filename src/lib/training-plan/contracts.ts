export type TrainingPlan = {
  title: string;
  contentMarkdown: string;
  revisedAt: string;
};

export type TrainingPlanStatus = {
  plan: TrainingPlan | null;
  stale: boolean;
  staleAfterDays: number;
};
