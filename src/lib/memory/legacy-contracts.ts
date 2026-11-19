export type TrainerMemory = {
  id: string;
  category: "learned_preference" | "temporary_constraint" | "commitment";
  value: string;
  provenanceText: string;
  expiresAt: Date | null;
  reconfirmAfter: Date | null;
};
